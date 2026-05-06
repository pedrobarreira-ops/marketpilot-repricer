// app/src/routes/onboarding/key.js
//
// Story 4.3 — Key entry form + inline 5s validation + encrypted persistence.
//
// GET  /onboarding/key  → render key entry form (AC#1, AC#2, AC#5, AC#7)
// POST /onboarding/key/validate → validate key via P11 (inlineOnly), encrypt,
//                                  persist to shop_api_key_vault + customer_marketplaces
//                                  + scan_jobs, redirect to /onboarding/scan (AC#3, AC#4).
//
// Critical constraints (do NOT relax):
//   - No re-implementation of encryption — import encryptShopApiKey from shared/crypto/envelope.js
//   - No direct HTTP fetch — runVerification from scripts/mirakl-empirical-verify.js uses api-client.js
//   - No export default in source modules — named export only (ESLint AD convention)
//   - No .then() chains — async/await only
//   - No console.log — pino only (req.log)
//   - No err.message / err.body in eta render paths — always getSafeErrorMessage(err)
//   - No writeAuditEvent — KEY_VALIDATED is NOT in the AD20 locked taxonomy
//   - No cleartext key in any log line — never assign shop_api_key to a pino-visible path
//   - RLS-aware client in all DB writes (request.db from rls-context.js middleware)
//   - WORTEN_TEST_EAN must be set; missing → PT-localized 500 message
//   - Route exports named function (export async function keyRoutes) — Fastify plugin shape

import { encryptShopApiKey } from '../../../shared/crypto/envelope.js';
import { loadMasterKey } from '../../../shared/crypto/master-key-loader.js';
import { getSafeErrorMessage } from '../../../shared/mirakl/safe-error.js';
import { runVerification } from '../../../scripts/mirakl-empirical-verify.js';
import { authMiddleware } from '../../middleware/auth.js';
import { rlsContext, releaseRlsClient } from '../../middleware/rls-context.js';

const KEY_VALIDATE_BODY_SCHEMA = {
  type: 'object',
  required: ['shop_api_key'],
  properties: {
    shop_api_key: { type: 'string', minLength: 1, maxLength: 512 },
  },
  additionalProperties: false,
};

// Default timeout per NFR-P6 (5s); overridable in tests via MIRAKL_VALIDATION_TIMEOUT_MS
const DEFAULT_VALIDATION_TIMEOUT_MS = 5_000;

/**
 * Render onboarding-key.eta with optional error state.
 *
 * @param {import('fastify').FastifyReply} reply - Fastify reply
 * @param {{error?: string|null, retryError?: string|null, status?: number}} [opts] - render options
 * @returns {import('fastify').FastifyReply} the reply (chainable)
 */
function renderKeyForm (reply, { error = null, retryError = null, status = 200 } = {}) {
  return reply.code(status).view('pages/onboarding-key.eta', { error, retryError });
}

/**
 * Create a promise that rejects with a timeout error after `ms` milliseconds.
 * Used with Promise.race to enforce the 5s validation budget (NFR-P6).
 *
 * @param {number} ms - timeout in milliseconds
 * @returns {{ promise: Promise<never>, cancel: () => void }} the timeout promise and a cancel function
 */
function createTimeoutRace (ms) {
  let timer;
  const promise = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      const err = new Error('Mirakl validation timed out');
      err.name = 'AbortError';
      err.code = 'ABORT_ERR';
      reject(err);
    }, ms);
  });
  const cancel = () => clearTimeout(timer);
  return { promise, cancel };
}

/**
 * Register GET /onboarding/key + POST /onboarding/key/validate.
 * Auth guard (authMiddleware) and RLS context (rlsContext + releaseRlsClient)
 * are applied to the entire encapsulated plugin scope via hooks.
 *
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance
 * @param {object} _opts - unused plugin options
 * @returns {Promise<void>} resolves once routes are registered
 */
export async function keyRoutes (fastify, _opts) {
  // Apply auth + RLS hooks to all routes in this plugin (encapsulated scope)
  fastify.addHook('preHandler', authMiddleware);
  fastify.addHook('preHandler', rlsContext);
  fastify.addHook('onResponse', releaseRlsClient);

  // ---------------------------------------------------------------------------
  // GET /onboarding/key
  // ---------------------------------------------------------------------------

  fastify.get('/onboarding/key', async (req, reply) => {
    // AC#7 — UX-DR2 forward-only routing guard
    const customerId = req.user.id;
    const existingResult = await req.db.query(
      `SELECT cron_state FROM customer_marketplaces WHERE customer_id = $1 LIMIT 1`,
      [customerId]
    );

    if (existingResult.rows.length > 0) {
      const { cron_state } = existingResult.rows[0];

      if (cron_state === 'PROVISIONING') {
        // Check if vault row with validated key already exists
        const vaultResult = await req.db.query(
          `SELECT v.last_validated_at
           FROM shop_api_key_vault v
           JOIN customer_marketplaces cm ON cm.id = v.customer_marketplace_id
           WHERE cm.customer_id = $1 AND v.last_validated_at IS NOT NULL
           LIMIT 1`,
          [customerId]
        );
        if (vaultResult.rows.length > 0) {
          // PROVISIONING with validated key → redirect to scan
          return reply.redirect('/onboarding/scan', 302);
        }
        // PROVISIONING with no validated key → show form (allow re-entry / rotation)
      } else {
        // DRY_RUN, ACTIVE, PAUSED_* → redirect to home (forward-only)
        return reply.redirect('/', 302);
      }
    }

    return renderKeyForm(reply);
  });

  // ---------------------------------------------------------------------------
  // POST /onboarding/key/validate
  // ---------------------------------------------------------------------------

  fastify.post('/onboarding/key/validate', {
    schema: { body: KEY_VALIDATE_BODY_SCHEMA },
    attachValidation: true,
  }, async (req, reply) => {
    // Schema validation failure — re-render form with generic error
    if (req.validationError) {
      return renderKeyForm(reply, {
        error: 'A chave Worten é inválida. Verifica a chave e tenta novamente.',
        status: 400,
      });
    }

    // WORTEN_TEST_EAN is required for P11 inline validation
    const referenceEan = process.env.WORTEN_TEST_EAN;
    if (!referenceEan || referenceEan.trim().length === 0) {
      req.log.error({}, 'key-validate: WORTEN_TEST_EAN is not set — cannot perform inline validation');
      return renderKeyForm(reply, {
        error: 'Configuração de validação em falta — contacta o suporte.',
        status: 500,
      });
    }

    const baseUrl = (process.env.WORTEN_INSTANCE_URL ?? 'https://marketplace.worten.pt').replace(/\/+$/, '');
    const timeoutMs = Number(process.env.MIRAKL_VALIDATION_TIMEOUT_MS) || DEFAULT_VALIDATION_TIMEOUT_MS;

    // Log without the key — never log request.body for this route (AC#3 constraint)
    req.log.info({ path: req.url }, 'key-validate-start');

    // ── 5s validation via Promise.race against a timeout rejection ────────────
    // runVerification with inlineOnly:true runs only the P11 call (Story 3.3 SSoT).
    // We race it against a timeout promise to enforce NFR-P6 (5s budget).
    const { promise: timeoutPromise, cancel: cancelTimeout } = createTimeoutRace(timeoutMs);

    let verificationResult;
    try {
      verificationResult = await Promise.race([
        runVerification({
          baseUrl,
          apiKey: req.body.shop_api_key,
          referenceEan: referenceEan.trim(),
          inlineOnly: true,
          dryRun: true,
        }),
        timeoutPromise,
      ]);
      cancelTimeout();
    } catch (err) {
      cancelTimeout();
      req.log.warn({ errName: err.name, errCode: err.code }, 'key-validate: verification error');

      // Timeout path (AbortError) or transport-level error (no HTTP status)
      const isTimeout = err.name === 'AbortError' || err.code === 'ABORT_ERR' ||
                        err.name === 'TimeoutError';
      const isTransport = !err.status && !isTimeout;

      if (isTimeout || isTransport) {
        return renderKeyForm(reply, {
          retryError: 'Não conseguimos contactar o Worten. Verifica a tua ligação e tenta novamente.',
          status: 200,
        });
      }

      // 401/403 or other Mirakl API error — inline error below input, no redirect
      return renderKeyForm(reply, {
        error: getSafeErrorMessage(err),
        status: 200,
      });
    }

    // ── P11 succeeded — check required assertion passed ───────────────────────
    if (!verificationResult.success) {
      // verificationResult.success is false when a required assertion failed.
      // Extract the P11 HTTP status to map to the right error message.
      const p11Result = verificationResult.results?.find(r => r.call === 'P11');
      const syntheticErr = { status: p11Result?.status ?? 0 };
      return renderKeyForm(reply, {
        error: getSafeErrorMessage(syntheticErr),
        status: 200,
      });
    }

    // ── Encrypt the key (Story 1.2 SSoT — NEVER re-implement) ────────────────
    let masterKey;
    try {
      masterKey = loadMasterKey();
    } catch (mkErr) {
      req.log.error({ errName: mkErr.name }, 'key-validate: master key load failed');
      return renderKeyForm(reply, {
        error: 'Erro interno de configuração — contacta o suporte.',
        status: 500,
      });
    }

    const { ciphertext, nonce, authTag, masterKeyVersion } = encryptShopApiKey(
      req.body.shop_api_key,
      masterKey
    );

    // ── DB writes under RLS-aware client (Story 2.1 SSoT) ───────────────────
    const customerId = req.user.id;

    try {
      // 1. Insert or find customer_marketplaces row in PROVISIONING state.
      //    max_discount_pct: 0.0300 sentinel — overwritten by Story 4.8 /onboarding/margin POST.
      //    max_increase_pct: 0.0500 default top band.
      //    All A01/PC01 columns NULL → satisfies F4 CHECK constraint (PROVISIONING allowed).
      let cmId;
      const existingCm = await req.db.query(
        `SELECT id FROM customer_marketplaces WHERE customer_id = $1 LIMIT 1`,
        [customerId]
      );

      if (existingCm.rows.length > 0) {
        cmId = existingCm.rows[0].id;
      } else {
        const cmInsert = await req.db.query(
          `INSERT INTO customer_marketplaces
             (customer_id, operator, marketplace_instance_url, cron_state, max_discount_pct, max_increase_pct)
           VALUES
             ($1, 'WORTEN', 'https://marketplace.worten.pt', 'PROVISIONING', 0.0300, 0.0500)
           RETURNING id`,
          [customerId]
        );
        cmId = cmInsert.rows[0].id;
      }

      // 2. Upsert vault row with encrypted key (rotation-safe — key can be resubmitted).
      await req.db.query(
        `INSERT INTO shop_api_key_vault
           (customer_marketplace_id, ciphertext, nonce, auth_tag, master_key_version, last_validated_at)
         VALUES
           ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (customer_marketplace_id)
         DO UPDATE SET
           ciphertext = EXCLUDED.ciphertext,
           nonce = EXCLUDED.nonce,
           auth_tag = EXCLUDED.auth_tag,
           last_validated_at = NOW(),
           updated_at = NOW()`,
        [cmId, ciphertext, nonce, authTag, masterKeyVersion]
      );

      // 3. Insert scan_jobs row (PENDING). Skip if EXCLUDE constraint fires —
      //    means a scan is already in-flight; we still redirect normally.
      try {
        await req.db.query(
          `INSERT INTO scan_jobs (customer_marketplace_id) VALUES ($1)`,
          [cmId]
        );
      } catch (scanErr) {
        // PostgreSQL exclusion_violation code: 23P01
        const isExcludeConstraint =
          scanErr.code === '23P01' ||
          (scanErr.message ?? '').includes('scan_job_unique_per_marketplace');
        if (!isExcludeConstraint) {
          throw scanErr;
        }
        req.log.info({ cmId }, 'key-validate: active scan already exists — skipping scan_jobs insert');
      }
    } catch (dbErr) {
      req.log.error({ errName: dbErr.name, errCode: dbErr.code }, 'key-validate: DB write failed');
      return renderKeyForm(reply, {
        error: 'Erro ao guardar a chave. Por favor tenta novamente.',
        status: 500,
      });
    }

    req.log.info({ customerId }, 'key-validate: key validated and persisted');

    // AC#3 happy path — redirect to onboarding scan
    return reply.redirect('/onboarding/scan', 302);
  });
}
