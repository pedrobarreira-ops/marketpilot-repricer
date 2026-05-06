// eslint-rules/no-raw-cron-state-update.js — Story 4.1
//
// Custom ESLint rule: forbid raw SQL strings that mutate customer_marketplaces.cron_state
// outside the SSoT module shared/state/cron-state.js.
//
// All cron_state mutations MUST flow through transitionCronState() from
// shared/state/cron-state.js. The SSoT enforces:
//   - Transition validation against LEGAL_CRON_TRANSITIONS
//   - Optimistic concurrency (WHERE cron_state = $from)
//   - Audit event emission (Bundle B atomicity)
//
// Ships with Story 4.1 per the custom ESLint rule deferred-rule pattern.
// Structural reference: matches the export pattern used by
// eslint-rules/no-direct-fetch.js (Story 3.1), no-direct-pg-in-app.js (Story 2.1)
// and no-raw-INSERT-audit-log.js (Story 9.0) — the file's default export is a
// plugin shape (`{ rules: { '<name>': rule } }`) so that eslint.config.js can
// register it as `plugins: { local: { rules: { 'no-raw-cron-state-update': rule } } }`
// and reference the rule as `'local/no-raw-cron-state-update': 'error'`.

const SSOT = 'shared/state/cron-state.js';

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Raw cron_state UPDATE must go through shared/state/cron-state.js SSoT',
    },
    messages: {
      noRawCronStateUpdate:
        'Raw cron_state UPDATE detected. Use transitionCronState() from shared/state/cron-state.js instead.',
    },
  },

  create (context) {
    /**
     * Returns true when the current file IS the SSoT module (allowlisted).
     * Normalises to forward slashes for cross-platform consistency.
     *
     * @returns {boolean}
     */
    function isAllowed () {
      const raw = context.filename ?? context.getFilename?.() ?? '';
      const filename = raw.replace(/\\/g, '/');
      return filename.endsWith(SSOT);
    }

    /**
     * Check a string value for the raw cron_state UPDATE pattern.
     * Matches: UPDATE customer_marketplaces SET cron_state (case-insensitive).
     *
     * @param {string} value
     * @returns {boolean}
     */
    function hasViolation (value) {
      return /UPDATE\s+customer_marketplaces\s+SET\s+cron_state/i.test(value);
    }

    return {
      /**
       * Flag string literals containing the forbidden raw SQL.
       *
       * @param {import('eslint').Rule.Node} node
       * @returns {void}
       */
      Literal (node) {
        if (isAllowed()) return;
        if (typeof node.value === 'string' && hasViolation(node.value)) {
          context.report({ node, messageId: 'noRawCronStateUpdate' });
        }
      },

      /**
       * Flag template literals containing the forbidden raw SQL.
       * Joins all quasi segments (static parts) for pattern matching.
       *
       * @param {import('eslint').Rule.Node} node
       * @returns {void}
       */
      TemplateLiteral (node) {
        if (isAllowed()) return;
        const raw = node.quasis.map((q) => q.value.raw).join('');
        if (hasViolation(raw)) {
          context.report({ node, messageId: 'noRawCronStateUpdate' });
        }
      },
    };
  },
};

export default {
  rules: {
    'no-raw-cron-state-update': rule,
  },
};
