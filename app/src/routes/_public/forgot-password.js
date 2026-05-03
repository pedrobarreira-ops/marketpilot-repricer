// Story 1.4 — Forgot-password route (FR3).
//
// GET  /forgot-password → render the email-input form
// POST /forgot-password → call supabase.auth.resetPasswordForEmail.
//                         ALWAYS render the same generic confirmation page,
//                         regardless of whether the email exists — defense
//                         against user-enumeration via this endpoint.
//
// Tiny artificial delay masks response-time differences between exists /
// not-exists email paths (timing-attack defense).

import { setTimeout as delay } from 'node:timers/promises';
import { getAnonSupabaseClient } from '../../lib/supabase-clients.js';

const FORGOT_BODY_SCHEMA = {
  type: 'object',
  required: ['email'],
  properties: {
    email: { type: 'string', format: 'email', maxLength: 254 },
  },
  additionalProperties: false,
};

// P6: deterministic floor — pad every response to at least this many
// milliseconds so an attacker cannot distinguish "exists" (Supabase issues
// an SMTP send, hundreds of ms) from "doesn't exist" (~5ms) by timing.
// Replaces a fixed 50ms additive delay that did not equalize the paths.
const TIMING_FLOOR_MS = 600;

/**
 * Pad the elapsed time since `startMs` so the response time has a
 * deterministic lower bound regardless of which branch executed.
 *
 * @param {number} startMs - Date.now() at request entry
 * @returns {Promise<void>} resolves after the padding delay
 */
async function padToFloor (startMs) {
  const elapsed = Date.now() - startMs;
  const remaining = TIMING_FLOOR_MS - elapsed;
  if (remaining > 0) await delay(remaining);
}

/**
 * Register GET + POST /forgot-password on the Fastify instance.
 *
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance
 * @returns {Promise<void>} resolves once routes are registered
 */
export async function forgotPasswordRoutes (fastify) {
  fastify.get('/forgot-password', async (_request, reply) => {
    return reply.view('pages/forgot-password.eta', {
      formValues: {},
      submitted: false,
    });
  });

  fastify.post('/forgot-password', {
    schema: { body: FORGOT_BODY_SCHEMA },
    attachValidation: true,
  }, async (request, reply) => {
    const start = Date.now();

    // Always render the generic confirmation — even on schema-validation
    // failure — so an attacker cannot distinguish "valid email, not
    // registered" from "invalid email format".
    if (request.validationError) {
      await padToFloor(start);
      return reply.view('pages/forgot-password.eta', {
        formValues: {},
        submitted: true,
      });
    }

    const { email } = request.body;
    // P9: strip a trailing slash from APP_BASE_URL to avoid building
    // `https://app//reset-password` if the operator sets the env var with
    // a trailing slash (very common — many cloud platforms ship vars that way).
    const appBaseUrl = (process.env.APP_BASE_URL ?? '').replace(/\/$/, '');
    const supabase = getAnonSupabaseClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${appBaseUrl}/reset-password`,
    });
    if (error) {
      // Log the failure but DO NOT surface to customer — we always render
      // the same generic confirmation regardless.
      request.log.warn({ code: error.code, status: error.status }, 'resetPasswordForEmail failed');
    }

    await padToFloor(start);
    return reply.view('pages/forgot-password.eta', {
      formValues: {},
      submitted: true,
    });
  });
}
