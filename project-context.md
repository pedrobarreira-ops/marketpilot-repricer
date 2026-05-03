# Project Context — marketpilot-repricer

> This file is loaded automatically by `bmad-create-story` (Bob), `bmad-dev-story` (Amelia), and `bmad-code-review` (CR adversarial layers). It encodes rules every BAD subagent must follow plus lookup tables so subagents don't re-derive from the distillates on every invocation.
>
> **Conflict rule:** If a rule below contradicts the architecture distillate or PRD distillate, the **distillate wins** — flag the conflict to Pedro before proceeding. This file is denormalized lookup, not the source of truth.

---

## How to Load Context

Every BAD subagent invocation loads:

1. **This file** (`project-context.md`) — rules + lookups
2. **`CLAUDE.md`** — project state + distillate loading pattern
3. **Distillates per task scope** (see below)

### Distillate selective-loading pattern

| Task | Load |
|------|------|
| Story sharding (Bob) — any story | `architecture-distillate/_index.md` + `epics-distillate/_index.md` + relevant epics section |
| Story 1.x sharding | + `architecture-distillate/01-context-and-scaffold.md` |
| Story touching Mirakl client | + `architecture-distillate/02-decisions-A-D.md` (AD5–AD14) |
| Story touching cron / state machine | + `architecture-distillate/02-decisions-A-D.md` (AD15–AD18) |
| Story touching audit log | + `architecture-distillate/02-decisions-A-D.md` (AD19–AD20) |
| Story touching billing / Stripe / deletion | + `architecture-distillate/03-decisions-E-J.md` (AD21–AD22) |
| Story touching ops / health / failure model | + `architecture-distillate/03-decisions-E-J.md` (AD23–AD27) |
| Schema migration story | + `architecture-distillate/06-database-schema.md` |
| UI / Pattern A/B/C surface story | + `architecture-distillate/09-visual-design-asset-class.md` |
| Sharding 9.0 or 9.1 (calendar-early) | + `epics-distillate/06-epics-9-10-audit-deletion.md` (NOT chronological order — see Calendar-Early below) |
| Implementation (Amelia) | story file completely; arch sections cited in story's Bob-trace |
| Code review architecture-compliance | `architecture-distillate/_index.md` — 27-constraint negative-assertion list is the primary checklist |

**Never load all 9 architecture sections + all 7 epics sections at once.** Defeats selective-loading.

---

## MCP Usage Rules

Three MCPs are wired into Claude Code. Each has a specific role and a conflict-resolution rule.

### 🔴 Mirakl MCP — Authoritative for all Mirakl API behavior

- **Always check Mirakl MCP first** before assuming any endpoint, field name, pagination, error code, rate limit, or response shape.
- **Never guess from training data** for Mirakl specifics.
- Cite MCP response in `Dev Agent Record` when locking a Mirakl-touching decision.
- Applies to **every story** touching `shared/mirakl/*`, `worker/src/engine/*`, or any P11 / PRI01 / PRI02 / PRI03 / A01 / PC01 / OF21 call.
- Mandate from CLAUDE.md applies to Bob, Amelia, CR, and any subagent.

### 🟡 Context7 MCP — Library reference docs

- **Use for**: Fastify v5, pino, eta, node-cron, `@fastify/static`, `@fastify/formbody`, `@supabase/supabase-js`, Stripe Node SDK, Node `crypto` API, ESLint v9 flat config, `pg` (worker context), `@fastify/cookie`, `@fastify/csrf-protection`.
- **Do NOT use for**: Mirakl (Mirakl MCP is authoritative — Context7 has no Mirakl content anyway), architectural decisions (ADs win), business logic, refactoring suggestions.
- **Translation rule**: Context7 returns **CommonJS examples** (`require('fastify')`). Project is **JS-ESM** (Step 3 lock — no TypeScript at MVP). When applying Context7 examples, auto-translate `require(...)` → `import ... from '...'`.
- **Conflict rule**: If Context7 disagrees with a locked AD or amendment, the **AD/amendment wins**. Do not "improve" architecture based on a Context7 snippet.
- Two tools: `resolve-library-id` (find Context7 ID) → `query-docs` (fetch docs by ID + query). Always resolve first unless user provides ID directly.

### 🟡 Supabase MCP — Project introspection, NOT migration management

- **Org-scoped** due to a Claude Code OAuth bug with query-string URLs. **Tool calls MUST pass `project_id` explicitly** every time.
- Project ID for `marketpilot-repricer`: **`ttqwrbtnwtyeehynzubw`**
- Region: `eu-west-3` (Paris). Postgres engine 17. Status: `ACTIVE_HEALTHY`.
- Automatic RLS event trigger (`ensure_rls`) is **enabled** on this project — every new table in `public` schema gets RLS auto-enabled at CREATE.

**✅ Read-only verification (encouraged):**
- `list_tables`, `list_migrations`, `list_extensions`, `list_branches`
- `execute_sql` with **SELECT only** (verification, RLS-policy probes, debugging)
- `get_logs`, `get_advisors`, `get_project`, `get_project_url`, `get_publishable_keys`
- `search_docs`

**🔴 Forbidden — `apply_migration`:**
- Migrations land via `npx supabase migration new <name>` + git-tracked SQL files only.
- Step 5 architecture lock: *"append-only SQL managed by Supabase CLI; never edit a migration after applied to any environment."*
- MCP `apply_migration` bypasses git history and corrupts the migration trail. **Refuse** if any subagent or skill tries to use it.

**⚠️ Restricted `execute_sql` mutations:**
- INSERT/UPDATE/DELETE only allowed for test-data setup or Pedro-authorized ad-hoc fixes.
- Any production-shape mutation via MCP is a code review red flag — flag in CR.

**🔴 Forbidden destructive ops:**
- `delete_branch`, `pause_project`, `restore_project`, `create_project`, `merge_branch`, `rebase_branch`, `reset_branch`
- Solo-founder operations only — require explicit Pedro authorization in conversation before invoking.

**Useful patterns:**
- Verify migration applied: `list_migrations` filtered by version
- Verify RLS policy works: `execute_sql` SELECT as anon role with cross-tenant probe
- Inspect schema state: `list_tables` + `execute_sql` on `information_schema`
- Debug deployment: `get_logs` with appropriate service filter

---

## 27 Architectural Constraints (Negative-Assertion List)

> **Primary CR architecture-compliance audit checklist.** Every PR must pass this list. Violations are flagged at code review.
>
> ~11 of the 27 are enforced by custom ESLint rules that ship WITH their target SSoT modules. Until the rule lands, the constraint is review-enforced. Sprint sequencing makes the ramp-up explicit.

1. **No Mirakl webhook listener** in codebase (AD18). Story 1.1 negative assertion (grep `package.json` + source). Seller-side webhooks unavailable per MCP — polling-only mandatory.
2. **No external validator library** — Fastify built-in JSON Schema only (AD28). Story 1.1 negative assertion (no `zod`, `yup`, `joi`, `ajv` in `package.json`).
3. **No SPA framework** — Story 1.1 negative assertion (no `react`, `vue`, `svelte`, `angular`, `solid-js`).
4. **No bundler** — Story 1.1 negative assertion (no `vite`, `webpack`, `rollup`, `esbuild`, `parcel`). Coolify runs `node app/src/server.js` directly. Per-page `<script src="/js/<page>.js" defer>` per F9.
5. **No TypeScript at MVP** — Story 1.1 negative assertion (no `typescript`, `ts-node`). JS-ESM with JSDoc only. `*.js → *.ts` rename trivial later.
6. **OF24 forbidden for price updates** (CLAUDE.md mandate). Story 6.1 PRI01 writer is SSoT path. ESLint `no-raw-CSV-building` flags any parallel writer. Grep verifies no `POST /api/offers` price calls. OF24 resets ALL unspecified offer fields to defaults — confirmed footgun.
7. **No customer-facing API at MVP** (PRD Journey 5 N/A through Phase 2). Story 1.1 negative assertion (no `/api/v1/...` routes). Stripe webhook is the only JSON-accepting route.
8. **No Redis / BullMQ / external queue** — Story 1.1 negative assertion (no `redis`, `ioredis`, `bullmq`, `bull`). `pri01_staging` table + Postgres advisory locks are the queue equivalent.
9. **No CDN in front of public/** — Story 1.1 deployment topology (`@fastify/static` serves directly). Phase 2 trigger if dashboard latency becomes customer-visible.
10. **No ES UI translation at MVP** (NFR-L2). Story 1.1 negative assertion (no `i18n` infrastructure, no ES translation files). Stories 4.x onboarding + 8.x dashboard are PT-only.
11. **No worker connection pooler beyond `pg`'s built-in** — Story 1.1 negative assertion (no `pgbouncer`-as-deployed, no `supavisor` config). At MVP scale `pg` Pool with `max: 5` is sufficient.
12. **No mobile-optimized surfaces beyond critical-alert response** (UX-DR25-27). Story 8.12 ships only the mobile critical-alert response surface. Stories 8.1-8.11 target ≥1280px primary.
13. **No customer impersonation by founder** (AD4 + UX-DR28-30). `/admin/status` is read-only; `/audit?as_admin={customer_id}` reuses customer-side audit log via service-role bypass with red admin-mode banner. Founder NEVER logs in as the customer.
14. **No FK constraint on `audit_log.sku_id` and `sku_channel_id`** (F8). Story 9.1 inline schema comment. Preserves audit history if a SKU is later removed; immutability per NFR-S6 trumps referential integrity.
15. **No `moloni_invoices` CASCADE on customer deletion** — Story 11.5 schema (`ON DELETE NO ACTION`). Fiscal record per AD22 / Portuguese statutory retention.
16. **No team-membership table at MVP** (FR2 negative assertion). Story 1.4 — schema does NOT include `customer_team_members` or equivalent. Single-login-per-customer-account at MVP; multi-user RBAC = Phase 2.
17. **No fiscal-evidence exception in audit_log retention** (Pedro's clarification). Zero `audit_log` rows retained on T+7d hard-delete. Fiscal evidence lives in `moloni_invoices` (separate table, separate retention).
18. **No `console.log` in production code** — Story 1.1 ESLint `no-console` rule + Story 1.2 secret-scanning hook. All output via `pino` per AD27.
19. **No direct `fetch` outside `shared/mirakl/`** — Story 3.1 custom ESLint rule `no-direct-fetch`.
20. **No raw CSV building outside `shared/mirakl/pri01-writer.js`** — Story 6.1 custom ESLint rule `no-raw-CSV-building`.
21. **No raw `INSERT INTO audit_log` outside `shared/audit/writer.js`** — Story 9.0 custom ESLint rule `no-raw-INSERT-audit-log`.
22. **No float-price math outside `shared/money/index.js`** — Story 7.1 custom ESLint rule `no-float-price`. Integer-cents discipline.
23. **No raw `UPDATE customer_marketplaces SET cron_state` outside `shared/state/cron-state.js`** — Story 4.1 custom ESLint rule.
24. **No worker query missing `customer_marketplace_id` filter** (RLS bypassed in worker) — Story 5.1 custom ESLint rule `worker-must-filter-by-customer`. Cross-customer queries require `// safe: cross-customer cron` comment to suppress.
25. **No refurbished products on Worten** — Architecture explicitly out of scope. Worten has no shared EAN catalog for seller-created refurbished listings; engine would tier-classify them T3 forever.
26. **No multi-marketplace beyond Worten at MVP** — Story 11.4 concierge-add limited to `operator='WORTEN'`. `marketplace_operator` enum has only `'WORTEN'` value at MVP.
27. **No self-serve "Add Marketplace" UI** (FR41 MVP) — Story 8.11 `/settings/marketplaces` shows read-only list with concierge tooltip. No form/wizard. Phase 2 trigger ships self-serve add/remove with Stripe proration UI.

---

## 11 Single-Source-of-Truth Modules (with custom ESLint rules)

> Each concern has exactly one path. Subagents extending behavior modify the existing module — never create a parallel implementation. Custom ESLint rule attaches to the target module's protected concern.

| # | Module | Function(s) | AD | Built by | Custom ESLint rule |
|---|--------|-------------|----|----------|---------------------|
| 1 | `shared/mirakl/api-client.js` | `mirAklGet`, `MiraklApiError` | AD5 | Story 3.1 | `no-direct-fetch` (no `fetch(` outside this module) |
| 2 | `shared/mirakl/pri01-writer.js` | `buildPri01Csv`, `submitPriceImport`, `markStagingPending` | AD7 | Story 6.1 | `no-raw-CSV-building` |
| 3 | `shared/mirakl/pri02-poller.js` | `pollImportStatus` | AD7 | Story 6.2 | — |
| 4 | `shared/mirakl/pri03-parser.js` | `parseErrorReport` | AD24 | Story 6.3 | — |
| 5 | `shared/audit/writer.js` | `writeAuditEvent` | AD20 | Story 9.0 | `no-raw-INSERT-audit-log` |
| 6 | `shared/state/cron-state.js` | `transitionCronState` | AD15 | Story 4.1 | flags raw `UPDATE customer_marketplaces SET cron_state` outside |
| 7 | `shared/state/sku-freeze.js` | `freezeSkuForReview`, `unfreezeSku` | AD12 | Story 7.4 | — |
| 8 | `worker/src/engine/decide.js` | `decideForSkuChannel` | AD8 | Story 7.2 | — |
| 9 | `shared/crypto/envelope.js` | `encryptShopApiKey`, `decryptShopApiKey` | AD3 | Story 1.2 | — (decryption only in worker context) |
| 10 | `shared/mirakl/self-filter.js` | `filterCompetitorOffers` | AD13 + AD14 | Story 3.2 | — |
| 11 | `shared/money/index.js` | `toCents`, `fromCents`, `roundFloorCents`, `roundCeilingCents`, `formatEur` | money discipline | Story 7.1 | `no-float-price` |

**+1 worker-level rule:** `worker-must-filter-by-customer` (Story 5.1) — every worker query that uses service-role client (RLS bypassed) must include `.eq('customer_marketplace_id', ...)` OR carry an explicit `// safe: cross-customer cron` comment opt-out.

**Wider SSoT module index** (~30 modules across all stories) lives in `epics-distillate/_index.md` "Cross-Cutting: SSoT Modules Index" section. The 11 above are the architectural-priority modules with custom ESLint enforcement.

---

## 3 Atomicity Bundles

### Bundle A — auth+profile creation (F3 + AD29)

- Single Postgres transaction kicked off by Supabase `auth.signUp({ options: { data: {...} } })`
- Trigger `handle_new_auth_user` on `auth.users` AFTER INSERT (`SECURITY DEFINER`)
- Validates `first_name`, `last_name`, `company_name` from `raw_user_meta_data` JSONB
- INSERTs `customers` + `customer_profiles` rows
- `RAISE EXCEPTION` on missing/empty rolls back ENTIRE auth.users INSERT (no orphan auth-without-profile state representable)
- HINT codes `PROFILE_FIRST_NAME_REQUIRED` / `PROFILE_LAST_NAME_REQUIRED` / `PROFILE_COMPANY_NAME_REQUIRED` mapped to PT-localized field errors
- **Lands as single PR**: Story 1.4 (trigger + signup endpoint + JSON Schema validation + safe-error mapping + source-context capture)

### Bundle B — state transition + audit emission (Step 5 pattern lock, AD15 + AD20)

- `transitionCronState({ tx, customerMarketplaceId, from, to, context })` performs `UPDATE ... WHERE cron_state = $from` (optimistic concurrency: 0 rows → `ConcurrentTransitionError`) AND calls `writeAuditEvent({ tx, ..., eventType, ... })` in **same transaction**
- Legal-transitions matrix in `shared/state/transitions-matrix.js` defines all 7 valid transitions as JS object literal
- Rejects illegal transitions (e.g., `'PAUSED_BY_CIRCUIT_BREAKER' → 'PAUSED_BY_CUSTOMER'` would skip manual unblock)
- Identical pattern for `freezeSkuForReview` (AD12 — atomic with audit emission, orthogonal to `cron_state`)
- `writeAuditEvent` may accept `eventType: null` for non-engine state changes (Story 10.1 deletion-grace transition uses this — see Note 18 below)
- **Pattern enforced across**: Stories 4.2, 8.1, 10.1, 11.5, 12.1, plus all subsequent state-transition emitters

### Bundle C — PRI01 atomic emission across all participating sku_channel rows (AD7)

- When PRI01 batch submitted, **EVERY** `sku_channel` row participating in batch (including channels whose price isn't changing — they appear as passthrough lines per delete-and-replace semantic) gets `pending_import_id = <import_uuid>` set in single transaction
- PRI02 COMPLETE clears `pending_import_id` for all rows in batch atomically
- PRI02 FAILED clears `pending_import_id` AND triggers per-SKU error handling per AD24
- Cooperative-absorption (AD9) skip-on-pending predicate depends on this atomicity to function correctly during in-flight imports
- **Bundle C gate at Story 7.8**: integration test asserts that for any in-flight PRI01 batch, ALL participating sku_channel rows have non-NULL `pending_import_id` matching same `import_uuid` (zero-tolerance for partial-set state)
- **Story 7.8 ships the gate test** — merging earlier engine/writer stories (5.1, 5.2, 6.1, 6.2, 6.3, 7.2, 7.3, 7.6) without Story 7.8 leaves Bundle C **unverified and unsafe to ship to production**

---

## Calendar-Early Sequencing

**Stories 9.0 + 9.1 ship between Epic 2 and Epic 3 — NOT in Epic 9 timeline.**

Reason: audit-log infrastructure (event_types lookup, partitioned `audit_log` table, priority-derivation trigger, `writeAuditEvent` SSoT, `no-raw-INSERT-audit-log` ESLint rule, monthly partition cron) is needed before Epic 3+ events fire. Epics 5, 7, 10, 11, 12 all emit audit events; the foundation must exist when those epics ship.

Sprint-status.yaml reflects this; the markers `[CALENDAR-EARLY — Story 1.x sibling]` annotate Stories 9.0 and 9.1 in their epics-distillate definitions.

**Story 5.1 retrofit pragma for Story 9.1 cron**: Story 9.1's `worker/src/jobs/monthly-partition-create.js` cron uses Story 5.1 cron dispatcher with the literal `// safe: cross-customer cron` comment opt-out from the `worker-must-filter-by-customer` ESLint rule. This is preserved verbatim on Story 5.1 AND cross-referenced on Story 9.1.

**Loading consequence**: when Bob shards Story 9.0 or 9.1, load `epics-distillate/06-epics-9-10-audit-deletion.md` (where the story bodies live) — calendar-early refers to *shipping order*, not *file location*.

---

## Pattern A / B / C — UI Surface Visual Contracts

Every UI-bearing story acceptance criterion cites three pointers: **Behavior** (PRD FR/NFR by number), **Structure** (UX skeleton § by number), **Visual** (design-references stub filename or fallback statement).

| Pattern | Surfaces | Visual contract | Example surfaces |
|---------|----------|-----------------|-------------------|
| **A — Stubbed UI** | 17 (fan out to 27 rows due to multi-state surfaces) | `_bmad-output/design-references/screens/<NN>-<name>.html` stub filename | Dashboard states (9 variants), audit log surfaces (3), modals, onboarding scan-ready, etc. |
| **B — Skeleton + visual fallback** | 2 | UX skeleton § + named visual fallback (e.g., `bundle/project/MarketPilot.html` ProgressScreen) | `/onboarding/scan` (FR12-FR14) + `/onboarding/margin` (FR16) |
| **C — Skeleton + Supabase chrome / DNA tokens** | 10 | UX skeleton § + visual-DNA tokens (Manrope/Inter, navy primary, radius scale) + consistent chrome | 5 auth screens, 5 settings pages |

**Total: 17 + 2 + 10 = 29 distinct surfaces.** Pattern A's 17 surfaces fan out to 27 table rows because dashboard root has 9 state-variants and audit log has 3 — each gets its own visual reference.

**Sharding rule**: Story whose AC needs a visual fallback statement (Pattern B/C) reads `architecture-distillate/09-visual-design-asset-class.md` for the locked contract.

---

## AD20 — 28-Event Audit Taxonomy

> Lookup table for `audit_log.event_type` + `audit_log.priority`. Schema enforces via `audit_log_event_types` lookup table (F5) + BEFORE-INSERT trigger `audit_log_set_priority` (denormalizes priority from event_type). Story 9.0 seeds 26 base rows; Stories 12.1 + 12.3 each ALTER-INSERT one row → 28 at end of MVP.

### Atenção (9): always shown in FR38b surface 2 "A precisar de atenção"

Base seed (Story 9.0):
1. `anomaly-freeze` — >40% external deviation per AD12
2. `circuit-breaker-trip` — per-cycle 20% halt per AD11
3. `circuit-breaker-per-sku-trip` — per-SKU 15% halt per AD11
4. `key-validation-fail` — mid-life Worten 401 per AD15 PAUSED_BY_KEY_REVOKED flow
5. `pri01-fail-persistent` — 3 consecutive cycles failing for same SKU per AD24
6. `payment-failure-pause` — Stripe final dunning failure per AD22
7. `shop-name-collision-detected` — multiple offers match own shop_name per AD13

Epic 12 additions:
8. `cycle-fail-sustained` (Story 12.1) — 3 consecutive cycles failing to reach Mirakl for same customer per AD24
9. `platform-features-changed` (Story 12.3) — monthly PC01 re-pull detects operator config drift per AD26

### Notável (8): capped feed in FR38b surface 3 "Eventos notáveis"

1. `external-change-absorbed` — cooperative-ERP-sync absorption per AD9
2. `position-won` — SKU transitioned to position 1
3. `position-lost` — SKU transitioned out of position 1
4. `new-competitor-entered` — Tier 3 → Tier 1/2a transition
5. `large-price-move-within-tolerance` — large legitimate move
6. `customer-paused` — FR32 pause clicked
7. `customer-resumed` — FR32 resume clicked
8. `scan-complete-with-issues` — onboarding scan completed with non-fatal issues

### Rotina (11): hidden by default, visible only via firehose filter per FR38c

1. `undercut-decision`
2. `ceiling-raise-decision`
3. `hold-floor-bound`
4. `hold-ceiling-bound`
5. `hold-already-in-1st`
6. `cycle-start`
7. `cycle-end`
8. `pri01-submit`
9. `pri02-complete`
10. `pri02-failed-transient`
11. `tier-transition`

**Test-count assertion canonical pattern**: Story 9.0 integration tests MUST assert `EVENT_TYPES.length === <expected>` (NOT hardcoded 26 or 28). `EVENT_TYPES` constant in `shared/audit/event-types.js` is single source of truth. Stories 12.1 + 12.3 each extend constant in same PR adding lookup-table seed row.

---

## Enum Quick Reference

### `cron_state` (8 values, UPPER_SNAKE_CASE per F13)

```
PROVISIONING                  -- F4: row exists, scan running, A01/PC01 NULL until populated
DRY_RUN                       -- scan complete; engine simulates; no PRI01
ACTIVE                        -- live cron running
PAUSED_BY_CUSTOMER            -- FR32
PAUSED_BY_PAYMENT_FAILURE     -- FR43 (Stripe sub auto-cancelled)
PAUSED_BY_CIRCUIT_BREAKER     -- FR27 (cycle halted, awaiting manual unblock)
PAUSED_BY_KEY_REVOKED         -- UX skeleton §8.1 (Worten 401 detected)
PAUSED_BY_ACCOUNT_GRACE_PERIOD -- FR4 amended (deletion initiated, 7-day grace)
```

Dispatcher predicate: `WHERE cron_state = 'ACTIVE' AND last_checked_at + (tier_cadence_minutes * INTERVAL '1 minute') < NOW()` — clean predicate, no NOT clauses.

### `channel_pricing_mode` (3 values)

```
SINGLE       -- Worten value [Empirical: PC01]; engine writes one price per (SKU, channel)
MULTI        -- tiered pricing; unused at MVP
DISABLED     -- one price per SKU; channel dimension collapses; routed to different code path
```

### `tier_value` (4 values)

```
'1'    -- contested, position > 1; cadence 15 min
'2a'   -- winning, position = 1, last_won_at < 4h ago; cadence 15 min (active-repricer protection)
'2b'   -- stable winner, position = 1, last_won_at >= 4h ago; cadence 45 min (locked default)
'3'    -- no competitors; cadence 1440 (daily, doubles as nightly reconciliation per FR28)
```

### `scan_job_status` (9 values)

```
PENDING / RUNNING_A01 / RUNNING_PC01 / RUNNING_OF21 / RUNNING_P11
CLASSIFYING_TIERS / SNAPSHOTTING_BASELINE / COMPLETE / FAILED
```

### `audit_log_priority` (3 values)

```
atencao | notavel | rotina   -- denormalized from audit_log_event_types via BEFORE-INSERT trigger
```

---

## 17 P11 Fixtures (Executable Spec for AD8)

> NOT optional — every engine story references fixtures by filename in story acceptance criteria. Mirakl mock server (`tests/mocks/mirakl-server.js`, Story 3.2) seeds from `verification-results.json` (live Worten captures 2026-04-30). Replacing seed with synthetic data weakens dogfood-validation chain.

| Fixture filename | Consumed by |
|---|---|
| `p11-tier1-undercut-succeeds.json` | Story 7.2, 7.8 |
| `p11-tier1-floor-bound-hold.json` | Story 7.2, 7.8 |
| `p11-tier1-tie-with-competitor-hold.json` | Story 7.2, 7.8 |
| `p11-tier2a-recently-won-stays-watched.json` | Story 7.5, 7.8 |
| `p11-tier2b-ceiling-raise-headroom.json` | Story 7.2, 7.8 |
| `p11-tier3-no-competitors.json` | Story 7.5, 7.8 |
| `p11-tier3-then-new-competitor.json` | Story 7.5, 7.8 |
| `p11-all-competitors-below-floor.json` | Story 7.2, 7.8 |
| `p11-all-competitors-above-ceiling.json` | Story 7.2, 7.8 |
| `p11-self-active-in-p11.json` | Story 7.2, 7.8 |
| `p11-self-marked-inactive-but-returned.json` | Story 7.2, 7.8 |
| `p11-single-competitor-is-self.json` | Story 7.2, 7.8 |
| `p11-zero-price-placeholder-mixed-in.json` | Story 7.2, 7.8 |
| `p11-shop-name-collision.json` | Story 7.2, 7.8 |
| `p11-pri01-pending-skip.json` | Story 7.2, 7.8 |
| `p11-cooperative-absorption-within-threshold.json` | Story 7.3, 7.8 |
| `p11-cooperative-absorption-anomaly-freeze.json` | Story 7.4, 7.8 |

**Story 7.8 integration gate consumes ALL 17 fixtures.** Bundle C invariant verified there.

---

## 16 Empirically-Verified Mirakl Facts (do NOT re-question)

> Verified live against Worten via Gabriel's Easy-Store account, 2026-04-30. Captured in `verification-results.json` (gitignored). Subagents must NOT propose architectural changes that conflict with these.

1. `shop_id` is `null` in P11 competitor offers across all 30 returned offers in 3 verification calls — `shop_name` is the only reliable self-identification key (AD13)
2. P11 placeholder offers with `total_price = 0` returned in production (Strawberrynet at rank 0 in PT and ES P11 calls); engine MUST filter `o.total_price > 0` (AD14 mandatory filter chain)
3. Worten `channel_pricing` is `SINGLE` (PC01) — engine writes one price per (SKU, channel); `MULTI`'s tiered pricing capability unused at MVP (AD6)
4. Worten `operator_csv_delimiter` is `SEMICOLON` (PC01) — never hardcode `,` in PRI01 writer (AD7)
5. Worten `offer_prices_decimals` is `2` (PC01) — `customer_marketplace.offer_prices_decimals` reads live value
6. Worten `discount_period_required: false`, `scheduled_pricing: false`, `volume_pricing: false` (PC01) — PRI01 CSV column set is `offer-sku;price;channels` only at MVP
7. Worten `competitive_pricing_tool: true` (PC01) — affects free-report sales positioning; does NOT change engine spec
8. P11 batch lookup uses `product_references=EAN|xxx,EAN|yyy` NOT `product_ids` (silently returns 0 products if EANs passed there)
9. P11 default page size 10 offers; need only top 2 for repricing
10. Worten Mirakl auth header is raw `Authorization: <api_key>` — **NO `Bearer` prefix**
11. A01 returns `shop_id`, `shop_name`, `channels[]`, `currency_iso_code`, `state`, `is_professional`, `domains[]` — Easy-Store: `shop_id 19706`, `shop_name "Easy - Store"`
12. OF21 returns `shop_sku` as seller-provided SKU (e.g., `EZ8809606851663`), `offer_sku: null`, `product_sku` is Mirakl's internal UUID (NOT seller SKU); `shop_sku` is value to use in PRI01 `offer-sku` column
13. P11 per-channel pattern: `pricing_channel_code` AND `channel_codes` both set per call; channel bucketing determined by which call returned the offer (NOT by reading `offer.channel_code`)
14. Mirakl webhooks/Cloud Events available for Operator users only, NOT Seller users — polling-only architecture mandatory (AD18)
15. Channel codes `WRT_PT_ONLINE` / `WRT_ES_ONLINE` confirmed in production (DynamicPriceIdea scanCompetitors.js)
16. Retry schedule: 5 retries, exponential backoff `[1s, 2s, 4s, 8s, 16s]`; retryable on 429 + 5xx + transport errors; non-retryable on 4xx (except 429); max attempt cap 30s per delay

EAN resolution (3-strategy in DynamicPriceIdea): `product.product_references` EAN entry → `product.product_sku` → single-EAN-batch fallback.

---

## Library Empirical Contracts + Operational Patterns

> Discovered during foundation-story implementation (Stories 1.1-1.4). These are **load-bearing rules** that override what library docs / spec text might suggest. Every BAD subagent must respect these or trigger silent failures.

### 1. GoTrue strips Postgres HINT codes from `auth.signUp` errors

Trigger-raised `RAISE EXCEPTION ... USING HINT = 'SOMETHING'` does NOT propagate the HINT through Supabase Auth to the client. Empirical contract (Supabase Auth ≥ 2.x, verified 2026-05-02): `error.message = "Database error saving new user"`, `error.code = "unexpected_failure"`. **The HINT is stripped before reaching `@supabase/auth-js`.**

**Pattern**: any story relying on a trigger HINT for user-facing field errors MUST mirror the trigger's validation at the route level. The trigger remains as defense-in-depth; the user-facing field error is produced by the route's pre-validation. Story 1.4's `signup.js` is the canonical example — `length(trim(...)) = 0` check before calling `auth.signUp`, returning PT-localized `fieldErrors` to the form template.

**Failure mode if violated**: customer sees generic catch-all error message instead of field-specific guidance. Atomicity invariant still holds (trigger rolls back), but UX regression.

### 2. `@fastify/cookie` v11+ does NOT auto-unwrap signed cookies

`request.cookies[name]` returns the raw `s:<value>.<signature>` string for signed cookies. To verify and extract the original value: `const { valid, value } = request.unsignCookie(raw)`.

**Pattern**: any code that reads a signed cookie MUST use `request.unsignCookie()` explicitly. Comments like "auto-unwraps if valid" are wrong — the library does not do this. The `request.cookies[name] === false` for tampered-cookie pattern (sometimes documented online) is also wrong.

Affects: Story 1.4 `mp_source_ctx` (fixed); Story 2.1 `mp_session` reader (apply this pattern); Story 11.x Stripe webhook signed cookies if used (apply this pattern).

**Failure mode if violated**: `JSON.parse` falls through silently, returning nulls instead of the cookie's actual values. No error logged. Hard to debug without specifically testing the cookie roundtrip.

### 3. `pg` Pool against Supabase requires CA pinning

Supabase Postgres uses a custom CA. `pg` Pool's default SSL behavior does NOT trust it. Must explicitly load and pass the CA cert.

**Pattern** (canonical, copied from `app/src/routes/health.js` and `worker/src/jobs/heartbeat.js`):

```js
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
const { Pool } = pg;

const caCert = fs.readFileSync(path.resolve('supabase/prod-ca-2021.crt'), 'utf8');

const pool = new Pool({
  connectionString: process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL,
  ssl: { ca: caCert },
  max: <appropriate>,
});
```

NEVER `ssl: { rejectUnauthorized: false }` (insecure — accepts forged certs). NEVER skip SSL config (Supabase requires SSL; connection fails). The CA cert is at `supabase/prod-ca-2021.crt` (committed — public CA).

Affects: every `pg` Pool instantiation. Story 1.1's `health.js` + `heartbeat.js` (done); Story 2.1's `shared/db/service-role-client.js` SSoT module (apply this pattern); every future worker-side query path.

### 4. Migration forward-FK deferral pattern

When a story's migration references a forward-FK target from a future story (e.g., Story 1.2's vault → Story 4.1's customer_marketplaces), the migration file is committed but NOT applied — neither locally nor to Cloud — until the target story ships.

**Pattern**: rename the migration file with `.deferred-until-story-X.Y` suffix. Supabase CLI ignores files without the `.sql` extension, so the file is committed (deliverable preserved) but excluded from `db push` / `db reset` / `start`.

**At the target story's sharding**: Bob's task list MUST include "rename `<filename>.sql.deferred-until-story-X.Y` back to `<filename>.sql`" + "run `npx supabase db push` to apply both this story's migration AND the unblocked deferred one."

Current instance: `supabase/migrations/202604301204_create_shop_api_key_vault.sql.deferred-until-story-4.1` — restore at Story 4.1 sharding.

**This rule does NOT violate migration immutability** — we're renaming for tooling exclusion, not editing content. Once restored at Story 4.1, the file content is unchanged from its original commit.

### 5. `auth.users` reset between integration tests: DELETE not TRUNCATE

`auth.refresh_tokens_id_seq` and other auth-schema sequences are owned by `supabase_auth_admin`, not the `postgres` connection user. `TRUNCATE auth.users CASCADE RESTART IDENTITY` fails with "must be owner of sequence."

**Pattern**: `DELETE FROM auth.users` — relies on Supabase-defined `ON DELETE CASCADE` chains (refresh_tokens, identities, sessions, our customers/customer_profiles). Works without sequence ownership.

Story 1.4's `tests/integration/_helpers/reset-auth-tables.js` is the canonical example.

### 6. Integration test readiness probe — don't poll `/health`

Per-feature integration tests typically spawn only the app (not the worker). `/health` requires `worker_heartbeats < 90s` freshness; without a worker, it always 503s.

**Pattern**: poll a route the test exercises anyway (e.g., `GET /` for the scaffold placeholder, or one of the routes under test). Story 1.1's `scaffold-smoke.test.js` is the exception — it spawns BOTH services intentionally to test `/health` composition.

### 7. Pino `base` REPLACES default `{pid, hostname}` (does NOT extend)

Setting `base: { service: 'app' }` in the pino config REPLACES the default base fields. Logs lose `pid` and `hostname` — breaking any log aggregation that filters by them, and making it impossible to distinguish app/worker output when both write to the same stream.

**Pattern**: when customizing `base`, explicitly include the defaults alongside any custom fields. Story 1.3's `shared/logger.js` is the canonical example:

```js
import os from 'node:os';

const logger = pino({
  base: {
    pid: process.pid,
    hostname: os.hostname(),
    service: 'app',  // or 'worker'
  },
  // ... rest of config
});
```

**Failure mode if violated**: structured logs lose pid/hostname; cannot correlate logs across worker restarts or distinguish processes.

### 8. `pg` ESM destructure: default-import then destructure

The `pg` package is published as CommonJS without an ESM-named-exports map. `import { Pool } from 'pg'` fails at module resolution.

**Pattern**: `import pg from 'pg'; const { Pool } = pg;` (or `Client`, `types` etc. as needed). Story 1.1's `health.js` + `heartbeat.js`, Story 1.5's `founder-admin-only.js`, Story 1.4's `reset-auth-tables.js` all follow this. Apply to Story 2.1's `shared/db/service-role-client.js` and every future `pg` consumer.

**Failure mode if violated**: `SyntaxError: The requested module 'pg' does not provide an export named 'Pool'` at boot. Hard fail, easy to spot — but blocks the process from starting.

### 9. Conditional SSL based on connection-string host (localhost vs Supabase Cloud)

Local Postgres test instances don't have SSL configured by default; Supabase Cloud requires SSL with CA pinning (per contract #3). Hard-coding `ssl: { ca: caCert }` breaks local tests; hard-coding `ssl: false` breaks Cloud. The two pool configurations must diverge based on the connection string's host.

**Pattern** (canonical — Story 2.1 will centralize this as a single helper to prevent cargo-culting across Epics 4+):

```js
function buildPgPoolConfig (connectionString, caCert) {
  const isLocal =
    connectionString.includes('localhost') ||
    connectionString.includes('127.0.0.1');
  return isLocal
    ? { connectionString, max: 2 }
    : { connectionString, ssl: { ca: caCert }, max: 2 };
}
```

Story 1.5's `founder-admin-only.js` deviated by inlining this logic per-pool (the SSL drift root cause). Story 2.1's `shared/db/service-role-client.js` MUST absorb the inline pools at `health.js`, `heartbeat.js`, `founder-admin-only.js` into the shared helper. Without centralization, every future `pg.Pool` site re-implements the host detection and drift continues.

**Failure mode if violated**: tests fail locally with SSL handshake errors, OR production fails with rejected certs. Drift across files makes audit hard ("which Pool uses which?").

### 10. `@fastify/formbody` required for HTML form-POST routes

Fastify v5's default body parser is JSON-only. POSTs from HTML forms (`Content-Type: application/x-www-form-urlencoded`) get `request.body === undefined` unless `@fastify/formbody` is registered. No error logged — silent empty body.

**Pattern**: any route that accepts an HTML form POST must register the plugin at server boot:

```js
import formbody from '@fastify/formbody';
fastify.register(formbody);
```

Story 1.4's `signup.js` failed silently on form POSTs until this was added. Already in `package.json` dependencies; verify `fastify.register(formbody)` is in `app/src/server.js` for any project that handles form POSTs.

**Failure mode if violated**: route handler sees `undefined` body; validation rejects "missing fields" even though the form sent them. Hard to diagnose without specifically testing form-encoded POST.

### 11. `requestIdLogLabel` is a Fastify v5 top-level option, NOT a pino option

To customize the field name pino uses for request IDs (e.g., to emit `reqId` instead of the default), set `requestIdLogLabel: 'reqId'` at the Fastify constructor's TOP LEVEL — beside `logger`, not nested inside the pino config. Fastify v5 reads this option from the top level only; nesting it inside `logger:` is silently ignored.

**Pattern**:

```js
const fastify = Fastify({
  logger: { /* pino config */ },
  requestIdLogLabel: 'reqId',  // top-level, not inside `logger`
  genReqId: () => randomUUID(),
});
```

Story 1.3 debug fix discovered this — the original config nested `requestIdLogLabel` inside `logger:` and request IDs were emitted under the default field name silently.

**Failure mode if violated**: request logs use the default field name; custom name silently ignored. No error logged. Discovered only when log-aggregation queries fail to find the expected field.

### 12. AD27 redaction list extension protocol: distillate-first, then `shared/logger.js`

When a new secret-bearing field is discovered (e.g., `access_token`, `refresh_token`, `mp_session` signature), the redaction extension MUST land in two places in the same PR: (a) the source distillate's AD27 redaction list (so future implementers see the canonical set), and (b) `shared/logger.js`'s pino redaction config (so the runtime actually redacts). The audit trail trusts (a); the runtime depends on (b).

**Pattern**: extension PR touches both files atomically:
- `_bmad-output/planning-artifacts/architecture-distillate/03-decisions-E-J.md` (AD27 entry)
- `shared/logger.js` (pino `redact: { paths: [...] }` config)

Story 1.3 + Story 1.5 patches added `access_token`, `refresh_token`, `mp_session` to both. The distillate-first order matters — if (a) is skipped, the next refactor of `shared/logger.js` may drop the field; if (b) is skipped, logs leak the secret immediately.

**Failure mode if violated**: redaction list drifts between distillate (truth) and runtime (effect). Audit reviews trust the distillate; production logs leak the secret. Latent bug class — only surfaces in a production incident or a careful log audit.

---

## F1-F13 Amendments — Quick Reference

| F# | Severity | Topic | Resolution |
|---|---|---|---|
| F1 | 🔴 Critical | T2a→T2b cadence write missing | AD10 transition writes `tier='2b'`, `tier_cadence_minutes=45` atomic with audit event (Story 7.5) |
| F2 | 🔴 Critical | Stripe model contradiction | One Customer + one Subscription per MarketPilot customer + one SubscriptionItem per marketplace (Story 11.1) |
| F3 | 🔴 Critical | Atomic auth+profile mechanism | Postgres trigger on `auth.users` AFTER INSERT, `SECURITY DEFINER`, RAISE EXCEPTION rolls back (Story 1.4) |
| F4 | 🔴 Critical | Schema chicken-and-egg (scan_jobs FK) | Added `'PROVISIONING'` cron_state + nullable A01/PC01 columns + CHECK constraint (Stories 4.1, 4.4) |
| F5 | 🔴 Critical | `audit_log_event_types` lookup migration ordering | Migration `202604301207b_create_audit_log_event_types.sql` ordered ahead of partitioned table (Story 9.0) |
| F6 | 🟡 Important | AD11 per-cycle 20% denominator ambiguous | Numerator = staged-for-write count; denominator = `COUNT(*) FROM sku_channels WHERE customer_marketplace_id = $1 AND excluded_at IS NULL` (Story 7.6) |
| F7 | 🟡 Important | NIF capture flow implicit | Founder asks at Day-3 pulse-check; persists to both `customer_profiles.nif` and `moloni_invoices.nif`; subsequent invoices pre-fill (Story 11.5 + Founder Operational track) |
| F8 | 🟡 Important | `audit_log.sku_id` / `sku_channel_id` FK posture | NO FK constraint, intentional for audit-log immutability (Story 9.1 inline schema comment) |
| F9 | 🟡 Important | Per-page JS module loading | Each eta page includes `<script src="/js/<page>.js" defer>` near `</body>`, no bundler (Story 1.1) |
| F10 | 🟢 Nice-to-have | Sustained-transient threshold hardcoded | Epic 2 trigger: nullable `customer_marketplace.sustained_transient_cycle_threshold` column (Story 12.1) |
| F11 | 🟢 Nice-to-have | Worker process count implicit | Step 6 deployment: explicit `replicas: 1` for both app and worker at MVP (Story 1.1) |
| F12 | 🟡 Important | Stale Stripe linkage prose post-F2 | Updated to cite `customers.stripe_customer_id`, `customers.stripe_subscription_id`, `customer_marketplaces.stripe_subscription_item_id` (Story 11.1) |
| F13 | 🟡 Important | cron_state casing inconsistent | All references standardized to UPPER_SNAKE_CASE matching SQL enum (Story 4.1) |

---

## BAD Subagent Operational Rules

### Bob (`bmad-create-story`)

- **Always load** `architecture-distillate/_index.md` + `epics-distillate/_index.md` first.
- **Then load** the relevant arch section (per task scope) + relevant epics section (epic-grouped per `epics-distillate/_index.md` section manifest).
- **For Mirakl-touching stories**: also check Mirakl MCP for any field/endpoint cited.
- **Story file output**: `_bmad-output/implementation-artifacts/<epic>-<story>-<slug>.md`. Set `Status: ready-for-dev`.
- **Atomicity bundle awareness**: If story is part of Bundle A/B/C, cite the bundle in story acceptance criteria. Don't ship a Bundle C story without referencing Story 7.8's gate.
- **Calendar-early**: Story 9.0 / 9.1 sharding loads epics section 06 even though they ship between Epic 2 and Epic 3.
- **Pattern A/B/C contract**: every UI-bearing story cites Behavior + Structure + Visual pointers per Pattern.
- **Fixture references**: every Epic 7 engine story names applicable P11 fixtures by filename in acceptance criteria.

### Amelia (`bmad-dev-story`)

- **Read story file COMPLETELY** before any implementation.
- **Mirakl MCP first** for any P11/PRI01/PRI02/A01/PC01/OF21 detail.
- **Tests must actually exist and pass 100%** — never claim a test passes that wasn't written.
- **RGR cycle** for feature tasks; for scaffolding tasks (config, ESLint, migration) use integration-gate completion criterion at story end.
- **SSoT module discipline**: extend the existing module — never create a parallel implementation. If you need a new shared module, propose it and ask Pedro before scaffolding.
- **Migration discipline**: `npx supabase migration new <name>` + git-tracked file. Never use Supabase MCP `apply_migration`.
- **Atomicity bundle**: if story is part of Bundle A (1.4) or specific Bundle B story (4.2, 8.1, 10.1, 11.5, 12.1), the migration + endpoint + validation + safe-error mapping ship in **single PR**.

### CR (`bmad-code-review`)

- **Always load** `architecture-distillate/_index.md` (the 27-constraint negative-assertion list is the primary checklist).
- **Three default review layers**: Blind Hunter / Edge Case Hunter / Acceptance Auditor.
- **Architecture-compliance audit**: walk the 27 constraints against the diff. Flag any violation as `decision_needed` if ambiguous, `patch` if mechanical fix, `defer` if pre-existing.
- **Mirakl-touching diff**: verify cited fields against Mirakl MCP. If MCP says different, `decision_needed`.
- **SSoT module check**: any `INSERT INTO audit_log` / raw CSV / `UPDATE customer_marketplaces SET cron_state` / direct `fetch(` outside its SSoT module is `patch` (mechanical fix to extend the module).
- **Multi-tenant safety**: any worker-context query without `.eq('customer_marketplace_id', ...)` AND without `// safe: cross-customer cron` comment is `patch` (high severity).
- **Money discipline**: any float-math on price-like identifier outside `shared/money/index.js` is `patch` (high severity).

---

## Anti-Patterns / Refuse List

If a request matches any of these, **refuse and flag to Pedro** (don't silently comply):

- "Can you add Mirakl webhook handling?" → No. Constraint #1 + AD18. Polling only.
- "Let me add zod / yup for validation." → No. Constraint #2. Fastify built-in JSON Schema.
- "Should we set up React / Vue?" → No. Constraint #3. Server-rendered eta only.
- "Let's add Vite / esbuild for bundling." → No. Constraint #4. No bundler at MVP.
- "Convert this to TypeScript." → No. Constraint #5. JS-ESM with JSDoc.
- "Use OF24 to update price." → No. Constraint #6 + CLAUDE.md mandate. PRI01 only.
- "Expose a REST API at `/api/v1/...`." → No. Constraint #7. Stripe webhook only.
- "Add Redis for queueing." → No. Constraint #8. `pri01_staging` table + advisory locks.
- "Add Spanish translations." → No. Constraint #10. PT-only at MVP.
- "Make the dashboard mobile-first." → No. Constraint #12. Desktop ≥1280px primary; only critical-alert is mobile-optimized.
- "Let me impersonate the customer for support." → No. Constraint #13. Read-only `?as_admin=` only.
- "Add `customer_team_members` for multi-user." → No. Constraint #16. Phase 2.
- "Use `apply_migration` via Supabase MCP." → No. CLI + git-tracked files only.
- "Generate a story for refurbished products." → No. Constraint #25. Out of scope.
- "Add Phone House / Carrefour integration story." → No. Constraint #26. Phase 2.
- "Build a self-serve Add Marketplace UI." → No. Constraint #27. Concierge-only at MVP.
- "Refactor the Mirakl client to use OpenAPI codegen." → No. Architecture locks `apiClient.js` ported from DynamicPriceIdea (AD5).
- "Replace Postgres advisory locks with table-row pseudo-mutex." → No. AD17 chose advisory locks deliberately over Gabriel's table-row pattern.

---

## Sources of Truth — Lookup Table

| Need | Source |
|------|--------|
| Functional requirements (FRs) | `_bmad-output/planning-artifacts/prd-distillate.md` |
| Non-functional requirements (NFRs) | `_bmad-output/planning-artifacts/prd-distillate.md` |
| Architectural decisions (ADs) | `_bmad-output/planning-artifacts/architecture-distillate/02-decisions-A-D.md` (AD1-AD20), `03-decisions-E-J.md` (AD21-AD30) |
| Schema DDL | `_bmad-output/planning-artifacts/architecture-distillate/06-database-schema.md` |
| Directory tree / file locations | `_bmad-output/planning-artifacts/architecture-distillate/05-directory-tree.md` |
| FR/AD → file mapping | `_bmad-output/planning-artifacts/architecture-distillate/07-fr-mapping-integrations-workflows.md` |
| F1-F13 amendments full detail | `_bmad-output/planning-artifacts/architecture-distillate/08-amendments-and-validation.md` |
| Story acceptance criteria | `_bmad-output/planning-artifacts/epics-distillate/<NN>-<scope>.md` (per epic) |
| 18 Notes-for-Pedro | `_bmad-output/planning-artifacts/epics-distillate/_index.md` "Notes for Pedro" section |
| Parallel Tracks (Legal / Founder Operational) | `_bmad-output/planning-artifacts/epics-distillate/_index.md` "Parallel Tracks" section |
| Sprint sequencing | `_bmad-output/implementation-artifacts/sprint-status.yaml` |
| Story file (after sharding) | `_bmad-output/implementation-artifacts/<epic>-<story>-<slug>.md` |
| Mirakl API behavior | Mirakl MCP (always check first, never guess) |
| Library / framework docs | Context7 MCP (auto-translate CommonJS → ESM) |
| Live Postgres / RLS / migrations state | Supabase MCP (read-only verification only; project_id `ttqwrbtnwtyeehynzubw`) |
| Live Worten verification fixtures | `verification-results.json` (gitignored) — captured 2026-04-30 |
| Reference Mirakl client code | `D:\Plannae Project\DynamicPriceIdea` (working P11 + apiClient.js) |
| Cooperative-absorption testbed | Gabriel's live Mirakl Worten sync (15-min cadence, real catalog) |
| Memory (long-term Pedro feedback) | `~/.claude/projects/d--Plannae-Project-marketpilot-repricer/memory/` |

---

## Key Project Constants

```
PROJECT_NAME              marketpilot-repricer
SUPABASE_PROJECT_ID       ttqwrbtnwtyeehynzubw
SUPABASE_REGION           eu-west-3 (Paris)
POSTGRES_VERSION          17.6.1.111
WORTEN_INSTANCE_URL       https://marketplace.worten.pt
WORTEN_CHANNEL_CODES      WRT_PT_ONLINE | WRT_ES_ONLINE
EDGE_STEP_CENTS           1 (€0.01) — undercut + ceiling-raise unit
ANOMALY_THRESHOLD_PCT     0.40 (40%) — MVP default, customer-tunable Phase 2
CIRCUIT_BREAKER_PER_SKU   0.15 (15%)
CIRCUIT_BREAKER_PER_CYCLE 0.20 (20%)
TIER_CADENCE_MINUTES      Tier 1: 15 | Tier 2a: 15 | Tier 2b: 45 | Tier 3: 1440
DISPATCHER_INTERVAL       5 minutes (master cron)
WORKER_HEARTBEAT_INTERVAL 30 seconds
HEALTH_CHECK_THRESHOLD    < 90s since last heartbeat (3× cadence)
RETRY_SCHEDULE            [1s, 2s, 4s, 8s, 16s] — 5 retries max, 30s cap per delay
PRI02_RESOLUTION_TARGET   ≤ 30 minutes (NFR-P5)
ALERT_DELIVERY_TARGET     ≤ 5 minutes (NFR-P9, FR48)
```
