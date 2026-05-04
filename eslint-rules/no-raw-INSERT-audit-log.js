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
// Error message: "Raw audit_log INSERT forbidden. Use shared/audit/writer.js's
//   writeAuditEvent for all audit emissions."
//
// Companion test: tests/shared/audit/writer.test.js (AC#4 section)

const FORBIDDEN_MESSAGE =
  "Raw audit_log INSERT forbidden. Use shared/audit/writer.js's writeAuditEvent for all audit emissions.";

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
      TemplateLiteral (node) {
        for (const quasi of node.quasis) {
          if (/insert\s+into\s+audit_log/i.test(quasi.value.raw)) {
            context.report({ node, message: FORBIDDEN_MESSAGE });
            return;
          }
        }
      },

      // Pattern 1 (string literals): 'INSERT INTO audit_log ...'
      Literal (node) {
        if (typeof node.value === 'string' &&
            /insert\s+into\s+audit_log/i.test(node.value)) {
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
