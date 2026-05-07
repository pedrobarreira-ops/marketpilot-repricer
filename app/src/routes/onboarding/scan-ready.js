// app/src/routes/onboarding/scan-ready.js
//
// Story 4.7 — Scan-ready interstitial /onboarding/scan-ready (UX-DR33-34)
//
// GET /onboarding/scan-ready → catalog quality summary with live counts.
//
// Count semantics (verified against worker/src/jobs/onboarding-scan.js Story 4.4):
//   scan_jobs.skus_total     = unique EAN-bearing SKUs loaded into skus table
//   scan_jobs.skus_processed = total OF21 offers paginated (including EAN-less)
//   noEanCount               = skus_processed - skus_total (EAN-less offers skipped)
//   totalOffers              = skus_total + noEanCount  (= skus_processed)
//   readyCount               = sku_channels WHERE tier IN ('1','2a','2b')
//   noCompetitorCount        = sku_channels WHERE tier = '3'
//
// Critical constraints (do NOT relax):
//   - No writeAuditEvent — this is a read-only page; no AD20 event type exists
//   - No console.log — pino only (req.log)
//   - No .then() chains — async/await only
//   - RLS-aware client only: req.db from rls-context.js middleware
//   - No cron_state UPDATE — do NOT touch customer_marketplaces via cron-state.js
//   - No new migrations — reads only skus, sku_channels, scan_jobs (existing)
//   - Phase 2 DRY_RUN revisit: allow render when cron_state = DRY_RUN and
//     margin not yet set; redirect to / only for ACTIVE/PAUSED_* states.
//     Leave a comment to tighten this guard in Story 4.8 or 4.9.

import { authMiddleware } from '../../middleware/auth.js';
import { rlsContext, releaseRlsClient } from '../../middleware/rls-context.js';

const ACTIVE_STATES = [
  'ACTIVE',
  'PAUSED_BY_CUSTOMER',
  'PAUSED_BY_PAYMENT_FAILURE',
  'PAUSED_BY_CIRCUIT_BREAKER',
  'PAUSED_BY_KEY_REVOKED',
  'PAUSED_BY_ACCOUNT_GRACE_PERIOD',
];

/**
 * Register GET /onboarding/scan-ready.
 * Auth guard (authMiddleware) and RLS context (rlsContext + releaseRlsClient)
 * are applied to the entire encapsulated plugin scope via hooks.
 *
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance
 * @param {object} _opts - unused plugin options
 * @returns {Promise<void>} resolves once routes are registered
 */
export async function scanReadyRoutes (fastify, _opts) {
  // Apply auth + RLS hooks to all routes in this plugin (encapsulated scope)
  fastify.addHook('preHandler', authMiddleware);
  fastify.addHook('preHandler', rlsContext);
  fastify.addHook('onResponse', releaseRlsClient);

  // ---------------------------------------------------------------------------
  // GET /onboarding/scan-ready
  // ---------------------------------------------------------------------------

  fastify.get('/onboarding/scan-ready', async (req, reply) => {
    const customerId = req.user.id;

    // 1. Fetch customer_marketplace row for cron_state + ID
    const { rows: cmRows } = await req.db.query(
      `SELECT id, cron_state FROM customer_marketplaces WHERE customer_id = $1 LIMIT 1`,
      [customerId]
    );
    const cm = cmRows[0] ?? null;

    // 2. UX-DR2 forward-only routing guards

    // No marketplace row yet → redirect to scan (no key entered)
    if (!cm || cm.cron_state === 'PROVISIONING') {
      return reply.redirect('/onboarding/scan', 302);
    }

    // ACTIVE or PAUSED_* → customer has already passed onboarding → dashboard
    if (ACTIVE_STATES.includes(cm.cron_state)) {
      return reply.redirect('/', 302);
    }

    // DRY_RUN — check latest scan_jobs status
    // Fetch skus_total + skus_processed from the most recent scan_jobs row
    const { rows: scanJobRows } = await req.db.query(
      `SELECT status, skus_total, skus_processed FROM scan_jobs
       WHERE customer_marketplace_id = $1
       ORDER BY started_at DESC LIMIT 1`,
      [cm.id]
    );
    const latestScan = scanJobRows[0] ?? null;

    // DRY_RUN + FAILED scan → redirect to scan-failed interstitial (Story 4.6)
    if (latestScan?.status === 'FAILED') {
      return reply.redirect('/scan-failed', 302);
    }

    // Phase 2: add session flag or margin_set_at column to make the DRY_RUN revisit
    // guard stricter (redirect to / when margin already set). For MVP, DRY_RUN customers
    // revisiting this page get the idempotent summary — counts are still valid.

    // 3. Count queries (parallel) — RLS ensures customer sees only their own rows
    const customerMarketplaceId = cm.id;

    const [
      { rows: [{ total_skus }] },
      { rows: [{ ready_count }] },
      { rows: [{ no_competitor_count }] },
    ] = await Promise.all([
      req.db.query(
        `SELECT COUNT(*)::int AS total_skus FROM skus WHERE customer_marketplace_id = $1`,
        [customerMarketplaceId]
      ),
      req.db.query(
        `SELECT COUNT(*)::int AS ready_count FROM sku_channels
         WHERE customer_marketplace_id = $1 AND tier IN ('1', '2a', '2b')`,
        [customerMarketplaceId]
      ),
      req.db.query(
        `SELECT COUNT(*)::int AS no_competitor_count FROM sku_channels
         WHERE customer_marketplace_id = $1 AND tier = '3'`,
        [customerMarketplaceId]
      ),
    ]);

    // skus_processed = total OF21 offers (EAN-bearing + EAN-less)
    // skus_total = EAN-bearing unique count only (matches COUNT(skus) rows)
    // noEanCount = skus_processed - skus_total (offers skipped for missing EAN)
    const skusTotal = latestScan?.skus_total ?? 0;
    const skusProcessed = latestScan?.skus_processed ?? 0;
    const noEanCount = Math.max(0, skusProcessed - skusTotal);

    // "X produtos encontrados no Worten" = all OF21 offers seen (EAN-bearing + EAN-less)
    const totalOffers = total_skus + noEanCount;

    req.log.info(
      {
        customer_marketplace_id: customerMarketplaceId,
        total_offers: totalOffers,
        ready_count,
        no_competitor_count,
        no_ean_count: noEanCount,
      },
      'scan-ready: counts computed'
    );

    return reply.view('pages/onboarding-scan-ready.eta', {
      totalOffers,                        // "X produtos encontrados no Worten"
      readyCount: ready_count,            // "Y prontos para repricing"
      noCompetitorCount: no_competitor_count, // "Z sem competidores"
      noEanCount,                         // "W sem EAN no Worten — ignorados"
    });
  });
}
