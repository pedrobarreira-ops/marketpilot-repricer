// eslint-rules/no-direct-pg-in-app.js
//
// Custom ESLint rule: forbids direct pg Pool/Client import or instantiation
// inside app/src/ (outside shared/db/). All Postgres access in the app layer
// MUST go through:
//   - getRlsAwareClient(jwt)  — shared/db/rls-aware-client.js (customer queries)
//   - getServiceRoleClient()  — shared/db/service-role-client.js (ops queries)
//
// The rule fires on:
//   import pg from 'pg'
//   import { Pool } from 'pg'
//   import { Client } from 'pg'
//   new Pool(...)
//   new Client(...)
//   new pg.Pool(...)        — MemberExpression form (e.g., default-imported pg)
//   new pg.Client(...)      — same
//
// The rule does NOT apply to:
//   shared/db/        — the SSoT modules own raw pg access
//   worker/src/       — separate worker-level convention
//   tests/            — test helpers may use service-role pool directly
//
// Companion negative-assertion test: eslint_no_direct_pg_in_app_rule_fires_on_violation
// (tests/shared/db/clients.test.js)
//
// Structural reference: no-direct-fetch.js (Story 3.1) uses the same pattern.

const FORBIDDEN_MESSAGE =
  "Direct `pg` Pool/Client instantiation forbidden in app/src/. " +
  "Use `getRlsAwareClient(jwt)` for customer queries (shared/db/rls-aware-client.js) " +
  "or `getServiceRoleClient()` for ops queries (shared/db/service-role-client.js).";

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid direct pg Pool/Client import or instantiation in app/src/',
      category: 'Architecture',
      recommended: false,
    },
    schema: [],
    messages: {
      noDirectPg: FORBIDDEN_MESSAGE,
    },
  },
  create (context) {
    return {
      // Flag: import pg from 'pg'
      // Flag: import { Pool } from 'pg'
      // Flag: import { Client } from 'pg'
      ImportDeclaration (node) {
        if (node.source.value === 'pg') {
          context.report({ node, messageId: 'noDirectPg' });
        }
      },

      // Flag: new Pool(...) or new Client(...) in app/src/ files.
      // Covers both bare-identifier form (named import) and MemberExpression
      // form (`new pg.Pool(...)` / `new pg.Client(...)`) so a default-imported
      // pg alias does not silently bypass the rule.
      NewExpression (node) {
        const { callee } = node;
        if (
          callee.type === 'Identifier' &&
          (callee.name === 'Pool' || callee.name === 'Client')
        ) {
          context.report({ node, messageId: 'noDirectPg' });
          return;
        }
        if (
          callee.type === 'MemberExpression' &&
          callee.property &&
          callee.property.type === 'Identifier' &&
          (callee.property.name === 'Pool' || callee.property.name === 'Client')
        ) {
          context.report({ node, messageId: 'noDirectPg' });
        }
      },
    };
  },
};

export default {
  rules: {
    'no-direct-pg-in-app': rule,
  },
};
