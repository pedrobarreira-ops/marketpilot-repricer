// Story 1.4 — Login route.
//
// GET  /login → render the form (preserves ?next= per UX-DR1)
// POST /login → validate {email, password}; call signInWithPassword;
//               on success, write the signed httpOnly mp_session cookie
//               with the JWT session payload; redirect to validated next path.
//               On failure, render the generic PT error (no enumeration leak).
//
// Story 2.1 reads this cookie in app/src/middleware/rls-context.js to
// construct the JWT-scoped DB client. Do not change the cookie name without
// updating Story 2.1.

import { getAnonSupabaseClient } from '../../lib/supabase-clients.js';

const SESSION_COOKIE_NAME = 'mp_session';
// P2: cookie lifetime tracks the refresh-token TTL, not the access-token's
// `expires_in` (which is ~1h on Supabase defaults). The cookie carries both
// tokens, and Story 2.1 owns the access-token-refresh-via-refresh-token
// dance. Evicting the cookie at access-token-expiry would throw away the
// refresh capability needlessly.
const SESSION_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 7; // 7 days — Supabase refresh-token default

const LOGIN_BODY_SCHEMA = {
  type: 'object',
  required: ['email', 'password'],
  properties: {
    email:    { type: 'string', format: 'email', maxLength: 254 },
    password: { type: 'string', minLength: 1, maxLength: 72 },
    next:     { type: 'string', maxLength: 512 },
  },
  additionalProperties: false,
};

const LOGIN_GENERIC_ERROR = 'Email ou palavra-passe incorretos.';

// Open-redirect guard — only relative paths starting with '/'.
// P1: negative lookahead `(?![/\\])` rejects protocol-relative paths like
// `//evil` and Windows-style `/\evil` that browsers would interpret as
// off-origin Location values.
// P3: character class includes `%`, `.`, `:`, `+`, `~` so legitimate
// URL-encoded paths and dotted/punctuated paths are not silently downgraded
// to `/`.
const SAFE_NEXT_PATH = /^\/(?![/\\])[A-Za-z0-9_\-./?=&%:+~]*$|^\/$/;

/**
 * Validate ?next= or hidden form field as a same-origin relative path.
 * Rejects protocol-relative (`//evil`), backslash-prefixed, and
 * non-relative paths.
 *
 * @param {unknown} candidate - the next-path value
 * @returns {string} the validated path or '/' as the safe default
 */
function safeNextPath (candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0) return '/';
  if (!SAFE_NEXT_PATH.test(candidate)) return '/';
  return candidate;
}

/**
 * Render login.eta with optional preserved email + per-field PT errors.
 *
 * @param {import('fastify').FastifyReply} reply - Fastify reply
 * @param {{formValues?: object, topError?: string|null, next?: string, status?: number, msg?: string|null}} [opts] - render options
 * @returns {import('fastify').FastifyReply} the reply (chainable)
 */
function renderLogin (reply, { formValues = {}, topError = null, next = '/', status = 200, msg = null } = {}) {
  const safeValues = { ...formValues };
  delete safeValues.password;
  return reply.code(status).view('pages/login.eta', {
    formValues: safeValues,
    topError,
    next,
    msg,
  });
}

/**
 * Register GET + POST /login on the Fastify instance.
 *
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance
 * @returns {Promise<void>} resolves once routes are registered
 */
export async function loginRoutes (fastify) {
  fastify.get('/login', async (request, reply) => {
    const next = safeNextPath(request.query?.next);
    const msg = typeof request.query?.msg === 'string' ? request.query.msg : null;
    return renderLogin(reply, { next, msg });
  });

  fastify.post('/login', {
    schema: { body: LOGIN_BODY_SCHEMA },
    attachValidation: true,
  }, async (request, reply) => {
    const next = safeNextPath(request.body?.next);

    if (request.validationError) {
      return renderLogin(reply, {
        formValues: request.body ?? {},
        topError: LOGIN_GENERIC_ERROR,
        next,
        status: 400,
      });
    }

    const { email, password } = request.body;
    const supabase = getAnonSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data?.session) {
      // Log the failure but never surface raw upstream message to the customer.
      request.log.warn({ code: error?.code, status: error?.status }, 'login failed');
      return renderLogin(reply, {
        formValues: { email },
        topError: LOGIN_GENERIC_ERROR,
        next,
        status: 400,
      });
    }

    const session = data.session;
    const cookieValue = JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });

    reply.setCookie(SESSION_COOKIE_NAME, cookieValue, {
      signed: true,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_COOKIE_MAX_AGE_S,
    });

    return reply.redirect(next, 302);
  });
}
