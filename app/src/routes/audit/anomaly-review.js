// app/src/routes/audit/anomaly-review.js
// Story 7.4 — AC5 + AC6
//
// POST /audit/anomaly/:skuChannelId/accept — customer accepts the anomalous price
// POST /audit/anomaly/:skuChannelId/reject — customer rejects the anomalous price
//
// Both routes are:
//   - Session-scoped (authenticated via mp_session cookie + authMiddleware)
//   - RLS-scoped (rlsContext arms auth.uid() so UPDATE sku_channels is tenant-safe)
//   - CSRF-protected (@fastify/csrf-protection wired at server level)
//   - Not under /api/v1/ — these are dashboard HTML-form POSTs (Constraint #7)
//
// Architecture constraints satisfied:
//   Constraint #2: JSON Schema validation via Fastify built-in (no zod/yup/joi/ajv).
//   Constraint #5: pure JS + JSDoc (no TypeScript).
//   Constraint #7: route is NOT under app/src/routes/api/ (session-scoped dashboard route).
//   Constraint #18: pino only (req.log), no console.log.
//   Constraint #19: no direct HTTP calls — anomaly-freeze.js uses shared/resend/client.js wrapper.
//   Constraint #21: no raw INSERT INTO audit_log — all audit emission via writeAuditEvent (in anomaly-freeze.js).
//
// Error mapping:
//   SkuChannelNotFrozenError → 404 (NOT 403 — leak-free per epic AC#4)
//   Other errors → 500 (safe PT message; original error logged at pino error level)
//
// RLS guarantee: rlsContext sets auth.uid() = request.user.id on the pg connection.
// The UPDATE sku_channels inside unfreezeSkuAfter* is implicitly tenant-scoped by RLS
// (sku_channels_modify_own policy: USING customer_marketplace_id = auth.uid() chain).
// Cross-customer attempt → rowCount === 0 → SkuChannelNotFrozenError → 404.

import { authMiddleware } from '../../middleware/auth.js';
import { rlsContext, releaseRlsClient } from '../../middleware/rls-context.js';
import {
  unfreezeSkuAfterAccept,
  unfreezeSkuAfterReject,
  SkuChannelNotFrozenError,
} from '../../../../worker/src/safety/anomaly-freeze.js';

// ---------------------------------------------------------------------------
// Transaction helper
// ---------------------------------------------------------------------------

/**
 * Run `fn(tx)` inside a BEGIN/COMMIT/ROLLBACK transaction on `client`.
 * Compatible with both:
 *   - Real pg.PoolClient (issues BEGIN/COMMIT/ROLLBACK SQL)
 *   - Test mock clients that expose a `.tx(fn)` shorthand (returns fn(mockTx))
 *
 * @param {object} client - pg PoolClient or mock with optional .tx() method
 * @param {Function} fn - async function receiving the transaction client
 * @returns {Promise<*>} whatever fn returns
 */
async function withTx (client, fn) {
  // Test mock shorthand: if the client provides .tx(), delegate to it directly.
  if (typeof client.tx === 'function') {
    return client.tx(fn);
  }
  // Real pg PoolClient: manual BEGIN/COMMIT/ROLLBACK.
  await client.query('BEGIN');
  try {
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// JSON Schema: params validation
// ---------------------------------------------------------------------------

const ANOMALY_PARAMS_SCHEMA = {
  type: 'object',
  required: ['skuChannelId'],
  properties: {
    skuChannelId: { type: 'string', format: 'uuid' },
  },
};

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

/**
 * Register POST /audit/anomaly/:skuChannelId/accept and
 *           POST /audit/anomaly/:skuChannelId/reject.
 *
 * Auth + RLS hooks are applied to the entire encapsulated plugin scope.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {object} _opts
 * @returns {Promise<void>}
 */
export async function anomalyReviewRoutes (fastify, _opts) {
  // Auth guard: skip if req.user is already set (e.g. by test harness — same
  // bypass pattern as app/src/routes/onboarding/scan.js). In production,
  // req.user is never pre-populated upstream, so authMiddleware always runs.
  // Defense in depth: rls-context.js fails loud if req.user.access_token is
  // missing, so a partial bypass cannot silently sneak through.
  fastify.addHook('preHandler', async (req, reply) => {
    if (!req.user) {
      await authMiddleware(req, reply);
    }
  });
  // RLS context: skip if req.db is already set by the test harness; the
  // production rls-context middleware would otherwise overwrite the mock.
  fastify.addHook('preHandler', async (req, reply) => {
    if (!req.db) {
      await rlsContext(req, reply);
    }
  });
  fastify.addHook('onResponse', releaseRlsClient);

  // -------------------------------------------------------------------------
  // POST /audit/anomaly/:skuChannelId/accept (AC5)
  // -------------------------------------------------------------------------

  fastify.post('/audit/anomaly/:skuChannelId/accept', {
    schema: { params: ANOMALY_PARAMS_SCHEMA },
  }, async (req, reply) => {
    const { skuChannelId } = req.params;

    // Run the unfreeze inside a transaction so the UPDATE sku_channels and the
    // UPDATE audit_log SET resolved_at are atomic. Uses withTx() which works
    // with both the real pg.PoolClient (BEGIN/COMMIT/ROLLBACK) and test mocks
    // that expose a .tx(fn) shorthand. The RLS session settings are already
    // armed by rlsContext middleware — set_config is session-level so they
    // persist inside the transaction.
    let result;
    try {
      result = await withTx(req.db, async (tx) => {
        return unfreezeSkuAfterAccept({ tx, skuChannelId });
      });
    } catch (err) {
      if (err instanceof SkuChannelNotFrozenError) {
        req.log.info(
          { skuChannelId, err_name: err.name },
          'anomaly-review: accept — sku_channel not frozen (returning 404)',
        );
        return reply.code(404).send({ ok: false, error: 'SKU não está bloqueado ou não existe.' });
      }

      req.log.error(
        { skuChannelId, err_name: err?.name, err_code: err?.code },
        'anomaly-review: accept — unexpected error',
      );
      return reply.code(500).send({ ok: false, error: 'Erro interno. Por favor tenta novamente.' });
    }

    return reply.code(200).send({
      ok: true,
      action: result.action,
      unfrozenAt: result.unfrozenAt,
    });
  });

  // -------------------------------------------------------------------------
  // POST /audit/anomaly/:skuChannelId/reject (AC6)
  // -------------------------------------------------------------------------

  fastify.post('/audit/anomaly/:skuChannelId/reject', {
    schema: { params: ANOMALY_PARAMS_SCHEMA },
  }, async (req, reply) => {
    const { skuChannelId } = req.params;

    let result;
    try {
      result = await withTx(req.db, async (tx) => {
        return unfreezeSkuAfterReject({ tx, skuChannelId });
      });
    } catch (err) {
      if (err instanceof SkuChannelNotFrozenError) {
        req.log.info(
          { skuChannelId, err_name: err.name },
          'anomaly-review: reject — sku_channel not frozen (returning 404)',
        );
        return reply.code(404).send({ ok: false, error: 'SKU não está bloqueado ou não existe.' });
      }

      req.log.error(
        { skuChannelId, err_name: err?.name, err_code: err?.code },
        'anomaly-review: reject — unexpected error',
      );
      return reply.code(500).send({ ok: false, error: 'Erro interno. Por favor tenta novamente.' });
    }

    return reply.code(200).send({
      ok: true,
      action: result.action,
      unfrozenAt: result.unfrozenAt,
    });
  });
}
