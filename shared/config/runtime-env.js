import { createWorkerLogger } from '../logger.js';

const log = createWorkerLogger();

const REQUIRED_VARS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_DATABASE_URL',
  'MASTER_KEY_BASE64',
  'COOKIE_SECRET',
  'APP_BASE_URL',
];

/**
 * Validates required environment variables are present and returns them.
 * Exits the process with code 1 if any required variable is missing.
 * @returns {{ SUPABASE_URL: string, SUPABASE_ANON_KEY: string, SUPABASE_SERVICE_ROLE_DATABASE_URL: string, MASTER_KEY_BASE64: string, COOKIE_SECRET: string, APP_BASE_URL: string }} Validated env object
 * @throws {never} Never throws — calls process.exit(1) on missing vars
 */
export function getEnv() {
  const missing = REQUIRED_VARS.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    log.error({ missing }, 'Missing required environment variables — aborting startup');
    process.exit(1);
  }
  return {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_DATABASE_URL: process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL,
    MASTER_KEY_BASE64: process.env.MASTER_KEY_BASE64,
    COOKIE_SECRET: process.env.COOKIE_SECRET,
    APP_BASE_URL: process.env.APP_BASE_URL,
  };
}
