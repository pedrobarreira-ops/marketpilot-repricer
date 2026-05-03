// Story 1.5 — generic Supabase Auth session-check preHandler.
//
// Reads the mp_session signed cookie set by Story 1.4's /login route,
// validates the JWT against Supabase Auth via supabase.auth.getUser(jwt),
// and decorates request.user. Redirects to /login?next=<current-path> on any
// failure path (UX-DR1).
//
// Cookie-name contract (mp_session) is a producer/consumer agreement with
// Story 1.4's app/src/routes/_public/login.js. Renaming requires a
// coordinated PR touching both sides — and Story 2.1's rls-context.js, which
// will read access_token from request.user (decorated below).
//
// Story 2.1 reads request.user.access_token in app/src/middleware/rls-context.js
// to construct the JWT-scoped Supabase DB client. Do not remove access_token
// from request.user without updating Story 2.1.
//
// Phase 2 / Story 2.1: implement refresh-token rotation when getUser fails
// with expired-jwt. Until then, expired access tokens force re-login (~1h
// Supabase access-token TTL).

import { getAnonSupabaseClient } from '../lib/supabase-clients.js';

const SESSION_COOKIE_NAME = 'mp_session'; // cross-story contract — DO NOT rename
const NEXT_MAX_LEN = 512;                  // matches LOGIN_BODY_SCHEMA.next.maxLength

/**
 * Generic Supabase Auth session-check preHandler. Validates the mp_session
 * signed cookie, calls supabase.auth.getUser(jwt), and decorates
 * request.user = {id, email, access_token, refresh_token} on success.
 * Redirects to /login?next=... on any failure path (UX-DR1).
 *
 * @param {import('fastify').FastifyRequest} request - Fastify request
 * @param {import('fastify').FastifyReply} reply - Fastify reply
 * @returns {Promise<void>}
 */
export async function authMiddleware (request, reply) {
  const raw = request.cookies?.[SESSION_COOKIE_NAME];
  if (typeof raw !== 'string' || raw.length === 0) {
    return redirectToLogin(request, reply);
  }

  // Library Empirical Contract #2 — @fastify/cookie v11+ does NOT auto-unwrap
  // signed cookies. Explicit unsignCookie() is required. Mirrors Story 1.4's
  // source-context-capture.js readSourceContext() pattern.
  let unsigned;
  try {
    unsigned = request.unsignCookie(raw);
  } catch (err) {
    request.log.warn({ cookie: SESSION_COOKIE_NAME, err }, 'mp_session unsign threw');
    return redirectToLogin(request, reply);
  }
  if (!unsigned.valid) {
    request.log.warn({ cookie: SESSION_COOKIE_NAME }, 'mp_session signature invalid');
    return redirectToLogin(request, reply);
  }

  let parsed;
  try {
    parsed = JSON.parse(unsigned.value);
  } catch {
    request.log.warn({ cookie: SESSION_COOKIE_NAME }, 'mp_session JSON malformed');
    return redirectToLogin(request, reply);
  }

  const { access_token, refresh_token } = parsed ?? {};
  if (typeof access_token !== 'string' || access_token.length === 0) {
    request.log.warn({ cookie: SESSION_COOKIE_NAME }, 'mp_session missing access_token');
    return redirectToLogin(request, reply);
  }

  const supabase = getAnonSupabaseClient();
  let data, error;
  try {
    ({ data, error } = await supabase.auth.getUser(access_token));
  } catch (err) {
    // getUser may throw on network failure (DNS, TLS handshake) instead of
    // returning {error}. Treat as session-invalid → redirect (UX-DR1).
    request.log.warn({ err }, 'auth.js getUser threw');
    return redirectToLogin(request, reply);
  }
  if (error || !data?.user?.id) {
    request.log.warn({ err: error, code: error?.code }, 'auth.js session validation failed');
    return redirectToLogin(request, reply);
  }
  // Supabase users with phone-only auth, anonymous auth, or post-admin email
  // wipe can return a user with no email. Without this guard, request.user.email
  // becomes undefined and founder-admin-only.js's typeof check incorrectly fires
  // the fail-loud "auth.js missing" error. Treat emailless users as session-
  // invalid for this app's purposes (admin gate keys on email).
  if (typeof data.user.email !== 'string' || data.user.email.length === 0) {
    request.log.warn({ user_id: data.user.id }, 'auth.js user has no email');
    return redirectToLogin(request, reply);
  }

  request.user = {
    id: data.user.id,
    email: data.user.email,
    access_token,
    refresh_token,
  };
}

/**
 * Redirect to /login preserving request.url as the ?next= path-only param.
 * Falls back to a bare /login when the encoded next exceeds NEXT_MAX_LEN —
 * the LOGIN_BODY_SCHEMA caps at 512 chars and Fastify's downstream validator
 * would reject longer values anyway.
 *
 * @param {import('fastify').FastifyRequest} request - Fastify request
 * @param {import('fastify').FastifyReply} reply - Fastify reply
 * @returns {import('fastify').FastifyReply} the chainable reply
 */
function redirectToLogin (request, reply) {
  const nextParam = request.url ?? '/';
  const encoded = encodeURIComponent(nextParam);
  if (encoded.length > NEXT_MAX_LEN) {
    request.log.info({ urlLen: nextParam.length }, 'next param truncated to bare /login');
    return reply.redirect('/login', 302);
  }
  return reply.redirect(`/login?next=${encoded}`, 302);
}
