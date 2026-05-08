// eslint-rules/no-raw-CSV-building.js — Story 6.1
//
// Custom ESLint rule: no-raw-CSV-building
//
// Forbids raw CSV construction outside shared/mirakl/pri01-writer.js.
// PRI01 emission is the ONLY permitted CSV building path; all CSV column
// ordering, delimiter handling, and passthrough-line invariants live there.
//
// Detection targets (fires outside the allowlisted file):
//   1. Import of csv-stringify or papaparse packages (CSV-building libraries)
//   2. Template literals containing semicolon- or comma-followed-by-newline
//      patterns (e.g. `${sku};${price}\n` or `${sku},${price}\n`)
//   3. String literals containing ';\n' or ',\n' adjacent patterns
//
// Does NOT fire on:
//   - shared/mirakl/pri01-writer.js (the SSoT — allowlisted)
//   - fs.readFileSync / readFile calls (reading CSV, not building it)
//
// Allowlist: file path contains 'shared/mirakl/pri01-writer.js'
//
// Export shape: { rules: { 'no-raw-CSV-building': rule } }
// Matches the pattern used by worker-must-filter-by-customer.js (Story 5.1).
// eslint.config.js registers it under the 'local-cron' plugin namespace.

/** @type {string[]} */
const CSV_BUILDING_PACKAGES = ['csv-stringify', 'csv-stringify/sync', 'papaparse'];

// Patterns that indicate CSV row construction (writes, not reads)
const CSV_BUILDING_PATTERNS = [
  /;\s*\\n/,   // semicolon followed by escaped newline in string: ';\n'
  /,\s*\\n/,   // comma followed by escaped newline in string: ',\n'
];

/**
 * Check whether the current file is the allowlisted PRI01 writer SSoT.
 *
 * @param {import('eslint').Rule.RuleContext} context
 * @returns {boolean}
 */
function isAllowed (context) {
  const raw = context.filename ?? context.getFilename?.() ?? '';
  const filename = raw.replace(/\\/g, '/');
  return (
    filename.includes('shared/mirakl/pri01-writer.js') ||
    filename.endsWith('pri01-writer.js')
  );
}

/**
 * Check whether a template literal's static quasis contain CSV-building patterns.
 *
 * @param {import('eslint').Rule.Node} node - TemplateLiteral node
 * @returns {boolean}
 */
function templateLiteralHasCsvPattern (node) {
  const raw = node.quasis.map(q => q.value.raw).join('');
  // Detect patterns like: `${sku};${price}\n` or `${sku},${price}\n`
  // The quasis join produces things like: ';' + '\n' across boundaries
  // Also check the raw string directly for ;\n or ,\n
  if (/;\n/.test(raw) || /,\n/.test(raw)) return true;
  if (/;\\n/.test(raw) || /,\\n/.test(raw)) return true;
  return false;
}

/**
 * Check whether a template literal's quasis transition implies CSV building.
 * Detects patterns like: `${sku};${price}\n` where quasis are [';', '\n'] etc.
 *
 * @param {import('eslint').Rule.Node} node - TemplateLiteral node
 * @returns {boolean}
 */
function templateLiteralHasCsvTransition (node) {
  const quasis = node.quasis;
  for (let i = 0; i < quasis.length - 1; i++) {
    const curr = quasis[i].value.raw;
    const next = quasis[i + 1].value.raw;
    // Pattern: quasi ends with ';' or ',' and next starts with '\n' or next quasi contains '\n'
    if ((curr.endsWith(';') || curr.endsWith(',')) && (next.startsWith('\n') || next.startsWith('\\n'))) {
      return true;
    }
    // Pattern: quasi itself contains ;\n or ,\n
    if (/;\n/.test(curr) || /,\n/.test(curr)) return true;
    if (/;\n/.test(next) || /,\n/.test(next)) return true;
  }
  // Also check last quasi
  const lastRaw = quasis[quasis.length - 1]?.value?.raw ?? '';
  if (/;\n/.test(lastRaw) || /,\n/.test(lastRaw)) return true;
  return false;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Raw CSV building forbidden outside shared/mirakl/pri01-writer.js. ' +
        'Use the PRI01 writer SSoT for all price CSV emission.',
    },
    messages: {
      noRawCsvBuilding:
        'Raw CSV building forbidden. Use shared/mirakl/pri01-writer.js for all PRI01 emission.',
    },
  },

  create (context) {
    return {
      /**
       * Flag imports of CSV-building packages (csv-stringify, papaparse).
       *
       * @param {import('eslint').Rule.Node} node - ImportDeclaration
       * @returns {void}
       */
      ImportDeclaration (node) {
        if (isAllowed(context)) return;
        const src = node.source.value;
        if (CSV_BUILDING_PACKAGES.some(pkg => src === pkg || src.startsWith(pkg + '/'))) {
          context.report({ node, messageId: 'noRawCsvBuilding' });
        }
      },

      /**
       * Flag template literals that contain CSV-building patterns
       * (`;${...}\n` or `,${...}\n` style constructions).
       *
       * Does NOT fire for fs.readFileSync/readFile calls (read patterns).
       *
       * @param {import('eslint').Rule.Node} node - TemplateLiteral
       * @returns {void}
       */
      TemplateLiteral (node) {
        if (isAllowed(context)) return;

        // Skip if this template is inside a readFileSync / readFile call
        // Walk up to find parent CallExpression
        let parent = node.parent;
        if (parent) {
          // Direct argument to a call — check if it's readFile* call
          if (parent.type === 'CallExpression') {
            const callee = parent.callee;
            const calleeName = callee.type === 'Identifier' ? callee.name
              : callee.type === 'MemberExpression' ? callee.property.name
                : '';
            if (calleeName === 'readFileSync' || calleeName === 'readFile') return;
          }
        }

        if (templateLiteralHasCsvPattern(node) || templateLiteralHasCsvTransition(node)) {
          context.report({ node, messageId: 'noRawCsvBuilding' });
        }
      },

      /**
       * Flag string literals containing ';\n' or ',\n' patterns (CSV row string).
       *
       * @param {import('eslint').Rule.Node} node - Literal
       * @returns {void}
       */
      Literal (node) {
        if (isAllowed(context)) return;
        if (typeof node.value !== 'string') return;

        // Skip if inside a readFileSync / readFile call
        const parent = node.parent;
        if (parent && parent.type === 'CallExpression') {
          const callee = parent.callee;
          const calleeName = callee.type === 'Identifier' ? callee.name
            : callee.type === 'MemberExpression' ? callee.property.name
              : '';
          if (calleeName === 'readFileSync' || calleeName === 'readFile') return;
        }

        const val = node.value;
        if (/;\n/.test(val) || /,\n/.test(val)) {
          context.report({ node, messageId: 'noRawCsvBuilding' });
        }

        // Also check the raw source value for escaped patterns
        const raw = node.raw ?? '';
        for (const pat of CSV_BUILDING_PATTERNS) {
          if (pat.test(raw)) {
            context.report({ node, messageId: 'noRawCsvBuilding' });
            return;
          }
        }
      },
    };
  },
};

export default {
  rules: {
    'no-raw-CSV-building': rule,
  },
};
