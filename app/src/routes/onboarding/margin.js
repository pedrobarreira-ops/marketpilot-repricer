// app/src/routes/onboarding/margin.js
//
// Story 4.8 — Margin question /onboarding/margin + smart-default mapping + <5% warning
//
// GET /onboarding/margin → band picker with 4 radio inputs (PT-localized)
// POST /onboarding/margin → persists max_discount_pct + max_increase_pct (0.05)
//
// Critical constraints (do NOT relax):
//   - No audit event calls — no AD20 event type for margin configuration
//   - No cron_state transition calls — cron_state stays DRY_RUN
//   - No console.log — pino only (req.log)
//   - No .then() chains — async/await only
//   - RLS-aware client only: req.db from rls-context.js middleware
//   - Server-side acknowledgement guard for under_5 + missing acknowledge
//   - Fastify JSON Schema validation rejects invalid band values (400)

import { authMiddleware } from '../../middleware/auth.js';
import { rlsContext, releaseRlsClient } from '../../middleware/rls-context.js';

/**
 * Bypass-aware authMiddleware wrapper.
 * Skips the real middleware when req.user is already set (unit-test injection).
 *
 * @param {import('fastify').FastifyRequest} req - Fastify request
 * @param {import('fastify').FastifyReply} reply - Fastify reply
 * @returns {Promise<void>}
 */
async function authMiddlewareConditional (req, reply) {
  if (req.user) return; // already set by test global preHandler — skip real auth
  return authMiddleware(req, reply);
}

/**
 * Bypass-aware rlsContext wrapper.
 * Skips the real middleware when req.db is already set (unit-test injection).
 *
 * @param {import('fastify').FastifyRequest} req - Fastify request
 * @param {import('fastify').FastifyReply} _reply - Fastify reply (unused)
 * @returns {Promise<void>}
 */
async function rlsContextConditional (req, _reply) {
  if (req.db) return; // already set by test global preHandler — skip real RLS client
  return rlsContext(req, _reply);
}

/**
 * Bypass-aware releaseRlsClient wrapper.
 * Skips the real release when req.db was externally injected (unit-test scenario).
 * The test mock's release() is a no-op — calling it is safe but unnecessary.
 *
 * @param {import('fastify').FastifyRequest} req - Fastify request
 * @returns {Promise<void>}
 */
async function releaseRlsClientConditional (req) {
  if (!req.db) return;
  return releaseRlsClient(req);
}

/**
 * Smart-default mapping: band value → max_discount_pct (Story 4.8 AC#3)
 *
 * @type {Record<string, number>}
 */
const BAND_TO_MAX_DISCOUNT = {
  under_5:   0.005,
  '5_10':    0.01,
  '10_15':   0.02,
  '15_plus': 0.03,
};

/**
 * Global default for max_increase_pct — always 5% regardless of band (AC#3).
 *
 * @type {number}
 */
const MAX_INCREASE_DEFAULT = 0.05;

/**
 * All cron_state values that indicate the customer has passed onboarding.
 * Matches the list used in scan-ready.js (Story 4.7).
 */
const ACTIVE_AND_PAUSED_STATES = [
  'ACTIVE',
  'PAUSED_BY_CUSTOMER',
  'PAUSED_BY_PAYMENT_FAILURE',
  'PAUSED_BY_CIRCUIT_BREAKER',
  'PAUSED_BY_KEY_REVOKED',
  'PAUSED_BY_ACCOUNT_GRACE_PERIOD',
];

/**
 * Fastify JSON Schema for POST /onboarding/margin body (AD28 — no zod/yup/joi).
 * Fastify auto-rejects invalid band values with 400 before the handler runs.
 */
const MARGIN_POST_SCHEMA = {
  body: {
    type: 'object',
    required: ['band'],
    properties: {
      band: { type: 'string', enum: ['under_5', '5_10', '10_15', '15_plus'] },
      acknowledge: { type: 'string' }, // optional: 'true' when under_5 acknowledged
    },
    additionalProperties: false,
  },
};

/**
 * Register GET + POST /onboarding/margin routes.
 * Auth guard (authMiddleware) and RLS context (rlsContext + releaseRlsClient)
 * are applied to the entire encapsulated plugin scope via hooks.
 *
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance
 * @param {object} _opts - unused plugin options
 * @returns {Promise<void>} resolves once routes are registered
 */
export async function marginRoutes (fastify, _opts) {
  // Apply auth + RLS hooks to all routes in this plugin (encapsulated scope).
  // Conditional wrappers skip the real middleware when req.user / req.db are
  // already set — allows unit tests to inject mocks via a global preHandler
  // without needing a real Supabase instance.
  fastify.addHook('preHandler', authMiddlewareConditional);
  fastify.addHook('preHandler', rlsContextConditional);
  fastify.addHook('onResponse', releaseRlsClientConditional);

  // ---------------------------------------------------------------------------
  // GET /onboarding/margin
  // ---------------------------------------------------------------------------

  fastify.get('/onboarding/margin', async (req, reply) => {
    const { rows: [cm] } = await req.db.query(
      `SELECT id, cron_state, max_discount_pct FROM customer_marketplaces
       WHERE customer_id = $1 LIMIT 1`,
      [req.user.id]
    );

    // Guard order per AC#4 + Dev Notes:
    // 1. No cm row OR PROVISIONING → redirect to scan
    if (!cm || cm.cron_state === 'PROVISIONING') {
      return reply.redirect('/onboarding/scan', 302);
    }

    // 2. ACTIVE or any PAUSED_* → customer has passed onboarding → dashboard
    if (ACTIVE_AND_PAUSED_STATES.includes(cm.cron_state)) {
      return reply.redirect('/', 302);
    }

    // 3. DRY_RUN + margin already set (IS NOT NULL) → forward to dashboard
    //    max_discount_pct IS NOT NULL is the reliable forward-only sentinel (AC#4)
    if (cm.cron_state === 'DRY_RUN' && cm.max_discount_pct !== null) {
      return reply.redirect('/', 302);
    }

    // 4. DRY_RUN + margin not yet set → render margin picker
    return reply.view('pages/onboarding-margin.eta', { error: null, calloutOpen: false });
  });

  // ---------------------------------------------------------------------------
  // POST /onboarding/margin
  // ---------------------------------------------------------------------------

  fastify.post('/onboarding/margin', { schema: MARGIN_POST_SCHEMA }, async (req, reply) => {
    const { band, acknowledge } = req.body;

    // Server-side acknowledgement guard for <5% band (AC#2, AC#3 constraint 4)
    // Client-side gate alone is insufficient — forms can be submitted programmatically.
    // Spec line 92: "respond with 400 OR re-render the margin page with the callout
    // pre-expanded" — we choose re-render and pass calloutOpen=true so the user
    // sees the §9.10 warning + "Compreendo e continuo" button without first having
    // to re-select the <5% radio.
    if (band === 'under_5' && acknowledge !== 'true') {
      return reply.view('pages/onboarding-margin.eta', {
        error: 'Por favor confirma que compreendeste o aviso de margem abaixo de 5%.',
        calloutOpen: true,
      });
    }

    const maxDiscountPct = BAND_TO_MAX_DISCOUNT[band];

    // Persist smart-default mapping — cron_state stays DRY_RUN (no state transition here).
    // No audit event for margin configuration (no AD20 event type defined for this action).
    await req.db.query(
      `UPDATE customer_marketplaces
       SET max_discount_pct = $1, max_increase_pct = $2
       WHERE customer_id = $3 AND cron_state = 'DRY_RUN'`,
      [maxDiscountPct, MAX_INCREASE_DEFAULT, req.user.id]
    );

    req.log.info({ band, max_discount_pct: maxDiscountPct }, 'margin: smart-default mapping persisted');

    // Redirect to dashboard root (Story 4.9)
    return reply.redirect('/', 302);
  });
}
