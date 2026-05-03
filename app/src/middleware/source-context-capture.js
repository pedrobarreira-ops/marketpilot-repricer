// Story 1.4 — FR7 source-context capture middleware.
//
// Captures ?source= / ?campaign= query params on _public routes into a
// signed httpOnly cookie. First-write-wins within the cookie's 7-day
// lifetime — a returning lead who visits /login from a different campaign
// URL must NOT have their original signup attribution rewritten.
//
// Wired only on the _public route group (Fastify plugin encapsulation
// auto-scopes the hook). Auth-agnostic and never blocks a request.

const COOKIE_NAME = 'mp_source_ctx';
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 7; // 7 days
// Tighter than printable-ASCII: marketing identifiers should be plain
// alphanumerics + safe punctuation. Excludes < > " ' & \ / etc., which
// could flow into non-escaping downstream consumers (admin logs, Stripe
// metadata, Moloni notes). Story 1.4 review P11.
const SAFE_IDENTIFIER = /^[A-Za-z0-9_.\-+]+$/;
const MAX_LEN = 100;

/**
 * Validate a query-string value as a safe marketing identifier within
 * length bounds.
 *
 * @param {unknown} raw - candidate string from request.query
 * @returns {string|null} the value if valid, else null
 */
function sanitize (raw) {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > MAX_LEN) return null;
  if (!SAFE_IDENTIFIER.test(raw)) return null;
  return raw;
}

/**
 * Fastify pre-handler hook. Captures FR7 source-context query params
 * (?source=, ?campaign=) into a signed httpOnly cookie. First-write-wins
 * within the cookie's 7-day lifetime — but only valid signed cookies count
 * as "already captured"; a tampered/forged cookie does NOT block legitimate
 * captures (Story 1.4 review P4).
 *
 * Gated to GET requests only (Story 1.4 review P5) — POST submissions never
 * trigger an attribution write, even if they carry ?source=… in the URL.
 *
 * @param {import('fastify').FastifyRequest} request - Fastify request
 * @param {import('fastify').FastifyReply} reply - Fastify reply
 * @returns {Promise<void>} resolves once the side-effect (or no-op) is done
 */
export async function sourceContextCapture (request, reply) {
  // P5: never set/overwrite attribution on a state-changing request.
  if (request.method !== 'GET') return;

  // P4: only treat a *valid signed* cookie as "already captured".
  // A forged/tampered cookie should be overwritten by a legitimate capture.
  const existing = request.cookies?.[COOKIE_NAME];
  if (typeof existing === 'string' && existing.length > 0) {
    let unsigned;
    try {
      unsigned = request.unsignCookie(existing);
    } catch {
      // If the unsigner throws (malformed cookie format), fall through and
      // overwrite with a fresh value below.
      unsigned = { valid: false };
    }
    if (unsigned.valid) return; // legitimate first-write-wins
    request.log.warn({ cookie: COOKIE_NAME }, 'source-context cookie signature invalid; will overwrite');
  } else if (existing === false) {
    // Defensive: handle the legacy auto-unsigned-false shape if any caller
    // (or future @fastify/cookie behavior) returns it.
    request.log.warn({ cookie: COOKIE_NAME }, 'source-context cookie signature invalid; will overwrite');
  }

  const source = sanitize(request.query?.source);
  const campaign = sanitize(request.query?.campaign);
  if (source === null && campaign === null) return;

  const value = JSON.stringify({ source, campaign });
  reply.setCookie(COOKIE_NAME, value, {
    signed: true,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_S,
  });
}

/**
 * Read FR7 source-context from the signed cookie set by
 * sourceContextCapture. Returns nulls for both fields if the cookie is
 * absent, malformed, or has an invalid signature.
 *
 * @param {import('fastify').FastifyRequest} request - Fastify request
 * @returns {{source: string|null, campaign: string|null}} parsed source/campaign or both null
 */
export function readSourceContext (request) {
  const raw = request.cookies?.[COOKIE_NAME];
  if (typeof raw !== 'string' || raw.length === 0) {
    return { source: null, campaign: null };
  }
  // @fastify/cookie does NOT auto-unwrap signed cookies — request.cookies[name]
  // returns the raw `s:<value>.<signature>` form. Explicit unsign is required.
  // P10: wrap in try/catch — a future Fastify/cookie validator throw should
  // be a benign null-return, not bubble a 500 to the user.
  let unsigned;
  try {
    unsigned = request.unsignCookie(raw);
  } catch (err) {
    request.log.warn({ cookie: COOKIE_NAME, err }, 'source-context cookie unsign threw');
    return { source: null, campaign: null };
  }
  if (!unsigned.valid) {
    request.log.warn({ cookie: COOKIE_NAME }, 'source-context cookie signature invalid');
    return { source: null, campaign: null };
  }
  try {
    const parsed = JSON.parse(unsigned.value);
    return {
      source: typeof parsed?.source === 'string' ? parsed.source : null,
      campaign: typeof parsed?.campaign === 'string' ? parsed.campaign : null,
    };
  } catch {
    request.log.warn({ cookie: COOKIE_NAME }, 'source-context cookie JSON malformed');
    return { source: null, campaign: null };
  }
}
