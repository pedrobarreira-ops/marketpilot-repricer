// Story 1.4 — supabase-js anon client factory.
//
// The anon client is the public-flow client used by /signup, /login,
// /forgot-password, /reset-password. It uses SUPABASE_ANON_KEY (the
// JWT-style API key) NOT the service-role key — anon-flow JWTs are issued
// by GoTrue on the anon path, which is required for signUp /
// signInWithPassword / resetPasswordForEmail to work.
//
// Server-side use only — auth: { persistSession: false, ... } opts out of
// supabase-js's browser-style localStorage session-management.

import { createClient } from '@supabase/supabase-js';

const ANON_CLIENT_OPTIONS = Object.freeze({
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

let _anonClient = null;

/**
 * Process-singleton supabase-js anon client for stateless public-flow auth
 * calls (signup, login, forgot-password). Server-side use only — no
 * browser-style session persistence; each call is stateless.
 *
 * Do NOT use the singleton for any flow that mutates client state via
 * setSession() — concurrent requests will cross-contaminate. For
 * setSession-bearing flows (e.g., recovery / password reset) use
 * createEphemeralAnonSupabaseClient() instead.
 *
 * @returns {import('@supabase/supabase-js').SupabaseClient} configured anon client
 */
export function getAnonSupabaseClient () {
  if (_anonClient === null) {
    _anonClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      ANON_CLIENT_OPTIONS
    );
  }
  return _anonClient;
}

/**
 * Per-request supabase-js anon client. Use this for flows that mutate client
 * state via setSession() (recovery / password reset) — a fresh client per
 * request prevents the singleton race where concurrent requests overwrite
 * each other's active session.
 *
 * @returns {import('@supabase/supabase-js').SupabaseClient} fresh anon client
 */
export function createEphemeralAnonSupabaseClient () {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    ANON_CLIENT_OPTIONS
  );
}
