// Story 1.4 — Signup route (Atomicity Bundle A: F3 + AD29).
//
// GET  /signup → render the form
// POST /signup → validate body via Fastify JSON Schema (AD28: built-in only,
//                no zod/joi/yup/ajv); call supabase.auth.signUp; map errors
//                via signup-error-mapper.js for PT-localized field messages;
//                redirect to /verify-email on success.
//
// Atomicity is enforced by the handle_new_auth_user() trigger and Postgres
// transaction semantics — the route does NOT need partial-state cleanup.

import { getAnonSupabaseClient } from '../../lib/supabase-clients.js';
import { mapSignupError } from '../../lib/signup-error-mapper.js';
import { readSourceContext } from '../../middleware/source-context-capture.js';

const SIGNUP_BODY_SCHEMA = {
  type: 'object',
  required: ['email', 'password', 'first_name', 'last_name', 'company_name'],
  properties: {
    email:        { type: 'string', format: 'email', maxLength: 254 },
    password:     { type: 'string', minLength: 8, maxLength: 72 },
    first_name:   { type: 'string', minLength: 1, maxLength: 100 },
    last_name:    { type: 'string', minLength: 1, maxLength: 100 },
    company_name: { type: 'string', minLength: 1, maxLength: 200 },
  },
  additionalProperties: false,
};

const PT_FIELD_LABELS = Object.freeze({
  email:        'email',
  password:     'palavra-passe',
  first_name:   'nome próprio',
  last_name:    'apelido',
  company_name: 'nome da empresa',
});

// P8: bcrypt (which Supabase Auth uses internally) caps password input at
// 72 BYTES. JSON Schema's maxLength counts characters; a 72-character
// multibyte password (emoji, Cyrillic) exceeds the byte cap and is silently
// truncated. Reject explicitly with a PT message instead.
const PASSWORD_BYTE_LIMIT = 72;
const PASSWORD_TOO_LONG_PT = 'Palavra-passe demasiado longa em UTF-8 (máx 72 bytes).';

const GENERIC_VALIDATION_ERROR_PT = 'O formulário não pôde ser submetido. Verifica os campos e tenta novamente.';

/**
 * Convert AJV (Fastify-built-in) validation errors into per-field
 * PT-localized messages keyed by field name + an optional top-level
 * fallback for keyword errors (e.g., additionalProperties) that have no
 * meaningful per-field placement.
 *
 * @param {Array<object>|undefined} errors - validationError.validation array
 * @returns {{fieldErrors: Record<string,string>, topError: string|null}}
 */
function ajvErrorsToFieldErrors (errors) {
  const fieldErrors = {};
  let nonFieldKeywordErr = false;
  for (const e of errors ?? []) {
    const segments = (e.instancePath ?? '').split('/').filter(Boolean);
    const field = segments[0] ?? e.params?.missingProperty ?? null;
    if (field !== null && field !== undefined && !(field in fieldErrors)) {
      fieldErrors[field] = `O campo ${PT_FIELD_LABELS[field] ?? field} é obrigatório ou inválido.`;
    } else if (e.keyword === 'additionalProperties' || (field === null && e.params?.additionalProperty)) {
      // P12: AJV emits additionalProperties errors with empty instancePath
      // and `params.additionalProperty` — these have no field to attach to.
      // Surface a top-level error so the user sees something instead of a
      // silent 400.
      nonFieldKeywordErr = true;
    }
  }
  const topError = (Object.keys(fieldErrors).length === 0 && (nonFieldKeywordErr || (errors ?? []).length > 0))
    ? GENERIC_VALIDATION_ERROR_PT
    : null;
  return { fieldErrors, topError };
}

/**
 * Render signup.eta with optional preserved form values + per-field PT
 * errors. NEVER preserves the password back to the form (defense in depth).
 *
 * @param {import('fastify').FastifyReply} reply - Fastify reply
 * @param {{formValues?: object, fieldErrors?: Record<string,string>, topError?: string|null, status?: number}} [opts] - render options
 * @returns {import('fastify').FastifyReply} the reply (chainable)
 */
function renderSignup (reply, { formValues = {}, fieldErrors = {}, topError = null, status = 200 } = {}) {
  const safeValues = { ...formValues };
  delete safeValues.password;
  return reply.code(status).view('pages/signup.eta', {
    formValues: safeValues,
    fieldErrors,
    topError,
    fieldLabels: PT_FIELD_LABELS,
  });
}

/**
 * Register GET + POST /signup on the Fastify instance.
 *
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance
 * @returns {Promise<void>} resolves once routes are registered
 */
export async function signupRoutes (fastify) {
  fastify.get('/signup', async (_request, reply) => renderSignup(reply));

  fastify.post('/signup', {
    schema: { body: SIGNUP_BODY_SCHEMA },
    attachValidation: true,
  }, async (request, reply) => {
    if (request.validationError) {
      const { fieldErrors, topError } = ajvErrorsToFieldErrors(request.validationError.validation);
      return renderSignup(reply, {
        formValues: request.body ?? {},
        fieldErrors,
        topError,
        status: 400,
      });
    }

    const { email, password, first_name, last_name, company_name } = request.body;

    // P8: bcrypt cap is 72 BYTES, not characters. Reject early so we don't
    // pass a silently-truncated password to Supabase.
    if (Buffer.byteLength(password, 'utf8') > PASSWORD_BYTE_LIMIT) {
      return renderSignup(reply, {
        formValues: request.body,
        fieldErrors: { password: PASSWORD_TOO_LONG_PT },
        status: 400,
      });
    }

    // Pre-validate that required B2B fields are non-empty after trim. JSON
    // Schema's minLength: 1 doesn't catch whitespace-only strings, and the
    // trigger's HINT propagation through GoTrue is unreliable — current
    // Supabase Auth genericizes the error to "Database error saving new
    // user" / "unexpected_failure", stripping the HINT before the mapper
    // can match it. So we mirror the trigger's length(trim(...)) = 0
    // check at the route level. The trigger remains as a defense-in-depth
    // safety net (catches direct DB writes / future code paths that bypass
    // this route), but the user-facing PT-localized field error is
    // produced here. Whitespace-only inputs never reach Supabase Auth.
    const trimErrors = {};
    if (first_name.trim().length === 0) {
      trimErrors.first_name = 'Por favor introduz o teu nome próprio.';
    }
    if (last_name.trim().length === 0) {
      trimErrors.last_name = 'Por favor introduz o teu apelido.';
    }
    if (company_name.trim().length === 0) {
      trimErrors.company_name = 'Por favor introduz o nome da tua empresa.';
    }
    if (Object.keys(trimErrors).length > 0) {
      return renderSignup(reply, {
        formValues: request.body,
        fieldErrors: trimErrors,
        status: 400,
      });
    }

    const { source, campaign } = readSourceContext(request);

    // P9: strip trailing slash from APP_BASE_URL to avoid `app//verify-email`.
    const appBaseUrl = (process.env.APP_BASE_URL ?? '').replace(/\/$/, '');
    const supabase = getAnonSupabaseClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { first_name, last_name, company_name, source, campaign },
        emailRedirectTo: `${appBaseUrl}/verify-email`,
      },
    });

    if (error) {
      request.log.error({ err: error, code: error.code, status: error.status }, 'signup failed');
      const { field, messagePt } = mapSignupError(error);
      if (field !== null) {
        return renderSignup(reply, {
          formValues: request.body,
          fieldErrors: { [field]: messagePt },
          status: 400,
        });
      }
      return renderSignup(reply, {
        formValues: request.body,
        topError: messagePt,
        status: 400,
      });
    }

    return reply.redirect('/verify-email', 302);
  });
}
