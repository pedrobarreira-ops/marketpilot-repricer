// eslint-rules/no-float-price.js
//
// Custom ESLint rule: forbids float-price math patterns outside shared/money/index.js.
//
// Story 7.1 / AC#6 — Architectural Constraint #22 (no-float-price).
//
// Forbidden patterns (outside shared/money/index.js):
//   1. <var>.toFixed(2) — ad-hoc decimal formatting on any identifier
//   2. parseFloat(<expr>) — any parseFloat call
//   3. <expr> * 100 — multiply by 100 (ad-hoc cents conversion)
//   4. Math.round(<expr> * 100) / 100 — ad-hoc cents rounding pattern
//
// Allowlist: shared/money/index.js — the SSoT module where these patterns are legitimately used.
// Cross-platform note: context.filename uses backslashes on Windows — normalised to forward slashes.
//
// Error message includes 'shared/money/index.js' and canonical function names so the developer
// knows exactly where to find the correct implementation.
//
// Companion test: tests/shared/money/index.test.js (AC#6 section)

const FORBIDDEN_MESSAGE =
  'Float-price math forbidden. Use shared/money/index.js (toCents, fromCents, roundFloorCents, roundCeilingCents) for all price arithmetic.';

const ALLOWLIST_SUFFIX = 'shared/money/index.js';

/**
 * Returns true if the file currently being linted is the allowlisted SSoT money module.
 *
 * @param {import('eslint').Rule.RuleContext} context
 * @returns {boolean}
 */
function isAllowlisted (context) {
  // ESLint 9+ flat config: context.filename (string property).
  // ESLint 8 and test mocks: context.getFilename() (method, may be present).
  // Normalise backslashes to forward slashes for cross-platform consistency (Windows).
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
      description: 'Forbid float-price math outside shared/money/index.js',
      category: 'Architecture',
      recommended: false,
    },
    schema: [],
    messages: {
      noFloatPrice: FORBIDDEN_MESSAGE,
    },
  },
  create (context) {
    if (isAllowlisted(context)) {
      // Inside the SSoT money module — patterns are legitimate here.
      return {};
    }

    return {
      // Pattern 1: <expr>.toFixed(2)
      // Flags any .toFixed(2) call — in context of price arithmetic, this is always wrong.
      // AST: CallExpression { callee: MemberExpression { property.name === 'toFixed' },
      //                       arguments: [ Literal { value: 2 } ] }
      CallExpression (node) {
        const { callee, arguments: args } = node;

        // Pattern 1: .toFixed(2)
        if (
          callee.type === 'MemberExpression' &&
          callee.property &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'toFixed' &&
          args.length === 1 &&
          args[0].type === 'Literal' &&
          args[0].value === 2
        ) {
          context.report({ node, message: FORBIDDEN_MESSAGE });
          return;
        }

        // Pattern 2: parseFloat(...)
        if (
          callee.type === 'Identifier' &&
          callee.name === 'parseFloat'
        ) {
          context.report({ node, message: FORBIDDEN_MESSAGE });
          return;
        }

        // Pattern 4: Math.round(<expr> * 100) / 100
        // Detect BinaryExpression (division by 100) whose LHS is Math.round(<expr> * 100)
        // This is caught via the BinaryExpression handler below — no extra CallExpression logic needed.
      },

      // Pattern 3: <expr> * 100
      // Pattern 4 (partial): Math.round(<expr> * 100) / 100
      // Both involve a BinaryExpression with operator '*' and numeric literal 100.
      BinaryExpression (node) {
        const { operator, left, right } = node;

        // Pattern 3: anything * 100 or 100 * anything
        if (operator === '*') {
          const isMultiplyBy100 = (
            (right.type === 'Literal' && right.value === 100) ||
            (left.type === 'Literal' && left.value === 100)
          );
          if (isMultiplyBy100) {
            context.report({ node, message: FORBIDDEN_MESSAGE });
            return;
          }
        }

        // Pattern 4: <anything> / 100
        // Catches the outer division in Math.round(price * 100) / 100.
        // (The inner * 100 is already caught by Pattern 3 above.)
        if (operator === '/') {
          const isDivideBy100 = right.type === 'Literal' && right.value === 100;
          if (isDivideBy100) {
            context.report({ node, message: FORBIDDEN_MESSAGE });
          }
        }
      },
    };
  },
};

export default {
  rules: {
    'no-float-price': rule,
  },
};
