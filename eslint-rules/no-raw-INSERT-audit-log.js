// eslint-rules/no-raw-INSERT-audit-log.js
//
// Custom ESLint rule: forbids raw INSERT INTO audit_log (or Supabase-style
// .from('audit_log').insert(...)) outside shared/audit/writer.js.
//
// Story 9.0 / AC#4
//
// Forbidden patterns (outside shared/audit/writer.js):
//   1. Template literals or strings containing `INSERT INTO audit_log` (case-insensitive)
//   2. Supabase-style `.from('audit_log').insert(...)` call chain
//
// Allowlist: shared/audit/writer.js (the SSoT INSERT path — writeAuditEvent).
//
// False-positive guards:
//   - `INSERT INTO audit_log_event_types` (the lookup/seed table) must NOT
//     match. The regex below uses a trailing negative-lookahead `(?!\w)` so
//     that `audit_log` is only matched at a word boundary (i.e. `audit_log`,
//     `audit_log;`, `audit_log (`, `audit_log\n`) — never `audit_log_event_types`
//     or any other identifier that extends `audit_log` with more word chars.
//   - Schema-prefixed `INSERT INTO public.audit_log` is also matched (the
//     `(?:public\.)?` group makes the schema prefix optional).
//
// Error message: "Raw audit_log INSERT forbidden. Use shared/audit/writer.js's
//   writeAuditEvent for all audit emissions."
//
// Companion test: tests/shared/audit/writer.test.js (AC#4 section)

const FORBIDDEN_MESSAGE =
  "Raw audit_log INSERT forbidden. Use shared/audit/writer.js's writeAuditEvent for all audit emissions.";

// Match `INSERT INTO [public.]audit_log` only when `audit_log` is followed by
// a non-word character (or end of string) — prevents false positives on
// `audit_log_event_types`, `audit_log_archive_runs`, etc.
const INSERT_AUDIT_LOG_RE = /insert\s+into\s+(?:public\s*\.\s*)?audit_log(?!\w)/i;

const ALLOWLIST_SUFFIX = 'shared/audit/writer.js';

/**
 * Returns true if the file currently being linted is the allowlisted writer module.
 *
 * @param {import('eslint').Rule.RuleContext} context
 * @returns {boolean}
 */
function isAllowlisted (context) {
  // ESLint 9+ flat config: context.filename (string property).
  // ESLint 8 and test mocks: context.getFilename() (method, may be present).
  // Normalise backslashes to forward slashes for cross-platform consistency.
  const filename = (
    typeof context.filename === 'string'
      ? context.filename
      : typeof context.getFilename === 'function'
        ? context.getFilename()
        : ''
  ).replace(/\\/g, '/');
  return filename.endsWith(ALLOWLIST_SUFFIX);
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: "Forbid raw INSERT INTO audit_log outside shared/audit/writer.js",
      category: 'Architecture',
      recommended: false,
    },
    schema: [],
    messages: {
      noRawInsertAuditLog: FORBIDDEN_MESSAGE,
    },
  },
  create (context) {
    if (isAllowlisted(context)) {
      // Inside the allowlisted writer module — no restrictions.
      return {};
    }

    return {
      // Pattern 1: template literals containing `INSERT INTO audit_log`
      // Covers sql`INSERT INTO audit_log ...` and similar.
      // Word-boundary guard prevents matching `audit_log_event_types`.
      TemplateLiteral (node) {
        for (const quasi of node.quasis) {
          if (INSERT_AUDIT_LOG_RE.test(quasi.value.raw)) {
            context.report({ node, message: FORBIDDEN_MESSAGE });
            return;
          }
        }
      },

      // Pattern 1 (string literals): 'INSERT INTO audit_log ...'
      // Word-boundary guard prevents matching `audit_log_event_types`.
      Literal (node) {
        if (typeof node.value === 'string' &&
            INSERT_AUDIT_LOG_RE.test(node.value)) {
          context.report({ node, message: FORBIDDEN_MESSAGE });
        }
      },

      // Pattern 2: Supabase .from('audit_log').insert(...) call chain.
      // Detect CallExpression whose callee is a MemberExpression `.insert`
      // whose object is itself a CallExpression `.from('audit_log')`.
      //
      // AST shape:
      //   CallExpression {
      //     callee: MemberExpression {
      //       object: CallExpression {         ← .from('audit_log')
      //         callee: MemberExpression { property.name === 'from' }
      //         arguments: [ Literal { value: 'audit_log' } ]
      //       }
      //       property: { name: 'insert' }
      //     }
      //   }
      CallExpression (node) {
        const { callee } = node;
        if (
          callee.type === 'MemberExpression' &&
          callee.property &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'insert'
        ) {
          const innerCall = callee.object;
          if (
            innerCall.type === 'CallExpression' &&
            innerCall.callee &&
            innerCall.callee.type === 'MemberExpression' &&
            innerCall.callee.property &&
            innerCall.callee.property.name === 'from' &&
            innerCall.arguments &&
            innerCall.arguments.length > 0 &&
            innerCall.arguments[0].type === 'Literal' &&
            innerCall.arguments[0].value === 'audit_log'
          ) {
            context.report({ node, message: FORBIDDEN_MESSAGE });
          }
        }
      },
    };
  },
};

export default {
  rules: {
    'no-raw-INSERT-audit-log': rule,
  },
};
