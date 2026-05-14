// app/src/middleware/interception-redirect.js — Story 4.6 + Story 8.1
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
// Story 8.1 — Epic 8 interceptions (UX-DR3, UX-DR32):
//   PAUSED_BY_KEY_REVOKED → /key-revoked (first login post-transition only)
//   PAUSED_BY_PAYMENT_FAILURE → /payment-failed (first login post-transition only)
//   Subsequent visits in same state → render `/` with persistent red banner (no redirect)
//   Once-per-transition tracking via req.session.shownInterceptionFor
//
// Architecture constraints:
//   - Named exports only (no default export)
//   - No .then() chains (async/await only)
//   - No console.log (pino only via req.log)
//   - RLS-aware client (req.db) — scoped to authenticated customer

// Cookie name for UX-DR32 once-per-transition interception tracking.
// Signed cookie containing { state, since } JSON — avoids a new session dep.
const INTERCEPTION_COOKIE_NAME = 'mp_interception';

// Story 8.1 — Epic 8 interception targets (UX-DR3, UX-DR32).
// Spec AC#1: first login post-state-transition → 302 to interception page.
// Subsequent visits in same state → pass through (dashboard banner only).
// Pages themselves are owned by Story 8.9.
const INTERCEPTION_TARGETS = {
  PAUSED_BY_KEY_REVOKED: '/key-revoked',
  PAUSED_BY_PAYMENT_FAILURE: '/payment-failed',
};

/**
 * Read the shownInterceptionFor tracking object from req.session or cookie.
 * Unit tests inject req.session directly via a global preHandler.
 * Production uses a signed cookie via @fastify/cookie.
 *
 * @param {import('fastify').FastifyRequest} req
 * @returns {{ state: string, since: string } | null}
 */
function readInterceptionFlag (req) {
  // Test injection path: req.session is set by global preHandler in tests.
  if (req.session?.shownInterceptionFor) {
    return req.session.shownInterceptionFor;
  }

  // Production path: read from signed cookie.
  if (req.cookies?.[INTERCEPTION_COOKIE_NAME]) {
    try {
      const unsigned = req.unsignCookie(req.cookies[INTERCEPTION_COOKIE_NAME]);
      if (unsigned.valid && unsigned.value) {
        return JSON.parse(unsigned.value);
      }
    } catch {
      // Malformed cookie — treat as no flag set (fire interception).
    }
  }

  return null;
}

/**
 * Write the shownInterceptionFor tracking object to req.session or cookie.
 * Unit tests read req.session directly; production sets a signed cookie.
 *
 * @param {import('fastify').FastifyRequest} req
 * @param {import('fastify').FastifyReply} reply
 * @param {{ state: string, since: string }} flag
 */
function writeInterceptionFlag (req, reply, flag) {
  // Test injection path: mutate req.session so tests can inspect.
  if (req.session !== undefined) {
    req.session.shownInterceptionFor = flag;
    return;
  }

  // Production path: set a signed cookie (httpOnly, sameSite=lax).
  // The flag persists until state transitions again — keyed by state+since pair.
  //
  // Failure mode (UX-DR32 fail-open): if signCookie throws (e.g. COOKIE_SECRET
  // missing / @fastify/cookie not configured for signing), the flag is not
  // persisted. The customer then sees the interception redirect on every visit
  // until the cookie can be written. Log at error level so this is visible in
  // ops dashboards — the catch is required so the redirect itself still fires
  // (interception fail-open is worse than the redirect succeeding once and
  // failing to be remembered).
  try {
    const signed = reply.signCookie(JSON.stringify(flag));
    reply.setCookie(INTERCEPTION_COOKIE_NAME, signed, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
  } catch (err) {
    req.log.error(
      { err, state: flag.state },
      'interception-redirect: failed to write interception cookie — customer will see interception on every visit until cookie signing is restored'
    );
  }
}

/**
 * Fastify preHandler: intercept requests to `/` for customers whose account
 * state requires attention. Redirects to the appropriate interception page.
 *
 * Story 4.6 implements the scan-failed interception (UX-DR3).
 * Story 8.1 extends with key-revoked and payment-failed interceptions (UX-DR3, UX-DR32).
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

  // ── Query: cron_state + state_updated_at + scan_jobs status ───────────────
  // Story 8.1 extends the original Story 4.6 query to include updated_at for
  // once-per-transition tracking (UX-DR32). The updated_at timestamp changes
  // whenever cron_state transitions — used as the "transition fingerprint".
  const { rows } = await req.db.query(
    `SELECT cm.cron_state, cm.updated_at AS state_updated_at, sj.status AS scan_status
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
    const { cron_state: cronState, state_updated_at: stateUpdatedAt, scan_status: scanStatus } = rows[0];

    // ── Story 4.6: scan-failed interception ──────────────────────────────────
    if (cronState === 'PROVISIONING' && scanStatus === 'FAILED') {
      req.log.info(
        { user_id: customerId, cron_state: cronState, scan_status: scanStatus },
        'interception-redirect: scan-failed interception triggered'
      );
      return reply.redirect('/scan-failed', 302);
    }

    // ── Story 4.9: UX-DR2 forward-only ───────────────────────────────────────
    // PROVISIONING without a FAILED scan → redirect to onboarding scan flow.
    if (cronState === 'PROVISIONING') {
      req.log.info(
        { user_id: customerId, cron_state: cronState },
        'interception-redirect: PROVISIONING customer redirected to /onboarding/scan'
      );
      return reply.redirect('/onboarding/scan', 302);
    }

    // ── Story 8.1: Epic 8 interceptions (UX-DR3, UX-DR32) ────────────────────
    // PAUSED_BY_KEY_REVOKED and PAUSED_BY_PAYMENT_FAILURE each trigger a one-time
    // interception redirect to /key-revoked or /payment-failed respectively, on
    // the first login post-state-transition. Subsequent visits in the same state
    // render the dashboard with a persistent red banner (no second redirect).
    //
    // The interception pages themselves ship in Story 8.9 (see Epic-8 distillate
    // §Story 8.9 — `app/src/routes/interceptions/key-revoked.js` + payment-failed.js).
    // Story 8.1's responsibility is the upstream redirect; Story 8.9 owns the
    // destination pages and their action CTAs (Stripe portal for payment-failed,
    // rotation flow for key-revoked).
    //
    // Once-per-transition tracking: compare the read interception flag against
    // { state: cronState, since: stateUpdatedAt.toISOString() }. If they match,
    // the interception was already shown — pass through.
    const interceptionTarget = INTERCEPTION_TARGETS[cronState];
    if (interceptionTarget) {
      const since = stateUpdatedAt instanceof Date
        ? stateUpdatedAt.toISOString()
        : String(stateUpdatedAt);

      const existingFlag = readInterceptionFlag(req);
      const alreadyShown =
        existingFlag?.state === cronState && existingFlag?.since === since;

      if (alreadyShown) {
        // Subsequent visit in same state — pass through to render `/` with banner.
        req.log.info(
          { user_id: customerId, cron_state: cronState },
          'interception-redirect: interception already shown; rendering dashboard with banner'
        );
      } else {
        // First login post-state-transition — redirect to interception page.
        // Mark as shown so subsequent visits skip the redirect (UX-DR32).
        const flag = { state: cronState, since };
        writeInterceptionFlag(req, reply, flag);

        req.log.info(
          { user_id: customerId, cron_state: cronState, target: interceptionTarget },
          'interception-redirect: interception triggered'
        );
        return reply.redirect(interceptionTarget, 302);
      }
    }
  }

  // No interception triggered — allow the request to proceed to the dashboard handler.
}
