// app/src/routes/dashboard/index.js — Story 8.1 (replaces Story 4.9 minimal stub)
//
// GET `/` — Full state-aware dashboard (replaces dry-run-minimal stub from 4.9).
//
// Auth guard (authMiddleware), RLS context (rlsContext), and interception
// redirect (interceptionRedirect) are applied as preHandler hooks.
// The handler queries full dashboard state (cron_state + anomaly_count +
// sustained_transient_active) and passes it to dashboard.eta.
//
// Story 4.9 stub: rendered dashboard-dry-run-minimal.eta with no DB query.
// Story 8.1:      queries customer_marketplaces + sku_channels + audit_log
//                 and renders dashboard.eta with full state context.
//
// Critical constraints (do NOT relax):
//   - No audit event calls (no state change in this route — read-only)
//   - No cron_state transition calls (read only)
//   - pino only for logging (req.log)
//   - async/await only (no promise-chain style)
//   - Named export only (no default export)
//   - Uses PRI01 only (never PRI01's predecessor endpoint)
//   - No SPA framework imports

import { authMiddleware } from '../../middleware/auth.js';
import { rlsContext, releaseRlsClient } from '../../middleware/rls-context.js';
import { interceptionRedirect } from '../../middleware/interception-redirect.js';

/**
 * Bypass-aware authMiddleware wrapper.
 * Skips the real middleware when req.user is already set (unit-test injection).
 *
 * @param {import('fastify').FastifyRequest} req
 * @param {import('fastify').FastifyReply} reply
 * @returns {Promise<void>}
 */
async function authMiddlewareConditional (req, reply) {
  if (req.user) {
    // Bypass is test-only — Epic 4 retro Q3 guard. If req.user is truthy outside
    // NODE_ENV=test it means a global preHandler in server.js set it before this
    // route's hooks ran, which would silently skip auth in production.
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('authMiddlewareConditional bypass fired outside NODE_ENV=test — auth would be silently skipped');
    }
    return;
  }
  return authMiddleware(req, reply);
}

/**
 * Bypass-aware rlsContext wrapper.
 * Skips the real middleware when req.db is already set (unit-test injection).
 *
 * @param {import('fastify').FastifyRequest} req
 * @param {import('fastify').FastifyReply} reply
 * @returns {Promise<void>}
 */
async function rlsContextConditional (req, reply) {
  if (req.db) {
    // Bypass is test-only — Epic 4 retro Q3 guard.
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('rlsContextConditional bypass fired outside NODE_ENV=test — RLS context would be silently skipped');
    }
    return;
  }
  return rlsContext(req, reply);
}

/**
 * Register GET `/` — full state-aware dashboard route.
 * Auth + RLS + interception hooks are applied at plugin scope (encapsulated).
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {object} _opts
 * @returns {Promise<void>}
 */
export async function dashboardRoutes (fastify, _opts) {
  fastify.addHook('preHandler', authMiddlewareConditional);
  fastify.addHook('preHandler', rlsContextConditional);
  fastify.addHook('preHandler', interceptionRedirect);
  fastify.addHook('onResponse', releaseRlsClient);

  fastify.get('/', async (req, reply) => {
    // interceptionRedirect middleware has already run and allowed this through.
    // Query full dashboard state for the authenticated customer.
    //
    // Tx-topology: No BEGIN/COMMIT. All reads are autocommit-per-statement via
    // req.db.query() (RLS-aware Supabase client). No writes occur here.
    //
    // sustained_transient_active: column added by Story 8.1 migration
    // (202605140001). Story 12.1 will set this to TRUE when ≥3 consecutive
    // cycle failures are detected. Defaults to FALSE.
    const { rows } = await req.db.query(
      `SELECT
         cm.cron_state,
         cm.max_discount_pct,
         cm.max_increase_pct,
         cm.updated_at AS state_updated_at,
         cm.sustained_transient_active,
         COALESCE(
           (SELECT COUNT(*)::int FROM sku_channels sc
            WHERE sc.customer_marketplace_id = cm.id
              AND sc.frozen_for_anomaly_review = TRUE),
           0
         ) AS anomaly_count
       FROM customer_marketplaces cm
       WHERE cm.customer_id = $1
       LIMIT 1`,
      [req.user.id]
    );

    if (rows.length === 0) {
      // Customer has no marketplace — shouldn't happen post-onboarding, but be safe.
      req.log.warn({ user_id: req.user.id }, 'dashboard: no customer_marketplace row found');
      return reply.redirect('/onboarding/scan', 302);
    }

    const state = rows[0];

    // ── Story 8.3: Channel count query ───────────────────────────────────────
    // Count distinct channel_code values for this customer's sku_channels.
    // RLS on sku_channels scopes the query to the authenticated customer's rows.
    // cm.customer_id = $1 is belt-and-suspenders clarity (RLS alone is sufficient).
    // channel_code values: WRT_PT_ONLINE / WRT_ES_ONLINE (AD6 empirical facts).
    // Tx-topology: autocommit-per-statement — no transaction.
    const { rows: chanRows } = await req.db.query(
      `SELECT COUNT(DISTINCT sc.channel_code)::int AS channel_count
       FROM sku_channels sc
       JOIN customer_marketplaces cm ON cm.id = sc.customer_marketplace_id
       WHERE cm.customer_id = $1`,
      [req.user.id]
    );
    const channelCount = chanRows[0]?.channel_count ?? 1;

    // Render channel-toggle.eta to an HTML string for the layout's channelToggle slot.
    // fastify.view() (instance decorator, not reply method) returns a Promise<string>.
    // Server-side default: activeChannel = 'pt'. Client JS (dashboard.js) overrides
    // from localStorage on DOMContentLoaded (AC#2 — first paint always PT then flicker
    // to ES if localStorage says ES; acceptable at MVP per story spec §Detected Conflicts 2).
    const channelToggleHtml = await fastify.view('components/channel-toggle.eta', {
      channelCount,
      activeChannel: 'pt',
    });

    // Derive user initials for avatar from email (email always set — auth.js guards this).
    const email = req.user.email ?? '';
    const namePart = email.split('@')[0] ?? '';
    const initials = namePart.slice(0, 2).toUpperCase() || '?';

    return reply.view('pages/dashboard.eta', {
      cronState: state.cron_state,
      anomalyCount: Number(state.anomaly_count ?? 0),
      sustainedTransientActive: Boolean(state.sustained_transient_active),
      maxDiscountPct: state.max_discount_pct,
      maxIncreasePct: state.max_increase_pct,
      userEmail: email,
      userInitials: initials,
      // Story 8.3: channel toggle pill for sticky header slot (default.eta: <%~ it.channelToggle || '' %>)
      channelToggle: channelToggleHtml,
      channelCount,
      activeChannel: 'pt',
    });
  });
}
