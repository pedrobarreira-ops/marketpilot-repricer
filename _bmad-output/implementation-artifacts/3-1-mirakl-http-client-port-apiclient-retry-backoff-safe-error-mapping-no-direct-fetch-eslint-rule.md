# Story 3.1: Mirakl HTTP Client Port — `apiClient` + Retry/Backoff + Safe-Error Mapping + `no-direct-fetch` ESLint Rule

**Sprint-status key:** `3-1-mirakl-http-client-port-apiclient-retry-backoff-safe-error-mapping-no-direct-fetch-eslint-rule`
**Status:** ready-for-dev
**Size:** M
**Epic:** Epic 3 — Mirakl Integration Foundation (architecture S-I phase 3)

---

## Narrative

**As a** BAD subagent implementing any story that reads from Mirakl (Stories 3.2, 3.3, 4.3, 4.4, 7.x),
**I want** a single-source-of-truth Mirakl HTTP GET client with retry/backoff, PT-localized safe-error mapping, and an ESLint rule that prevents any direct `fetch()` call outside `shared/mirakl/`,
**So that** every Mirakl HTTP call in the codebase flows through one controlled path — with automatic retries, redaction-safe error handling, and a mechanical guard that makes it impossible to bypass the SSoT module.

---

## Trace

- **Architecture decisions:** AD5 (Mirakl HTTP client reused from DynamicPriceIdea; retry/backoff spec; error classification; auth header format)
- **Functional requirements:** Foundation (no direct FR; enables FR8-FR15, FR20, FR23 via Story 3.2+)
- **Non-functional requirements:** NFR-I1 (Mirakl rate-limit/retry); NFR-S1 (no cleartext key in errors/logs)
- **Epic section:** `_bmad-output/planning-artifacts/epics-distillate/01-epics-1-3-foundation-tenancy-mirakl.md`, Story 3.1
- **Architecture impl patterns:** `_bmad-output/planning-artifacts/architecture-distillate/04-implementation-patterns.md` — SSoT modules + ESLint enforcement

---

## SSoT Modules Introduced

This story establishes two of the 11 architecture-mandated single-source-of-truth modules:

1. **`shared/mirakl/api-client.js`** — exports `mirAklGet(baseUrl, path, params, apiKey)` and `MiraklApiError` class. The ONLY permitted Mirakl HTTP GET path. All Mirakl GET callers across Epics 3–7+ must use this function. Never call `fetch()` directly outside `shared/mirakl/` (ESLint rule enforces this).

2. **`shared/mirakl/safe-error.js`** — exports `getSafeErrorMessage(err)`. The ONLY permitted path to derive a PT-localized customer-facing message from a Mirakl error. Never pass `err.message` or raw upstream response body to any template or banner.

**ESLint rule shipped with this story:** `eslint-rules/no-direct-fetch.js` (placeholder already exists; this story implements it).

---

## Mirakl MCP Verification

**No Mirakl endpoints are called by Story 3.1's implementation code.** The story builds the HTTP client itself, not the callers. However, the auth header format and retry behavior are derived from empirically-verified Mirakl facts (confirmed 2026-04-30 on Worten via Gabriel's Easy-Store account) and locked in the architecture distillate:

- Auth header: `Authorization: <api_key>` — raw key, NO `Bearer` prefix (empirically confirmed on all 6 Worten calls in verification run)
- Retry schedule: 5 retries, exponential backoff `[1s, 2s, 4s, 8s, 16s]` — retryable on 429 + 5xx + transport errors; non-retryable on 4xx (except 429); max 30s per delay cap
- These facts are in "Cross-Cutting Empirically-Verified Mirakl Facts" (architecture-distillate/_index.md) and do NOT require MCP re-verification.

---

## Dependencies

- **Story 1.1** (DONE): project scaffold, `eslint.config.js`, `eslint-rules/` directory — `eslint-rules/no-direct-fetch.js` placeholder already exists (line 1–2: empty stub)
- **Story 1.3** (DONE): `shared/logger.js` with `getRedactPaths()` and `getRedactCensor()` exports — pino redaction of `Authorization` header is already wired; this story's tests verify the integration works

**Enables (blocked until this story is done):**
- Story 3.2 (`a01.js`, `pc01.js`, `of21.js`, `p11.js`, `self-filter.js`, mock server) — all wrappers import `mirAklGet` from this story
- Story 3.3 (`mirakl-empirical-verify.js`) — smoke script calls wrappers from Story 3.2
- Story 4.3 (key entry inline validation) — uses Story 3.2's P11 wrapper
- Story 4.4 (catalog scan) — uses Story 3.2's wrappers via api-client
- Stories 7.x (engine) — indirect dependency via Story 3.2's P11 wrapper

---

## Critical Constraints (Do Not Violate)

1. **`apiKey` is ALWAYS a function parameter, NEVER module-scope.** The worker decrypts each customer's API key at cycle start and passes it through `mirAklGet(...)`. It must never be stored at module level. (AD5 adaptation requirement + NFR-S1 trust posture)

2. **Auth header is raw `Authorization: <key>` — NO `Bearer` prefix.** Empirically confirmed on Worten. If you add `Bearer`, the request will fail with 401.

3. **Node ≥22 built-in `fetch` only.** No third-party HTTP libraries (`node-fetch`, `axios`, `got`, `undici`, etc.). The project already runs Node ≥22 (`package.json` engines field); global `fetch` is available natively.

4. **`MiraklApiError` must carry `.status`, `.code`, and `.safeMessagePt`.** The `.code` is a program-readable identifier (e.g., `WORTEN_API_KEY_INVALID`, `WORTEN_TEMPORARILY_UNAVAILABLE`, `WORTEN_REQUEST_REFUSED`). The `.safeMessagePt` is the PT-localized customer-facing string (derived at throw-time via `getSafeErrorMessage`). The raw upstream error text MUST NEVER appear in any of these fields.

5. **`getSafeErrorMessage` must live in `shared/mirakl/safe-error.js`** as a separate module — NOT inlined in `api-client.js`. Story 3.1 spec has them as two separate SSoT files. The AC in the epics distillate confirms this split.

6. **`no-direct-fetch` ESLint rule scope:** The rule must flag `fetch(...)` calls AND `import { fetch }` or equivalent destructuring OUTSIDE `shared/mirakl/`. It must NOT flag files inside `shared/mirakl/` (api-client.js and pri01-writer.js both legitimately use fetch). The rule should use a `context.filename` path check — not a per-file exception.

7. **Placeholder `eslint-rules/no-direct-fetch.js` must be replaced, not appended to.** The current file (lines 1–2) is a stub: `export default { rules: {} }`. This story replaces it with the real implementation. The `eslint.config.js` does NOT yet load `no-direct-fetch` — this story must add it.

8. **Pino redaction applies to `Authorization` header in any logged error object.** Story 1.3 ships `getRedactPaths()` and `getRedactCensor()` exports from `shared/logger.js`. When the worker logs a `MiraklApiError`, it must log `{ err, headers: { authorization: '[REDACTED]' } }` — never the raw key. The test already verifies this (`api-client.test.js` test "MiraklApiError logged via pino").

9. **`no-console` ESLint rule is active** in `shared/**/*.js`. Never use `console.log` or `console.error` in `api-client.js` or `safe-error.js`. Use pino (but only in caller context — the shared modules themselves don't own a logger instance; they throw errors for callers to log).

10. **Named exports only.** `export default` is forbidden (ESLint enforces `ExportDefaultDeclaration` selector). Use `export class MiraklApiError`, `export async function mirAklGet`, `export function getSafeErrorMessage`.

---

## Source to Port: DynamicPriceIdea `apiClient.js`

The source file to port is at `D:\Plannae Project\DynamicPriceIdea\src\workers\mirakl\apiClient.js`. The DynamicPriceIdea version has been running in production against Gabriel's Worten account — it is the production-tested baseline.

**Key diff between DPI source and the repricer target:**

| Aspect | DynamicPriceIdea source | Repricer Story 3.1 target |
|--------|------------------------|--------------------------|
| `getSafeErrorMessage` | Inline in `apiClient.js` | Separate `shared/mirakl/safe-error.js` |
| `MiraklApiError` fields | `.status` only | `.status` + `.code` + `.safeMessagePt` |
| `safeMessagePt` messages | Mix of PT strings (some non-standard) | Exact spec-mandated strings per AC3 below |
| ESLint rule | None | `no-direct-fetch.js` ships with this story |
| JSDoc | Minimal | Full `@param`, `@returns`, `@throws` on exports |

---

## File-Touch List

### New files

| File | Purpose |
|------|---------|
| `shared/mirakl/api-client.js` | `mirAklGet` + `MiraklApiError` — SSoT for all Mirakl HTTP GET calls |
| `shared/mirakl/safe-error.js` | `getSafeErrorMessage` — PT-localized customer-facing error strings |

### Modified files

| File | Change |
|------|--------|
| `eslint-rules/no-direct-fetch.js` | Replace placeholder stub with real AST-walking rule implementation |
| `eslint.config.js` | Add `no-direct-fetch` rule to source files block (`app/**`, `worker/**`, `shared/**`) with `shared/mirakl/` allow-listed |

### Test files (already exist as scaffolds — activate assertions)

| File | Status |
|------|--------|
| `tests/shared/mirakl/api-client.test.js` | ALREADY EXISTS (scaffold from Epic 3 Phase 1 test design) — all assertions are written; story just needs the implementation to make them pass |

---

## Acceptance Criteria

### AC1 — `mirAklGet`: correct HTTP behavior

**Given** `shared/mirakl/api-client.js` exports `mirAklGet(baseUrl, path, params, apiKey)` as the single source of truth for Mirakl HTTP GET
**When** I call `mirAklGet` with a Worten URL + path + params + apiKey
**Then:**
- The request includes header `Authorization: <apiKey>` (raw — NO `Bearer` prefix)
- The request uses Node's built-in `fetch` (Node ≥22) — no third-party HTTP library
- Query params are forwarded correctly via `URLSearchParams` (`new URL(baseUrl + path)` + `url.searchParams.set(k, String(v))`)
- On 429 or 5xx, the client retries up to 5 times with exponential backoff `[1s, 2s, 4s, 8s, 16s]` (max 30s per delay)
- Transport errors (network timeout, ECONNRESET, etc.) are retried on the same schedule (status = 0)
- 4xx (except 429) is non-retryable — throws `MiraklApiError` immediately (1 attempt total)
- On success (2xx), returns parsed JSON from `res.json()`

### AC2 — `MiraklApiError`: shape and redaction

**Given** any error from a Mirakl call
**When** the caller receives a `MiraklApiError`
**Then:**
- The error has `.status` (HTTP status code; 0 for transport errors)
- The error has `.code` (program-readable identifier, non-empty string, e.g., `'WORTEN_API_KEY_INVALID'`)
- The error has `.safeMessagePt` (PT-localized customer-facing string, non-empty)
- The `apiKey` is NEVER present in `.message`, `.stack`, or `JSON.stringify(err)` — verified by the test that passes a known sentinel string as apiKey and checks no trace in the serialized error

### AC3 — `getSafeErrorMessage`: exact PT strings

**Given** `shared/mirakl/safe-error.js` exports `getSafeErrorMessage(err)`
**When** I pass a `MiraklApiError`:
- **401 status:** returns `"A chave Worten é inválida. Verifica a chave e tenta novamente."`
- **429 or 5xx after retry exhaustion:** returns `"O Worten está temporariamente indisponível. Vamos tentar novamente em breve."`
- **Generic 4xx (e.g., 403, 422):** returns `"Pedido recusado pelo Worten. Contacta o suporte se persistir."`
- **Any status:** NEVER returns the raw upstream error message (checked by test passing a raw string as error message and asserting it doesn't appear in output)

### AC4 — `no-direct-fetch` ESLint rule

**Given** the custom ESLint rule `eslint-rules/no-direct-fetch.js`
**When** ESLint runs against the codebase
**Then:**
- Any `fetch(...)` call OUTSIDE `shared/mirakl/` directory triggers a lint error: *"Direct fetch() forbidden. Use shared/mirakl/api-client.js for GET; PRI01 multipart submit lives in shared/mirakl/pri01-writer.js (Epic 6)."*
- The rule allows `fetch()` inside `shared/mirakl/api-client.js` (no violation)
- The rule allows `fetch()` inside `shared/mirakl/pri01-writer.js` (no violation — future Epic 6 story)
- The rule also flags `import { fetch }` or destructured equivalent outside the allowlist
- Story 1.1's `eslint.config.js` is updated to load this rule against `app/**`, `worker/**`, `shared/**` files
- Legitimate non-Mirakl fetches (none expected at MVP) require `// eslint-disable-next-line no-direct-fetch` with justification comment

### AC5 — Unit tests pass

**Given** unit tests in `tests/shared/mirakl/api-client.test.js` (already written as scaffold)
**When** I run `node --test tests/shared/mirakl/api-client.test.js`
**Then** all tests pass:
- Happy GET path ✓
- Authorization header raw (no Bearer) ✓
- Query params forwarded correctly ✓
- Uses Node built-in fetch (no third-party dep) ✓
- Retry on 429 → succeed on attempt 3 ✓
- Retry exhaustion on 500 → throws MiraklApiError with status=500 ✓
- 401 immediate throw (1 attempt total) ✓
- Transport error → status 0 ✓
- MiraklApiError has `.status`, `.code`, `.safeMessagePt` ✓
- apiKey never in error serialization ✓
- Transport error status = 0 ✓
- getSafeErrorMessage 401 PT string ✓
- getSafeErrorMessage 429/500 PT string ✓
- getSafeErrorMessage generic 4xx PT string ✓
- getSafeErrorMessage never raw upstream message ✓
- `no-direct-fetch.js` file exists ✓
- ESLint rule flags fetch() outside shared/mirakl/ ✓
- ESLint rule allows fetch() inside shared/mirakl/api-client.js ✓
- ESLint rule allows fetch() inside shared/mirakl/pri01-writer.js ✓
- MiraklApiError logged via pino → Authorization redacted ✓

---

## Implementation Guide

### `shared/mirakl/api-client.js`

Port from `D:\Plannae Project\DynamicPriceIdea\src\workers\mirakl\apiClient.js` with these changes:

1. **`MiraklApiError` must add `.code` and `.safeMessagePt`** — derive them at construction time:
   ```js
   import { getSafeErrorMessage } from './safe-error.js';

   export class MiraklApiError extends Error {
     /**
      * @param {string} message
      * @param {number} status - HTTP status code; 0 for transport errors
      * @param {string} code - Program-readable error identifier
      */
     constructor(message, status, code) {
       super(message);
       this.name = 'MiraklApiError';
       this.status = status;
       this.code = code ?? _codeFromStatus(status);
       this.safeMessagePt = getSafeErrorMessage(this);
     }
   }
   ```

2. **The `message` parameter MUST NOT contain the apiKey.** In the DPI source, error messages include `HTTP ${res.status}` and `Mirakl API error after N retries` — these are safe. Do NOT include the apiKey, URL params that might contain keys, or raw response body text.

3. **Add JSDoc `@param`, `@returns`, `@throws`** to `mirAklGet` and `MiraklApiError`. The `jsdoc/require-jsdoc` ESLint rule fires on `publicOnly: true` — both are exported, so both require JSDoc.

4. **`@typedef MiraklApiErrorShape`** is not required at this story size, but the `@throws {MiraklApiError}` tag on `mirAklGet` is required.

5. **Code identifiers** (use these exact strings to match test expectations and architecture):
   - 401 → `'WORTEN_API_KEY_INVALID'`
   - 429 → `'WORTEN_RATE_LIMITED'`
   - 5xx → `'WORTEN_SERVER_ERROR'`
   - Transport (status 0) → `'WORTEN_TRANSPORT_ERROR'`
   - Generic 4xx → `'WORTEN_REQUEST_REFUSED'`

### `shared/mirakl/safe-error.js`

The DPI source inlines `getSafeErrorMessage` in `apiClient.js`. Extract it to its own file with the spec-mandated PT strings:

```js
/**
 * Map any Mirakl error to a safe Portuguese user-facing message.
 * Never exposes raw error text, API response content, or apiKey.
 *
 * @param {import('./api-client.js').MiraklApiError} err
 * @returns {string} PT-localized user-facing message
 */
export function getSafeErrorMessage(err) {
  const status = err?.status;

  if (status === 401 || status === 403) {
    return 'A chave Worten é inválida. Verifica a chave e tenta novamente.';
  }
  if (status === 429 || status >= 500) {
    return 'O Worten está temporariamente indisponível. Vamos tentar novamente em breve.';
  }
  if (status >= 400 && status < 500) {
    return 'Pedido recusado pelo Worten. Contacta o suporte se persistir.';
  }
  // Transport errors (status 0) or unknown
  return 'O Worten está temporariamente indisponível. Vamos tentar novamente em breve.';
}
```

**NOTE:** The circular import issue — `api-client.js` imports from `safe-error.js`, and if `safe-error.js` imported from `api-client.js` it would be circular. The solution: `safe-error.js` does NOT import `MiraklApiError`. It just inspects `err.status` which is a plain number. No circular dependency.

### `eslint-rules/no-direct-fetch.js`

Replace the placeholder stub. The rule must:
- Walk `CallExpression` nodes where `callee.name === 'fetch'` or `callee.property.name === 'fetch'`
- Walk `ImportDeclaration` nodes importing `'node:fetch'` or `'fetch'`
- Check `context.filename` (or `context.physicalFilename`) to determine if the file is inside `shared/mirakl/` — use a path check like `filename.includes('/shared/mirakl/')` or `filename.includes('\\shared\\mirakl\\')`
- If the file is NOT in the allowlist, report the violation

Example rule structure:
```js
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow direct fetch() outside shared/mirakl/',
    },
    messages: {
      noDirectFetch: 'Direct fetch() forbidden. Use shared/mirakl/api-client.js for GET; PRI01 multipart submit lives in shared/mirakl/pri01-writer.js (Epic 6).',
    },
  },
  create(context) {
    function isAllowed() {
      const filename = context.filename ?? context.getFilename();
      return filename.includes('/shared/mirakl/') || filename.includes('\\shared\\mirakl\\');
    }
    return {
      CallExpression(node) {
        if (isAllowed()) return;
        const callee = node.callee;
        const isFetch =
          (callee.type === 'Identifier' && callee.name === 'fetch') ||
          (callee.type === 'MemberExpression' && callee.property.name === 'fetch');
        if (isFetch) {
          context.report({ node, messageId: 'noDirectFetch' });
        }
      },
      ImportDeclaration(node) {
        if (isAllowed()) return;
        const src = node.source.value;
        if (src === 'node:fetch' || src === 'fetch') {
          context.report({ node, messageId: 'noDirectFetch' });
        }
      },
    };
  },
};
```

### `eslint.config.js` update

Add the `no-direct-fetch` rule to the source-files block. Load it the same way `noRawInsertAuditLog` and `noDirPgInApp` are loaded:

```js
import noDirectFetch from './eslint-rules/no-direct-fetch.js';
```

And add a new config object (or extend the existing source-files block):
```js
{
  files: ['app/**/*.js', 'worker/**/*.js', 'shared/**/*.js'],
  plugins: { 'no-direct-fetch': noDirectFetch },
  rules: {
    'no-direct-fetch/no-direct-fetch': 'error',
  },
},
```

**IMPORTANT:** Scope to `app/**`, `worker/**`, `shared/**` only. The rule must NOT apply to `tests/**` (test files may need to import fetch for mocking purposes) or `scripts/**`.

---

## Test File Status

`tests/shared/mirakl/api-client.test.js` **already exists** (committed in `d721d12 feat(test): Epic 3 test scaffolds`). It contains all 20 test cases written and ready. The dev agent's job is to implement the source files that make these tests pass — do NOT recreate or substantially modify the test file.

The test file imports from:
- `'../../../shared/mirakl/api-client.js'` — must export `mirAklGet`, `MiraklApiError`
- `'../../../shared/mirakl/api-client.js'` — must also export `getSafeErrorMessage` (via re-export). The test imports `getSafeErrorMessage` from `api-client.js` (AC3 tests, lines 237, 253, 267, 276). Since `safe-error.js` is the canonical home, `api-client.js` must re-export it:
  ```js
  export { getSafeErrorMessage } from './safe-error.js';
  ```
  The AC3 tests call `getSafeErrorMessage(err)` as a standalone function on a freshly-constructed `MiraklApiError` — they are testing `getSafeErrorMessage` as a function, not just reading `err.safeMessagePt`. Both must work.
- `'../../../eslint-rules/no-direct-fetch.js'` — must be the real rule
- `'../../../shared/logger.js'` — must export `getRedactPaths`, `getRedactCensor` (already does, per Story 1.3)

**Check the test file before implementing** to confirm import paths — the scaffold was written with the story's spec in mind.

---

## Pattern Compliance Checklist

Before marking done, verify:

- [ ] `shared/mirakl/api-client.js` has NO `export default` (use named exports)
- [ ] `shared/mirakl/safe-error.js` has NO `export default`
- [ ] `shared/mirakl/api-client.js` has NO `console.log` / `console.error`
- [ ] `shared/mirakl/safe-error.js` has NO `console.log` / `console.error`
- [ ] `shared/mirakl/api-client.js` uses NO `.then()` chains (async/await only)
- [ ] No third-party HTTP lib imported (`node-fetch`, `axios`, `got`, `undici` absent from new files)
- [ ] `apiKey` does not appear in any string concatenated into error messages
- [ ] JSDoc `@param`, `@returns`, `@throws` on all exported functions
- [ ] `eslint.config.js` loads `no-direct-fetch` rule under `app/**`, `worker/**`, `shared/**` scope
- [ ] `eslint-rules/no-direct-fetch.js` no longer contains the placeholder stub

---

## Story Completion Status

Status: **review**

---

### Review Findings

Code review pass 2026-05-06 — Blind Hunter + Edge Case Hunter + Acceptance Auditor. 22/22 tests pass; ESLint clean; all 5 ACs verified satisfied.

- [x] [Review][Patch] Filter undefined/null query params in `mirAklGet` so callers passing `{ foo: undefined }` don't emit `?foo=undefined` in the URL [shared/mirakl/api-client.js:86-91]
- [x] [Review][Defer] `res.json()` may throw `SyntaxError` on malformed 2xx body — caller gets non-MiraklApiError [shared/mirakl/api-client.js:113] — deferred, not exercised in MVP, no test coverage; revisit if Worten ever returns malformed JSON
- [x] [Review][Defer] ESLint `no-direct-fetch` does not catch `obj['fetch']()` computed-access bypass [eslint-rules/no-direct-fetch.js:55-66] — deferred, requires deliberate evasion; the rule prevents accidental usage which is the actual goal
- [x] [Review][Defer] ESLint `no-direct-fetch` does not catch `export { fetch } from 'node:fetch'` re-export bypass [eslint-rules/no-direct-fetch.js:75-81] — deferred, same reasoning as computed-access
- [x] [Review][Defer] ESLint `no-direct-fetch` does not catch dynamic `await import('node:fetch')` [eslint-rules/no-direct-fetch.js:75-81] — deferred, same reasoning; bypass requires intent
- [x] [Review][Defer] `backoffDelay` does not propagate AbortSignal — worker shutdown waits up to 16s for in-flight delay [shared/mirakl/api-client.js:32-34] — deferred, MVP shutdown handling is outside Story 3.1 scope
- [x] [Review][Defer] Test "transport errors are retried (5xx schedule)" only asserts final error, not retry count [tests/shared/mirakl/api-client.test.js:169-176] — deferred, retry-count assertion would require fake timers or deeper mocking
- [x] [Review][Defer] Source-file string-sniff test (`for dep of forbidden`) is brittle to comments mentioning forbidden libs [tests/shared/mirakl/api-client.test.js:97-104] — deferred, current source has no such comments; useful guardrail despite fragility

---

## File List

- `shared/mirakl/api-client.js` (new)
- `shared/mirakl/safe-error.js` (new)
- `eslint-rules/no-direct-fetch.js` (modified)
- `eslint.config.js` (modified)
- `tests/shared/mirakl/api-client.test.js` (modified — ESLint v9 compat fix only)

---

## Change Log

- 2026-05-06: Story 3.1 implemented — created `shared/mirakl/api-client.js` (mirAklGet + MiraklApiError SSoT), `shared/mirakl/safe-error.js` (PT error strings), replaced `eslint-rules/no-direct-fetch.js` placeholder with real AST rule, updated `eslint.config.js` to load rule, updated tests for ESLint v9 flat-config API. All 21 tests pass.

---

## Dev Agent Record

### Completion Notes

**Date:** 2026-05-06

Implementation complete. All 21 unit tests pass (0 failures, 0 regressions).

**Files created:**
- `shared/mirakl/api-client.js` — `mirAklGet` + `MiraklApiError` SSoT, named exports, full JSDoc, no third-party HTTP libs, re-exports `getSafeErrorMessage`
- `shared/mirakl/safe-error.js` — `getSafeErrorMessage` with exact spec-mandated PT strings

**Files modified:**
- `eslint-rules/no-direct-fetch.js` — replaced placeholder stub with real ESLint v9+ flat-config rule; `isAllowed()` normalises paths to forward slashes and handles both absolute and relative path forms
- `eslint.config.js` — imported `noDirectFetch`, wrapped in plugin shape `{ rules: { 'no-direct-fetch': noDirectFetch } }`, added block scoped to `app/**`, `worker/**`, `shared/**`
- `tests/shared/mirakl/api-client.test.js` — minimal compatibility fix: updated 4 ESLint tests from deprecated `linter.defineRule()` API (removed in ESLint v9) to flat-config plugin registration; test assertions and intent unchanged

**Key decisions:**
- `catch {}` (no binding) used in transport-error path to avoid `no-unused-vars` lint error on catch parameter — cleanest approach for an unused binding
- ESLint plugin registration in config uses the plugin shape `{ rules: {...} }` while the rule file exports the rule object directly; the `eslint.config.js` wraps it at registration time
- `isAllowed()` normalises backslashes → forward slashes before the `includes()` check so Windows absolute paths and relative paths both work correctly

**Pattern compliance verified:**
- No `export default` in new source files
- No `console.log`/`console.error`
- No `.then()` chains
- No third-party HTTP deps
- apiKey never in error messages (test 10 confirms)
- JSDoc on all exported symbols
- ESLint passes with 0 errors on new files

Analysis complete — comprehensive developer guide created covering:
- DPI source to port + exact delta requirements
- Exact PT strings for `getSafeErrorMessage` (spec-mandated, not approximated)
- `MiraklApiError` field contract (`.status`, `.code`, `.safeMessagePt`)
- `no-direct-fetch` ESLint rule implementation pattern
- `eslint.config.js` integration instructions
- Pre-existing test scaffold (`api-client.test.js`) — implement to pass, don't rewrite
- All 10 critical constraints with rationale
- Pattern compliance checklist
