// app/src/routes/interceptions/scan-failed.js — Story 4.6
//
// GET /scan-failed — Interception page shown to customers whose catalog scan
// has failed during onboarding (AC#2, UX-DR3).
//
// Route behaviour:
//   - Requires auth (authMiddleware + rlsContext via plugin hooks)
//   - Looks up the latest FAILED scan_jobs row for the customer's marketplace
//   - Renders scan-failed.eta with { failureReason, keyUrl }
//   - If no FAILED row → redirect to / (stale bookmark guard)
//   - If scan_jobs status is COMPLETE → redirect to / (scan succeeded elsewhere)
//
// Architecture constraints:
//   - Named exports only (no default export)
//   - No .then() chains (async/await only)
//   - No console.log (pino only via req.log)
//   - No err.message in eta render paths — use safe PT-localized strings only
//   - RLS-aware client (req.db) — customer can only read their own scan_jobs rows
//   - JSDoc on exported function
//
// FR traceability: UX-DR3, FR15

import { authMiddleware } from '../../middleware/auth.js';
import { rlsContext, releaseRlsClient } from '../../middleware/rls-context.js';

/**
 * Register GET /scan-failed route (scan-failed interception page, Story 4.6 AC#2).
 *
 * Template data shape:
 * @typedef {{ failureReason: string, keyUrl: string }} ScanFailedViewData
 *
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance
 * @param {object} _opts - unused plugin options
 * @returns {Promise<void>}
 */
export async function scanFailedRoutes (fastify, _opts) {
  // Apply auth + RLS hooks to all routes in this encapsulated plugin scope.
  fastify.addHook('preHandler', authMiddleware);
  fastify.addHook('preHandler', rlsContext);
  fastify.addHook('onResponse', releaseRlsClient);

  // ---------------------------------------------------------------------------
  // GET /scan-failed
  // ---------------------------------------------------------------------------

  fastify.get('/scan-failed', async (req, reply) => {
    const customerId = req.user.id;

    // Look up the latest FAILED scan_jobs row for this customer's marketplace.
    // RLS-aware client (req.db) enforces customer-scoped access: customers can
    // only see their own scan_jobs rows (Story 4.2 RLS policy).
    const { rows } = await req.db.query(
      `SELECT sj.failure_reason, sj.status
       FROM scan_jobs sj
       JOIN customer_marketplaces cm ON cm.id = sj.customer_marketplace_id
       WHERE cm.customer_id = $1
       ORDER BY sj.started_at DESC
       LIMIT 1`,
      [customerId]
    );

    // No scan_jobs row at all → redirect to / (stale bookmark or no scan started)
    if (rows.length === 0) {
      req.log.info({ user_id: customerId }, 'scan-failed: no scan_jobs row found — redirecting to /');
      return reply.redirect('/', 302);
    }

    const { failure_reason: failureReason, status } = rows[0];

    // If the most recent scan is COMPLETE → redirect to / (onboarding succeeded)
    if (status === 'COMPLETE') {
      req.log.info({ user_id: customerId }, 'scan-failed: latest scan is COMPLETE — redirecting to /');
      return reply.redirect('/', 302);
    }

    // If the most recent scan is NOT FAILED (e.g., PENDING, RUNNING_*) →
    // redirect to / so customer doesn't see the error page for an in-progress scan.
    if (status !== 'FAILED') {
      req.log.info(
        { user_id: customerId, status },
        'scan-failed: latest scan is not FAILED — redirecting to /'
      );
      return reply.redirect('/', 302);
    }

    // Translate failure_reason to a safe PT-localized display message.
    // Per arch constraint (no-raw-error-to-template): do NOT render raw error
    // strings from DB columns directly. The failure_reason column stores
    // PT-localized strings written by the worker (onboarding-scan.js) — these
    // are safe for display. If null or empty, use a generic fallback.
    const safeFailureReason = (typeof failureReason === 'string' && failureReason.trim().length > 0)
      ? failureReason.trim()
      : 'Ocorreu um erro inesperado durante a análise do catálogo. Por favor tenta novamente.';

    const keyUrl = '/onboarding/key';

    req.log.info({ user_id: customerId }, 'scan-failed: rendering interception page');

    /**
     * Template data: ScanFailedViewData
     * @type {ScanFailedViewData}
     */
    return reply.view('pages/scan-failed.eta', {
      title: 'Análise falhou',
      failureReason: safeFailureReason,
      keyUrl,
    });
  });
}
