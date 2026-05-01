# Master-Key Rotation Runbook (AD3)

> **Cadence:** Annual ceremony (calendar event), or on-incident if compromise suspected.
> **Executor:** Pedro (founder operational track per `_bmad-output/planning-artifacts/epics-distillate/_index.md` "Master-key rotation ceremony").
> **Duration:** ~30 minutes for ≤10 customers; scales linearly with vault row count.
> **Helper modules:** `shared/crypto/envelope.js`, `shared/crypto/master-key-loader.js`.

## Why we rotate

The master key encrypts every customer's Mirakl `shop_api_key` at rest (AD3 envelope encryption, AES-256-GCM). NFR-S1 commits to "all customer Mirakl shop API keys encrypted at rest using KMS-managed key". Annual rotation limits the blast radius of a hypothetical key compromise: even if last year's key leaked unnoticed, this year's vault rows are unrecoverable with it.

## Prerequisites

- Coolify access (env-var management for repricer-worker service)
- 1Password vault access (cold backup of master keys)
- `openssl` available (Pedro's local machine OR Coolify shell)
- `npx supabase db connect` working (Pedro's machine), or direct `psql` against `SUPABASE_SERVICE_ROLE_DATABASE_URL`
- Worker is healthy (heartbeat current); no in-flight engine cycles for the customers being re-encrypted

## The 5-step procedure

### Step 1 — Generate the new master key

```sh
openssl rand -base64 32
# 44-character base64 string; copy to clipboard (do NOT paste into terminal history)
```

Verify locally that the new value decodes to exactly 32 bytes:

```sh
node -e "console.log(Buffer.from(process.argv[1],'base64').length)" "<paste-new-value>"
# must print: 32
```

### Step 2 — Deploy the new key alongside the existing one

In Coolify → repricer-worker → Environment Variables: **add** `MASTER_KEY_BASE64_NEXT=<new-value>` WITHOUT removing the existing `MASTER_KEY_BASE64`. Restart the worker. Both keys are now in process memory simultaneously — the worker can decrypt with the old key and encrypt with the new key.

> Note: at the time of writing (Story 1.2), the worker only loads `MASTER_KEY_BASE64`. Adding the `_NEXT` variable + dual-key decode path is part of the rotation script Pedro authors at rotation time (a one-off `scripts/rotate-master-key.js` consuming `shared/crypto/envelope.js`). The runbook documents the procedural steps; the rotation-time script is intentionally not pre-built (single-customer MVP doesn't need it yet).

### Step 3 — Re-encrypt every vault row

Each row gets re-encrypted under a per-row Postgres advisory lock keyed on `customer_marketplace_id`, so an in-flight engine cycle for that customer cannot read a half-rotated row. Bumps `master_key_version` from 1 → 2 (or current → current+1).

Pseudocode (Pedro writes a one-off script invoking `shared/crypto/envelope.js`):

```js
import { encryptShopApiKey, decryptShopApiKey } from '../shared/crypto/envelope.js';
// for each vault row:
//   pg_try_advisory_lock(hashtext(customer_marketplace_id::text)::bigint)
//   plaintext = decryptShopApiKey({ ciphertext, nonce, authTag, masterKey: OLD })
//   encrypted = encryptShopApiKey(plaintext, NEW)
//   UPDATE shop_api_key_vault
//     SET ciphertext=$1, nonce=$2, auth_tag=$3, master_key_version=<new>, updated_at=NOW()
//     WHERE customer_marketplace_id=$4
//   pg_advisory_unlock(hashtext(customer_marketplace_id::text)::bigint)
```

> Note on the lock key: Postgres advisory locks accept `bigint`; uuid has no
> direct cast to bigint. `hashtext(uuid::text)::bigint` produces a stable
> 32-bit hash widened to 64-bit. Hash collisions across customers are
> tolerable for a per-row rotation lock — the rotation script processes one
> row at a time, so a colliding lock just serializes two rows that wouldn't
> have run concurrently anyway. If stricter isolation is ever required, use
> `pg_try_advisory_xact_lock` inside an explicit transaction per row.

Verify completeness:

```sql
SELECT COUNT(*) FROM shop_api_key_vault WHERE master_key_version < <new>;
-- must return 0 when re-encryption is complete
```

### Step 4 — Coolify env-var swap

In Coolify: **delete** the old `MASTER_KEY_BASE64`, then **rename** `MASTER_KEY_BASE64_NEXT` → `MASTER_KEY_BASE64`. Restart the worker. Now only the new key is in process memory; the worker's `loadMasterKey()` (in `shared/crypto/master-key-loader.js`) picks up the new value.

### Step 5 — Update 1Password backup

Replace the old master-key entry in 1Password with the new value. Confirm the old value is no longer recoverable from any clipboard / shell history / Coolify logs.

## Post-rotation verification

- [ ] `SELECT MAX(master_key_version) FROM shop_api_key_vault` returns the new version (e.g., 2)
- [ ] `SELECT COUNT(*) FROM shop_api_key_vault WHERE master_key_version < <new>` returns 0
- [ ] Worker decrypts a vault row successfully (manual smoke test against one customer's heartbeat / scan job)
- [ ] No `KEY_VAULT_DECRYPT_FAILED` errors in logs in the hour following rotation

## Rollback

If Step 3 fails partway through:

- The advisory lock pattern means in-flight per-row re-encryption is atomic (commit or rollback per row); a partial run leaves some rows at the old version, some at the new.
- Both `MASTER_KEY_BASE64` and `MASTER_KEY_BASE64_NEXT` are still in Coolify env at this point — re-run Step 3 to finish the remaining rows.
- Do **NOT** proceed to Step 4 until Step 3 completes (would orphan rows still encrypted under the old key).

If a customer reports a key-vault decrypt failure post-rotation:

- Inspect that row's `master_key_version` — if behind, the rotation script missed it; re-run Step 3 scoped to that `customer_marketplace_id`.
- If at the new version but still failing, restore the old master key value from 1Password back into Coolify as `MASTER_KEY_BASE64_RECOVER`, decrypt with that, re-encrypt with the current key. Then remove the recovery variable.
