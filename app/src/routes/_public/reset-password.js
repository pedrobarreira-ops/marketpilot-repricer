// Story 1.4 — Reset-password route (FR3).
//
// GET  /reset-password → render the new-password-input form. Supabase Auth's
//                        recovery link redirects here with the recovery token
//                        in the URL fragment (#access_token=...&type=recovery)
//                        — the F9 client-side defer-loaded JS extracts the
//                        fragment and POSTs it back to this route.
// POST /reset-password → call setSession({access_token, refresh_token}) then
//                        updateUser({password}); redirect to /login on
//                        success with ?msg=password_reset_ok.

import { createEphemeralAnonSupabaseClient } from '../../lib/supabase-clients.js';

const RESET_BODY_SCHEMA = {
  type: 'object',
  required: ['password', 'access_token', 'refresh_token'],
  properties: {
    password:      { type: 'string', minLength: 8, maxLength: 72 },
    access_token:  { type: 'string', minLength: 1, maxLength: 4096 },
    refresh_token: { type: 'string', minLength: 1, maxLength: 4096 },
  },
  additionalProperties: false,
};

const RESET_FAILURE_MESSAGE = 'Não foi possível repor a palavra-passe. Tenta novamente.';

// P8: bcrypt (Supabase Auth's hash algorithm) caps password input at 72
// BYTES; JSON Schema's maxLength counts characters; a multibyte password
// at 72 chars exceeds the byte cap and is silently truncated.
const PASSWORD_BYTE_LIMIT = 72;
const PASSWORD_TOO_LONG_MESSAGE = 'Palavra-passe demasiado longa em UTF-8 (máx 72 bytes).';

/**
 * Render reset-password.eta with optional error.
 *
 * @param {import('fastify').FastifyReply} reply - Fastify reply
 * @param {{topError?: string|null, status?: number}} [opts] - render options
 * @returns {import('fastify').FastifyReply} the reply (chainable)
 */
function renderReset (reply, { topError = null, status = 200 } = {}) {
  return reply.code(status).view('pages/reset-password.eta', { topError });
}

/**
 * Register GET + POST /reset-password on the Fastify instance.
 *
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance
 * @returns {Promise<void>} resolves once routes are registered
 */
export async function resetPasswordRoutes (fastify) {
  fastify.get('/reset-password', async (_request, reply) => renderReset(reply));

  fastify.post('/reset-password', {
    schema: { body: RESET_BODY_SCHEMA },
    attachValidation: true,
  }, async (request, reply) => {
    if (request.validationError) {
      return renderReset(reply, { topError: RESET_FAILURE_MESSAGE, status: 400 });
    }

    const { password, access_token, refresh_token } = request.body;

    // P8: bcrypt cap is 72 BYTES, not characters.
    if (Buffer.byteLength(password, 'utf8') > PASSWORD_BYTE_LIMIT) {
      return renderReset(reply, { topError: PASSWORD_TOO_LONG_MESSAGE, status: 400 });
    }

    // Per-request client: setSession() mutates client state; concurrent
    // recovery flows on a shared singleton would cross-contaminate sessions
    // and could land A's password update on B's user. See Story 1.4 review D2.
    const supabase = createEphemeralAnonSupabaseClient();

    const { error: setSessionError } = await supabase.auth.setSession({
      access_token,
      refresh_token,
    });
    if (setSessionError) {
      request.log.warn({ code: setSessionError.code, status: setSessionError.status }, 'reset-password setSession failed');
      return renderReset(reply, { topError: RESET_FAILURE_MESSAGE, status: 400 });
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      request.log.warn({ code: updateError.code, status: updateError.status }, 'reset-password updateUser failed');
      return renderReset(reply, { topError: RESET_FAILURE_MESSAGE, status: 400 });
    }

    return reply.redirect('/login?msg=password_reset_ok', 302);
  });
}
