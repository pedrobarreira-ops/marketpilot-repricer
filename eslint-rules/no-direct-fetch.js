// eslint-rules/no-direct-fetch.js — Story 3.1
//
// Custom ESLint rule: forbid direct fetch() calls and fetch imports outside
// shared/mirakl/. All HTTP GET calls must flow through the SSoT module at
// shared/mirakl/api-client.js. PRI01 multipart submit lives in
// shared/mirakl/pri01-writer.js (Epic 6) — also allowed.
//
// Allowlisted paths (no violation):
//   shared/mirakl/api-client.js
//   shared/mirakl/pri01-writer.js
//
// Any other file calling fetch() or importing from 'node:fetch' / 'fetch'
// triggers an error.

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow direct fetch() outside shared/mirakl/',
    },
    messages: {
      noDirectFetch:
        'Direct fetch() forbidden. Use shared/mirakl/api-client.js for GET; PRI01 multipart submit lives in shared/mirakl/pri01-writer.js (Epic 6).',
    },
  },

  create (context) {
    /**
     * Returns true when the current file is inside the shared/mirakl/ allowlist.
     * Normalises the filename to forward slashes so the check works on both
     * POSIX ('/') and Windows ('\\') path separators, and handles both
     * absolute paths ('.../shared/mirakl/...') and relative paths
     * ('shared/mirakl/...').
     *
     * @returns {boolean}
     */
    function isAllowed () {
      const raw = context.filename ?? context.getFilename?.() ?? '';
      // Normalise to forward slashes for a single consistent check
      const filename = raw.replace(/\\/g, '/');
      return (
        filename.includes('/shared/mirakl/') ||
        filename.startsWith('shared/mirakl/')
      );
    }

    return {
      /**
       * Flag any direct `fetch(...)` or `globalThis.fetch(...)` /
       * `window.fetch(...)` call outside the allowlist.
       *
       * @param {import('eslint').Rule.Node} node
       * @returns {void}
       */
      CallExpression (node) {
        if (isAllowed()) return;
        const callee = node.callee;
        const isFetch =
          (callee.type === 'Identifier' && callee.name === 'fetch') ||
          (callee.type === 'MemberExpression' &&
            callee.property.type === 'Identifier' &&
            callee.property.name === 'fetch');
        if (isFetch) {
          context.report({ node, messageId: 'noDirectFetch' });
        }
      },

      /**
       * Flag `import { fetch } from 'node:fetch'` or `import ... from 'fetch'`
       * outside the allowlist.
       *
       * @param {import('eslint').Rule.Node} node
       * @returns {void}
       */
      ImportDeclaration (node) {
        if (isAllowed()) return;
        const src = node.source.value;
        if (src === 'node:fetch' || src === 'fetch') {
          context.report({ node, messageId: 'noDirectFetch' });
        }
      },
    };
  },
};
