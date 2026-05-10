# BAD Customization Notes — collected from Stories 1.1-1.5 manual runs

> **Purpose**: capture the deltas between BAD's forked-skill assumptions and marketpilot-repricer's actual implementation reality. Populated story-by-story during the manual Bob → Amelia → CR flow for Stories 1.1-1.5. After Story 1.5 ships, this becomes the changelist for customizing `bad/SKILL.md` and `bad-review/SKILL.md` before the BAD pipeline runs Stories 1.6+ autonomously.
>
> **Read alongside**: `bad/SKILL.md` (the coordinator skill we'll customize) and `bad-review/SKILL.md` (the audit-before-merge skill). Per the 2026-05-01 audit, both are forked from a previous BAD project (DynamicPriceIdea-flavored — `src/workers/`, BullMQ/SQLite/Drizzle stack, "MCP-Verified Endpoint Reference" pointer that doesn't exist in our distillates).

---

## Per-Story Findings

### Story 1.1 — Scaffold + two-service Coolify deploy + composed /health

**Status**: complete (smoke test green 2026-05-01).

**File paths actually created** (compare against BAD's hardcoded `src/workers/`, `src/routes/`, `src/middleware/errorHandler.js`):
- `app/src/server.js`, `app/src/routes/health.js` — BAD's gate needs `app/src/routes/` not `src/routes/`
- `worker/src/index.js`, `worker/src/jobs/heartbeat.js` — BAD's gate needs `worker/src/` not `src/workers/`
- `shared/config/runtime-env.js` — shared module pattern confirmed working
- `db/migrations/202604301212_create_worker_heartbeats.sql` — BUT: Supabase CLI requires migrations in `supabase/migrations/`, not `db/migrations/`. Architecture directory tree needs update.
- `supabase/migrations/202604301212_create_worker_heartbeats.sql` — actual applied location
- `eslint.config.js`, `eslint-rules/` (4 placeholder stubs), `tests/integration/scaffold-smoke.test.js`

**Conventions emerging / drift from architecture**:
- **Migration path drift**: Architecture says `db/migrations/` but Supabase CLI requires `supabase/migrations/`. Going forward, migrations live in `supabase/migrations/`. The `db/` directory can hold seeds only. Architecture's `05-directory-tree.md` needs amendment.
- **ESLint no-default-export**: Bob missed this from the Story 1.1 ESLint spec; fixed before Amelia ran. BAD's story-creation must catch this — add to architecture-compliance audit checklist.
- **pg Pool SSL config**: Bob/Amelia didn't include `ssl: { rejectUnauthorized: false }` in Pool config — required for Supabase connections. See critical finding below.

**Pain points in manual flow**:
- Supabase CLI login/link required browser auth + correct account — took significant debugging time. BAD automation would face same issue on first run; Pedro must pre-link CLI before BAD runs.
- DB password with special characters broke `--db-url` flag; alphanumeric-only password required. Document this as onboarding requirement.
- Session pooler URL (`postgres.PROJECT_REF@pooler.supabase.com`) failed with "tenant not found" — direct connection URL only. Must update `.env.example` to clarify correct URL format.

**MCP invocation patterns**:
- Mirakl MCP: not needed (no Mirakl calls in Story 1.1) ✓
- Context7: Bob used it for Fastify v5 ESM init + ESLint v9 flat config patterns — citations embedded in story file ✓
- Supabase MCP: used `list_tables` to verify `worker_heartbeats` table landed after migration ✓

**Test patterns**:
- Integration smoke test (not RGR) — `node:test` spawning child processes, polling /health, checking DB row. Amelia wrote a real behavioral test, not theater. ✓ Pedro's empirical prior confirmed: scaffolding stories produce integration-gate tests, not fake unit tests.
- ESLint + smoke test together are the acceptance gates. No RGR needed for this story type.

**Worker-Path Opus Gate validation**:
- Worker paths landed at: `worker/src/index.js`, `worker/src/jobs/heartbeat.js`, `worker/src/engine/` (empty scaffold), `worker/src/safety/` (empty scaffold)
- BAD's current gate condition: `src/workers/` — WRONG for our project
- Required update: `worker/src/` (all worker-side code), `app/src/routes/` (Fastify routes), `app/src/middleware/` (middleware)

**CR findings**: not yet run — proceeding directly to Story 1.2 given smoke test green. Story 1.1 PRE-MERGE findings noted below.

**Critical finding for all future stories — pg Pool SSL**:
- Every `pg` Pool in this project MUST include `ssl: { rejectUnauthorized: false }`
- Supabase SSL certificates don't pass strict verification; `rejectUnauthorized: false` is required
- The `shared/db/service-role-client.js` SSoT module (Story 2.1) MUST include this in its Pool config
- Bob must include this in every story that creates a pg Pool. Add to project-context.md Dev Notes template.
- Confirmed: direct connection `db.PROJECT_REF.supabase.co:5432` + SSL works; session pooler `pooler.supabase.com` does NOT work (tenant not found)

**Notes for BAD customization**:
- Worker-Path Opus Gate: `src/workers/` → `worker/src/`, add `app/src/routes/`, `app/src/middleware/`
- Story creation (Bob): must encode Supabase pg Pool SSL requirement in Dev Notes for any story touching `pg`
- Migration path: `supabase/migrations/` not `db/migrations/` — update architecture directory tree reference in skill

**🔴 CRITICAL — migration immutability rule violated by CR (caught and corrected during Story 1.1 review)**:

During Story 1.1's code review pass, the CR subagent **edited an already-applied migration file** to add an index, instead of creating a new migration. Specifically:
- `supabase/migrations/202604301212_create_worker_heartbeats.sql` had been applied to the remote project (Supabase MCP `list_tables` confirmed the table existed)
- CR review pass added `CREATE INDEX worker_heartbeats_written_at_desc_idx ON worker_heartbeats (written_at DESC)` to the same file
- This violated Step 5 architecture lock: *"append-only SQL managed by Supabase CLI; never edit a migration after applied to any environment"*
- Practical consequence: `npx supabase db push` would NOT have applied the index because the migration was already tracked as applied in `supabase_migrations.schema_migrations`. The index would have lived on local file system only, with silent divergence between filesystem and remote DB state.
- Fix: reverted index out of original migration; created new migration `202605011940_add_worker_heartbeats_written_at_idx.sql` with the index DDL only. Applied via `npx supabase db push`.

**Why this happens**: CR subagents have no visibility into "what's been applied to which environment." They reason about a diff in isolation and treat migration files as ordinary editable files. The remote `schema_migrations` tracking table is invisible to the review window. Subagent reasoning alone cannot catch this — it requires a mechanical gate.

**Failure mode in production**: in a multi-environment setup, this divergence is catastrophic:
- Local dev regenerates DB from migrations → gets the edited version (with index)
- Staging/prod previously ran the original migration → have the old version (no index)
- Bug reports that don't reproduce locally; manual schema reconciliation in panic
- Cost: days of debugging per incident; high probability across a 62-story project lifetime

**Required hard gates (highest priority for BAD customization, ahead of Worker-Path Opus Gate)**:

1. **`bad-review/SKILL.md` — Phase 1 step 9 (new)**: deterministic check that flags any modified file in `supabase/migrations/` whose timestamp predates HEAD. Trigger pattern (post-Phase 1 step 6, before Phase 2):
   ```bash
   git log --diff-filter=M --name-only HEAD -- 'supabase/migrations/*.sql' | sort -u
   ```
   If any results, halt with: `❌ Migration immutability violation. PR modifies <file>. Migrations are append-only — never edit after apply. Create a new migration instead.` Do not proceed to Phase 2.

2. **`bad-review/references/mcp-forbidden-patterns.md` — add new pattern**: "Modified migration in `supabase/migrations/`" (severity: HIGH; subagent A code-vs-spec audit flags as blocking).

3. **`bad/SKILL.md` Step 5 review prompt — add explicit instruction**: *"If the diff modifies any existing file in `supabase/migrations/` (not just adds new ones), flag as decision_needed. Never patch the modification directly. Create a new migration file."*

4. **Pre-commit hook (project-level)**: bash script in `scripts/check-migration-immutability.sh` that runs in CI and on local commit. Compares staged changes against `git log` to detect any modification of `.sql` files in `supabase/migrations/` that exist in git history. Block commit if violated.

5. **`project-context.md` — add to BAD subagent rules**: explicit rule for Bob/Amelia/CR: "NEVER edit a migration file in `supabase/migrations/` once it has been added to a commit. Schema changes after the first commit always create new migrations. This rule has zero exceptions."

**This rule's failure mode is a multi-day production incident, not just a performance miss — higher priority customization than path-pattern updates.**

**Worker-Path Opus Gate validation**:
- BAD gate condition: `src/workers/`, `src/middleware/errorHandler.js`, `src/routes/`
- Our actual paths landed: _to be filled_
- Required gate update: _to be filled_

**CR findings (severity, accuracy, misses)**:
- _to be filled_

**Story file structure observations** (Bob's output format vs Amelia's expected input):
- _to be filled_

**Notes for BAD customization**:
- _to be filled_

---

### Story 1.2 — Envelope encryption + master-key loader + secret-scanning hook

**Status**: complete (smoke green, 31/31 unit tests, e2e hook test green; dev=Opus, review=Opus).

**File paths actually created**:
- `shared/crypto/master-key-loader.js`, `shared/crypto/envelope.js`
- `worker/src/index.js` extended (loadMasterKey before startHeartbeat)
- `supabase/migrations/202604301204_create_shop_api_key_vault.sql` (Option A: committed; apply deferred to Story 4.1)
- `scripts/check-no-secrets.sh`, `.githooks/pre-commit`, `scripts/install-git-hooks.sh`, `scripts/rotate-master-key.md`
- `.gitattributes` (LF on `*.sh` + `.githooks/*` — Coolify Linux containers + Pedro's Windows clone)
- Test files: `tests/shared/crypto/{envelope,master-key-loader}.test.js`, `tests/scripts/check-no-secrets.test.js`

**Critical CR catch — hook silently bypassed on real git commit**:
- Original hook used `[ -t 0 ]` (true only for TTY). Git invokes hooks with stdin=`/dev/null` — neither TTY nor pipe — so logic fell to `cat`, got empty content, exit 0.
- All 10 unit tests passed because they pipe input via stdin (a different codepath).
- **Without CR catching this, AD3 first-line-of-defense would have shipped non-functional.**
- Fix: `[ -t 0 ]` → `[ -p /dev/stdin ]`.

**Notes for BAD customization (additive)**:
- **Git hook test pattern**: every hook spec MUST include canonical real-git invocation in tests — `bash .githooks/<hook> < /dev/null` with real staged content. Stdin-piped tests alone exercise the wrong codepath. Add to project-context.md test patterns.
- **Spec regex validation by Bob**: any regex in acceptance criteria must include 2-3 representative test inputs to mentally validate. The `MASTER_KEY[A-Z_]*` vs `[A-Z0-9_]*` bug shipped because no spec-time test case used `MASTER_KEY_BASE64` (digits in suffix). Bob's create-story prompt should require this.
- **`.gitattributes` cross-platform LF rule**: any story creating `*.sh` or `.githooks/*` MUST include `*.sh text eol=lf` and `.githooks/* text eol=lf`. Default for Bob.
- **`grep ... || true` antipattern**: swallows exit 2 (malformed regex) along with exit 1 (no match). Use explicit `if [ $? -gt 1 ]` distinction in any spec involving grep + error tolerance.
- **Self-referential test exclusions** (now hit twice — Story 1.2 + Story 1.3): any scanner OR redactor whose tests prove detection/redaction MUST exclude those test files from the scan path. The class is broader than "scanner tests" — Story 1.3's redaction tests also legitimately construct synthetic trigger patterns. Generalize the rule for BAD: when a story ships a security-protective primitive (scanner, redactor, validator) AND tests it with synthetic trigger patterns, Bob must include the path exclusion in the spec. Current exclusions: `tests/scripts/*` (Story 1.2), `tests/shared/logger.test.js` (Story 1.3). Future stories will add more — Story 7.x engine fixtures with PRI01 patterns, Story 11.x Stripe fixtures, etc.
- **Adversarial review framing matters more than model size**: dev=Opus and review=Opus, yet review caught a critical bug dev missed. The fresh-context separate review pass is the load-bearing variable. Reinforces "always run CR before merging security-critical stories" — this is non-negotiable, regardless of model selection.

---

### Story 1.3 — Pino config + redaction list + structured logging

**Status**: complete (13/13 unit tests green; dev=Opus, review=Sonnet 4.6). Smoke test failed for environmental reason — IPv6-only DNS resolution on `db.PROJECT_REF.supabase.co` from Pedro's home network. Not a regression.

**File paths actually created**:
- `shared/logger.js` (SSoT factory + `AD27_FIELDS` + `REDACT_CONFIG` + `FASTIFY_REQUEST_ID_LOG_LABEL` constant)
- `tests/shared/logger.test.js` (captured-stream pattern, parameterized over 14 AD27 fields × 2 depths)
- Modified: `app/src/server.js`, `worker/src/index.js`, `shared/config/runtime-env.js`, `eslint.config.js`, `.env.example`

**Two impl-time spec deviations (Amelia caught + documented)**:
- `requestIdLogLabel` is a Fastify v5 **constructor option**, not a logger option. Bob's spec snippet had it nested in `logger:` config; that path is silently ignored by Fastify (falls back to `reqId`). Top-level placement at `Fastify({ logger: ..., requestIdLogLabel: ... })` is the only way.
- Pino `base` REPLACES the default `{ pid, hostname }` rather than augmenting. AC#2 requires both fields, so they must be re-added explicitly when overriding `base`.

**One review-time spec inconsistency (CR caught + Pedro extended AD27)**:
- Original AD27 list had asymmetric casing: `Authorization` + `authorization` (both) but only `cookie` / `set-cookie` (lowercase). Same Node-http-parser-vs-construction reasoning applies symmetrically. Extended AD27 to 14 fields (added `Cookie` + `Set-Cookie`).
- Touched 7 files: 2 distillates (architecture + epics), 1 epics-section, 1 story file, code, tests, project-context. Validated as a pattern: when Bob applies a rule to one item, all logically-equivalent items should receive the same treatment.

**Notes for BAD customization (additive)**:
- **Framework integration option placement**: Bob's spec must verify whether a framework-integration option lives at the framework-constructor level vs the wrapped-library level. Empirical check at story-creation time: try the snippet against the real framework version. Pino + Fastify is the canonical example; same pattern applies to Stripe webhooks, Resend, etc.
- **Pino `base` semantics**: `base` is replacement, not merge. Any story using `base: { ... }` must explicitly re-include `pid`/`hostname` if AC requires them.
- **Asymmetric-pattern detector**: when a redaction/exclusion list applies a pattern (dual-casing, case-folding, wildcard) to one entry, CR should flag any other entry that doesn't get the same treatment. Heuristic: same severity class + same input source = same protection breadth.
- **Smoke test environmental fragility**: Supabase direct connection (`db.PROJECT_REF.supabase.co`) resolves IPv6-only on this project. Pedro's home network has intermittent IPv6 connectivity → smoke test against real Supabase is flaky locally. Not a Coolify deployment issue (their infrastructure has clean dual-stack). Document in BAD: don't gate merge on smoke test passing locally if all unit tests + structural verification pass and the failure shape is connection timeout.

---

### Story 1.4 — Signup + atomic customer_profiles trigger + source-context capture (Bundle A)

**Status**: spec ready, env vars in place, awaiting Amelia.

**Pre-implementation infrastructure work** (large detour — captured here so future sessions don't re-debate):

**Local Supabase stack on Pedro's machine** (Windows + WSL2 + AMD Ryzen 7 5800XT):
- Docker Desktop installed, working, disk image moved to `D:\DockerData` (C: was full)
- BIOS SVM enabled (was off after motherboard swap)
- Three Supabase services confirmed segfault on this hardware combo and are disabled in `supabase/config.toml`:
  - **`realtime`** (Elixir/Erlang BEAM VM) — `[realtime] enabled = false`
  - **`analytics`** (logflare, also Elixir/Erlang BEAM VM) — `[analytics] enabled = false`
  - **`storage`** (storage-api v1.54.0 — Go binary; segfaults specific to this version on Ryzen) — `[storage] enabled = false`
- None of these are used by MVP architecture; AD18 mandates polling-only (no realtime), no file uploads in scope, analytics dashboard is not needed locally. Production Coolify environment doesn't hit these (different runtime).
- Docker Desktop disk-image relocation pattern works: `Settings → Resources → Advanced → Disk image location` → moved from `C:\Users\pedro\AppData\Local\Docker\` to `D:\DockerData\DockerDesktopWSL\`.

**Migration ordering deferral (Story 1.2 vault → Story 4.1 customer_marketplaces forward FK)**:
- `supabase/migrations/202604301204_create_shop_api_key_vault.sql` references `customer_marketplaces(id)` which is created by Story 4.1's not-yet-shipped migration.
- Story 1.2's spec (Option A) deferred Cloud apply until Story 4.1. Local `npx supabase start` reveals that local apply also needs deferral.
- Resolution: file renamed to `202604301204_create_shop_api_key_vault.sql.deferred-until-story-4.1` so Supabase CLI ignores it. Filename encodes restore action.
- **MUST DO when Story 4.1 ships**: rename file back to `.sql`, run `npx supabase db reset` locally + `npx supabase db push` to Cloud. Add to Story 4.1's task list at sharding time.
- **Generalized rule for BAD customization**: when a story's migration references a forward-FK target from a future story, defer via `.deferred-until-story-X.Y` suffix (NOT by editing the migration content — immutability rule still applies). Restore at the target story's sharding.

**Three env vars added for Story 1.4 in `.env.local`**:
- `COOKIE_SECRET` — generated via `openssl rand -base64 32`; signed-cookie HMAC for `mp_session` + `mp_source_ctx`. Distinct from `MASTER_KEY_BASE64`.
- `APP_BASE_URL=http://localhost:3000` (dev) / `https://app.marketpilot.pt` (prod) — Supabase Auth redirect target for `emailRedirectTo` and password-recovery link.
- `SUPABASE_ANON_KEY` already present from Supabase project setup. Distinct from `SUPABASE_SERVICE_ROLE_KEY` and from `SUPABASE_SERVICE_ROLE_DATABASE_URL`.

**Operational pre-flights for Pedro before Amelia runs**:
- Configure Supabase Auth → URL Configuration → Redirect URLs allowlist:
  - `http://localhost:3000/verify-email`
  - `http://localhost:3000/reset-password`
- Without these, Supabase Auth confirmation/recovery emails redirect to URLs Supabase doesn't trust → flow breaks.

**Notes for BAD customization (additive)**:
- **Hardware-compat triplet captured**: WSL2 + AMD Ryzen + Supabase local stack — known-segfault services (realtime, analytics, storage-api, edge_runtime; studio + pg_meta health-check cascade-fail). Final working set after triage: db, gateway, api, auth, mailpit. None of MVP requires the disabled ones.
- **Forward-FK migration deferral pattern**: `.deferred-until-story-X.Y` suffix is the canonical pattern. Bob's create-story workflow should add a "post-Story-X.Y restore" task to the future story's task list when sharding.
- **Don't pre-emptively `npx supabase db push` for forward-FK migrations**: Cloud and local share the same deferral discipline.

**Two empirical library contracts caught during Story 1.4 integration verification — promote to project-context.md if they recur**:

- **GoTrue strips Postgres HINT codes from `auth.signUp` errors**. Trigger-raised `RAISE EXCEPTION ... USING HINT = 'SOMETHING'` does NOT propagate the HINT through Supabase Auth to the client. Empirical contract (Supabase Auth ≥ 2.x, verified 2026-05-02): `error.message = "Database error saving new user"`, `error.code = "unexpected_failure"`, no HINT anywhere in the response. The substring-match-on-HINT pattern in error mappers DOES NOT WORK. **Pattern**: any story relying on a trigger HINT for user-facing field errors must mirror the trigger's validation at the route level (so the user sees the field-specific message), with the trigger remaining as defense-in-depth for non-route DB writes. Story 1.4 applied this pattern in `app/src/routes/_public/signup.js` — first instance.
- **`@fastify/cookie` v11+ does NOT auto-unwrap signed cookies**. `request.cookies[name]` returns the raw `s:<value>.<signature>` string. To verify signature and extract the original value: `const { valid, value } = request.unsignCookie(raw)`. **Pattern**: any story that reads a signed cookie must use `request.unsignCookie()` explicitly. Story 1.4 corrected `source-context-capture.js` — first instance. Future stories with session-cookie reads (Story 2.1's RLS middleware reading `mp_session`, Story 11.x's billing webhooks if signed) must follow this pattern.

**Test infrastructure patterns captured**:

- **`auth.users` reset between integration tests**: use `DELETE FROM auth.users`, NOT `TRUNCATE`. The `auth.refresh_tokens_id_seq` and other auth-schema sequences are owned by `supabase_auth_admin`, not the `postgres` connection user — TRUNCATE CASCADE fails with "must be owner of sequence". DELETE relies on Supabase-defined ON DELETE CASCADE chains and works without ownership.
- **Integration test readiness probe**: do NOT poll `GET /health` if the test only spawns the app process. `/health` requires worker_heartbeats < 90s freshness; without a worker, it always returns 503. Use a simpler endpoint that the test exercises anyway (e.g., `GET /` for the placeholder, or one of the routes under test). The Story 1.1 scaffold-smoke test spawns BOTH app and worker, so it can use `/health`; per-feature integration tests typically don't need the worker.

---

### Story 1.5 — founder_admins table + admin-route middleware

**Status**: not yet started.

(Same subsections — populate after run.)

---

## Aggregate Observations (filled after Story 1.5)

### File path inventory

> Complete list of paths landed across Stories 1.1-1.5 — drives Worker-Path Opus Gate update + filename-claim-audit regex update.

- _to be filled_

### Recurring pain points

> Things the manual flow exposed that BAD's automation would address (or would amplify).

- _to be filled_

### Recurring strengths of manual flow

> Things the manual flow does well that we'd lose if BAD just runs without modification.

- _to be filled_

### Mirakl MCP usage frequency

> How often did Mirakl MCP get invoked across these 5 stories? Establishes whether BAD's "check Mirakl MCP" gate needs to be hard or soft.

- _to be filled_

### Supabase MCP usage patterns

> What read-only ops were useful? Did anyone try `apply_migration` (forbidden)? Did the org-scope project_id get passed correctly?

- _to be filled_

### Context7 usage patterns

> What library docs got fetched? Were Context7's CommonJS-to-ESM translations clean or did they require manual fixup?

- _to be filled_

---

## BAD Customization Deltas — Final Changelist for Skill Files

> Populated after Story 1.5 ships. This section is the deliverable: a precise list of edits to apply to `.claude/skills/bad/SKILL.md` and `.claude/skills/bad-review/SKILL.md` (and their reference files) before BAD runs Story 1.6 autonomously.

### `.claude/skills/bad/SKILL.md` — required changes

- **Worker-Path Opus Gate (L362)**: replace `src/workers/`, `src/middleware/errorHandler.js`, `src/routes/` with the actual marketpilot-repricer paths discovered during Stories 1.1-1.5. Concrete diff: _to be filled_.
- **Step 1 distillate reference (L283)**: replace pointer to `_bmad-output/planning-artifacts/epics-distillate.md` "MCP-Verified Endpoint Reference" with `architecture-distillate/_index.md` "Cross-Cutting Empirically-Verified Mirakl Facts" section.
- **Memory file references (L194, L255, L341, L368)**: these cite memory files from the previous BAD project. Either inline the rationale (preferred — gates are self-justifying then) or remove the citation.
- **Bundle C awareness**: add gate that prevents auto-merge of Stories 5.1, 5.2, 6.1, 6.2, 6.3, 7.2, 7.3, 7.6 to main until Story 7.8's atomicity-bundle gate test passes. Concrete mechanism: _to be designed_ (likely a `block_auto_merge_until_story` field in sprint-status.yaml).
- **Calendar-early sequencing**: add `calendar_early` flag in sprint-status.yaml override to allow Stories 9.0/9.1 to be picked between Epic 2 and Epic 3 despite naive epic-ordering.
- **Epic-Start Test Design re-entry guard**: prevent double-firing for Epic 9 (once at calendar-early start, once at chronological start).

### `.claude/skills/bad-review/SKILL.md` — required changes

- **Repo-specific context block (L552-559)**: replace stack documentation. Current says "BullMQ, SQLite/Drizzle"; correct is "Postgres on Supabase Cloud EU, no BullMQ, no Drizzle". Replace `scripts/mcp-probe.js` with `scripts/mirakl-empirical-verify.js`.
- **Live Smoke Evidence guard trigger (L77)**: replace `src/workers/mirakl/` path match with our Mirakl-touching paths (likely `shared/mirakl/`, `worker/src/engine/`, `app/src/routes/_public/onboarding-key.js`).
- **Filename claim audit regex (L109)**: extend allowed path-prefix list to include `app/`, `worker/`, `shared/`, `db/migrations/`, `tests/integration/`, `tests/fixtures/`, `eslint-rules/`.
- **Distillate reference**: any reference to `epics-distillate.md` (single file) should point to `epics-distillate/_index.md` (folder pattern).

### `.claude/skills/bad-review/references/mcp-forbidden-patterns.md` — required changes

> Read this file before customization to see existing 5-pattern list.

- Patterns to keep: `product_ids: <with EANs>`, `o.channel_code / offer.channel_code`, `offer.price without offer.total_price alongside`, `Compare activeOffers.length to total_count` (these apply to our project too).
- Pattern to remove or invert: `state === 'ACTIVE'` — actually correct for our cron_state per F13 lock (UPPER_SNAKE_CASE). Previous project may have used lowercase; we don't.
- Patterns to add (project-specific footguns):
  - Float-price math outside `shared/money/index.js` (constraint #22, AD8 STEP 3)
  - Raw `INSERT INTO audit_log` outside `shared/audit/writer.js` (constraint #21)
  - Direct `fetch(` outside `shared/mirakl/api-client.js` (constraint #19)
  - Raw `UPDATE customer_marketplaces SET cron_state` outside `shared/state/cron-state.js` (constraint #23)
  - Worker queries missing `customer_marketplace_id` filter without `// safe: cross-customer cron` comment (constraint #24)
  - `apply_migration` via Supabase MCP (project-context.md MCP rule)
  - `OF24` for price updates (constraint #6 — confirmed footgun)
  - `Bearer ` prefix on Mirakl Authorization header (empirical fact #10)
  - `product_sku` used as seller SKU in PRI01 CSV (empirical fact #12 — `shop_sku` is correct)

### Other reference files to audit

- _to be filled_ — read other files in `.claude/skills/bad/references/` and `.claude/skills/bad-review/references/` and note customizations needed.

---

## Open Questions (raise during BAD customization session)

- **Auto-merge policy at MVP**: should `AUTO_PR_MERGE` be `true` (BAD merges to main automatically) or `false` (Pedro hand-merges per `bad-review` audit)? Trade-off: speed vs Bundle C / calendar-early safety. Default: `false` until BAD customization fully lands and Bundle C gate is in place.
- **MAX_PARALLEL_STORIES tuning**: BAD default is 3. Solo founder + 1M context might handle 3 cleanly; might want 2 to keep review surface manageable. Decide based on Stories 1.1-1.5 cadence.
- **MODEL_QUALITY = opus default**: should Step 5 always run Opus regardless of path, given the architecture's safety-critical surfaces? Or keep the path-gated approach and just update the path list?
- **Dependency graph behavior with calendar-early**: how does Phase 0's `bmad-help` map dependencies for Stories 9.0/9.1 ahead of their epic? Worth verifying in dry-run.

---

## Validated Mid-Pipeline Patterns

Patterns surfaced and validated during BAD's autonomous run that are worth capturing as reusable conventions. Each entry includes the validating event, the pattern, and how to apply it next time.

### `/bmad-correct-course` for spec-amendment-driven mid-pipeline corrections (validated Story 6.3, 2026-05-09)

**Trigger:** a story shipped through BAD into `review` state, then `/bad-review` (or any post-merge audit) caught a spec-vs-code gap that requires AC amendments + re-running BAD's review chain on the fix.

**Validating event:** Story 6.3 first ship (PR #85) passed BAD Steps 1-7 and `bmad-code-review`'s adversarial layers, but `/bad-review`'s spec-grounded `code-vs-spec` subagent caught a production wire-up gap (`scheduleRebuildForFailedSkus` implemented + tested but never invoked) plus a counter double-count latent bug. `/bmad-correct-course` was used (first time in this project) to amend the spec with new ACs and re-dispatch through BAD on the existing PR branch.

**The pattern:**
1. Run `/bmad-correct-course` with a detailed prompt covering: story key + path, what went wrong (with concrete code/spec citations), why the fix is structural vs hotfix, the recommended scope, the locked decisions (e.g., counter ownership), constraints (Bundle C invariants, migration immutability, cross-story file modifications expected via stacked PR), and explicit "what NOT to do" boundaries.
2. The skill produces: amended story spec (NEW ACs as additive section, course-correction banner at top, supersession map for any superseded ACs/Dev Notes/test names, Dev Notes documenting locked decisions), sprint-status flip from `review` → `atdd-done`, and a Sprint Change Proposal artifact at `_bmad-output/planning-artifacts/sprint-change-proposal-YYYY-MM-DD.md`.
3. The skill MUST NOT implement the code fix itself. Code work is handed off to BAD's Step 3 dev agent on the next `/bad` run (Phase 0's bundle-stacked exception picks the story up at `atdd-done`; commits land additively on the existing PR branch — no reset, no force-push).
4. After approval: commit the spec edits in the worktree + the sprint-status flip + sprint-change-proposal on main BEFORE running `/bad`. Phase 0's reconciliation against GitHub state can otherwise revert the local flip.

**What it explicitly avoided (positive design):** never implements the code fix inside the correction skill; never re-writes the story from scratch (additive AC pattern preserves prior passing tests + work); never touches `merge_blocks` or atomicity-bundle invariants.

**Worked example:** Story 6.3 course-correction at `_bmad-output/planning-artifacts/sprint-change-proposal-2026-05-09.md`. Spec amendments at commit `d0bb844` on the PR #85 branch. Sprint-status flip + proposal at commit `be22bfc` on main.

### `[WIRE-UP]:` marker convention for spec authors (companion to Step 5 spec-wire-up check, Q3 of Epic 6 retro)

**When to use:** any story whose ACs or Dev Notes mandate cross-file integration ("X must call Y" / "the route must invoke Z") — i.e., spec assertions that diff-grounded review (Step 5 + Step 7) cannot detect if MISSING.

**Marker syntax:** `[WIRE-UP]: <callsite-file> MUST call <function-name>` — exactly that shape, one assertion per line. The callsite file is repo-relative; the function name is bare (no parens, no module prefix). Examples:
```
[WIRE-UP]: shared/mirakl/pri02-poller.js MUST call scheduleRebuildForFailedSkus
[WIRE-UP]: worker/src/jobs/master-cron.js MUST call dispatchCycle
```

**Where to place markers:** in the story spec, ideally inside the relevant AC's "Then" clause OR in a Dev Note for the wire-up obligation. The Step 5 coordinator pre-spawn check greps the entire spec file for the regex pattern.

**What the check does:** `git grep` the worktree for `<function-name>\s*\(` in `<callsite-file>`. If any match → assertion satisfied. If zero matches → HALT before spawning Step 5 with: `❌ Story {N}: spec [WIRE-UP] assertion not realized in code`.

**When NOT to use:** stories with no cross-file integration (pure utility modules, schema-only migrations, doc-only changes). The check is opt-in — absence of markers means "no wire-up assertions to validate."

**False-positive avoidance:** the function name match is `<name>\s*\(` so `scheduleRebuildForFailedSkus` won't match a comment that mentions the function without calling it. If a callsite uses the function via a renamed import (`import { scheduleRebuildForFailedSkus as scheduleRebuild }`) the check would miss it — author should mark with the imported alias name in the marker, OR avoid renamed imports for assertions that need the wire-up check.

**Validating event:** Story 6.3 wire-up gap survived 4 review layers; the structural check would have caught it at Step 5 dispatch time. Q3 lands the check; this convention captures the spec-author side.

---

## Maintenance

- Update after each story's full pipeline lands (Bob → Amelia → CR → review).
- After Story 1.5: aggregate findings, draft the BAD skill file diffs, and apply them in a single customization PR before Story 1.6 starts under autonomous BAD.
- Keep this file in sync with reality — if BAD customization happens partially across stories, note which deltas are applied vs pending.
