// shared/resend/client.js — Story 4.6 SSoT Resend client (AD25)
//
// CANONICAL Resend client — Story 12.2 (email templates) extends this module,
// NOT a parallel implementation. The function signature `sendCriticalAlert({ to, subject, html })`
// is locked; do not change it without updating all callers.
//
// Architecture constraints:
//   - Named exports only (no default export per arch constraint)
//   - No .then() chains (async/await only)
//   - No console.log (pino only via createWorkerLogger)
//   - RESEND_API_KEY read from env at module load; process exits on missing key
//   - NEVER log email body content (may contain PII)

import { Resend } from 'resend';
import { createWorkerLogger } from '../logger.js';

const logger = createWorkerLogger();

// Fail fast at module load if RESEND_API_KEY is missing (AD25 / Task 1 spec).
// This converts a would-be runtime error (first email attempt) into a boot
// failure, matching the `loadMasterKey` and `getEnv` fast-fail pattern.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
if (!RESEND_API_KEY || RESEND_API_KEY.length === 0) {
  // Log before exiting so the operator knows why the process stopped.
  // Do NOT call process.exit() inside a module that tests import — rely on
  // the importer to handle the thrown error gracefully (the worker already
  // boots with env checked; the app does not import this module).
  throw new Error(
    'shared/resend/client.js: RESEND_API_KEY is required but not set — ' +
    'set it in the environment before starting the worker process.'
  );
}

const resend = new Resend(RESEND_API_KEY);

// FROM address for critical alerts.
// The `from` address must be a verified sender domain in Resend.
// MarketPilot uses a noreply address for automated alerts.
const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS ?? 'MarketPilot <noreply@marketpilot.pt>';

/**
 * Send a critical alert email via Resend.
 *
 * This is the SSoT Resend client for MarketPilot (AD25). All transactional
 * email in the system MUST import from this module — never construct a Resend
 * instance elsewhere.
 *
 * Best-effort: if Resend returns an error, this function logs it with pino
 * and returns normally (does NOT re-throw). The caller's primary operation
 * (e.g., recording a scan failure) must not be blocked by an email failure.
 *
 * @param {{ to: string, subject: string, html: string }} opts - email parameters
 * @param {string} opts.to - recipient email address
 * @param {string} opts.subject - email subject line
 * @param {string} opts.html - email body as HTML (must NOT contain cleartext API keys or secrets)
 * @returns {Promise<void>} resolves when the email is sent or after logging the error
 * @throws {never} never re-throws — Resend errors are caught and logged
 */
export async function sendCriticalAlert ({ to, subject, html }) {
  // Log metadata only — NEVER log the html body (may contain PII: name, email,
  // failure details). The subject is safe to log (no PII per AC#1 design).
  logger.info({ to, subject }, 'resend/client: sending critical alert email');

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject,
      html,
    });

    if (error) {
      // Resend returns { data: null, error: { name, message, statusCode } } on
      // API-level errors (e.g., invalid domain, rate limit). Log and continue.
      logger.error(
        { resend_error_name: error.name, resend_error_status: error.statusCode },
        'resend/client: Resend API returned an error (non-fatal — scan failure not blocked)'
      );
      return;
    }

    logger.info(
      { resend_email_id: data?.id },
      'resend/client: critical alert email sent successfully'
    );
  } catch (err) {
    // Network/transport-level error (DNS, TLS). Log and continue.
    // Do NOT log err.message — it may contain the HTML body in some SDK versions.
    logger.error(
      { err_name: err?.name },
      'resend/client: unexpected error sending critical alert (non-fatal)'
    );
  }
}
