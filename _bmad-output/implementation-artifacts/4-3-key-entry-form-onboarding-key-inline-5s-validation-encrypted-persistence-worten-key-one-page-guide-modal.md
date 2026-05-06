# Story 4.3: Key Entry Form `/onboarding/key` + Inline 5s Validation + Encrypted Persistence + Worten-Key One-Page Guide Modal

> **Endpoints verified against Mirakl MCP and architecture-distillate empirical facts (2026-05-06).**
> P11 (`GET /api/products/offers`) used via `scripts/mirakl-empirical-verify.js` `inlineOnly` mode. Field names, param format (`product_references=EAN|xxx`), auth header (`Authorization: <api_key>` — no Bearer prefix), and filter chain (`active=true AND total_price > 0 AND shop_name != ownShopName`) all confirmed per architecture-distillate Cross-Cutting Empirically-Verified Mirakl Facts rows 1–3, 8, 9, 10. No direct P11 call in this story — delegated entirely to the existing SSoT (`p11.js` + `mirakl-empirical-verify.js`).

**Sprint-status key:** `4-3-key-entry-form-onboarding-key-inline-5s-validation-encrypted-persistence-worten-key-one-page-guide-modal`
**Status:** ready-for-dev
**Size:** L
**Epic:** Epic 4 — Customer Onboarding (architecture S-I phase 4)
**Atomicity:** Bundle B (creates PROVISIONING rows; merge blocked until Story 4.4 lands — `merge_blocks` in sprint-status.yaml)
**Depends on:** Stories 1.2 (envelope.js), 1.4 (auth + profile), 3.1 (api-client.js + safe-error.js), 3.3 (mirakl-empirical-verify.js inlineOnly mode), 4.1 (customer_marketplaces schema + shop_api_key_vault — all `done`)
**Enables:** Story 4.4 (scan orchestration picks up scan_jobs row created here)

> **Merge block:** Sprint-status.yaml `merge_blocks` entry blocks this story's PR from merging to main until Story 4.4 (`4-4-async-catalog-scan-orchestration-*`) reaches `done`. Reason: this story creates `customer_marketplaces` rows in PROVISIONING; without Story 4.4 in main those rows have no path forward (CHECK constraint blocks transition until A01/PC01 populate).

---

## Narrative

**As a** signed-up, email-verified customer with no existing validated marketplace connection,
**I want** a single-purpose API key entry form at `/onboarding/key` that validates my Worten Mirakl API key inline within 5 seconds (using a real P11 call), then encrypts and persists it — with a "Como gerar a chave?" guide modal walkthrough for finding the key in Worten Seller Center —
**So that** the system has a trusted, encrypted-at-rest key it can use for catalog scanning, and I understand both how to find the key and why it is safe to enter.

---

## Trace

- **Architecture decisions:** AD3 (AES-256-GCM envelope encryption — module from Story 1.2), AD16 (step 1 of onboarding sequence — F4 PROVISIONING row creation), AD5 (Mirakl HTTP client for P11 validation)
- **UX-DRs:** UX-DR23 (primary trust block at /onboarding/key), UX-DR2 (forward-only state machine)
- **FRs:** FR8 (key entry form), FR9 (inline 5s validation), FR10 (Worten key guide modal), FR11 (encrypted-at-rest, no founder cleartext, no logs)
- **NFRs:** NFR-P6 (5s validation), NFR-S1 (KMS envelope encryption), NFR-A2 (keyboard accessibility)
- **Amendments:** F4 (PROVISIONING + nullable A01/PC01 + CHECK constraint — row born here)
- **Pattern A/B/C:** Pattern A — visual references at `_bmad-output/design-references/screens/11-onboarding-key.html` + `screens/16-onboarding-key-help.html`
- **UX skeleton:** §3.2 (key entry form states table), §5.1 (trust block primary copy + visual treatment)
- **Epic section:** `_bmad-output/planning-artifacts/epics-distillate/02-epic-4-onboarding.md`, Story 4.3

---

## Acceptance Criteria

### AC#1 — GET /onboarding/key renders the single-purpose key form

**Given** the route `app/src/routes/onboarding/key.js` and template `app/src/views/pages/onboarding-key.eta`
**When** an authenticated customer (with no existing `customer_marketplace` row OR a row in PROVISIONING with no validated key) lands on `GET /onboarding/key`
**Then**:
- The page renders with a single API key `<input>` (placeholder visible, `type="password"` or `type="text"` with mask toggle — mono font per §10)
- A "Validar chave" submit button, **disabled** until input is non-empty (enforced client-side via `public/js/onboarding-key.js`)
- A "Como gerar a chave?" link that opens the guide modal `app/src/views/modals/key-help.eta`
- The trust block component below the input (`app/src/views/components/trust-block.eta`) per UX-DR23
- UX-DR2 (forward-only): if customer already has a validated key + PROVISIONING row, redirect to `/onboarding/scan`

### AC#2 — Trust block renders verbatim PT copy (UX-DR23 / §5.1)

**Given** the trust block component `app/src/views/components/trust-block.eta`
**When** rendered on `/onboarding/key`
**Then** it contains:
- Lock icon: Material Symbols `lock` filled, color `var(--mp-win)`
- Green-edged box: `var(--mp-win-soft)` background + border `color-mix(in oklch, var(--mp-win) 25%, transparent)`
- **Verbatim PT body copy** from UX skeleton §5.1:
  > *A tua chave fica **encriptada em repouso**. Apenas o motor de repricing a usa para falar com o Worten — nem o nosso fundador a vê em texto puro.*
- A "Ver as nossas garantias →" link (opens a `/security` modal stub per OQ-6 decision: modal at MVP)
- 14px medium-weight body copy, identical styling to free-report trust block variant (§10.1)

### AC#3 — POST /onboarding/key/validate: validation flow + encrypted persistence + PROVISIONING row

**Given** the customer pastes a key and clicks "Validar chave"
**When** the form posts to `POST /onboarding/key/validate`
**Then**:

**Happy path (valid key):**
- The route calls `runVerification({ baseUrl: 'https://marketplace.worten.pt', apiKey: pastedKey, referenceEan: <WORTEN_TEST_EAN>, inlineOnly: true })` from `scripts/mirakl-empirical-verify.js` (programmatic import, not shell exec), with a 5-second `AbortController` timeout wrapping the call
- The spinner renders with label `"A validar a tua chave..."` (from `public/js/onboarding-key.js` setting the button label + CSS spinner class) while the POST is in-flight
- If P11 returns successfully (any non-401/403/transport-error response): the key is encrypted via `shared/crypto/envelope.js` `encryptShopApiKey(pastedKey)` (Story 1.2 SSoT — NEVER re-implement encryption)
- A `shop_api_key_vault` row is **UPSERTED** (INSERT OR UPDATE) with: `customer_marketplace_id`, `ciphertext`, `nonce`, `auth_tag`, `master_key_version = 1`, `last_validated_at = NOW()`
- A `customer_marketplaces` row is created: `customer_id`, `operator = 'WORTEN'`, `marketplace_instance_url = 'https://marketplace.worten.pt'`, `cron_state = 'PROVISIONING'` (DEFAULT), all A01/PC01 columns NULL (CHECK constraint allows — PROVISIONING state)
- `max_discount_pct` is NOT set here — Story 4.8 sets it; the INSERT must omit this NOT NULL column, which means the INSERT requires Story 4.8's value OR the route pre-seeds a sentinel value. **See Dev Notes — max_discount_pct handling.**
- A `scan_jobs` row is created: `customer_marketplace_id`, `status = 'PENDING'`, `phase_message = 'A iniciar análise…'`
- The cleartext key is NEVER assigned to any variable that passes through pino (no req.body logging, no key in error messages)
- Redirect 302 to `/onboarding/scan`

**Invalid key (401/403 from Mirakl):**
- Inline red error below input in `onboarding-key.eta`: PT-localized message via `getSafeErrorMessage(err)` from `shared/mirakl/safe-error.js` (Story 3.1 SSoT)
- No `shop_api_key_vault` row created; no `customer_marketplaces` row created
- No redirect — page re-renders with inline error, input retains focus

**Network/transport error (timeout or unreachable):**
- Inline retry CTA below input: PT-localized message (e.g., *"Não conseguimos contactar o Worten. Verifica a tua ligação e tenta novamente."*) with a "Tentar novamente" button
- No vault row; no marketplace row

### AC#4 — Successful validation sets last_validated_at + no audit event emitted

**Given** a successful `POST /onboarding/key/validate`
**When** the route completes
**Then**:
- `shop_api_key_vault.last_validated_at` is set to `NOW()` — this timestamp is the customer-visible signal of successful validation (used later by `/settings/key` vault status pill in Story 5.2)
- **NO audit event is emitted** — `KEY_VALIDATED` is NOT in the AD20 locked 26-row taxonomy; the route MUST NOT call `writeAuditEvent` for this transition
- Confirm: `audit_log` row count is unchanged before/after the successful validation

### AC#5 — "Como gerar a chave?" guide modal (FR10 / §3.2)

**Given** the customer clicks "Como gerar a chave?"
**When** the modal `app/src/views/modals/key-help.eta` opens (triggered by vanilla JS in `public/js/onboarding-key.js`)
**Then**:
- The modal renders the one-page guide (FR10) with the verified PT walkthrough: Worten Seller Center → Account → API Keys section, 3 steps with accompanying image stubs from `public/images/key-guide/` (3 screenshot assets: `01-seller-center-menu.png`, `02-account-settings.png`, `03-api-key-copy.png`)
- The modal visual reference is `_bmad-output/design-references/screens/16-onboarding-key-help.html` — implement to match
- Modal closes via: Escape key OR click "Fechar" button
- Keyboard navigation works without mouse: Tab moves focus inside modal, Escape closes (NFR-A2)
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to the modal heading
- Focus is trapped inside the modal while open; on close, focus returns to the "Como gerar?" link

### AC#6 — Integration test in tests/integration/key-entry.test.js

**Given** `tests/integration/key-entry.test.js` (scaffold already committed — see Pre-Existing Test Scaffold)
**When** ATDD Step 2 fills in the stubs
**Then** the integration test covers (all test IDs match scaffold):

| Test ID | Scenario |
|---|---|
| `get_onboarding_key_renders_form_for_provisioning_customer` | GET /onboarding/key after signup returns form HTML |
| `trust_block_renders_pt_copy_and_lock_icon` | HTML contains `encriptada em repouso` + lock icon marker |
| `valid_key_creates_vault_row_and_customer_marketplace_in_provisioning` | Vault row exists with encrypted ciphertext ≠ raw key; marketplace row in PROVISIONING |
| `valid_key_redirects_to_onboarding_scan` | POST returns 302 to `/onboarding/scan` |
| `valid_key_sets_last_validated_at_on_vault_row` | `last_validated_at IS NOT NULL` after successful validation |
| `invalid_key_401_returns_inline_pt_error_no_vault_row` | 401 from mock → no redirect, zero vault rows, zero marketplace rows |
| `network_timeout_returns_inline_retry_cta` | Mock delays > 5s → inline retry CTA, no vault row |
| `cleartext_key_never_appears_in_pino_output` | Raw key string never in pino log lines |
| `no_audit_event_emitted_on_key_validated` | `audit_log` count unchanged before/after |
| `guide_modal_renders_pt_walkthrough_content` | GET /onboarding/key contains 3-step guide copy + "Fechar" |
| `integration_test_valid_key_full_flow` | E2E: signup → validate key → vault row + PROVISIONING + redirect |
| `integration_test_invalid_key_no_side_effects` | E2E: signup → 401 → zero side-effects |
| `integration_test_timeout_no_side_effects` | E2E: signup → timeout → zero side-effects |

**Test harness:** Uses Mirakl mock server (`tests/mocks/mirakl-server.js` from Story 3.2) with two endpoints seeded: P11 200 (happy path) and P11 401 (invalid key path). Timeout path: mock configured to delay response beyond 5s AbortController cutoff.

### AC#7 — UX-DR2 forward-only routing guards

**Given** UX-DR2 (strictly forward state machine)
**When** any of these routing scenarios occur:
- Customer with `cron_state = 'PROVISIONING'` AND validated key tries to GET `/onboarding/key` again → redirect to `/onboarding/scan`
- Customer with `cron_state = 'DRY_RUN'` or `'ACTIVE'` tries to GET `/onboarding/key` → redirect to `/`
- Unauthenticated customer tries to GET `/onboarding/key` → redirect to `/login?next=/onboarding/key` (middleware handles)

**Then** the redirect fires before any page render.

### AC#8 — Pedro sign-off (Pattern A sign-off convention)

**Given** Pattern A visual reference is `screens/11-onboarding-key.html` + `screens/16-onboarding-key-help.html`
**When** Story 4.3 is implemented and the PR is ready
**Then** before being considered shippable to the first paying customer, Pedro signs off on the rendered output of `/onboarding/key` + "Como gerar?" modal against the stubs
**And** the sign-off is recorded as: a PR comment with screenshots OR in `_bmad-output/sign-offs/story-4.3.md` (per epics-distillate Note #10 — Pedro picks the convention on first sign-off)
**And** any visual deviations from the stub are either fixed or documented as accepted deviations with rationale.

---

## Dev Notes

### max_discount_pct Handling — CRITICAL

The `customer_marketplaces` table has `max_discount_pct numeric(5,4) NOT NULL` with **no DEFAULT** (per Story 4.1 constraint #8 — intentional, Story 4.8 sets it from the margin form). This creates an ordering problem: Story 4.3 creates the row, Story 4.8 writes the value.

**Resolution:** Story 4.3's `INSERT INTO customer_marketplaces` must supply `max_discount_pct`. Use a sentinel value of `0.0300` (3% — the top band from Story 4.8's mapping) as the insert-time placeholder. Story 4.8's `POST /onboarding/margin` overwrites it with the customer's actual choice. The sentinel is intentionally at the top band so no accidental repricing during the PROVISIONING → DRY_RUN gap causes under-discounting. Inline code comment in the route: `// max_discount_pct: 0.0300 sentinel — overwritten by Story 4.8 /onboarding/margin POST`.

Alternatively: add a nullable default `0.0300` to the migration. **Do NOT change the migration** (migrations are append-only after apply — architecture constraint). The sentinel approach in the INSERT is the correct path.

### shared/crypto/envelope.js — Use Exactly As-Is (Story 1.2 SSoT)

Do NOT re-implement encryption. Import from `shared/crypto/envelope.js`:

```js
import { encryptShopApiKey, decryptShopApiKey } from '../../shared/crypto/envelope.js';
```

The `encryptShopApiKey(plaintextKey)` function returns `{ ciphertext, nonce, auth_tag, master_key_version }` — persist all four columns to `shop_api_key_vault`. The `decryptShopApiKey` is worker-only (Story 4.4 uses it).

### scripts/mirakl-empirical-verify.js — inlineOnly Mode

The `runVerification` function (exported from `scripts/mirakl-empirical-verify.js`) supports `{ inlineOnly: true }` which runs ONLY the P11 call — skipping A01/PC01/OF21. This is exactly the 5s validation path:

```js
import { runVerification } from '../../../scripts/mirakl-empirical-verify.js';

// In the route handler:
const ac = new AbortController();
const timer = setTimeout(() => ac.abort(), 5_000);
try {
  await runVerification({
    baseUrl: 'https://marketplace.worten.pt',
    apiKey: req.body.shop_api_key,
    referenceEan: process.env.WORTEN_TEST_EAN,
    inlineOnly: true,
    // Pass signal to abort on timeout
  });
  clearTimeout(timer);
} catch (err) {
  clearTimeout(timer);
  if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
    // timeout path → inline retry CTA
  } else {
    // use getSafeErrorMessage(err) for 401/4xx
  }
}
```

`WORTEN_TEST_EAN` env var must be set in `.env.local` and `.env.test`. Add it to `.env.example` as `WORTEN_TEST_EAN=` (no value).

### shared/mirakl/safe-error.js — Error Mapping

Import `getSafeErrorMessage` from `shared/mirakl/safe-error.js` (Story 3.1 SSoT) for all Mirakl error messages. Never expose raw `err.message` to the eta template (ESLint rule `no-raw-error-to-template` flags this).

### shop_api_key_vault UPSERT vs INSERT

The form may be submitted on re-entry (rotation flow from `/settings/key` — AC#1 allows re-entry when row exists in PROVISIONING with no validated key). Use UPSERT:

```sql
INSERT INTO shop_api_key_vault (customer_marketplace_id, ciphertext, nonce, auth_tag, master_key_version, last_validated_at)
VALUES ($1, $2, $3, $4, 1, NOW())
ON CONFLICT (customer_marketplace_id)
DO UPDATE SET ciphertext = EXCLUDED.ciphertext, nonce = EXCLUDED.nonce, auth_tag = EXCLUDED.auth_tag,
              last_validated_at = NOW(), updated_at = NOW();
```

### scan_jobs Row Creation

Create the `scan_jobs` row AFTER the vault INSERT succeeds (and AFTER customer_marketplaces insert succeeds). Status defaults to `'PENDING'`. Story 4.4 worker picks it up. The EXCLUDE constraint on `scan_jobs` (`status NOT IN ('COMPLETE', 'FAILED')`) enforces only one active scan per marketplace — if a prior scan is in PENDING/RUNNING, Story 4.3's attempt will throw a unique constraint violation. Handle this: if the EXCLUDE fires, the scan is already in-flight; do NOT create a new row, still redirect to `/onboarding/scan`.

### RLS and DB Client

Use the RLS-aware client (`shared/db/rls-aware-client.js`) for the route — the customer's JWT scopes all writes to their own rows. The vault and marketplace INSERT must happen under the authenticated customer's RLS context. Do NOT use the service-role client in app routes.

### No Audit Event for KEY_VALIDATED

The AD20 locked taxonomy (26 rows in `audit_log_event_types`) does NOT include `KEY_VALIDATED`. Do NOT call `writeAuditEvent`. Do NOT add a new event_type. The `last_validated_at` timestamp on `shop_api_key_vault` is the sole signal.

### Cleartext Key Redaction

- Fastify `req.body` must NOT be logged by pino (use `request.log.info(omit(req.body, ['shop_api_key']), 'key-validate-start')` or no body logging at all for this route)
- Never assign the cleartext key to a variable named in pino redact paths — but best practice: pass it directly to `encryptShopApiKey()` without intermediary storage beyond the minimal flow
- The `shared/mirakl/api-client.js` already redacts the `Authorization` header per Story 1.3's redaction list — no extra work needed there

### Eta Template Patterns

- Templates: `app/src/views/pages/onboarding-key.eta`, `app/src/views/modals/key-help.eta`, `app/src/views/components/trust-block.eta`
- Error injection: pass `{ error: getSafeErrorMessage(err) }` to the template; render as `<p class="inline-error" aria-live="polite"><%= it.error %></p>` — the `no-raw-error-to-template` ESLint rule forbids direct `err.message` pass-through
- Page script: `<script src="/js/onboarding-key.js" defer></script>` near `</body>` per F9 pattern (no bundler, `defer` attribute required)

### Image Assets for Key Guide Modal

Create placeholder images (empty or minimal placeholder files) at:
- `public/images/key-guide/01-seller-center-menu.png`
- `public/images/key-guide/02-account-settings.png`
- `public/images/key-guide/03-api-key-copy.png`

These are screenshot stubs — Pedro will provide actual Worten Seller Center screenshots before first customer Go-Live (or they can remain as labeled placeholders at code-review time, documented as "pre-customer asset replacement").

---

## File-Touch List

### New files (create)

| File | Purpose |
|---|---|
| `app/src/routes/onboarding/key.js` | GET form + POST validate handler (FR8, FR9, FR10, FR11) |
| `app/src/views/pages/onboarding-key.eta` | Key entry page template (all state variants per §3.2 table) |
| `app/src/views/modals/key-help.eta` | "Como gerar a chave?" one-page guide modal (FR10) |
| `app/src/views/components/trust-block.eta` | Reusable trust block component (UX-DR23, §5.1) |
| `public/js/onboarding-key.js` | Button enable/disable + spinner + modal open/close + Escape key handler |
| `public/images/key-guide/01-seller-center-menu.png` | Screenshot stub (placeholder) |
| `public/images/key-guide/02-account-settings.png` | Screenshot stub (placeholder) |
| `public/images/key-guide/03-api-key-copy.png` | Screenshot stub (placeholder) |

### Modified files

| File | Change |
|---|---|
| `.env.example` | Add `WORTEN_TEST_EAN=` (no value — documents required env var) |
| `app/src/server.js` | Register `app/src/routes/onboarding/key.js` route plugin |

### Pre-existing (DO NOT recreate or restructure)

| File | Status | Note |
|---|---|---|
| `tests/integration/key-entry.test.js` | ALREADY EXISTS — 13 stubs (AC#6) | ATDD Step 2 fills in stubs; never modify scaffold structure |
| `shared/crypto/envelope.js` | ALREADY EXISTS — Story 1.2 | Import only; never re-implement |
| `shared/mirakl/safe-error.js` | ALREADY EXISTS — Story 3.1 | Import `getSafeErrorMessage` |
| `shared/mirakl/p11.js` | ALREADY EXISTS — Story 3.2 | Used internally by `mirakl-empirical-verify.js` |
| `scripts/mirakl-empirical-verify.js` | ALREADY EXISTS — Story 3.3 | Import `runVerification` with `inlineOnly: true` |
| `shared/db/rls-aware-client.js` | ALREADY EXISTS — Story 2.1 | App routes DB client |
| `shared/db/tx.js` | ALREADY EXISTS — Story 2.1 | Transaction helper |
| `shared/audit/writer.js` | ALREADY EXISTS — Story 9.0 | DO NOT call for this story |
| `app/src/middleware/auth.js` | ALREADY EXISTS — Story 1.5 | Handles auth guard + redirect to /login |
| `app/src/middleware/rls-context.js` | ALREADY EXISTS — Story 2.1 | Binds JWT to RLS-aware client |
| `supabase/migrations/202604301204_create_shop_api_key_vault.sql` | ALREADY EXISTS — activated in Story 4.1 | Schema is live; route writes to this table |

---

## Database Operations (Verbatim Reference)

Story 4.3 writes to three tables in the happy path. All under the authenticated customer's RLS context:

```sql
-- 1. Create customer_marketplaces row (if not exists)
INSERT INTO customer_marketplaces
  (customer_id, operator, marketplace_instance_url, cron_state, max_discount_pct, max_increase_pct)
VALUES
  ($customer_id, 'WORTEN', 'https://marketplace.worten.pt', 'PROVISIONING', 0.0300, 0.0500)
RETURNING id;
-- Note: 0.0300 is sentinel for max_discount_pct; overwritten by Story 4.8.
-- Note: all A01/PC01 columns NULL → satisfies F4 CHECK constraint (PROVISIONING allowed).

-- 2. Upsert vault row with encrypted key
INSERT INTO shop_api_key_vault
  (customer_marketplace_id, ciphertext, nonce, auth_tag, master_key_version, last_validated_at)
VALUES
  ($cm_id, $ciphertext, $nonce, $auth_tag, 1, NOW())
ON CONFLICT (customer_marketplace_id)
DO UPDATE SET
  ciphertext = EXCLUDED.ciphertext,
  nonce = EXCLUDED.nonce,
  auth_tag = EXCLUDED.auth_tag,
  last_validated_at = NOW(),
  updated_at = NOW();

-- 3. Create scan_jobs row (if no active scan exists)
INSERT INTO scan_jobs (customer_marketplace_id)
VALUES ($cm_id)
-- ON CONFLICT: EXCLUDE constraint fires if active scan exists — catch and skip insert
```

### shop_api_key_vault Schema (for reference)

```sql
shop_api_key_vault (
  customer_marketplace_id uuid PRIMARY KEY,  -- FK → customer_marketplaces.id ON DELETE CASCADE
  ciphertext              bytea NOT NULL,
  nonce                   bytea NOT NULL,    -- 12 bytes for AES-256-GCM
  auth_tag                bytea NOT NULL,    -- 16 bytes
  master_key_version      integer NOT NULL DEFAULT 1,
  last_validated_at       timestamptz,
  last_failure_status     smallint,
  created_at              timestamptz NOT NULL DEFAULT NOW(),
  updated_at              timestamptz NOT NULL DEFAULT NOW()
)
```

RLS on `shop_api_key_vault`: customer can read existence (SELECT) but NOT decrypt values — values read/decrypt via service-role in worker context only. Story 4.3's route writes under RLS-aware client (customer's JWT scopes the INSERT).

---

## Critical Constraints (Do Not Violate)

1. **No re-implementation of encryption** — `shared/crypto/envelope.js` is the SSoT (AD3). Import `encryptShopApiKey` only.

2. **No direct `fetch()` call** — all Mirakl HTTP calls go through `shared/mirakl/api-client.js` (`mirAklGet`). The P11 validation reuses `scripts/mirakl-empirical-verify.js` which uses `api-client.js` internally. ESLint rule `no-direct-fetch` will flag any violation.

3. **No `export default`** in any new file. Named exports only: `export async function handler(...)`.

4. **No `.then()` chains** — async/await only.

5. **No `console.log`** — pino only per AD27. Route uses `req.log` (Fastify built-in pino logger).

6. **No `err.message` / `err.response` / `err.body` in eta render paths** — ESLint rule `no-raw-error-to-template` enforces. Always use `getSafeErrorMessage(err)` from `shared/mirakl/safe-error.js`.

7. **No audit event for KEY_VALIDATED** — `writeAuditEvent` MUST NOT be called in this route. The event_type does not exist in the locked AD20 taxonomy.

8. **No bundler / no ES module type="module" for simple JS** — `public/js/onboarding-key.js` is a plain script with `defer`. No `import` statements unless the browser target explicitly supports ES modules and the script is declared `type="module"` per F9 pattern. For simple enable/disable + modal open/close, vanilla DOM is sufficient — no imports needed.

9. **Cleartext key NEVER logged** — not in req.body, not in error messages, not in pino output. Test `cleartext_key_never_appears_in_pino_output` validates this at ATDD Step 2.

10. **WORTEN_TEST_EAN env var** — must exist in `.env.test` for integration tests. Route reads `process.env.WORTEN_TEST_EAN` at runtime. Missing env var → route returns 500 with PT-localized message "Configuração de validação em falta — contacta o suporte."

11. **No SPA / no framework JS** — `public/js/onboarding-key.js` is vanilla DOM. No React, no Alpine, no Stimulus (architecture constraint #3).

12. **max_discount_pct sentinel** — INSERT with `0.0300` as described in Dev Notes. No DEFAULT added to migration (migrations are immutable after apply).

13. **RLS-aware client in app routes** — use `shared/db/rls-aware-client.js` factory. Never service-role client in app routes.

---

## Architectural Pattern Reference

### Route Handler Shape (follow existing patterns from Story 3.1 / 4.1)

```js
// app/src/routes/onboarding/key.js
export default async function keyRoutes (fastify, _opts) {
  // GET /onboarding/key
  fastify.get('/onboarding/key', { onRequest: [fastify.authenticate] }, async (req, reply) => {
    // 1. Check customer_marketplace cron_state; redirect if already past PROVISIONING
    // 2. Render onboarding-key.eta
  });

  // POST /onboarding/key/validate
  fastify.post('/onboarding/key/validate', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['shop_api_key'],
        properties: {
          shop_api_key: { type: 'string', minLength: 1, maxLength: 512 },
        },
      },
    },
  }, async (req, reply) => {
    // 1. 5s validation via runVerification (inlineOnly)
    // 2. encryptShopApiKey()
    // 3. INSERT customer_marketplaces
    // 4. UPSERT shop_api_key_vault
    // 5. INSERT scan_jobs
    // 6. Redirect to /onboarding/scan
  });
}
```

Fastify JSON Schema validation (`schema.body`) handles input validation (AD28 — Fastify built-in only, no zod/joi). Min/max length on `shop_api_key` prevents trivially short or excessively long inputs.

### Eta Template Inline Error Pattern

```eta
<% if (it.error) { %>
  <p class="inline-error" role="alert" aria-live="polite"><%= it.error %></p>
<% } %>
<% if (it.retryError) { %>
  <p class="inline-retry" role="alert" aria-live="polite"><%= it.retryError %></p>
  <button type="button" class="btn-secondary" onclick="this.closest('form').requestSubmit()">
    Tentar novamente
  </button>
<% } %>
```

### Modal JS Pattern (vanilla DOM, no framework)

```js
// public/js/onboarding-key.js
const input = document.querySelector('#shop_api_key');
const btn = document.querySelector('#validate-btn');
const modal = document.querySelector('#key-help-modal');
const modalClose = document.querySelector('#key-help-modal-close');
const modalTrigger = document.querySelector('#open-key-help');

// Enable/disable validate button
input.addEventListener('input', () => {
  btn.disabled = input.value.trim().length === 0;
});

// Open modal
modalTrigger.addEventListener('click', (e) => {
  e.preventDefault();
  modal.setAttribute('aria-hidden', 'false');
  modal.classList.add('modal--open');
  modalClose.focus();
});

// Close modal (button)
modalClose.addEventListener('click', () => {
  modal.setAttribute('aria-hidden', 'true');
  modal.classList.remove('modal--open');
  modalTrigger.focus(); // return focus to trigger
});

// Close modal (Escape key)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modal.classList.contains('modal--open')) {
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('modal--open');
    modalTrigger.focus();
  }
});
```

---

## Previous Story Learnings (patterns to preserve)

**From Story 4.1 (cron-state.js SSoT + migrations):**
- Comments must not contain strings the ESLint negative-assertion tests grep for — avoid `UPDATE customer_marketplaces SET cron_state` in comments outside the SSoT file.
- ESLint rules scope to `app/**, worker/**, shared/**` — `scripts/` is typically excluded.
- Named exports only (`export async function`, `export const`) — no `export default` in source modules. Route files use `export default` **only** as a Fastify plugin (the framework convention for `fastify.register()`).

**From Story 3.1 (Mirakl client + safe-error + ESLint):**
- `getSafeErrorMessage(err)` from `shared/mirakl/safe-error.js` is the only path to PT-localized error strings for Mirakl errors. Do not hand-craft error messages.
- `no-direct-fetch` ESLint rule: any `fetch(` call outside `shared/mirakl/api-client.js` is flagged. `mirakl-empirical-verify.js` uses `api-client.js` internally — import `runVerification`, not `p11.js` directly.

**From Story 3.3 (mirakl-empirical-verify.js):**
- The `inlineOnly: true` mode runs ONLY the P11 call. This is the exact inline validation path for Story 4.3 — confirmed by the exported `runVerification` function's `inlineOnly` branch in the source.
- `WORTEN_TEST_EAN` must be set in `.env.test` for integration tests to pass. The scaffold in `tests/integration/key-entry.test.js` assumes this is configured.

**From Story 1.2 (envelope encryption):**
- `encryptShopApiKey` returns `{ ciphertext: Buffer, nonce: Buffer, auth_tag: Buffer, master_key_version: number }`. All four go to `shop_api_key_vault`. Buffers are stored as Postgres `bytea` — pg driver handles Buffer → bytea encoding natively.
- Decryption (`decryptShopApiKey`) is worker-only. App routes never decrypt — they only encrypt on entry.

**From Story 2.1 (RLS-aware client):**
- The RLS-aware client is request-scoped (session JWT bound per-request in middleware). Use `req.dbClient` (or whatever the fastify decorator name is from Story 2.1's implementation) for all DB calls in the route handler.

---

## Integration Test Gate

This story is tagged `integration_test_required: true` in `sprint-status.yaml` (implicit — touches Mirakl API + encrypted vault + Supabase Auth session + pg writes). The Phase 4.5 gate will halt after BAD's batch completes and require Pedro to run `npm run test:integration` locally.

The integration test file at `tests/integration/key-entry.test.js` has 13 pre-committed stubs. ATDD Step 2 fills them in. All 13 must pass before the story moves to review.

Key mock requirements for integration tests:
- Mirakl mock server (`tests/mocks/mirakl-server.js`) must handle:
  - `GET /api/products/offers?product_references=EAN|<WORTEN_TEST_EAN>&...` → 200 with minimal P11 fixture payload (happy path)
  - Same endpoint with a specific "invalid key" header → 401 response (unhappy path)
  - Same endpoint with a "slow key" header → delayed response > 5s (timeout path)
- Mock server was built in Story 3.2; check if it already supports these scenarios before extending.

---

## Visual Design Reference

- `/onboarding/key` form: `_bmad-output/design-references/screens/11-onboarding-key.html`
- "Como gerar?" modal: `_bmad-output/design-references/screens/16-onboarding-key-help.html` (includes verified PT walkthrough copy + redacted screenshot positions)
- Trust block visual treatment: identical to `MarketPilot.html` prominent trust variant (§10.1) — green-edged box, lock icon, body+link

Pattern A contract: implemented to match the stub within Pedro's sign-off tolerance. Any deviation documented as accepted deviation in sign-off record.

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
