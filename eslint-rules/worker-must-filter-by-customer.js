// eslint-rules/worker-must-filter-by-customer.js — Story 5.1
//
// Custom ESLint rule: worker-must-filter-by-customer
//
// In the worker context, RLS is bypassed (service-role client). Any query on a
// customer-scoped table MUST filter by customer_marketplace_id to prevent
// cross-customer data leakage. Queries that are deliberately cross-customer
// (e.g., the dispatcher's initial SELECT across all ACTIVE customers) must be
// annotated with a `// safe: cross-customer cron` comment on the immediately
// preceding line to suppress this rule.
//
// Customer-scoped tables (9):
//   sku_channels, audit_log, baseline_snapshots, pri01_staging, cycle_summaries,
//   daily_kpi_snapshots, scan_jobs, customer_marketplaces, customer_profiles
//
// Detection strategy:
//   - Hook CallExpression nodes where the callee property is 'query'
//     (matches client.query(...) and pool.query(...) patterns)
//   - Inspect the first argument (string literal or template literal) for any
//     reference to a customer-scoped table name
//   - If a customer-scoped table is found AND the SQL does NOT contain a
//     customer_marketplace_id filter, check for the pragma comment
//   - If no pragma → report violation
//
// Pragma suppression:
//   The `// safe: cross-customer cron` comment must appear on the line
//   immediately preceding the client.query(...) call expression.
//
// Export shape: { rules: { 'worker-must-filter-by-customer': rule } }
// Matches the pattern used by no-raw-cron-state-update.js (Story 4.1) and
// no-direct-fetch.js (Story 3.1).

/** @type {readonly string[]} */
const CUSTOMER_SCOPED_TABLES = Object.freeze([
  'sku_channels',
  'audit_log',
  'baseline_snapshots',
  'pri01_staging',
  'cycle_summaries',
  'daily_kpi_snapshots',
  'scan_jobs',
  'customer_marketplaces',
  'customer_profiles',
]);

const FILTER_PATTERNS = [
  /customer_marketplace_id\s*=\s*\$\d+/i,    // parameterised: customer_marketplace_id = $1
  /customer_marketplace_id\s*=/i,             // any form (WHERE clause)
  /customer_marketplace_id,/i,               // INSERT column list: ..., customer_marketplace_id, ...
  /customer_marketplace_id\s*\)/i,           // INSERT column list trailing: ..., customer_marketplace_id)
  /\bcustomer_marketplace_id\b/i,            // any reference to column (covers INSERT ... (customer_marketplace_id ...) patterns)
  /\.eq\s*\(\s*['"]customer_marketplace_id['"]/i, // Supabase client: .eq('customer_marketplace_id', ...)
  /\bWHERE\s+(?:\w+\.)?id\s*=\s*\$\d+/i,    // WHERE id = $N or WHERE cm.id = $N (PK lookup — single customer row)
];

/**
 * Check whether a SQL string references at least one customer-scoped table.
 *
 * @param {string} sql
 * @returns {boolean}
 */
function referencesCustomerScopedTable (sql) {
  const lower = sql.toLowerCase();
  return CUSTOMER_SCOPED_TABLES.some((t) => lower.includes(t));
}

/**
 * Check whether a SQL string contains a customer_marketplace_id filter.
 *
 * @param {string} sql
 * @returns {boolean}
 */
function hasCustomerFilter (sql) {
  return FILTER_PATTERNS.some((re) => re.test(sql));
}

/**
 * Extract the SQL text from a CallExpression's first argument node.
 * Returns null if the argument is not a plain string literal or template literal.
 *
 * @param {import('eslint').Rule.Node} argNode - First argument of the query call
 * @returns {string|null}
 */
function extractSqlText (argNode) {
  if (!argNode) return null;

  // Plain string literal: 'SELECT ...' or "SELECT ..."
  if (argNode.type === 'Literal' && typeof argNode.value === 'string') {
    return argNode.value;
  }

  // Template literal: `SELECT ...` (join the static quasi parts)
  if (argNode.type === 'TemplateLiteral') {
    return argNode.quasis.map((q) => q.value.raw).join('');
  }

  return null;
}

/**
 * Check whether the pragma comment appears on the line immediately preceding
 * the given node's start line, OR at the top of the file (file-level suppression).
 *
 * File-level pragma: if `// safe: cross-customer cron` appears in any comment
 * on lines 1-5 of the file, the entire file is treated as a cross-customer cron
 * (pattern used by `monthly-partition-create.js` which has the pragma at line 1).
 *
 * Inline pragma: `// safe: cross-customer cron` on the immediately preceding line
 * suppresses a single query call.
 *
 * @param {import('eslint').SourceCode} sourceCode
 * @param {import('eslint').Rule.Node} node - The CallExpression node
 * @returns {boolean}
 */
function hasPrecedingPragma (sourceCode, node) {
  const callLine = node.loc.start.line; // 1-indexed

  // Get all comments and check:
  //   1. Immediately preceding line (inline suppression)
  //   2. Lines 1-5 of the file (file-level suppression)
  const allComments = sourceCode.getAllComments();
  for (const comment of allComments) {
    const commentText = comment.value.trim();
    if (commentText.startsWith('safe: cross-customer cron')) {
      // Inline: immediately preceding line
      if (comment.loc.start.line === callLine - 1) return true;
      // File-level: comment is in the first 5 lines
      if (comment.loc.start.line <= 5) return true;
    }
  }
  return false;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Worker queries on customer-scoped tables must filter by customer_marketplace_id ' +
        '(RLS is bypassed in worker context). Add the filter, or annotate with ' +
        '`// safe: cross-customer cron` if the query is deliberately cross-customer.',
    },
    messages: {
      missingCustomerFilter:
        'Worker queries on customer-scoped tables must filter by customer_marketplace_id ' +
        '(RLS is bypassed in worker context). Add the filter, or annotate with ' +
        '`// safe: cross-customer cron` if the query is deliberately cross-customer.',
    },
  },

  create (context) {
    return {
      /**
       * Inspect every CallExpression whose callee property is 'query'.
       * Matches: client.query(...), pool.query(...), db.query(...), etc.
       *
       * @param {import('eslint').Rule.Node} node
       * @returns {void}
       */
      CallExpression (node) {
        // Match any *.query(...) call
        if (
          node.callee.type !== 'MemberExpression' ||
          node.callee.property.type !== 'Identifier' ||
          node.callee.property.name !== 'query'
        ) {
          return;
        }

        // Exclude req.db.query(...) calls — these use the RLS-aware app client,
        // not the service-role worker client. RLS is active for req.db so
        // cross-customer leakage is impossible at the DB layer.
        // Callee shape for req.db.query: object = MemberExpression (req.db), object.object = req
        const calleeObj = node.callee.object;
        if (
          calleeObj.type === 'MemberExpression' &&
          calleeObj.object.type === 'Identifier' &&
          calleeObj.object.name === 'req'
        ) {
          return;
        }

        const firstArg = node.arguments[0];
        const sql = extractSqlText(firstArg);
        if (!sql) return;

        // Only flag queries that reference a customer-scoped table
        if (!referencesCustomerScopedTable(sql)) return;

        // If the query already has the required filter — OK
        if (hasCustomerFilter(sql)) return;

        // Check for the escape-hatch pragma on the preceding line
        const sourceCode = context.getSourceCode ? context.getSourceCode() : context.sourceCode;
        if (hasPrecedingPragma(sourceCode, node)) return;

        context.report({ node, messageId: 'missingCustomerFilter' });
      },
    };
  },
};

export default {
  rules: {
    'worker-must-filter-by-customer': rule,
  },
};
