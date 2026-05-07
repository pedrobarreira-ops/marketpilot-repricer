// worker/src/email/scan-failed-email.js — Story 4.6
//
// Renders the scan-failed email HTML from the Eta template at
// app/src/views/emails/scan-failed.eta.
//
// Architecture constraints:
//   - Named exports only (no default export)
//   - No .then() chains (async/await only)
//   - No console.log (pino only)
//   - Do NOT pass cleartext API key into template data

import { Eta } from 'eta';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve the views directory relative to this file.
// Path: worker/src/email/ → ../../.. → repo root → app/src/views
const VIEWS_DIR = join(__dirname, '..', '..', '..', 'app', 'src', 'views');

// Eta instance configured for email template rendering.
// `autoEscape: true` is Eta's default (escapes HTML in <%= %> expressions),
// protecting against XSS even in email body text.
const eta = new Eta({ views: VIEWS_DIR });

/**
 * Render the scan-failed email HTML from app/src/views/emails/scan-failed.eta.
 *
 * Template data shape (documented here as the caller's JSDoc contract):
 * @param {{ customerName: string|null, failureReason: string, keyUrl: string }} data
 * @param {string|null} data.customerName - customer's first name (null if unavailable)
 * @param {string} data.failureReason - PT-localized human-readable failure reason
 * @param {string} data.keyUrl - full URL to /onboarding/key for re-validation
 * @returns {Promise<string>} rendered HTML string
 */
export async function renderScanFailedEmail ({ customerName, failureReason, keyUrl }) {
  // eta.renderAsync returns a Promise<string> for async template execution.
  // The template path is relative to the configured `views` directory.
  // Include the .eta extension to match the file name exactly.
  return eta.renderAsync('emails/scan-failed.eta', {
    customerName: customerName ?? null,
    failureReason,
    keyUrl,
  });
}
