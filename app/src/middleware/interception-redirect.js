// app/src/middleware/interception-redirect.js — Story 4.6
//
// Fastify preHandler middleware that intercepts authenticated requests to `/`
// and redirects to interception pages when the customer's account state
// requires attention (UX-DR3).
//
// Must run AFTER authMiddleware and rlsContext (requires req.user and req.db).
//
// Story 4.6 — scan-failed interception:
//   cron_state = PROVISIONING AND latest scan_jobs row is FAILED → /scan-failed
//
// Story 4.9 — forward-only UX-DR2:
//   cron_state = PROVISIONING AND no FAILED scan → /onboarding/scan
//
// Epic 8 stories will extend this middleware with additional interceptions:
//   // Epic 8: PAUSED_BY_KEY_REVOKED → /key-revoked
//   // Epic 8: PAUSED_BY_PAYMENT_FAILURE → /payment-failed
//
// Architecture constraints:
//   - Named exports only (no default export)
//   - No .then() chains (async/await only)
//   - No console.log (pino only via req.log)
//   - RLS-aware client (req.db) — scoped to authenticated customer

/**
 * Fastify preHandler: intercept requests to `/` for customers whose account
 * state requires attention. Redirects to the appropriate interception page.
 *
 * Story 4.6 implements the scan-failed interception (UX-DR3).
 * Epic 8 will extend this with key-revoked and payment-failed interceptions.
 *
 * Must run after authMiddleware and rlsContext (requires req.user and req.db).
 *
 * @param {import('fastify').FastifyRequest} req - Fastify request
 * @param {import('fastify').FastifyReply} reply - Fastify reply
 * @returns {Promise<void>}
 */
export async function interceptionRedirect (req, reply) {
  // Fail-loud guard: requires authMiddleware and rlsContext as prior hooks.
  if (!req.user || !req.db) {
    throw new Error(
      'interception-redirect requires authMiddleware + rlsContext as prior preHandler hooks'
    );
  }

  const customerId = req.user.id;

  // ── Story 4.6: scan-failed interception ────────────────────────────────────
  // Check cron_state = PROVISIONING AND latest scan_jobs row is FAILED.
  // A customer re-validating their key after a scan failure will be in
  // PROVISIONING until the new scan completes (PROVISIONING → DRY_RUN).
  // Once cron_state advances past PROVISIONING, the scan failure is resolved —
  // do NOT intercept.
  const { rows } = await req.db.query(
    `SELECT cm.cron_state, sj.status AS scan_status
     FROM customer_marketplaces cm
     LEFT JOIN LATERAL (
       SELECT status
       FROM scan_jobs
       WHERE customer_marketplace_id = cm.id
       ORDER BY started_at DESC
       LIMIT 1
     ) sj ON true
     WHERE cm.customer_id = $1
     LIMIT 1`,
    [customerId]
  );

  if (rows.length > 0) {
    const { cron_state: cronState, scan_status: scanStatus } = rows[0];

    // Story 4.6: scan-failed interception
    if (cronState === 'PROVISIONING' && scanStatus === 'FAILED') {
      req.log.info(
        { user_id: customerId, cron_state: cronState, scan_status: scanStatus },
        'interception-redirect: scan-failed interception triggered'
      );
      return reply.redirect('/scan-failed', 302);
    }

    // Story 4.9: UX-DR2 forward-only — PROVISIONING without a FAILED scan
    // (scan not started, pending, or in-progress) redirects to /onboarding/scan.
    if (cronState === 'PROVISIONING') {
      req.log.info(
        { user_id: customerId, cron_state: cronState },
        'interception-redirect: PROVISIONING customer redirected to /onboarding/scan'
      );
      return reply.redirect('/onboarding/scan', 302);
    }

    // Epic 8 stories add additional interceptions here:
    // if (cronState === 'PAUSED_BY_KEY_REVOKED') {
    //   return reply.redirect('/key-revoked', 302);
    // }
    // if (cronState === 'PAUSED_BY_PAYMENT_FAILURE') {
    //   return reply.redirect('/payment-failed', 302);
    // }
  }

  // No interception triggered — allow the request to proceed to the dashboard handler.
}
