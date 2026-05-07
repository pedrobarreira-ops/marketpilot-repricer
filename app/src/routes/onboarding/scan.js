// app/src/routes/onboarding/scan.js
//
// Story 4.5 — Scan progress page + /status polling endpoint.
//
// GET  /onboarding/scan         → render progress page (AC#1, AC#4, AC#5)
// GET  /onboarding/scan/status  → JSON polling endpoint (AC#2, AC#3); rate-limited 5 req/sec
//
// Critical constraints (do NOT relax):
//   - No raw fetch() — DB access only via req.db (RLS-aware client, rls-context.js)
//   - No export default — named export only (ESLint AD convention)
//   - No .then() chains — async/await only
//   - No console.log — pino only (req.log)
//   - No new npm packages — @fastify/rate-limit already in package.json
//   - scan_jobs queried via customer_marketplace_id FK, not customer_id directly
//   - Rate limit ONLY on /status — not on the page itself
//   - No writeAuditEvent — no audit events for scan progress page loads or polls

import { authMiddleware } from '../../middleware/auth.js';
import { rlsContext, releaseRlsClient } from '../../middleware/rls-context.js';

/**
 * Map scan_jobs.status to 1-indexed checklist phase number (AC#1).
 * COMPLETE and FAILED are never rendered (redirects fire first).
 */
const PHASE_MAP = {
  PENDING: 1,
  RUNNING_A01: 1,
  RUNNING_PC01: 1,
  RUNNING_OF21: 2,
  RUNNING_P11: 3,
  CLASSIFYING_TIERS: 3,
  SNAPSHOTTING_BASELINE: 4,
  COMPLETE: 5,
  FAILED: 5,
};


/**
 * Register GET /onboarding/scan and GET /onboarding/scan/status routes.
 * Auth guard (authMiddleware) and RLS context (rlsContext + releaseRlsClient)
 * are applied to the entire encapsulated plugin scope via hooks.
 *
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance
 * @param {object} _opts - unused plugin options
 * @returns {Promise<void>} resolves once routes are registered
 */
export async function scanRoutes (fastify, _opts) {
  // Auth guard: skip if req.user is already set (e.g. by test harness).
  // In production, req.user is never pre-populated by upstream code, so
  // authMiddleware always runs. Defense in depth: if a future middleware
  // ever pre-populates req.user without the production shape, rls-context.js
  // line 37 fails loud ("rls-context requires auth.js as a prior preHandler
  // hook") because req.user.access_token is missing — so a partial bypass
  // here cannot silently reach the DB layer.
  fastify.addHook('preHandler', async (req, reply) => {
    if (!req.user) {
      await authMiddleware(req, reply);
    }
  });
  // RLS context: skip if req.db is already set (e.g. by test harness).
  fastify.addHook('preHandler', async (req, reply) => {
    if (!req.db) {
      await rlsContext(req, reply);
    }
  });
  fastify.addHook('onResponse', releaseRlsClient);

  // ---------------------------------------------------------------------------
  // GET /onboarding/scan — progress page (AC#1, AC#4, AC#5)
  // ---------------------------------------------------------------------------

  fastify.get('/onboarding/scan', async (req, reply) => {
    const customerId = req.user.id;

    // Step 1: check customer_marketplaces row (UX-DR2 guard — AC#4)
    const cmResult = await req.db.query(
      `SELECT id, cron_state FROM customer_marketplaces WHERE customer_id = $1 LIMIT 1`,
      [customerId]
    );

    // No customer_marketplaces row → redirect to key entry
    if (cmResult.rows.length === 0) {
      return reply.redirect('/onboarding/key', 302);
    }

    const cm = cmResult.rows[0];

    // cron_state is NOT 'PROVISIONING' → customer has moved past onboarding (UX-DR2)
    if (cm.cron_state !== 'PROVISIONING') {
      return reply.redirect('/', 302);
    }

    // Step 2: check scan_jobs row
    const sjResult = await req.db.query(
      `SELECT id, status, phase_message, skus_total, skus_processed, started_at, completed_at
       FROM scan_jobs
       WHERE customer_marketplace_id = $1
       ORDER BY started_at DESC
       LIMIT 1`,
      [cm.id]
    );

    // PROVISIONING + no scan_jobs row → key was never fully validated / scan not started
    if (sjResult.rows.length === 0) {
      return reply.redirect('/onboarding/key', 302);
    }

    const row = sjResult.rows[0];

    // Terminal status redirects (fire before progress page renders)
    if (row.status === 'COMPLETE') {
      return reply.redirect('/onboarding/scan-ready', 302);
    }
    if (row.status === 'FAILED') {
      return reply.redirect('/scan-failed', 302);
    }

    // Happy path: in-flight scan → render progress page
    const activePhase = PHASE_MAP[row.status] ?? 1;

    req.log.info({ customerId, scanStatus: row.status, activePhase }, 'scan-progress: rendering progress page');

    return reply.view('pages/onboarding-scan.eta', {
      currentStatus: row.status,
      phaseMessage: row.phase_message,
      skusTotal: row.skus_total,
      skusProcessed: row.skus_processed,
      activePhase,
    });
  });

  // ---------------------------------------------------------------------------
  // GET /onboarding/scan/status — JSON polling endpoint (AC#2, AC#3)
  // Rate-limited to 5 req/sec per customer (AC#3)
  // ---------------------------------------------------------------------------

  fastify.get('/onboarding/scan/status', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 second',
        // AC#3: rate-limit "5 req/sec per customer". Default keyGenerator
        // uses request.ip which collapses customers behind shared NAT (corp
        // proxy, mobile carrier) into one budget. Key by req.user.id so the
        // budget is truly per-customer; auth middleware has already populated
        // req.user before this route runs (preHandler order).
        keyGenerator: (req) => req.user?.id ?? req.ip,
      },
    },
  }, async (req, reply) => {
    const customerId = req.user.id;

    // Step 1: resolve customer_marketplace_id from customer_id
    const cmResult = await req.db.query(
      `SELECT id FROM customer_marketplaces WHERE customer_id = $1 LIMIT 1`,
      [customerId]
    );

    if (cmResult.rows.length === 0) {
      return reply.code(404).send({ error: 'Nenhuma análise encontrada.' });
    }

    const cmId = cmResult.rows[0].id;

    // Step 2: fetch latest scan_jobs row
    const sjResult = await req.db.query(
      `SELECT id, status, phase_message, skus_total, skus_processed, started_at, completed_at
       FROM scan_jobs
       WHERE customer_marketplace_id = $1
       ORDER BY started_at DESC
       LIMIT 1`,
      [cmId]
    );

    if (sjResult.rows.length === 0) {
      return reply.code(404).send({ error: 'Nenhuma análise encontrada.' });
    }

    const row = sjResult.rows[0];

    // Return the 6-field shape (AC#3)
    return reply.code(200).send({
      status: row.status,
      phase_message: row.phase_message,
      skus_total: row.skus_total,
      skus_processed: row.skus_processed,
      started_at: row.started_at,
      completed_at: row.completed_at,
    });
  });
}
