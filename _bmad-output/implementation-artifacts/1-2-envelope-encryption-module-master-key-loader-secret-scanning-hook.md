# Story 1.2: Envelope encryption module, master-key loader, secret-scanning hook

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As Pedro (founder),
I want the envelope-encryption primitives, master-key loader, encrypted-vault table (with RLS), and secret-scanning pre-commit hook in place,
so that customer Mirakl shop API keys can be persisted encrypted-at-rest from day 1 — with the master key never on disk, never in logs, never in a git commit — fulfilling the trust commitment we are selling (NFR-S1, FR11, AD3, CLAUDE.md trust-critical mandate).

## Acceptance Criteria

1. **Given** the master-key loader module **When** the worker (or any process consuming `shared/crypto/master-key-loader.js`) starts with `MASTER_KEY_BASE64` set to a valid 32-byte base64 value (44 chars including padding) **Then** `loadMasterKey()` returns a 32-byte `Buffer` held in process memory only **And** the function reads `process.env.MASTER_KEY_BASE64` only — never from a file, network, or any other source **And** if the env var is missing, empty, malformed base64, or decodes to anything other than exactly 32 bytes, the function throws a `MasterKeyLoadError` with `code: 'MASTER_KEY_INVALID'` and a message that does NOT include the env-var value **And** the worker entry point (`worker/src/index.js`) calls `loadMasterKey()` once at boot and exits with `process.exit(1)` (no partial-state startup) on throw **And** the loader writes nothing to logs about the key value (only success/failure metadata: byte length, version assumption).

2. **Given** `shared/crypto/envelope.js` **When** I call `encryptShopApiKey(plaintext, masterKey)` with `plaintext` as a non-empty string and `masterKey` as the 32-byte Buffer from `loadMasterKey()` **Then** I get back `{ ciphertext: Buffer, nonce: Buffer (12 bytes), authTag: Buffer (16 bytes), masterKeyVersion: 1 }` using AES-256-GCM with a fresh CSPRNG nonce per call (`crypto.randomBytes(12)`) **And** `decryptShopApiKey({ ciphertext, nonce, authTag, masterKey })` returns the original UTF-8 plaintext string **And** decryption with a tampered `ciphertext`, `nonce`, or `authTag` throws `KeyVaultDecryptError` with `code: 'KEY_VAULT_DECRYPT_FAILED'` (auth-tag verification failure surfaces as that error class — not the raw OpenSSL message) **And** decryption with a wrong `masterKey` (any 32-byte Buffer ≠ encryption key) throws `KeyVaultDecryptError` **And** unit tests in `tests/shared/crypto/envelope.test.js` cover: round-trip happy path, tampered-ciphertext rejection, tampered-nonce rejection, tampered-auth-tag rejection, wrong-master-key rejection, two consecutive `encryptShopApiKey` calls on identical plaintext produce different `nonce`+`ciphertext` (CSPRNG nonce reuse check) **And** plaintext, masterKey, and ciphertext NEVER appear in `MasterKeyLoadError` / `KeyVaultDecryptError` `.message`, `.stack`, or any logged structured field.

3. **Given** the `shop_api_key_vault` migration **When** I apply `supabase/migrations/202604301204_create_shop_api_key_vault.sql` to a fresh Postgres **Then** the table exists with the exact schema in [Database Schema — shop_api_key_vault Migration](#database-schema--shop_api_key_vault-migration) below (`customer_marketplace_id uuid PK FK ON DELETE CASCADE`, `ciphertext bytea NOT NULL`, `nonce bytea NOT NULL`, `auth_tag bytea NOT NULL`, `master_key_version integer NOT NULL DEFAULT 1`, `last_validated_at timestamptz`, `last_failure_status smallint`, `created_at`, `updated_at`) **And** RLS is enabled on the table **And** RLS policy `shop_api_key_vault_select_own` is present in the SAME migration file (per "every customer-scoped table migration includes its RLS policy in the same file" convention) **And** the policy restricts SELECT to rows whose `customer_marketplace_id IN (SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid())` **And** there is NO INSERT/UPDATE/DELETE policy for customer-scoped clients (writes are service-role-only, bypass RLS) **And** the migration includes an inline comment naming `shop_api_key_vault` as a table that Story 2.2's `scripts/rls-regression-suite.js` MUST cover when it lands.

4. **Given** the secret-scanning hook is installed via `git config core.hooksPath .githooks` (one-time setup; documented in README and `scripts/install-git-hooks.sh`) **When** I attempt `git commit` with a staged file whose ADDED diff lines contain any of the locked patterns **Then** `.githooks/pre-commit` invokes `bash scripts/check-no-secrets.sh` against `git diff --cached --no-color`, `scripts/check-no-secrets.sh` exits non-zero, and the commit is blocked with PT-or-EN output naming the matched pattern + offending file:line **And** the four AD3-locked patterns are matched in this exact form (POSIX ERE; `grep -E`):
    - `MASTER_KEY[A-Z_]*[ \t]*[=:][ \t]*['\"]?[A-Za-z0-9+/=_-]{16,}` — catches `MASTER_KEY=...`, `MASTER_KEY_BASE64=<base64>`, `MASTER_KEY_NEXT: '<value>'`, etc.
    - `(shop_api_key|SHOP_API_KEY)[ \t]*[=:][ \t]*['\"]?[A-Za-z0-9+/=_-]{8,}` — case-sensitive on `shop_api_key`; catches the actual customer Mirakl key in any KV form
    - `sk_live_[A-Za-z0-9]{16,}` — Stripe live secret
    - `sk_test_[A-Za-z0-9]{16,}` — Stripe test secret
   **And** the heuristic pattern `Authorization:[ \t]*Bearer[ \t]+[A-Za-z0-9._-]{16,}` is matched additionally (catches accidentally-pasted bearer tokens; non-Worten since Worten Mirakl auth is raw `Authorization: <key>` per project-context.md fact #10) **And** the script scans staged diff lines (`git diff --cached --no-color -U0`) — NOT whole files — so plain mentions of the env-var NAME in source (e.g., `'MASTER_KEY_BASE64'` as a string literal in `shared/config/runtime-env.js` REQUIRED_VARS) do not match unless followed by an `=`-or-`:` assignment with a substantial value **And** running the hook twice on the same staged set produces the same outcome (idempotent — the script is read-only, no state mutated) **And** running the hook on a clean staged set (no matches) exits 0 silently **And** unit tests in `tests/scripts/check-no-secrets.test.js` use `node:test` to spawn `bash scripts/check-no-secrets.sh` with synthetic stdin and assert each pattern blocks (exit 1 + matched-pattern output to stderr/stdout) and clean input passes (exit 0).

5. **Given** the rotation runbook **When** I open `scripts/rotate-master-key.md` **Then** it documents the 5-step rotation procedure verbatim from architecture AD3 (1. generate new key with `openssl rand -base64 32`; 2. Coolify deploys new master as `MASTER_KEY_BASE64_NEXT` alongside existing `MASTER_KEY_BASE64`; 3. worker re-encrypts every `shop_api_key_vault` row with per-row Postgres advisory lock keyed on `customer_marketplace_id`; 4. Coolify env-var swap — rename `MASTER_KEY_BASE64_NEXT` → `MASTER_KEY_BASE64`, delete old; 5. 1Password backup updated) **And** the runbook is markdown only, NOT executable code **And** the runbook explicitly states the rotation is "annual ceremony or on-incident if compromise suspected" and is executed by Pedro (founder operational track per `epics-distillate/_index.md` Founder Operational Track entry "Master-key rotation ceremony") **And** the runbook documents which `shop_api_key_vault.master_key_version` value the worker stamps after re-encryption (increments from 1 → 2 → 3 etc.) **And** the runbook references the Story 1.2 envelope-encryption helpers by absolute import path (`shared/crypto/envelope.js`) so future executors know which functions to call from a one-off rotation script.

## Tasks / Subtasks

- [x] **Task 1: Create `shared/crypto/master-key-loader.js`** (AC: #1)
  - [x] Implement `loadMasterKey()` per the verbatim snippet in [Master-Key Loader Implementation Notes](#master-key-loader-implementation-notes)
  - [x] Add `MasterKeyLoadError extends Error` with `code = 'MASTER_KEY_INVALID'`
  - [x] JSDoc `@returns {Buffer}` (32-byte master key) + `@throws {MasterKeyLoadError}`
  - [x] Wire into `worker/src/index.js`: call `loadMasterKey()` once at boot, store the returned Buffer in module-scope `let masterKey` (NOT exported — accessed only via passing as parameter); on throw log `error` level (no key value) and `process.exit(1)`
  - [x] Do NOT call `loadMasterKey()` in `app/src/server.js` at MVP — app-server has no decrypt path yet (Story 4.3 onboarding key-entry validation routes to the worker side; until then, app process never holds master key in memory)

- [x] **Task 2: Create `shared/crypto/envelope.js`** (AC: #2)
  - [x] Implement `encryptShopApiKey(plaintext, masterKey)` per the verbatim snippet in [Envelope Encryption Implementation Notes](#envelope-encryption-implementation-notes)
  - [x] Implement `decryptShopApiKey({ ciphertext, nonce, authTag, masterKey })` per the verbatim snippet
  - [x] Add `KeyVaultDecryptError extends Error` with `code = 'KEY_VAULT_DECRYPT_FAILED'`
  - [x] JSDoc both exported functions with `@param`, `@returns`, `@throws`, `@typedef EncryptedKey { ciphertext: Buffer, nonce: Buffer, authTag: Buffer, masterKeyVersion: number }`
  - [x] Use Node's built-in `node:crypto` (`createCipheriv`, `createDecipheriv`, `randomBytes`); NO third-party crypto library
  - [x] Hardcode `masterKeyVersion: 1` at MVP (single-key era; rotation ceremony increments); the column is wired but only Pedro's runbook bumps it

- [x] **Task 3: Write envelope-encryption unit tests** (AC: #2)
  - [x] Create `tests/shared/crypto/envelope.test.js` using `node:test` + `node:assert/strict`
  - [x] Test cases (each `test('...', () => {})`):
    - [x] `round-trip happy path`: encrypt then decrypt returns identical plaintext (byte-equal)
    - [x] `tampered ciphertext rejected`: flip one byte of ciphertext, decrypt throws `KeyVaultDecryptError`
    - [x] `tampered nonce rejected`: flip one byte of nonce, decrypt throws `KeyVaultDecryptError`
    - [x] `tampered auth tag rejected`: flip one byte of authTag, decrypt throws `KeyVaultDecryptError`
    - [x] `wrong master key rejected`: encrypt with key A, decrypt with random key B (also 32 bytes), throws `KeyVaultDecryptError`
    - [x] `nonce uniqueness`: encrypt the same plaintext twice with the same masterKey; assert `result1.nonce` ≠ `result2.nonce` AND `result1.ciphertext` ≠ `result2.ciphertext` (CSPRNG nonce, no static IV)
    - [x] `error opacity`: catch `KeyVaultDecryptError` and assert `.message`, `.stack`, `JSON.stringify(err)` do NOT contain the plaintext, ciphertext hex, masterKey hex, or any base64 form thereof
  - [x] Generate test master key inline via `crypto.randomBytes(32)` — never commit a real master key

- [x] **Task 4: Create `supabase/migrations/202604301204_create_shop_api_key_vault.sql`** (AC: #3)
  - [x] Use the verbatim DDL in [Database Schema — shop_api_key_vault Migration](#database-schema--shop_api_key_vault-migration) below
  - [x] Include `CREATE POLICY shop_api_key_vault_select_own` in the same file (atomic deploy convention)
  - [x] Create the file directly at `supabase/migrations/202604301204_create_shop_api_key_vault.sql` with the verbatim DDL. **Do NOT** use `npx supabase migration new` — that command generates a current-time timestamp, which would diverge from the architecture-planned migration order. Story 1.1 used `202604301212` even though it was created on 2026-05-01; same convention here for `202604301204`.
  - [x] **Defer `npx supabase db push` until Story 4.1 lands `customer_marketplaces`.** Per Option A in Database Schema notes below, the FK target doesn't exist yet — the migration file is committed (deliverable satisfied) but the apply step waits.
  - [x] Migration timestamp 202604301204 is the architecture-planned filename; ordering relative to 1212 (worker_heartbeats) does not matter — Supabase records applied migrations in `supabase_migrations.schema_migrations` and applies new ones idempotently
  - [x] Add inline SQL comment immediately after the policy: `-- TODO Story 2.2: add 'shop_api_key_vault' to scripts/rls-regression-suite.js coverage list`

- [x] **Task 5: Create the secret-scanning script** (AC: #4)
  - [x] Create `scripts/check-no-secrets.sh` per the verbatim snippet in [Secret-Scanning Script Implementation Notes](#secret-scanning-script-implementation-notes)
  - [x] Make it executable on tracked filesystems: `chmod +x scripts/check-no-secrets.sh` and verify mode is preserved (`git update-index --chmod=+x scripts/check-no-secrets.sh` if needed)
  - [x] Verify Git Bash on Windows runs it correctly (Pedro is on Windows; bash is bundled with Git for Windows)
  - [x] Patterns matched per AC#4 (5 total: 4 AD3-locked + 1 Authorization heuristic)

- [x] **Task 6: Create the pre-commit hook + install script** (AC: #4)
  - [x] Create `.githooks/pre-commit` (tracked, version-controlled) — single-line shim that exec-runs the scanner; see [Git Hook Shim](#git-hook-shim) below
  - [x] `chmod +x .githooks/pre-commit`
  - [x] Create `scripts/install-git-hooks.sh` — one-liner: `git config core.hooksPath .githooks && echo "Pre-commit hook installed."`
  - [x] Document the one-time install in README under a new "Developer setup" section: `bash scripts/install-git-hooks.sh`
  - [x] Add a friendly note to README that GitHub-side secret-scanning is also enabled (Pedro toggles in repo Settings → Code security → Secret scanning) — this is the second layer of defense per AD3 distillate

- [x] **Task 7: Write secret-scanning script tests** (AC: #4)
  - [x] Create `tests/scripts/check-no-secrets.test.js` using `node:test` + `node:child_process` (spawn bash)
  - [x] Test cases:
    - [x] `MASTER_KEY env-style assignment blocks`: pipe `+MASTER_KEY_BASE64=YWJjZGVmZ2hpamtsbW5vcA==aGlqaw` (synthetic 16+ char base64) to the script via stdin, assert exit code 1, stdout/stderr contains `MASTER_KEY` and the matched line
    - [x] `MASTER_KEY mention in code passes`: pipe `+const REQUIRED = ['MASTER_KEY_BASE64'];` (string literal usage) to the script, assert exit code 0
    - [x] `shop_api_key assignment blocks`: pipe `+const config = { shop_api_key: 'AbCdEf0123456789' };`, assert exit 1
    - [x] `Stripe live secret blocks`: pipe `+stripe.SECRET = 'sk_live_AbCdEf0123456789ABCDEF';`, assert exit 1
    - [x] `Stripe test secret blocks`: pipe `+stripe.SECRET = 'sk_test_AbCdEf0123456789ABCDEF';`, assert exit 1
    - [x] `Authorization Bearer blocks`: pipe `+headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9...' }`, assert exit 1
    - [x] `clean diff passes`: pipe `+function add (a, b) { return a + b }`, assert exit 0
    - [x] `idempotency`: run the same input twice, assert outputs are byte-identical
  - [x] Tests use `spawn('bash', ['scripts/check-no-secrets.sh'])` with `input` written to child stdin; on Windows, `bash` resolves to Git Bash — if not on PATH, skip with `t.skip` and document in test header

- [x] **Task 8: Create the rotation runbook** (AC: #5)
  - [x] Create `scripts/rotate-master-key.md` (markdown — NOT executable)
  - [x] Use the structure in [Rotation Runbook Outline](#rotation-runbook-outline) below
  - [x] Cite `shared/crypto/envelope.js` and `shared/crypto/master-key-loader.js` by path so a future one-off rotation script knows where the helpers live
  - [x] Cross-reference Founder Operational Track entry "Master-key rotation ceremony" in `epics-distillate/_index.md`

- [x] **Task 9: Pre-flight env check + verify negative assertions and SSoT discipline** (AC: #1–#5)
  - [x] **Pre-flight (PEDRO):** before merging this story, confirm `.env.local`'s `MASTER_KEY_BASE64` decodes to EXACTLY 32 bytes. The Story 1.1 smoke test only checked presence — a wrong-length value worked then but will start failing at boot once Story 1.2 lands the byte-length check. Verify with: `node -e "console.log(Buffer.from(process.env.MASTER_KEY_BASE64,'base64').length)"` (after sourcing `.env.local`); it MUST print `32`. If not, regenerate via `openssl rand -base64 32` and update `.env.local` AND Coolify env var BEFORE deploying.
  - [x] Confirm `shared/crypto/envelope.js` is the ONLY module performing `crypto.createCipheriv` / `createDecipheriv` calls anywhere in the codebase (grep `app/`, `worker/`, `shared/`, `scripts/` — only `shared/crypto/envelope.js` and its test should match)
  - [x] Confirm the master-key Buffer is held only in `worker/src/index.js` module scope and passed as a parameter to encryption helpers — never module-scope inside `shared/crypto/envelope.js`, never on a `customer_marketplace` row, never logged
  - [x] Confirm `MASTER_KEY_BASE64` is NOT logged anywhere; pino redaction list (Story 1.3) will catch leaks at runtime, but Story 1.2 must not introduce any log line referencing the key value (spot-check via `grep -RE "MASTER_KEY|masterKey" app/ worker/ shared/`)
  - [x] Confirm secret-scanning hook is wired (run `git config --get core.hooksPath` post-install — should output `.githooks`)
  - [x] Confirm the existing `shared/config/runtime-env.js` already validates `MASTER_KEY_BASE64` PRESENCE (Story 1.1, `REQUIRED_VARS` array). Story 1.2 does NOT modify `runtime-env.js`; the deeper byte-length validation lives in `master-key-loader.js`. `runtime-env.js` stays a presence-only checker per Story 1.1's separation-of-concerns.
  - [x] Re-run `npm run test:integration` (Story 1.1's scaffold-smoke test) to confirm the new boot-time master-key load does not regress smoke-test passage. The test already passes when `.env.local` has a valid 32-byte key; the regression risk is only when Pedro's current value is wrong-length (handled by the pre-flight above).

- [x] **Task 10: Update `.env.example`** (AC: #1)
  - [x] Update the comment line above `MASTER_KEY_BASE64=` in `.env.example` to read: `# 32-byte master key, base64-encoded. Generate with: openssl rand -base64 32`
  - [x] No value committed (this is a template); Pedro fills `.env.local` separately

## Dev Notes

### CRITICAL Architecture Constraints for This Story

Story 1.2 ships THREE primitives that the entire encryption-at-rest trust chain depends on. Failure modes here are catastrophic (key leak = total customer data compromise). Implementation follows the AD3 lock VERBATIM.

**Hard stops (refuse and flag to Pedro if any subagent proposes these):**

| Constraint | What's forbidden | What to do instead |
|---|---|---|
| AD3 single-key path | Storing master key on disk, in DB, in any persisted form | env var (`MASTER_KEY_BASE64`) only; in-memory Buffer at runtime; 1Password cold backup outside repo |
| AD3 envelope cipher | Any AES mode other than GCM (no CBC, no CTR, no ECB); any non-AES algorithm | AES-256-GCM with 12-byte nonce + 16-byte auth tag; `node:crypto` only |
| AD3 nonce reuse | Static IV / hardcoded nonce / counter-based nonce | `crypto.randomBytes(12)` per encryption — CSPRNG; nonce reuse with same key catastrophic for GCM |
| #18 console.log | Any logging of plaintext, ciphertext, or master key | `pino` only (Story 1.3); `KeyVaultDecryptError`'s `.message` is opaque (no upstream OpenSSL detail) |
| AD3 secret-scan | Skipping the pre-commit hook to land "just this one fix" | Hook is mandatory; if false-positive, refine regex — never bypass with `--no-verify` |
| Trust commitment | App-server holding plaintext key in memory at MVP | App never decrypts; key validation in onboarding (Story 4.3) routes through worker-side helper or via service-role server-side helper invoked from app — but the master key Buffer lives only in worker process |

**Forward dependencies — do NOT pre-create:**
- `shared/db/service-role-client.js` (Story 2.1) — direct `pg.Pool` is fine here, but Story 1.2 does NOT yet need any DB write of vault rows. Vault-write happens at Story 4.3 (key entry form); Story 1.2 ships only the migration + helpers.
- `shared/audit/writer.js` (Story 9.0) — `master-key-loader-fail` audit event is NOT emitted at Story 1.2 time. Worker boot failure logs a pino `error` and `process.exit(1)` — that's it.
- `scripts/rls-regression-suite.js` (Story 2.2) — file does not exist yet; the migration's inline `-- TODO Story 2.2:` comment is the forward-reference; Story 2.2's BAD subagent will add `shop_api_key_vault` to the suite when it lands.
- ESLint custom rules — none ship with Story 1.2 (Bob's note in `architecture-distillate/04-implementation-patterns.md` line 213-214: "no-direct-fetch lands with 1.2 if shared/mirakl/api-client.js ships in 1.2's envelope-encryption work, else lands with Story 3.1 when api-client port lands"). `api-client.js` ships at Story 3.1, NOT Story 1.2 — so no custom ESLint rule lands here.

### Master-Key Loader Implementation Notes

```js
// shared/crypto/master-key-loader.js
import { Buffer } from 'node:buffer';

/**
 * Error thrown when MASTER_KEY_BASE64 is missing, malformed, or wrong byte-length.
 * The error message NEVER includes the env-var value.
 */
export class MasterKeyLoadError extends Error {
  constructor (message) {
    super(message);
    this.name = 'MasterKeyLoadError';
    this.code = 'MASTER_KEY_INVALID';
  }
}

/**
 * Loads the AES-256-GCM master key from process.env.MASTER_KEY_BASE64.
 * Validates that the decoded buffer is exactly 32 bytes (AES-256 keysize).
 * Holds the key in memory only — never persists, never logs.
 *
 * Call exactly once at process boot (e.g., worker/src/index.js).
 * Pass the returned Buffer as a parameter to encryptShopApiKey / decryptShopApiKey.
 *
 * @returns {Buffer} 32-byte master key
 * @throws {MasterKeyLoadError} if env var missing/empty/malformed/wrong length
 */
export function loadMasterKey () {
  const raw = process.env.MASTER_KEY_BASE64;
  if (!raw || raw.trim().length === 0) {
    throw new MasterKeyLoadError('MASTER_KEY_BASE64 is missing or empty');
  }
  // Strict base64 decode; Buffer.from('not-base64', 'base64') silently produces
  // garbage. Use a length round-trip check to detect malformed input.
  let decoded;
  try {
    decoded = Buffer.from(raw, 'base64');
  } catch {
    throw new MasterKeyLoadError('MASTER_KEY_BASE64 is not valid base64');
  }
  // Round-trip: re-encoding should match the trimmed input modulo padding
  const reEncoded = decoded.toString('base64');
  if (reEncoded.replace(/=+$/, '') !== raw.trim().replace(/=+$/, '')) {
    throw new MasterKeyLoadError('MASTER_KEY_BASE64 is not valid base64');
  }
  if (decoded.length !== 32) {
    throw new MasterKeyLoadError(
      `MASTER_KEY_BASE64 must decode to exactly 32 bytes; got ${decoded.length}`
    );
  }
  return decoded;
}
```

**Wire-in at worker boot (`worker/src/index.js`)** — the existing scaffolded file from Story 1.1 starts the heartbeat job. Add the master-key load BEFORE starting any cron / heartbeat work:

```js
// worker/src/index.js — Story 1.1 already calls getEnv() and starts the heartbeat.
// Add ABOVE the heartbeat startup:
import { loadMasterKey, MasterKeyLoadError } from '../../shared/crypto/master-key-loader.js';

let masterKey;
try {
  masterKey = loadMasterKey();
  logger.info({ masterKeyByteLength: masterKey.length, masterKeyVersion: 1 }, 'Master key loaded');
} catch (err) {
  // err is a MasterKeyLoadError — message already redacted of value
  logger.error({ code: err.code, message: err.message }, 'Master key load failed — exiting');
  process.exit(1);
}
// masterKey is now a 32-byte Buffer in worker process memory.
// Pass it as a parameter to encryptShopApiKey / decryptShopApiKey wherever needed.
// Do NOT log masterKey or any derivative; do NOT export from this module.
```

**App server intentionally does NOT load the master key at MVP.** Decryption happens only in worker context (engine cycles, onboarding scan). When Story 4.3 lands inline-validation, the app-side route will either (a) call into a worker-side endpoint over Postgres (less likely at MVP) or (b) have a service-role server-side helper that loads the key on demand from `process.env` and discards immediately. That decision is Story 4.3's; Story 1.2 only ensures the helpers exist and the key is loadable.

### Envelope Encryption Implementation Notes

```js
// shared/crypto/envelope.js
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';

/**
 * @typedef {object} EncryptedKey
 * @property {Buffer} ciphertext  - encrypted bytes
 * @property {Buffer} nonce       - 12-byte random IV used for AES-256-GCM
 * @property {Buffer} authTag     - 16-byte GCM authentication tag
 * @property {number} masterKeyVersion - 1 at MVP; bumped by rotation ceremony
 */

/**
 * Error thrown when ciphertext, nonce, or authTag fail GCM verification,
 * or when the masterKey does not match the encryption key. Does NOT leak
 * upstream OpenSSL detail (which can hint at error class). Treat all
 * decryption failures as a single opaque condition.
 */
export class KeyVaultDecryptError extends Error {
  constructor (message = 'shop_api_key vault decryption failed') {
    super(message);
    this.name = 'KeyVaultDecryptError';
    this.code = 'KEY_VAULT_DECRYPT_FAILED';
  }
}

const ALGO = 'aes-256-gcm';
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const CURRENT_MASTER_KEY_VERSION = 1;

/**
 * Encrypts a customer's Mirakl shop_api_key under the master key using AES-256-GCM.
 * Generates a fresh CSPRNG nonce per call.
 *
 * @param {string} plaintext  - the shop_api_key as a UTF-8 string
 * @param {Buffer} masterKey  - 32-byte Buffer from loadMasterKey()
 * @returns {EncryptedKey}
 * @throws {Error} if plaintext is not a non-empty string or masterKey is not 32 bytes
 */
export function encryptShopApiKey (plaintext, masterKey) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('plaintext must be a non-empty string');
  }
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new Error('masterKey must be a 32-byte Buffer');
  }
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGO, masterKey, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext,
    nonce,
    authTag,
    masterKeyVersion: CURRENT_MASTER_KEY_VERSION,
  };
}

/**
 * Decrypts a vault row to recover the original shop_api_key string.
 *
 * @param {object} args
 * @param {Buffer} args.ciphertext
 * @param {Buffer} args.nonce       - must be 12 bytes
 * @param {Buffer} args.authTag     - must be 16 bytes
 * @param {Buffer} args.masterKey   - 32-byte Buffer from loadMasterKey()
 * @returns {string} the original plaintext shop_api_key (UTF-8)
 * @throws {KeyVaultDecryptError} on any verification failure (tamper / wrong key)
 */
export function decryptShopApiKey ({ ciphertext, nonce, authTag, masterKey }) {
  if (
    !Buffer.isBuffer(ciphertext) ||
    !Buffer.isBuffer(nonce) || nonce.length !== NONCE_BYTES ||
    !Buffer.isBuffer(authTag) || authTag.length !== AUTH_TAG_BYTES ||
    !Buffer.isBuffer(masterKey) || masterKey.length !== 32
  ) {
    throw new KeyVaultDecryptError();
  }
  try {
    const decipher = createDecipheriv(ALGO, masterKey, nonce);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  } catch {
    // Swallow upstream detail — single opaque error class
    throw new KeyVaultDecryptError();
  }
}
```

**Why opaque error class:** GCM auth-tag verification failures vs malformed nonce vs wrong-key all produce different OpenSSL strings (`Unsupported state`, `bad decrypt`, etc.). Surfacing those gives an attacker probing the system free oracle bits about which component is misaligned. One opaque `KeyVaultDecryptError` reveals nothing.

**Why master key as parameter (not module scope):** module-scope key would force every test to mutate global state to inject a test key; passing as parameter keeps the helpers pure and testable. Worker boot pins the production key; tests pin a `crypto.randomBytes(32)` key; behavior is identical.

### Database Schema — `shop_api_key_vault` Migration

File: `supabase/migrations/202604301204_create_shop_api_key_vault.sql`

```sql
-- AD3 envelope-encryption vault: AES-256-GCM (12-byte nonce, 16-byte auth tag).
-- One row per customer_marketplaces row; ON DELETE CASCADE so vault row goes
-- when the marketplace row goes.
--
-- Encryption + decryption helpers live in shared/crypto/envelope.js.
-- Master key custody: Coolify env var MASTER_KEY_BASE64 (1Password cold backup);
-- master_key_version supports the AD3 annual rotation ceremony.
--
-- RLS: customer-scoped SELECT only (existence-read); no customer-side INSERT/UPDATE/DELETE.
-- Worker writes via service-role connection (bypasses RLS).
--
-- IMPORTANT: this file is append-only once committed. Schema changes after the
-- first commit ALWAYS create a new migration. Never edit this file post-commit.
-- (Project-context.md migration-immutability rule, captured 2026-05-01 after
-- Story 1.1's CR pass attempted to edit an applied migration to add an index.)

CREATE TABLE shop_api_key_vault (
  customer_marketplace_id  uuid PRIMARY KEY REFERENCES customer_marketplaces(id) ON DELETE CASCADE,
  ciphertext               bytea NOT NULL,
  nonce                    bytea NOT NULL,                 -- 12 bytes for AES-256-GCM
  auth_tag                 bytea NOT NULL,                 -- 16 bytes
  master_key_version       integer NOT NULL DEFAULT 1,     -- supports rotation ceremony (AD3)
  last_validated_at        timestamptz,                    -- last successful Mirakl call (set by worker)
  last_failure_status      smallint,                       -- last HTTP status if 401/403/etc.
  created_at               timestamptz NOT NULL DEFAULT NOW(),
  updated_at               timestamptz NOT NULL DEFAULT NOW()
);

-- Forward-dependency: customer_marketplaces table is created in Story 4.1
-- (migration 202604301203_create_customer_marketplaces.sql per directory tree).
-- This migration timestamp (1204) lands AFTER 1203 in lexicographic order, so
-- the FK target exists at apply time.

ALTER TABLE shop_api_key_vault ENABLE ROW LEVEL SECURITY;

-- Customer reads own vault row(s) by joining through customer_marketplaces.
-- Ciphertext/nonce/auth_tag are useless without the master key (held only in
-- worker process memory), so allowing SELECT-existence is acceptable.
CREATE POLICY shop_api_key_vault_select_own ON shop_api_key_vault
  FOR SELECT
  USING (
    customer_marketplace_id IN (
      SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()
    )
  );

-- INSERT/UPDATE/DELETE: NO customer-side policy. All writes go through the
-- worker process via service-role connection (RLS bypassed).

-- TODO Story 2.2: add 'shop_api_key_vault' to scripts/rls-regression-suite.js coverage list.
-- The suite must assert customer A cannot SELECT customer B's vault row.
```

**Apply sequence on a fresh DB:** 1203 (customer_marketplaces, Story 4.1) must precede 1204 (this migration) for the FK target to exist. Story 4.1 lands later in the sprint sequence, so on a fresh DB the FK target won't exist when 1204 is applied — this is a temporal mismatch the migration runner will reject.

**Resolution:** Pedro has TWO valid options at apply time:

- **Option A (recommended) — apply this migration after Story 4.1 lands.** Story 1.2 commits the migration FILE (so the spec is satisfied and the helper code is shippable), but Pedro defers `npx supabase db push` until Story 4.1's `customer_marketplaces` migration is also in the tree. The story is still "done" — the deliverable is the migration file + the helpers + the scanning hook + the runbook. The architecture's "every customer-scoped table includes RLS in the same migration" rule is what's load-bearing; apply timing is operational.

- **Option B — split the FK off.** Drop the `REFERENCES customer_marketplaces(id) ON DELETE CASCADE` in this migration; add a follow-up `ALTER TABLE shop_api_key_vault ADD CONSTRAINT ...` migration once 1203 lands. Less clean; loses CASCADE-guarantee until the ALTER lands. Not recommended unless Pedro wants to apply the table now to satisfy a downstream test gate.

Pedro picks at apply time. The Story 1.2 BAD subagent ships Option A by default — files committed, `db push` deferred — and notes the choice in the Dev Agent Record completion notes.

### Secret-Scanning Script Implementation Notes

File: `scripts/check-no-secrets.sh`

```bash
#!/usr/bin/env bash
# AD3 pre-commit secret scanner.
#
# Reads `git diff --cached --no-color -U0` (or stdin if data is piped — for
# unit-testability), and rejects any added line matching one of the five
# patterns below. Patterns target ASSIGNMENTS with substantial values, not
# bare mentions of env-var names — so source code referencing 'MASTER_KEY_BASE64'
# as a string literal in REQUIRED_VARS arrays does not trigger.
#
# Usage:
#   scripts/check-no-secrets.sh                      # scans staged diff
#   scripts/check-no-secrets.sh < some-file.diff    # scans piped input (tests)
#
# Exit codes:
#   0 — no matches found, commit may proceed
#   1 — at least one match found; offending file:line printed to stderr;
#       commit blocked
#
# Idempotent — script does not mutate any state.

set -euo pipefail

# 5 patterns per AC#4 (POSIX ERE).
PATTERNS=(
  'MASTER_KEY[A-Z_]*[ \t]*[=:][ \t]*['\''"]?[A-Za-z0-9+/=_-]{16,}'
  '(shop_api_key|SHOP_API_KEY)[ \t]*[=:][ \t]*['\''"]?[A-Za-z0-9+/=_-]{8,}'
  'sk_live_[A-Za-z0-9]{16,}'
  'sk_test_[A-Za-z0-9]{16,}'
  'Authorization:[ \t]*Bearer[ \t]+[A-Za-z0-9._-]{16,}'
)

PATTERN_NAMES=(
  'MASTER_KEY-style assignment'
  'shop_api_key assignment'
  'Stripe live secret (sk_live_)'
  'Stripe test secret (sk_test_)'
  'Authorization Bearer token'
)

# Load input — stdin if piped (tests), else staged diff (real commit).
if [ -t 0 ]; then
  diff_content="$(git diff --cached --no-color -U0 -- ':!*.env.example' ':!*.md' || true)"
else
  diff_content="$(cat)"
fi

# Empty diff (e.g., commit --allow-empty) — pass.
if [ -z "$diff_content" ]; then
  exit 0
fi

# Only inspect ADDED lines (start with '+', skip '+++' file headers).
added_lines="$(printf '%s\n' "$diff_content" | grep -E '^\+' | grep -v -E '^\+\+\+' || true)"

if [ -z "$added_lines" ]; then
  exit 0
fi

found_match=0
for i in "${!PATTERNS[@]}"; do
  pattern="${PATTERNS[$i]}"
  name="${PATTERN_NAMES[$i]}"
  matches="$(printf '%s\n' "$added_lines" | grep -E "$pattern" || true)"
  if [ -n "$matches" ]; then
    if [ $found_match -eq 0 ]; then
      printf '\n\xE2\x9C\x97 Pre-commit secret-scanning hook BLOCKED this commit:\n\n' >&2
      found_match=1
    fi
    printf '  Pattern: %s\n' "$name" >&2
    printf '%s\n' "$matches" | sed 's/^/    > /' >&2
    printf '\n' >&2
  fi
done

if [ $found_match -ne 0 ]; then
  printf 'If this is a false positive, refine the pattern in scripts/check-no-secrets.sh\n' >&2
  printf 'or remove the offending value before committing. Do NOT bypass with --no-verify.\n\n' >&2
  exit 1
fi

exit 0
```

**Note on the `-- ':!*.env.example' ':!*.md'` pathspec exclusions:** these tell git to skip `.env.example` (template — patterns appear without values, false positive) and markdown documentation (READMEs / runbooks legitimately reference `MASTER_KEY_BASE64`, `shop_api_key`, etc. as identifiers). The exclusions are file-level — if Pedro accidentally pastes a real value into either, it would slip through; the pattern-substantial-value requirement (`{16,}`, `{8,}`) is the second guard that catches plain identifiers but not assigned values.

**Why we DO NOT include `Worten Mirakl auth` (raw `Authorization: <key>` no-Bearer-prefix) as a pattern:** that pattern is too broad — every legitimate test in `tests/shared/mirakl/api-client.test.js` (Story 3.1) constructs a fake `Authorization: <test-key>` header for the mock server. The Bearer heuristic catches the more-common public-API leak case (e.g., a Stripe Bearer or GitHub Bearer pasted from a tutorial); raw-Authorization is reviewed at code review.

**On the AC#4 `shop_api_key` pattern — practical narrowing of "any string containing shop_api_key (case-sensitive)":**

The verbatim AC text from `epics-distillate/01-epics-1-3-foundation-tenancy-mirakl.md` reads "any string containing shop_api_key (case-sensitive)". Read literally, that would match every legitimate code mention — column names in migrations (`CREATE TABLE shop_api_key_vault ...` itself), JSON field names in API contracts, schema descriptions, error messages, and SELECT statements. Such a hook would be unworkable for normal development: the BAD subagent could not even commit Story 1.2's own files because they reference `shop_api_key` in DDL, doc strings, and runbook prose.

Practical interpretation applied: `(shop_api_key|SHOP_API_KEY)[ \t]*[=:][ \t]*['\"]?[A-Za-z0-9+/=_-]{8,}` — i.e., the identifier followed by an `=`-or-`:` assignment with a substantial value. This catches the actual leak case (a customer Mirakl key inlined as a config value) while letting code references through. The `*.md` and `.env.example` path-exclusions further reduce false positives.

If Pedro prefers the strict literal reading, the regex broadens to `shop_api_key` (case-sensitive, no value-tail) and the path-exclusion list grows to include `supabase/migrations/`, `db/seed/`, `tests/`, `shared/crypto/`, and `app/src/routes/onboarding/key.js` — i.e., every directory that touches the column. That's noisy and brittle; the practical narrowing is recommended. BAD subagent picks; document the choice in Dev Agent Record completion notes.

**Forward concern — Stripe test fixtures (Story 11.x):**

The `sk_test_[A-Za-z0-9]{16,}` pattern will block any test fixture (e.g., `tests/fixtures/stripe/...`) that uses a literal Stripe test secret. Story 11.1 / 11.2 BAD subagents must either (a) use synthetic values matching no pattern (e.g., `mock_stripe_AbCdEf...`) and load real test secrets from `.env.test`, or (b) extend the path exclusion in `scripts/check-no-secrets.sh` to skip `tests/fixtures/stripe/`. This is a Story 11.x concern — Story 1.2 ships the hook as-is.

### Git Hook Shim

File: `.githooks/pre-commit` (executable; tracked)

```bash
#!/usr/bin/env bash
# Pre-commit hook installed via `git config core.hooksPath .githooks`.
# Delegates to scripts/check-no-secrets.sh. Idempotent.
exec bash "$(git rev-parse --show-toplevel)/scripts/check-no-secrets.sh"
```

File: `scripts/install-git-hooks.sh`

```bash
#!/usr/bin/env bash
# One-time developer setup: tells git to look for hooks in .githooks/ instead
# of the default .git/hooks/ (which is per-clone and untracked).
# Run once per fresh clone.
set -euo pipefail
git config core.hooksPath .githooks
echo "✓ Pre-commit secret-scanning hook installed (core.hooksPath=.githooks)."
```

**Cross-platform note:** Pedro is on Windows; `bash` resolves to Git Bash (bundled with Git for Windows installer). The shebang `#!/usr/bin/env bash` works in Git Bash and on Linux/macOS. NO PowerShell version needed.

### Rotation Runbook Outline

File: `scripts/rotate-master-key.md`

Structure (full prose to be written by the BAD subagent — keep it under ~80 lines, markdown only):

```markdown
# Master-Key Rotation Runbook (AD3)

> **Cadence:** Annual ceremony (calendar event), or on-incident if compromise suspected.
> **Executor:** Pedro (founder operational track per epics-distillate Founder Operational Track entry "Master-key rotation ceremony").
> **Duration:** ~30 minutes for ≤10 customers; scales linearly with vault row count.

## Why we rotate

[Brief — 3-4 sentences on AD3 / NFR-S1 / trust commitment]

## Prerequisites

- Coolify access (env-var management for repricer-worker service)
- 1Password vault access (cold backup)
- `openssl` available (Pedro's local machine OR Coolify shell)
- `npx supabase db connect` working (Pedro's machine)

## The 5-step procedure

### Step 1 — Generate the new master key

```sh
openssl rand -base64 32
# 44-character base64 string; copy to clipboard
```

### Step 2 — Deploy the new key alongside the existing one

In Coolify → repricer-worker → Environment Variables: add `MASTER_KEY_BASE64_NEXT=<new-value>` WITHOUT removing `MASTER_KEY_BASE64`. Restart worker. Both keys are now in process memory simultaneously.

### Step 3 — Re-encrypt every vault row

[Pseudocode showing the per-row advisory-lock loop using `shared/crypto/envelope.js`. Bumps `master_key_version` on each row.]

```js
// Pseudocode — Pedro writes a one-off script as needed:
import { encryptShopApiKey, decryptShopApiKey } from '../shared/crypto/envelope.js';
// for each vault row:
//   pg_try_advisory_lock(customer_marketplace_id)
//   plaintext = decryptShopApiKey({ ciphertext, nonce, authTag, masterKey: OLD })
//   encrypted = encryptShopApiKey(plaintext, NEW)
//   UPDATE vault SET ciphertext=$1, nonce=$2, auth_tag=$3, master_key_version=2, updated_at=NOW()
//   pg_advisory_unlock(customer_marketplace_id)
```

Verify: `SELECT COUNT(*) FROM shop_api_key_vault WHERE master_key_version = 1` returns 0 when re-encryption is complete.

### Step 4 — Coolify env-var swap

In Coolify: rename `MASTER_KEY_BASE64_NEXT` → `MASTER_KEY_BASE64` (delete the old `MASTER_KEY_BASE64` first). Restart worker. Now only the new key is in process memory.

### Step 5 — Update 1Password backup

Replace the old master-key entry in 1Password with the new value. Confirm the old value is unrecoverable.

## Post-rotation verification

- [ ] `SELECT MAX(master_key_version) FROM shop_api_key_vault` returns the new version (e.g., 2)
- [ ] Worker decrypts a vault row successfully (manual smoke test against one customer)
- [ ] No `KEY_VAULT_DECRYPT_FAILED` errors in logs in the hour following rotation

## Rollback

If Step 3 fails partway through:
- The advisory lock pattern means in-flight per-row re-encryption is atomic (commit or rollback per row); a partial run leaves some rows at v1, some at v2
- Both `MASTER_KEY_BASE64` and `MASTER_KEY_BASE64_NEXT` are still in env at this point — re-run Step 3 to finish
- Do NOT proceed to Step 4 until Step 3 completes
```

### Pino Redaction at Story 1.2

Story 1.2 introduces `MASTER_KEY_BASE64` and `master_key` as redaction targets. Story 1.3 ships the canonical pino redaction list (`shared/logger.js`) — the redaction list at AD27 is locked to include `MASTER_KEY_BASE64` and `master_key` already.

**At Story 1.2 time, no logs are emitted that contain the master key value** (the loader logs only byte-length metadata; encrypted vault writes go through the worker which has no plaintext-of-key log path). So Story 1.2 does NOT need to ship redaction itself — but the BAD subagent must verify via grep that no introduced log line includes a `masterKey` / `plaintext` / `ciphertext` value field.

### Test Patterns

**Crypto tests** — `tests/shared/crypto/envelope.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, Buffer } from 'node:crypto'; // Buffer via crypto's import surface fine
import {
  encryptShopApiKey, decryptShopApiKey, KeyVaultDecryptError,
} from '../../../shared/crypto/envelope.js';

test('round-trip happy path', () => {
  const masterKey = randomBytes(32);
  const plaintext = 'AbCdEf0123456789-test-shop-api-key';
  const enc = encryptShopApiKey(plaintext, masterKey);
  assert.equal(enc.nonce.length, 12);
  assert.equal(enc.authTag.length, 16);
  assert.equal(enc.masterKeyVersion, 1);
  const decrypted = decryptShopApiKey({ ...enc, masterKey });
  assert.equal(decrypted, plaintext);
});

test('tampered ciphertext rejected', () => {
  const masterKey = randomBytes(32);
  const enc = encryptShopApiKey('plaintext', masterKey);
  enc.ciphertext[0] ^= 0xff;
  assert.throws(
    () => decryptShopApiKey({ ...enc, masterKey }),
    (err) => err instanceof KeyVaultDecryptError && err.code === 'KEY_VAULT_DECRYPT_FAILED'
  );
});

// ... (similar for tampered nonce, tampered auth tag, wrong master key)

test('nonce uniqueness across calls', () => {
  const masterKey = randomBytes(32);
  const a = encryptShopApiKey('same-plaintext', masterKey);
  const b = encryptShopApiKey('same-plaintext', masterKey);
  assert.notDeepEqual(a.nonce, b.nonce, 'CSPRNG nonce reused — catastrophic for GCM');
  assert.notDeepEqual(a.ciphertext, b.ciphertext);
});

test('error opacity — secrets never leak', () => {
  const masterKey = randomBytes(32);
  const plaintext = 'SECRET_VALUE_THAT_MUST_NOT_LEAK';
  const enc = encryptShopApiKey(plaintext, masterKey);
  enc.ciphertext[0] ^= 0xff;
  try {
    decryptShopApiKey({ ...enc, masterKey });
    assert.fail('expected KeyVaultDecryptError');
  } catch (err) {
    const dump = err.message + '\n' + err.stack + '\n' + JSON.stringify(err);
    assert.ok(!dump.includes(plaintext), 'plaintext leaked in error');
    assert.ok(!dump.includes(enc.ciphertext.toString('hex')), 'ciphertext leaked');
    assert.ok(!dump.includes(masterKey.toString('hex')), 'masterKey leaked');
    assert.ok(!dump.includes(masterKey.toString('base64')), 'masterKey base64 leaked');
  }
});
```

**Master-key loader tests** — `tests/shared/crypto/master-key-loader.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { loadMasterKey, MasterKeyLoadError } from '../../../shared/crypto/master-key-loader.js';

test('loadMasterKey happy path', () => {
  const original = process.env.MASTER_KEY_BASE64;
  process.env.MASTER_KEY_BASE64 = randomBytes(32).toString('base64');
  try {
    const key = loadMasterKey();
    assert.equal(key.length, 32);
    assert.ok(Buffer.isBuffer(key));
  } finally {
    if (original === undefined) delete process.env.MASTER_KEY_BASE64;
    else process.env.MASTER_KEY_BASE64 = original;
  }
});

test('loadMasterKey rejects missing env', () => {
  const original = process.env.MASTER_KEY_BASE64;
  delete process.env.MASTER_KEY_BASE64;
  try {
    assert.throws(() => loadMasterKey(), (err) =>
      err instanceof MasterKeyLoadError && err.code === 'MASTER_KEY_INVALID');
  } finally {
    if (original !== undefined) process.env.MASTER_KEY_BASE64 = original;
  }
});

test('loadMasterKey rejects wrong-length key', () => {
  const original = process.env.MASTER_KEY_BASE64;
  process.env.MASTER_KEY_BASE64 = randomBytes(16).toString('base64'); // 16 bytes, not 32
  try {
    assert.throws(() => loadMasterKey(), (err) =>
      err instanceof MasterKeyLoadError && err.code === 'MASTER_KEY_INVALID');
  } finally {
    if (original === undefined) delete process.env.MASTER_KEY_BASE64;
    else process.env.MASTER_KEY_BASE64 = original;
  }
});

test('loadMasterKey rejects malformed base64', () => {
  const original = process.env.MASTER_KEY_BASE64;
  process.env.MASTER_KEY_BASE64 = 'not!@#valid$%^base64';
  try {
    assert.throws(() => loadMasterKey(), (err) =>
      err instanceof MasterKeyLoadError);
  } finally {
    if (original === undefined) delete process.env.MASTER_KEY_BASE64;
    else process.env.MASTER_KEY_BASE64 = original;
  }
});

test('loadMasterKey error message never includes the env value', () => {
  const original = process.env.MASTER_KEY_BASE64;
  const sentinelValue = 'SECRET_SENTINEL_BASE64==';
  process.env.MASTER_KEY_BASE64 = sentinelValue;
  try {
    loadMasterKey();
  } catch (err) {
    assert.ok(!err.message.includes(sentinelValue), 'env value leaked into error message');
    assert.ok(!err.stack.includes(sentinelValue), 'env value leaked into stack');
  } finally {
    if (original === undefined) delete process.env.MASTER_KEY_BASE64;
    else process.env.MASTER_KEY_BASE64 = original;
  }
});
```

**Secret-scanning hook tests** — see Task 7. Use `node:child_process.spawn('bash', ['scripts/check-no-secrets.sh'])` with stdin piped to feed synthetic diffs. Skip with `t.skip` if `bash` is not on PATH (some Windows envs without Git Bash).

### Forward Dependencies — What This Story Does NOT Do

- **Vault row writes** (encrypt + INSERT INTO `shop_api_key_vault`): Story 4.3 (onboarding key entry form). Story 1.2 ships only the migration + helpers; the customer-facing key entry form does not exist yet.
- **Vault row reads + decrypt** (engine cycle / catalog scan): Story 3.x (Mirakl integration) + Story 4.4 (onboarding scan) + Story 7.x (engine).
- **Key destruction at deletion initiation** (`UPDATE shop_api_key_vault SET ciphertext=null, nonce=null, auth_tag=null WHERE customer_marketplace_id IN ...`): Story 10.1 (account deletion multi-step flow per FR4 amended).
- **RLS regression test for `shop_api_key_vault`**: Story 2.2 (`scripts/rls-regression-suite.js` is built there; this migration's TODO comment is the forward-pointer).
- **Concierge marketplace-add** (founder CLI that encrypts a key submitted out-of-band): Story 11.4. Reuses these helpers.
- **Pino redaction of `master_key`**: Story 1.3 ships `shared/logger.js`; AD27 redaction list already includes `master_key` and `MASTER_KEY_BASE64`.
- **GitHub Secret Scanning** (platform-side, not code): Pedro toggles in repo Settings → Code security & analysis → Secret scanning. README documents this in the Developer Setup section. Repo-side scanning is the second layer behind the pre-commit hook (catches anything that slipped past the local hook on someone else's clone).

### Previous Story Intelligence — Story 1.1

Lessons from Story 1.1 implementation + review (review applied 2026-05-01):

- **TLS to Postgres on Hetzner→Supabase route requires explicit configuration.** Story 1.1's review flagged `ssl: { rejectUnauthorized: false }` on both pg Pools as silently accepting MITM/forged certs on service-role credentials. Resolution: TLS CA pinning waiting on Pedro to drop Supabase's root CA at `db/supabase-ca.pem`. Story 1.2 does not add new pg Pools — but if a future task adds a vault-read pg Pool, follow the same CA-pinning resolution.
- **Migration canonical location is `supabase/migrations/`** (not `db/migrations/`). Story 1.1 D2 decision moved this. Story 1.2's vault migration goes to `supabase/migrations/202604301204_create_shop_api_key_vault.sql`.
- **ESLint v10 flat config is in use** (Story 1.1 D3 decision: kept v10 over the spec's v9 wording). New JS files (`shared/crypto/envelope.js`, `shared/crypto/master-key-loader.js`) must satisfy the existing `no-console`, `no-default-export`, `no-restricted-syntax` (`.then()` chains forbidden), `jsdoc/require-jsdoc` rules. JSDoc on every exported function with `@param`, `@returns`, `@throws`.
- **`pg` ESM import quirk**: Story 1.2 does NOT add new pg Pools, so this does not apply here. Future stories: `import pg from 'pg'; const { Pool } = pg;` (CJS-default destructure pattern).
- **Smoke-test pattern that worked**: spawn child processes, pipe stdout/stderr to test output, fail fast on early child exit, poll with timeout. Story 1.2's hook tests don't spawn long-lived processes — single bash invocation per test case — but the same idea applies (capture stderr for diagnostic).
- **Heartbeat eager-write pattern (Story 1.1 review patch)**: don't introduce 30s gaps on boot; immediate-then-interval. Story 1.2's master-key load is single-shot at boot, no interval involved.
- **Pre-existing scaffolding leaves pre-existing patterns**: Story 1.2 does not retroactively refactor Story 1.1's inline pg Pool. Story 2.1 owns that consolidation.
- **Story 1.1 review identified `MASTER_KEY_BASE64` shape (32-byte base64) not validated** as DEFERRED to Story 1.2 (review item P-D4 in Story 1.1's deferred list). This story owns that validation — implemented in `shared/crypto/master-key-loader.js`.

### Git Intelligence — Recent Commits

```
66f4cc1 feat(story-1.1): scaffold project, two-service Coolify deploy, composed /health
2acb867 docs(planning): three distillates + project-context.md + CLAUDE.md path updates
87fc05d docs(sprint): generate sprint-status.yaml — 62 stories sequenced
8f7add7 docs(planning): readiness-check fixes — NFR-O4 binding + I1-I3 cleanup
4baad0f docs(planning): epics breakdown — 62 stories / 12 epics (status: complete)
```

Story 1.1 landed yesterday. Story 1.2 is the second feat commit. Convention: commit message starts with `feat(story-1.2):`, single commit per AC bundle (Bundle A applies to Story 1.4, not here — Story 1.2 has no atomicity bundle, multiple commits OK if logical separation helps).

### Latest Tech Information

- **Node `node:crypto` AES-256-GCM**: stable since Node 10; Node 22's API surface (`createCipheriv`, `setAuthTag`, `getAuthTag`) is unchanged. No version-pinning concerns.
- **No third-party crypto libraries**: NO `bcrypt`, NO `argon2`, NO `tweetnacl`, NO `libsodium-wrappers`, NO `crypto-js`. Built-in `node:crypto` is sufficient and matches the JS-ESM-no-dependencies philosophy.
- **`Buffer.from(str, 'base64')` quirk**: `Buffer.from('not-base64-at-all', 'base64')` does NOT throw — it silently returns a buffer of decoded garbage. The round-trip check (`decoded.toString('base64') === input` modulo padding) is the standard mitigation. The loader implements this.
- **Git pre-commit hooks via `core.hooksPath`**: Git ≥2.9 (May 2016) supports `core.hooksPath`. Pedro's Git is current. Cross-platform — works in Git Bash on Windows.
- **Pino redaction**: AD27 list already includes `master_key` and `MASTER_KEY_BASE64`. Story 1.3 wires the actual redaction; Story 1.2 introduces no log lines that would carry the value.
- **Supabase CLI migration ordering**: applied in lexicographic order of filename; tracked in `supabase_migrations.schema_migrations` so already-applied ones are skipped on subsequent `db push`. Out-of-order new files are simply applied next.

### Project Structure Notes

Files created in this story:

```
shared/crypto/envelope.js                                                 # NEW — encrypt/decrypt helpers
shared/crypto/master-key-loader.js                                        # NEW — loadMasterKey()
supabase/migrations/202604301204_create_shop_api_key_vault.sql           # NEW — vault table + RLS
scripts/check-no-secrets.sh                                              # NEW — pre-commit scanner
scripts/install-git-hooks.sh                                             # NEW — one-time hook setup
scripts/rotate-master-key.md                                             # NEW — annual rotation runbook
.githooks/pre-commit                                                     # NEW — hook shim
tests/shared/crypto/envelope.test.js                                     # NEW
tests/shared/crypto/master-key-loader.test.js                            # NEW
tests/scripts/check-no-secrets.test.js                                   # NEW
worker/src/index.js                                                      # UPDATED — call loadMasterKey() at boot
.env.example                                                             # UPDATED — comment line above MASTER_KEY_BASE64
README.md                                                                # UPDATED — Developer Setup section + GitHub secret-scanning toggle note
```

Files NOT touched (per "do not create implementation files for stories beyond 1.2"):
- `app/src/server.js` — app server does not load master key at MVP
- `shared/config/runtime-env.js` — presence-check stays here; deeper validation lives in master-key-loader.js (separation of concerns)
- Any other `shared/`, `app/`, `worker/` files

### Alignment with Unified Project Structure

- **Module location**: `shared/crypto/envelope.js` and `shared/crypto/master-key-loader.js` match `architecture-distillate/05-directory-tree.md` (the `shared/crypto/` directory is reserved exactly for these two modules).
- **Migration filename**: `202604301204_create_shop_api_key_vault.sql` matches the directory tree exactly.
- **Script locations**: `scripts/check-no-secrets.sh`, `scripts/install-git-hooks.sh`, `scripts/rotate-master-key.md` all match the architecture's `scripts/` convention.
- **Hook directory**: `.githooks/` is new (not in the directory tree explicitly); it's hidden, tracked, and standard for `core.hooksPath`-managed hooks. Add a one-line entry to README's project-tree section if the BAD subagent maintains one.
- **No deviations from the unified project structure.** No exceptions, no conflicts.

### References

- [Source: architecture-distillate/02-decisions-A-D.md#AD3 — Encrypted shop_api_key vault: app-layer envelope encryption (B1 lock)] — full AD3 spec including 5-step rotation procedure
- [Source: architecture-distillate/04-implementation-patterns.md#Structural — 11 Single-Source-of-Truth Modules] — `shared/crypto/envelope.js` is module #9 in the SSoT list; AD3
- [Source: architecture-distillate/06-database-schema.md#shop_api_key_vault (Marketplaces & Keys)] — full DDL including RLS comment
- [Source: architecture-distillate/05-directory-tree.md] — file-location confirmation: `shared/crypto/envelope.js`, `shared/crypto/master-key-loader.js`, `scripts/rotate-master-key.md`, `scripts/check-no-secrets.sh`, `supabase/migrations/202604301204_create_shop_api_key_vault.sql`
- [Source: architecture-distillate/_index.md#Cross-Cutting Pre-Locked Decisions (frontmatter) — B1] — app-layer envelope encryption lock
- [Source: epics-distillate/01-epics-1-3-foundation-tenancy-mirakl.md#Story 1.2: Envelope encryption module, master-key loader, secret-scanning hook] — verbatim ACs (5 ACs as transcribed above)
- [Source: epics-distillate/_index.md#Cross-Cutting: SSoT Modules Index] — Story 1.2 builds `shared/crypto/envelope.js` (consumed by Stories 4.3, 4.4, 10.1, 11.4) + `shared/crypto/master-key-loader.js`
- [Source: epics-distillate/_index.md#Architectural Constraints / Negative Assertions (27 items)] — items #18 (no console.log) + AD3 (master-key custody)
- [Source: epics-distillate/_index.md#Founder Operational Track] — "Master-key rotation ceremony (already in Story 1.2 as `scripts/rotate-master-key.md`) — Annual rotation procedure per AD3"
- [Source: project-context.md#11 Single-Source-of-Truth Modules] — table row for `shared/crypto/envelope.js` (Story 1.2; no custom ESLint rule; decryption only in worker context)
- [Source: project-context.md#Anti-Patterns / Refuse List] — refuse OF24, refuse Mirakl webhook, refuse zod
- [Source: prd-distillate.md#FR11] — "API key stored encrypted at rest; founder cannot view cleartext; application MUST NOT log cleartext key material"
- [Source: prd-distillate.md#NFR-S1] — "All customer Mirakl shop API keys encrypted at rest using KMS-managed key; founder cannot view cleartext key material; application logs never contain cleartext key material; verified pre-launch via security review and ongoing via DB-dump scans"
- [Source: CLAUDE.md] — "Trust constraint: API keys MUST be stored encrypted at rest. The Mirakl shop_api_key has no read-only mode and grants full account access (bank/IBAN, sales, prices, orders). This is a trust-critical component."
- [Source: implementation-artifacts/1-1-scaffold-project-two-service-coolify-deploy-composed-health.md] — Story 1.1 patterns + deferred review item ("MASTER_KEY_BASE64 shape (32-byte base64) not validated — deferred, Story 1.2 explicitly owns this per spec line 401")
- [Mirakl MCP] — not required for this story (no Mirakl calls in Story 1.2)
- [Context7: /nodejs/node — `crypto` module] — `createCipheriv`/`createDecipheriv` AES-256-GCM example, stable across Node 22.x; if BAD subagent wants to verify, query `crypto.createCipheriv aes-256-gcm`
- DynamicPriceIdea repo at `D:\Plannae Project\DynamicPriceIdea` — does NOT have envelope encryption (DPI uses an in-memory `keyStore` Map keyed by job_id with TTL eviction; never persists keys); Story 1.2 is genuinely new code, not a DPI port.

## Dev Agent Record

### Agent Model Used

- claude-opus-4-7 (bmad-create-story / Bob — 2026-05-01) — story sharding
- claude-opus-4-7 (bmad-dev-story / Amelia — 2026-05-01) — implementation

### Debug Log References

- **Pattern fix #1 (`MASTER_KEY[A-Z_]*` → `MASTER_KEY[A-Z0-9_]*`):** the AC#4 verbatim regex `MASTER_KEY[A-Z_]*` does NOT match `MASTER_KEY_BASE64=...` because `BASE64` contains digits, and `[A-Z_]` excludes digits. First test run blocked 0/4 MASTER_KEY assignments. Adjusted to `[A-Z0-9_]*` to honor the spec's stated intent (env var names like `MASTER_KEY_BASE64`, `MASTER_KEY_NEXT`, `MASTER_KEY_BASE64_2024`). The original AC text was a transcription bug, not a deliberate narrowing.
- **Pattern fix #2 (`Authorization:[ \t]*Bearer` → `Authorization:[ \t]*['"]?Bearer`):** AC#4's verbatim test fixture `+headers: { Authorization: 'Bearer eyJ...' }` includes a single quote between `Authorization:` and `Bearer` (JS-style header object), which the verbatim regex `Authorization:[ \t]*Bearer[ \t]+...` does not match. Allowed an optional `'` or `"` between the colon and `Bearer` so the spec's own test fixture passes. The legitimate HTTP header form (`Authorization: Bearer X`) is still caught.
- **`.gitattributes` added:** Pedro is on Windows, but Coolify runs the worker / hooks in a Linux container. Without `.gitattributes`, `git`'s autocrlf would convert `*.sh` and `.githooks/pre-commit` to CRLF on commit, which crashes `#!/usr/bin/env bash` shebangs on Linux. Added `*.sh text eol=lf` and `.githooks/* text eol=lf` to force LF in the working tree. Out-of-scope per the strict task list, but the hook-shipping deliverable is non-functional on Linux without it.

### Completion Notes List

- **All 5 ACs satisfied; all 10 tasks (40 subtasks) checked.** 31/31 unit tests pass; integration smoke test passes (`node --env-file=.env.local --test tests/integration/scaffold-smoke.test.js`). Lint clean (only pre-existing warning in `scripts/mirakl-empirical-verify.js:146` which is outside Story 1.2 scope).
- **Pre-flight verified (Task 9):** `.env.local`'s `MASTER_KEY_BASE64` decodes to exactly 32 bytes. Worker boot now logs `Master key loaded` with `masterKeyByteLength: 32, masterKeyVersion: 1` — metadata only, no value.
- **SSoT discipline verified:** `createCipheriv` / `createDecipheriv` exist only in `shared/crypto/envelope.js` (grep confirms). The master-key Buffer is held in `worker/src/index.js` module scope only; passed by parameter to encrypt/decrypt helpers; never module-scope in `envelope.js`; never logged as value.
- **Migration option chosen: Option A (recommended).** Migration file `supabase/migrations/202604301204_create_shop_api_key_vault.sql` is committed but NOT applied via `npx supabase db push` — the FK target `customer_marketplaces` does not exist until Story 4.1 lands. Pedro applies after Story 4.1's migration is in the tree (lexicographic 1203 < 1204 ensures correct order on a fresh DB).
- **`shop_api_key` regex narrowing chosen: practical interpretation.** AC#4 verbatim says "any string containing shop_api_key (case-sensitive)". Implemented as `(shop_api_key|SHOP_API_KEY)[ \t]*[=:][ \t]*['"]?[A-Za-z0-9+/=_-]{8,}` — the identifier followed by `=`/`:` assignment with substantial value. Strict literal would block legitimate code references in DDL, JSON contracts, and runbook prose (including Story 1.2's own files). Combined with `*.md` and `.env.example` path exclusions in the script, this catches assignments while letting code references through. Documented in story Dev Notes; future BAD subagents may broaden if Pedro prefers the strict reading.
- **Hook installed and end-to-end tested:** `git config --get core.hooksPath` returns `.githooks`; piping a synthetic `+stripe.SECRET = 'sk_live_...'` line to `bash .githooks/pre-commit` returns exit 1 with the matched-pattern report on stderr.
- **Forward dependencies untouched per spec:** `app/src/server.js` does NOT load the master key (Story 4.3 decides the app-side validation path). `shared/config/runtime-env.js` keeps presence-only validation; deeper byte-length validation lives in `master-key-loader.js`. No new pg Pools added (Story 2.1 owns the RLS-aware client). No custom ESLint rules ship here (per architecture distillate, custom rules ship with their target SSoT modules).
- **Pre-existing repo conventions retained:** ESLint v10 flat config (Story 1.1 D3); migration directory `supabase/migrations/` (Story 1.1 D2); `node:test` + `node:assert/strict`; ESM imports throughout; no third-party crypto libraries (only `node:crypto`).

### File List

**New:**
- `shared/crypto/master-key-loader.js` — `loadMasterKey()` + `MasterKeyLoadError` class
- `shared/crypto/envelope.js` — `encryptShopApiKey()` + `decryptShopApiKey()` + `KeyVaultDecryptError` class
- `supabase/migrations/202604301204_create_shop_api_key_vault.sql` — vault table + RLS policy (committed; apply deferred until Story 4.1 per Option A)
- `scripts/check-no-secrets.sh` — pre-commit secret scanner (5 patterns)
- `scripts/install-git-hooks.sh` — one-time hook installer (`core.hooksPath=.githooks`)
- `scripts/rotate-master-key.md` — annual master-key rotation runbook (AD3 5-step procedure)
- `.githooks/pre-commit` — hook shim that delegates to `scripts/check-no-secrets.sh`
- `.gitattributes` — forces LF for `*.sh` and `.githooks/*` (Linux container compatibility)
- `tests/shared/crypto/envelope.test.js` — 12 unit tests
- `tests/shared/crypto/master-key-loader.test.js` — 9 unit tests
- `tests/scripts/check-no-secrets.test.js` — 10 hook tests

**Modified:**
- `worker/src/index.js` — calls `loadMasterKey()` at boot; `process.exit(1)` on failure; logs only metadata (byte length + version)
- `.env.example` — added `# 32-byte master key, base64-encoded. Generate with: openssl rand -base64 32` comment above `MASTER_KEY_BASE64=`
- `README.md` — added Developer Setup section (hook install + master-key generation) + linked `scripts/rotate-master-key.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — Story 1.2 ready-for-dev → in-progress → review

### Change Log

| Date | Change | Author |
|---|---|---|
| 2026-05-01 | Story 1.2 sharded from epic into ready-for-dev story file | bmad-create-story (Bob) |
| 2026-05-01 | Story 1.2 implemented: envelope encryption module + master-key loader + secret-scanning pre-commit hook + vault migration + rotation runbook. 31 unit tests, integration smoke test passing. Status → review. | bmad-dev-story (Amelia) |
| 2026-05-01 | Code review applied. 4 patches landed: critical hook-bypass fix (`[ -t 0 ]` → `[ -p /dev/stdin ]`, end-to-end verified), uuid::bigint cast fix in rotation runbook, grep-error-code discipline in scanner, removed dead try/catch in master-key-loader. 22 items deferred to `deferred-work.md`. 5 dismissed as noise. 31/31 tests still pass. Status → done. | bmad-code-review |

### File List

### Review Findings

Code review applied 2026-05-01 (bmad-code-review). Three adversarial layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor) launched in parallel. Auditor verdict: all 5 ACs met, deviations properly documented. Blind+Edge surfaced 4 patch-level issues — one of them critical to the trust commitment.

**Patches (4 — applied 2026-05-01):**

- [x] [Review][Patch] Pre-commit hook silently bypasses on real `git commit` — `[ -t 0 ]` was true only for interactive TTY; both real `git commit` (stdin=/dev/null) and piped tests (stdin=pipe) made it false. Real commits fell into the `cat` branch, got empty content, exited 0 without scanning. **Fixed:** replaced `[ -t 0 ]` with `[ -p /dev/stdin ]`. End-to-end verified by staging a fake `sk_live_...` secret and invoking the hook with `bash .githooks/pre-commit < /dev/null` — now blocks correctly with exit 1. All 31 unit tests still pass. [scripts/check-no-secrets.sh:42-50]
- [x] [Review][Patch] Rotation runbook pseudocode `customer_marketplace_id::bigint` cast fails at runtime — **Fixed:** changed pseudocode to `pg_try_advisory_lock(hashtext(customer_marketplace_id::text)::bigint)` and matching unlock; added explanatory note on hash-collision tolerance for a rotation lock and a pointer to `pg_try_advisory_xact_lock` for stricter isolation. [scripts/rotate-master-key.md:51,57]
- [x] [Review][Patch] `set -euo pipefail` + `grep ... || true` masked malformed-regex errors — **Fixed:** wrapped each pattern grep in `set +e` / `set -e` with explicit `rc>1 → exit rc` handling so grep exit code 2 (regex/I-O error) now aborts the hook with a diagnostic instead of passing silently. [scripts/check-no-secrets.sh:62-79]
- [x] [Review][Patch] Dead `try/catch` around `Buffer.from(raw, 'base64')` — **Fixed:** removed the unreachable catch; replaced with a comment explaining why the round-trip check is the actual validator (Node's `Buffer.from('base64')` is documented as lenient — silent truncation, never throws). [shared/crypto/master-key-loader.js:35-41]

**Deferred (22 — pre-existing, beyond MVP scope, or duplicates of already-tracked items; mirrored to `_bmad-output/implementation-artifacts/deferred-work.md`):**

- [x] [Review][Defer] base64 trim asymmetry under non-documented openssl wrapping [shared/crypto/master-key-loader.js:45] — deferred, theoretical (32-byte keys never exceed openssl's column wrap)
- [x] [Review][Defer] secret-scanning regex coverage narrow (only 5 patterns, real Stripe/GitHub leak shapes vary) [scripts/check-no-secrets.sh:24-30] — deferred, spec-mandated; broaden in later security pass
- [x] [Review][Defer] single opaque `KeyVaultDecryptError` masks programmer-error vs tamper [shared/crypto/envelope.js:82-90] — deferred, spec-mandated for attacker-oracle protection
- [x] [Review][Defer] master key buffer not zeroed on shutdown; no `inspect`/`toString` guard [worker/src/index.js:15] — deferred, defense-in-depth beyond MVP
- [x] [Review][Defer] returned EncryptedKey buffers are by-reference (mutability hazard) [shared/crypto/envelope.js:60-65] — deferred, low-priority
- [x] [Review][Defer] `loadMasterKey` trailing-whitespace edge cases [shared/crypto/master-key-loader.js:32,45] — deferred, fragile but currently correct
- [x] [Review][Defer] migration apply-order discipline (1204 references 1203's table) [supabase/migrations/202604301204_create_shop_api_key_vault.sql:23] — deferred, Option A explicitly chosen by spec
- [x] [Review][Defer] `updated_at` has DEFAULT but no auto-update trigger [supabase/migrations/202604301204_create_shop_api_key_vault.sql:31] — deferred, downstream writers own
- [x] [Review][Defer] scanner does not catch SUPABASE_SERVICE_ROLE_KEY / `whsec_` / `re_` / DB connection strings [scripts/check-no-secrets.sh:24-30] — deferred, broaden in later security pass; `.env.example` enumerates the gap
- [x] [Review][Defer] multi-line secret values bypass line-by-line scanner [scripts/check-no-secrets.sh:53] — deferred, inherent to diff-line scanning
- [x] [Review][Defer] RLS policy silent-fail on `auth.uid()` NULL [supabase/migrations/202604301204_create_shop_api_key_vault.sql:42-44] — deferred, Story 2.2 RLS regression suite
- [x] [Review][Defer] `last_failure_status smallint` accepts negatives and >599 (no CHECK) [supabase/migrations/202604301204_create_shop_api_key_vault.sql:29] — deferred, no analytics depend on it yet
- [x] [Review][Defer] `masterKey` is dead-weight at module scope; not yet passed to startHeartbeat or engine [worker/src/index.js:15-25] — deferred, Story 7.x wires the engine
- [x] [Review][Defer] over-padded base64 round-trip accepted; only the 32-byte gate catches it [shared/crypto/master-key-loader.js:44-47] — deferred, length check is sufficient
- [x] [Review][Defer] `withEnv` test helper not robust under concurrent runners [tests/shared/crypto/master-key-loader.test.js:7-17] — deferred, sequential default safe
- [x] [Review][Defer] `.gitattributes` doesn't auto-renormalize pre-existing CRLF working trees [.gitattributes:4-5] — deferred, document `git add --renormalize` if a fresh-clone problem surfaces
- [x] [Review][Defer] hook bypassed via GitHub web UI / Desktop / `--no-verify` [.githooks/pre-commit:4] — deferred, inherent; second-layer GitHub scanning per README
- [x] [Review][Defer] coverage gap on extreme plaintext sizes in envelope tests [tests/shared/crypto/envelope.test.js] — deferred, code is correct; coverage gap only
- [x] [Review][Defer] hook does not fire on `git rebase --continue` / `cherry-pick` / `merge` [.githooks/pre-commit:4] — deferred, inherent git limitation; document in runbook
- [x] [Review][Defer] pathspec `:!*.md` exclusion is git-version-dependent [scripts/check-no-secrets.sh:42] — deferred, modern git is fine
- [x] [Review][Defer] back-port the two regex transcription-bug fixes (F4.2, F4.3) to source distillate [_bmad-output/planning-artifacts/epics-distillate/01-epics-1-3-foundation-tenancy-mirakl.md AC#4] — deferred, housekeeping outside this commit
- [x] [Review][Defer] worker boot has no SIGTERM handler; masterKey not zeroed on shutdown [worker/src/index.js:27] — deferred, Story 1.1 already-deferred shutdown story owns

**Dismissed as noise (5):**

- Blind Hunter: pre-commit hook pathspec from subdirectory — git invokes hooks from worktree root, not user cwd; non-issue
- Blind Hunter: missing INSERT/UPDATE/DELETE RLS policies and "future-date" filename — writes go via service-role-bypass per spec; today is 2026-05-01 so the timestamp is current, not future
- Blind Hunter: tampered-ciphertext test only checks `instanceof` — actual test file at `tests/shared/crypto/envelope.test.js:31,41` does check `err.code === 'KEY_VAULT_DECRYPT_FAILED'`
- Blind Hunter: `^\+\+\+` filter excludes `++X` content — false positive; the regex requires three leading `+`, lines starting `++X` are correctly preserved and scanned
- Blind Hunter: `.gitattributes` only fixes `.sh` and `.githooks/*` — covered by `.githooks/* text eol=lf` directory rule


