This section covers Architecture Validation Results: all 13 post-completion amendments F1-F13 (Pass 1 + Pass 2), coherence validation, requirements coverage, completeness checklist, Pedro's flagged checks verified, Architecture Readiness Assessment. Part 8 of 9 from `architecture.md`.

## Pass 1 Amendments (F1-F11)
- **F1 🔴 Critical**: AD10 said 'no DB write needed' for T2a→T2b; without writing `tier_cadence_minutes=45`, dispatcher predicate keeps row at 15-min cadence forever. Resolution: AD10 transition list updated to write `tier='2b'`, `tier_cadence_minutes=45` atomic with `tier-transition` audit event
- **F2 🔴 Critical**: AD22 internally contradictory (one Subscription per marketplace + 5 line items on one Subscription). Resolution: one Customer + one Subscription per MarketPilot customer, one SubscriptionItem per marketplace; `stripe_customer_id` + `stripe_subscription_id` moved to `customers` table; `stripe_subscription_item_id` added to `customer_marketplaces`
- **F3 🔴 Critical**: AD29 said 'atomic with auth user creation' without specifying mechanism (Pedro flag). Resolution: Postgres trigger on `auth.users` AFTER INSERT, `SECURITY DEFINER`, reads `raw_user_meta_data` JSONB, validates required fields, RAISE EXCEPTION rolls back auth user creation; full trigger DDL inline in schema; migration filename updated
- **F4 🔴 Critical**: Schema chicken-and-egg — `scan_jobs` needed `customer_marketplace_id` FK target but A01/PC01 columns NOT NULL (couldn't populate before scan ran). Resolution: added `'PROVISIONING'` to `cron_state` enum; relaxed A01/PC01 columns to NULLABLE; added CHECK constraint `customer_marketplace_provisioning_completeness` enforcing all populated when `cron_state != 'PROVISIONING'`; default state changed from `DRY_RUN` to `PROVISIONING`
- **F5 🔴 Critical**: `audit_log_event_types` lookup table referenced as FK target but missing from migrations list. Resolution: added `202604301207b_create_audit_log_event_types.sql` ahead of `_create_audit_log_partitioned.sql`; seeded with AD20 taxonomy (26 base rows); Stories 12.1 + 12.3 each ALTER-INSERT one row → 28 total at end of MVP
- **F6 🟡 Important**: AD11 per-cycle 20% denominator ambiguous ('20% of catalog'). Resolution: numerator = staged-for-write count this cycle; denominator = `COUNT(*) FROM sku_channels WHERE customer_marketplace_id = $1 AND excluded_at IS NULL`
- **F7 🟡 Important**: NIF capture flow implicit (schema had nullable column on profiles, NOT NULL on invoices, no flow description). Resolution: AD22 NIF capture flow added — founder asks at Day-3 pulse-check, persists to both `customer_profiles.nif` and `moloni_invoices.nif`; subsequent invoices pre-fill
- **F8 🟡 Important**: `audit_log.sku_id` and `sku_channel_id` had unspecified FK posture. Resolution: inline schema comment — NO FK constraint, intentional for audit-log immutability through SKU lifecycle
- **F9 🟡 Important**: Step 6 listed `public/js/*.js` modules without saying how they load. Resolution: each eta page includes `<script src="/js/<page>.js" defer>` near `</body>`, no bundler
- **F10 🟢 Nice-to-have**: sustained-transient threshold (3 cycles) hardcoded; per-customer-config worth flagging. Resolution: AD24 amended with Epic 2 trigger note — nullable `customer_marketplace.sustained_transient_cycle_threshold` column
- **F11 🟢 Nice-to-have**: worker process count implicit. Resolution: Step 6 deployment workflow — explicit `replicas: 1` for both app and worker at MVP; horizontal scaling is Epic 2 trigger via AD17 advisory locks

## Pass 2 Amendments (F12-F13)
- **F12 🟡 Important**: F2 (Stripe model) applied to schema and AD22 prose, but stale 'Schema reservation for Epic 2' line in AD22 still referenced old `customer_marketplace.stripe_subscription_id` / `customer_marketplace.stripe_customer_id` columns. Resolution: updated to cite new Stripe linkage layout — `customers.stripe_customer_id`, `customers.stripe_subscription_id`, `customer_marketplaces.stripe_subscription_item_id`
- **F13 🟡 Important**: cron-state enum-value casing inconsistent — schema declared UPPER_SNAKE_CASE (`'ACTIVE'`, `'PAUSED_BY_CUSTOMER'`) per Step 5, but multiple prose references and SQL examples used lowercase (`'active'`, `'paused_by_circuit_breaker'`); subagent reading lowercase examples would write code that fails enum constraint. Resolution: standardized all references to UPPER_SNAKE_CASE matching SQL enum — AD11 (2 spots), AD15 dispatcher predicate, AD17 dispatch SQL, AD21 deletion flow + cancel-mid-grace, frontmatter C-lock summary line, Step 5 cron-state JSDoc example; cross-cutting concerns paragraph updated; frontmatter line preserves lock-decision provenance with clarifying note
- Pass 2 outcome: 2 residual findings on lower end for 11-amendment cascade against 2,000+ line spec; both mechanical (stale reference + casing drift), neither structural; fixes localized, no further cascades

## Coherence Validation
- AD7 (PRI01 per-SKU writer) ↔ AD9 (cooperative-absorption skip-on-pending) ↔ AD10 (T2a→T2b write): all converge on `pending_import_id` invariant — any row with `pending_import_id IS NOT NULL` skipped by absorption AND tier-transition AND dispatcher; PRI02 COMPLETE clears column atomically across all participating rows
- AD11 (circuit breaker) ↔ AD15 (cron_state) ↔ F6 (denominator): per-cycle trip → `transitionCronState` to `'PAUSED_BY_CIRCUIT_BREAKER'` atomic with audit event per Step 5 pattern; manual unblock → back to `'ACTIVE'`; denominator query well-defined against `sku_channels.excluded_at`
- AD16 (onboarding sequence) ↔ F4 (PROVISIONING): customer pastes key → key-validate → `customer_marketplace` row created in `'PROVISIONING'` (default per F4) → `scan_job` created (FK target now exists) → A01 + PC01 + OF21 + P11 run populating nullable columns → scan completes → `transitionCronState` to `'DRY_RUN'`; CHECK constraint blocks transition if any A01/PC01 column still NULL
- F2 (Stripe customer-level) ↔ AD21 (deletion grace + `cancel_at_period_end`): `cancel_at_period_end=true` operates on Subscription (customer-level) so cancellation cancels whole Subscription = all marketplaces for that customer at end of billing period; marketplace-level removal (FR41 Epic 2) operates on SubscriptionItem instead; different operations on different Stripe objects
- F3 (auth+profile trigger) ↔ AD29 (NOT NULL fields) ↔ F4 (PROVISIONING): trigger creates `customers` and `customer_profiles` rows in one transaction; customer-marketplaces created later (when customer pastes first Worten key) = independent flow; trigger does NOT create `customer_marketplaces`; F4 PROVISIONING state is for that separate row; no interaction
- AD13 (self-filter) ↔ AD14 (P11 placeholder filter) ↔ Step 5 single-source `shared/mirakl/self-filter.js`: filter chain order well-defined — `active === true` → `total_price > 0` → `shop_name !== own_shop_name` → ranking; one module, one chain, no parallel implementations
- Pattern consistency: single-source-of-truth modules unchanged; `shared/state/cron-state.js` carries new PROVISIONING value through legal-transitions matrix (Bob Story 1.x); F13 normalized casing — all enum-value references UPPER_SNAKE_CASE; F2 `stripe_subscription_item_id` follows JSON snake_case; no amendment touched price math; F1 `tier-transition` event uses canonical `writeAuditEvent` pattern; F6 `circuit-breaker-trip` already canonical
- Structure alignment: `customer_profiles` trigger lives in same migration file as table per Step 5 (RLS policy + table same migration; trigger + table same migration); migration ordering well-defined — `customers` → `customer_profiles_with_trigger` → `founder_admins` → `customer_marketplaces` → `shop_api_key_vault` → `skus` → `sku_channels` → `baseline_snapshots` → `audit_log_event_types` → `audit_log_partitioned` → ...; all FK targets exist when their referencer migrates

## Requirements Coverage
- FR-A Account & Identity (FR1-FR7) ✅ Complete: F3 closed atomicity gap on FR1; FR4 amended deletion + AD21; FR5 RLS via AD2 + AD30; FR7 source-context middleware in app routes
- FR-B API Key & Catalog Onboarding (FR8-FR16) ✅ Complete: F4 closed schema chicken-and-egg on FR12-FR15; AD3 + AD16 cover encrypted vault + scan sequence
- FR-C Pricing Engine (FR17-FR25) ✅ Complete: F1 closed T2a→T2b cadence gap; AD8 enumerates decision table; AD13 + AD14 lock filter chain
- FR-D Engine Safety (FR26-FR33) ✅ Complete: F6 closed circuit-breaker denominator ambiguity; AD11 + AD12 layered (engine per-SKU, dispatcher per-cycle, anomaly per-SKU); FR33 `baseline_snapshots` table reserved
- FR-E Dashboard & Audit Log (FR34-FR39) ✅ Complete: F5 closed migration ordering gap; AD19 + AD20 with lookup table + trigger handle volume math + taxonomy enforcement
- FR-F Subscription & Billing (FR40-FR44) ✅ Complete: F2 closed Stripe model contradiction; F7 closed NIF capture flow; AD22 corrected
- FR-G Operations & Alerting (FR45-FR48) ✅ Complete: AD23 + AD24 + AD25 cover health + 3-tier failure model + alerts; F11 made worker count explicit
- NFR Performance (P1-P10) ✅ Complete: NFR-P10 catalog scan UNVERIFIED at MVP — empirical-verify script seeds latency floor (P11 ~140ms single call); calibrate during dogfood
- NFR Security (S1-S7) ✅ Complete: NFR-S1 envelope encryption (AD3 + `master_key_version`); NFR-S3 RLS (AD2 + AD30); NFR-S6 append-only via DB-level event_types lookup + trigger + no-FK on `audit_log` columns
- NFR Scalability (Sc1-Sc5) ✅ Complete: NFR-Sc3 advisory locks (AD17); F11 explicit single-worker default with horizontal-scale Epic 2 trigger
- NFR Reliability (R1-R5) ✅ Complete: F11 Coolify rollback + `worker_heartbeats` + `/health` composition; AD24 3-tier model
- NFR Integration Quality (I1-I6) ✅ Complete: all 5 external integrations mapped to specific files in Step 6 FR/AD→file table
- NFR Accessibility/Localization (A1-A3, L1-L2) ✅ Spec-locked: UX skeleton enforces; backend doesn't alter
- NFR Operational (O1-O3) ✅ Complete: all 3 documented founder-side commitments; Bob stories include runbook + monitoring dashboard

## Implementation Readiness
- Decision completeness: all 30 ADs carry decision + FR/NFR trace + MCP/empirical citation + Bob-story handoff; no TBD placeholders; 6 PRD gaps explicitly closed (engine decision table, PRI01/PRI02 race, Tier 2b cadence, audit-log indexing, /health composition, RLS-vs-service-role split)
- Structure completeness: Step 6 directory tree names every file location BAD subagents need; 14-table schema with full DDL; RLS policy intent declared per table; FR/AD→file mapping covers 30+ rows
- Pattern completeness: 11 single-source-of-truth modules locked (no parallel implementations possible without ESLint failure); 17 enumerated engine fixture files (executable spec for AD8); 10-rule mechanical enforcement matrix; naming + structure + format + communication + process patterns each with concrete examples (good vs anti-pattern)
- Verification artifact reuse: `scripts/mirakl-empirical-verify.js` doubles as Bob Story 1.X smoke test; `verification-results.json` (live Worten captures) seeds Mirakl mock server fixtures

## Pedro's Two Flagged Checks — Verified
- ✅ **Atomic auth+profile creation pattern**: F3 locked Postgres trigger pattern (option a); `SECURITY DEFINER`, validates required fields with `RAISE EXCEPTION`, rolls back atomically via Postgres transaction semantics; full DDL inline in schema; migration filename `202604301201_create_customer_profiles_with_trigger.sql` reflects inclusion
- ✅ **5 Epic 2 schema reservations** ALL LANDED: `customer_marketplaces.anomaly_threshold_pct` (numeric, nullable, defaults 0.40 in code) line 1707; `customer_marketplaces.tier_cadence_minutes_override` (jsonb, nullable) line 1709; `customer_marketplaces.edge_step_cents` (integer NOT NULL DEFAULT 1) line 1706; `skus.cost_cents` (integer, nullable) Step 6 schema reservation table; `skus.excluded_at` (timestamptz, nullable) Step 6 schema reservation table; bonus `shop_api_key_vault.master_key_version` (integer NOT NULL DEFAULT 1) supports AD3 rotation; bonus post-F10 `customer_marketplaces.sustained_transient_cycle_threshold` flagged for Epic 2 (no MVP column)

## Architecture Readiness Assessment
- **Status**: READY FOR IMPLEMENTATION
- **Confidence**: HIGH
- Confidence drivers: empirical grounding against live Worten via Easy-Store (not just MCP doc reading); two-pass validation caught 13 issues (11 + 2) and fixed all; single-source-of-truth + ESLint enforcement makes BAD subagent divergence mechanically impossible; engine fixture set (16+1 cases) provides executable spec for highest-leverage AD; Bob-story trace for every AD removes 'where does this live' rederivation
- Key strengths:
  - Empirical verification before lock (`channel_pricing=SINGLE`, `csv_delimiter=SEMICOLON`, `decimals=2`, `total_price=0` placeholder reality, `shop_id=null` in P11)
  - Trust as architectural property (encrypted-at-rest with master on Hetzner / ciphertext on Supabase, append-only audit log enforced at DB layer via lookup table + trigger + no-FK, pause-as-freeze, dry-run-by-default, customer-self-flip Go-Live)
  - Single-source-of-truth discipline (11 modules + ESLint custom rules + mechanical enforcement matrix)
  - Schema designed for Epic 2 without migration (6 reservation columns; concierge-to-self-serve marketplace add path; cost-CSV / per-SKU exclude / customer-tunable thresholds all column-only changes)
  - Two-pass validation with 13 fixes documented inline

## Architecture Completeness Checklist
- ✅ Requirements Analysis: PRD (51 FRs across 7 groups) and UX skeleton (38 UX requirements) loaded and mapped; all NFRs traced to architectural answers; empirical reality (Worten via Easy-Store, 2026-04-30) grounds Mirakl-touching decisions; 5 reference repos surveyed (DPI reused; Gabriel partial; OUTREACH/PRICING skipped)
- ✅ Architectural Decisions: 30 numbered ADs each with FR/NFR + MCP/empirical citation + Bob-story trace; 6 explicit PRD gaps closed (engine decision table, race resolution, cadence values, audit-log indexing, /health, RLS+service-role split); 15 MCP verification questions resolved (10 from PRD/distillate + 5 added during work); critical pre-locks captured (A1 deletion+Stripe, B1 envelope encryption, C single cron_state enum, engine edge-step logic, schema reservations, customer profile NOT NULL fields)
- ✅ Implementation Patterns: 11 single-source-of-truth modules locked; naming + structure + format + communication + process patterns with examples; 10-rule mechanical enforcement matrix (ESLint custom rules + secret-scanning + RLS regression suite); 17 engine fixture cases enumerated; Mirakl mock server seed strategy (`verification-results.json` → fixtures)
- ✅ Project Structure: complete directory tree (every file location); 14-table schema with full DDL, RLS policies, indexes, triggers, CHECK constraints; migration file ordering with FK target verification; FR/AD→file mapping (30+ rows); external + internal integration boundaries; engine cycle data flow trace (load-bearing flow)
- ✅ Validation: Pass 1 (11 findings, all addressed via inline amendments); Pass 2 (2 residual findings — stale reference, casing drift — addressed); coherence cross-checks across 6 critical AD intersections; Pedro flagged checks verified; schema reservations confirmed

## Epic 2 Future Enhancements
- HTMX upgrade for audit log if 5-surface IA gets gnarly
- TypeScript migration if JSDoc churn exceeds tolerance
- Cost-CSV upload + cost-based formula
- Customer-tunable anomaly threshold + transient-failure threshold
- Self-serve marketplace add/remove
- Multi-marketplace beyond Worten (Phone House ES, Carrefour ES, PCComponentes, MediaMarkt)
- Moloni API integration
- Restore-baseline UI
- HTMX-ready URL namespace already reserved

## UNVERIFIED Items (calibrate during dogfood)
- NFR-P10 catalog scan throughput (50k SKUs in 4h) — empirical floor in place, full scan calibration during dogfood
- PRI01 CSV decimal separator (period vs comma) — Worten dogfood calibration
- PRI01 idempotency at prices-state level — confirmed via MCP, validate operationally during dogfood
- Worten/Mirakl operator ToS compatibility for automated repricing — pre-revenue legal review

## Minor Flags Non-Blocking (cleanup during sharding, post-Step-4 sweep 2026-04-30)
- Item 9 Story 1.5 `admin_access_denied` PII minimization — log SHA-256 first 8 hex of email or pino redaction list, decision at first GDPR review or first founder-side incident
- Item 10 Story 4.3 sign-off recording convention — PR comment vs `_bmad-output/sign-offs/story-4.3.md`, Pedro picks during first sign-off
- Item 11 UX-DR26 mobile bottom action bar safe-area inset (OQ-7) — Story 8.12 AC notes Step 4 verification on iPhone SE / iPhone 14 simulators (`env(safe-area-inset-bottom)`); Sally Pass 2 visual review
- Item 12 `pri02-complete` event granularity volume sanity — one event per affected `sku_channel` may multiply audit-row volume; if live volume exceeds AD19 ~3M/quarter/customer AND threatens NFR-P8 2s budget on 90-day audit-log filter, switch to one aggregate `pri02-complete-batch` event per `import_id` (per-SKU detail nested in JSONB); schema change forward-only
- Item 13 Story 9.6 `audit_log_atencao_archive` placement — at MVP in-DB single non-partitioned table; Phase 2 trigger to evaluate S3-equivalent external archive when scale demands (Postgres disk pressure on Supabase, or Atenção retention beyond customer-account-lifetimes)
- Item 14 Story 11.4 concierge marketplace-add CLI security review — pre-customer-#2 review of cleartext-key handling (terminal masking via `process.stdin.setRawMode(true)` + memory-only retention + zero-disk-write + CLI process exit clears heap reference)
- Item 15 Story 11.5 `moloni_invoices.customer_id` FK ON DELETE NO ACTION — fiscal archive retention per AD21; deletion-grace cron (Story 10.3) handles orphan-FK by NOT deleting `moloni_invoices` rows during T+7d hard-delete
- Item 16 Story 12.3 `critical-alert-platform-features-changed.eta` — 9th PT-localized Resend template OR generic `critical-alert.eta` with payload-driven body, Bob picks during Story 12.3 sharding; `shared/resend/client.js` accepts arbitrary template names per AD25
