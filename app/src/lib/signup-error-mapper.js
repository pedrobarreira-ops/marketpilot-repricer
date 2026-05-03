// Story 1.4 — supabase.auth.signUp error → PT-localized field message.
//
// The handle_new_auth_user() trigger raises with HINT codes that propagate
// through GoTrue into the supabase-js AuthError.message. This mapper
// substring-searches for those HINTs and returns a {field, messagePt}
// tuple for inline form rendering. Unmapped errors fall through to a
// generic catch-all message — the customer NEVER sees raw upstream
// error.message text (NFR-S5 / safe-error contract).

const HINT_MAP = Object.freeze({
  PROFILE_FIRST_NAME_REQUIRED:   { field: 'first_name',   messagePt: 'Por favor introduz o teu nome próprio.' },
  PROFILE_LAST_NAME_REQUIRED:    { field: 'last_name',    messagePt: 'Por favor introduz o teu apelido.' },
  PROFILE_COMPANY_NAME_REQUIRED: { field: 'company_name', messagePt: 'Por favor introduz o nome da tua empresa.' },
});

const HINT_KEYS = Object.freeze(Object.keys(HINT_MAP));

const GENERIC_MESSAGE = 'Não foi possível criar a conta. Tenta novamente em alguns minutos.';
const ALREADY_REGISTERED_MESSAGE = 'Este email já está registado. Tenta iniciar sessão.';

/**
 * Map a Supabase auth.signUp error to a {field, messagePt} tuple for
 * rendering. Returns {field: null, messagePt} for unmapped errors so the
 * caller can render the catch-all at the top of the form.
 *
 * @param {unknown} error - the error returned from supabase.auth.signUp
 * @returns {{field: 'first_name'|'last_name'|'company_name'|'email'|null, messagePt: string}} mapped field error or generic
 */
export function mapSignupError (error) {
  const message = String(error?.message ?? '');
  const code = String(error?.code ?? '');
  const haystack = `${message} ${code}`;

  for (const key of HINT_KEYS) {
    if (haystack.includes(key)) return HINT_MAP[key];
  }

  // GoTrue surfaces "User already registered" / "user_already_exists" for
  // duplicate emails. Surface this as a field-mapped error on `email` so
  // the customer can immediately correct their action.
  if (
    code === 'user_already_exists' ||
    /already (registered|exists)/i.test(message)
  ) {
    return { field: 'email', messagePt: ALREADY_REGISTERED_MESSAGE };
  }

  return { field: null, messagePt: GENERIC_MESSAGE };
}
