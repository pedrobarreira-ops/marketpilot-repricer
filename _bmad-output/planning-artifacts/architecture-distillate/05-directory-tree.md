This section is the complete project directory tree (every file location BAD subagents need); migration ordering with F-amendment inline comments. Part 5 of 9 from `architecture.md`.

## Complete Project Directory Tree

```
marketpilot-repricer/
├── README.md                           # one-page: stack, deploy targets, "see _bmad-output/ for everything"
├── CLAUDE.md                           # already exists; project guardrails
├── package.json                        # single npm package, two start commands (start:app / start:worker)
├── package-lock.json
├── .env.example                        # template — every env var name, no values
├── .env.local                          # gitignored; local dev secrets
├── .env.test                           # test env (test DB connection, mock keys)
├── .gitignore
├── .nvmrc                              # 22 (Node version)
├── .editorconfig
├── eslint.config.js                    # base config; references ./eslint-rules/
├── eslint-rules/                       # custom rules (lands incrementally per Bob's note)
│   ├── no-raw-error-to-template.js
│   ├── worker-must-filter-by-customer.js
│   ├── single-source-of-truth.js       # one rule with multiple module enforcements
│   └── no-direct-fetch.js
│
├── _bmad-output/                       # planning artifacts (already exists)
│   └── planning-artifacts/
│       ├── product-brief-marketpilot-repricer.md
│       ├── product-brief-marketpilot-repricer-distillate.md
│       ├── prd.md
│       ├── ux-skeleton.md
│       └── architecture.md             # this file
│
├── app/                                # Fastify public service (app.marketpilot.pt)
│   └── src/
│       ├── server.js                   # entry point: npm run start:app
│       ├── routes/                     # one file per route group
│       │   ├── _public/                # unauthenticated
│       │   │   ├── signup.js           # FR1, FR7 (source-context capture); AD29 atomic profile
│       │   │   ├── login.js
│       │   │   ├── verify-email.js
│       │   │   ├── forgot-password.js  # FR3
│       │   │   └── reset-password.js   # FR3
│       │   ├── onboarding/             # FR8–FR16; AD16 sequence
│       │   │   ├── key.js              # GET form + POST validate (FR8, FR9, FR10)
│       │   │   ├── scan.js             # GET progress page + status polling (FR12, FR13, FR14)
│       │   │   ├── scan-ready.js       # UX skeleton §8.3
│       │   │   └── margin.js           # FR16 single onboarding question
│       │   ├── dashboard/              # FR30–FR39
│       │   │   ├── index.js            # GET / — KPI cards + state-aware view (UX §3.1)
│       │   │   ├── pause-resume.js     # POST /pause, /resume (FR32; AD15 cron-state transition)
│       │   │   ├── go-live.js          # POST /go-live (FR31; informed-consent confirmation)
│       │   │   └── margin-edit.js      # POST /margin (FR36 save)
│       │   ├── audit/                  # FR37, FR38, FR38b/c/d
│       │   │   ├── index.js            # GET /audit — 3-surface stack (Daily / Atenção / Notável)
│       │   │   ├── _fragments/         # HTMX-ready partials (URL space reserved per Step 5)
│       │   │   │   ├── atencao-feed.js
│       │   │   │   ├── notavel-feed.js
│       │   │   │   └── search-by-sku.js
│       │   │   ├── search.js           # GET /audit?sku=EAN
│       │   │   ├── firehose.js         # GET /audit/firehose (UX §4.1.5)
│       │   │   └── anomaly-review.js   # POST /audit/anomaly/:sku/{accept|reject} (FR29)
│       │   ├── settings/
│       │   │   ├── account.js          # email/password
│       │   │   ├── key.js              # vault status + rotate flow (UX §5.2)
│       │   │   ├── marketplaces.js     # FR41 read-only at MVP (UX §8.5)
│       │   │   ├── billing.js          # Stripe Customer Portal link
│       │   │   └── delete.js           # FR4 amended; AD21 4-step flow
│       │   ├── interceptions/          # routes that override / on landing (UX §3.1 + §8.1)
│       │   │   ├── key-revoked.js      # paused_by_key_revoked
│       │   │   ├── payment-failed.js   # paused_by_payment_failure
│       │   │   └── scan-failed.js      # FR15
│       │   ├── admin/                  # AD4 founder-only
│       │   │   └── status.js           # /admin/status (UX §7)
│       │   ├── _webhooks/              # machine-callable, never linked from UI
│       │   │   └── stripe.js           # AD22 webhook signature + replay protection
│       │   └── health.js               # AD23 — UptimeRobot endpoint
│       ├── views/                      # eta templates (PT-localized)
│       │   ├── layouts/
│       │   │   └── default.eta         # sticky header + banner zone + body slot + footer
│       │   ├── components/
│       │   │   ├── kpi-cards.eta       # FR34 (3 status cards from free-report family)
│       │   │   ├── margin-editor.eta   # FR36 inline panel
│       │   │   ├── audit-feeds.eta     # 3-surface stack
│       │   │   ├── banners.eta         # UX skeleton §9 banner library, precedence-aware
│       │   │   └── pause-button.eta
│       │   ├── pages/                  # one per route
│       │   │   ├── dashboard.eta
│       │   │   ├── audit.eta
│       │   │   ├── onboarding-key.eta
│       │   │   ├── onboarding-scan.eta
│       │   │   ├── onboarding-scan-ready.eta
│       │   │   ├── onboarding-margin.eta
│       │   │   ├── settings-*.eta      # one per /settings route
│       │   │   ├── interception-*.eta  # one per interception route
│       │   │   └── admin-status.eta
│       │   ├── modals/
│       │   │   ├── go-live-consent.eta # FR31 (UX §9.1)
│       │   │   └── anomaly-review.eta  # FR29 (UX §9.2)
│       │   ├── partials/               # smaller reusables (alert pills, status badges, etc.)
│       │   └── emails/                 # PT-localized Resend templates
│       │       ├── critical-alert.eta
│       │       ├── deletion-confirmation.eta # AD21 step 3
│       │       ├── deletion-grace-reminder.eta # AD21 day-5 reminder
│       │       └── scan-failed.eta     # FR15
│       ├── middleware/
│       │   ├── auth.js                 # Supabase Auth session check; redirect to /login
│       │   ├── rls-context.js          # binds JWT to RLS-aware DB client
│       │   ├── csrf.js                 # @fastify/csrf-protection wiring
│       │   ├── source-context-capture.js # FR7 (?source / ?campaign)
│       │   ├── error-handler.js        # global Fastify error handler — safe PT messages
│       │   └── interception-redirect.js # AD15 — checks customer_marketplace.cron_state on /
│       └── lib/                        # app-only helpers (NOT shared/)
│           ├── session.js
│           ├── view-helpers.js         # eta helpers: formatEur, formatLisbon, etc.
│           └── format.js               # money/date display formatters
│
├── worker/                             # cron service (no public URL)
│   └── src/
│       ├── index.js                    # entry: npm run start:worker; starts cron + heartbeat
│       ├── dispatcher.js               # AD17 — master 5-min poll + advisory locks
│       ├── advisory-lock.js            # pg_try_advisory_lock wrapper
│       ├── engine/
│       │   ├── decide.js               # AD8 — full decision table (decideForSkuChannel)
│       │   ├── tier-classify.js        # AD10
│       │   ├── cooperative-absorb.js   # AD9 — skip-on-pending semantics
│       │   └── kpi-derive.js           # cycle-end aggregation → cycle_summaries
│       ├── safety/
│       │   ├── circuit-breaker.js      # AD11 — per-cycle 20% (per-SKU 15% lives in engine/decide.js)
│       │   ├── anomaly-freeze.js       # AD12
│       │   └── reconciliation.js       # nightly Tier 3 pass (FR28)
│       ├── jobs/
│       │   ├── master-cron.js          # node-cron: every 5 min → dispatcher
│       │   ├── pri02-poll.js           # node-cron: every 5 min → resolve pending imports
│       │   ├── deletion-grace.js       # node-cron: daily at midnight Lisbon → process T+7d deletions
│       │   ├── pc01-monthly-repull.js  # AD26 — monthly platform-features-changed detection
│       │   ├── daily-kpi-aggregate.js  # AD19 — midnight refresh + 5-min "today" partial
│       │   ├── monthly-partition-create.js # AD19 — last-day-of-month creates next month's audit_log partition
│       │   ├── audit-log-archive.js    # AD19 — detach old partitions
│       │   └── heartbeat.js            # AD23 — every 30s
│       └── lib/
│           └── batch-utils.js
│
├── shared/                             # imported by both app/ and worker/
│   ├── audit/                          # AD20 single source of truth for audit log
│   │   ├── writer.js                   # writeAuditEvent — atomic with state mutation
│   │   ├── event-types.js              # enum + priority mapping + @typedef PayloadFor<EventType>
│   │   └── readers.js                  # query helpers for the 5 surfaces (UX §4.1)
│   ├── crypto/                         # AD3
│   │   ├── envelope.js                 # AES-256-GCM encrypt/decrypt
│   │   └── master-key-loader.js        # process-start validation
│   ├── db/                             # AD2
│   │   ├── rls-aware-client.js         # app factory (JWT-scoped)
│   │   ├── service-role-client.js      # worker factory (cross-customer)
│   │   └── tx.js                       # transaction helpers
│   ├── mirakl/                         # AD5–AD7, AD13, AD14, AD16
│   │   ├── api-client.js               # mirAklGet — single source of truth (AD5)
│   │   ├── a01.js                      # GET /api/account
│   │   ├── pc01.js                     # GET /api/platform/configuration
│   │   ├── of21.js                     # GET /api/offers (paginated own catalog)
│   │   ├── p11.js                      # GET /api/products/offers (per-channel)
│   │   ├── pri01-writer.js             # AD7 — CSV builder + multipart submit, per-SKU aggregation
│   │   ├── pri02-poller.js             # AD7 — status polling
│   │   ├── pri03-parser.js             # AD24 — error report parser
│   │   ├── self-filter.js              # AD13 + AD14 — filterCompetitorOffers chain
│   │   └── safe-error.js               # AD5 — getSafeErrorMessage (PT-localized)
│   ├── money/                          # AD-pattern: integer cents discipline
│   │   └── index.js                    # toCents, fromCents, roundFloorCents, roundCeilingCents
│   ├── state/
│   │   ├── cron-state.js               # AD15 — transitionCronState (atomic + audit)
│   │   ├── sku-freeze.js               # AD12 — freezeSkuForReview, unfreezeSku
│   │   └── transitions-matrix.js       # legal-transitions enum (read at top of cron-state.js)
│   ├── stripe/                         # AD22
│   │   ├── webhooks.js                 # signature verify + replay protection (NFR-S4)
│   │   ├── subscriptions.js            # idempotent mutations (NFR-I2)
│   │   └── customer-portal.js          # link generator
│   ├── resend/                         # AD25
│   │   └── client.js                   # PT-localized critical-alert sender
│   ├── moloni/                         # AD22 (manual at MVP; API stub for Epic 2)
│   │   └── invoice-metadata.js         # write moloni_invoices row from manual workflow
│   └── config/
│       └── runtime-env.js              # validates required env vars at process start
│
├── supabase/                            # Supabase CLI directory (config + migrations)
│   ├── config.toml                      # local-stack config
│   └── migrations/                      # Supabase CLI-managed; append-only
│       ├── 202604301200_create_customers.sql
│       ├── 202604301201_create_customer_profiles_with_trigger.sql  # F3: includes handle_new_auth_user trigger on auth.users
│       ├── 202604301202_create_founder_admins.sql
│       ├── 202604301203_create_customer_marketplaces.sql
│       ├── 202604301204_create_shop_api_key_vault.sql
│       ├── 202604301205_create_skus.sql
│       ├── 202604301206_create_sku_channels.sql
│       ├── 202604301207_create_baseline_snapshots.sql
│       ├── 20260430120730_create_audit_log_event_types.sql  # F5: lookup table seeded with AD20 taxonomy; MUST run before audit_log
│       ├── 202604301208_create_audit_log_partitioned.sql
│       ├── 202604301209_create_daily_kpi_snapshots.sql
│       ├── 202604301210_create_cycle_summaries.sql
│       ├── 202604301211_create_scan_jobs.sql
│       ├── 202604301212_create_worker_heartbeats.sql
│       ├── 202604301213_create_moloni_invoices.sql
│       ├── 202604301214_create_pri01_staging.sql
│       ├── 202604301215_add_pri01_consecutive_failures_to_sku_channels.sql  # Story 6.3 escalation tracking (AD24)
│       └── 202604301216_add_day5_reminder_sent_at_to_customers.sql          # Story 10.3 day-5 reminder idempotency (AD21)
│
├── db/
│   └── seed/
│       ├── dev/                        # local-dev seed data (2 fake customers for RLS tests)
│       └── test/                       # test-runner seed data
│
├── public/                             # served by @fastify/static
│   ├── css/
│   │   ├── tokens.css                  # OKLCH tokens carrying from MarketPilot.html (UX §10)
│   │   ├── layout.css                  # 1400px container, sticky header
│   │   └── components.css              # KPI cards, banners, modal, margin editor
│   ├── js/                             # per-page vanilla modules (no bundler)
│   │   ├── dashboard.js                # channel-toggle + pause confirmation
│   │   ├── audit.js                    # filter-form submission + sticky search
│   │   ├── margin-editor.js            # 150ms-debounced live worked-profit-example (UX §4.3)
│   │   ├── pause-resume.js             # confirmation modal trigger
│   │   ├── go-live-modal.js            # checkbox→Stripe wiring
│   │   ├── anomaly-review.js           # accept/reject submit
│   │   └── delete-account.js           # ELIMINAR phrase validation client-side
│   │   # F9: each eta page template includes its corresponding script via
│   │   # <script src="/js/<page>.js" defer></script> near </body>. No bundler.
│   │   # `defer` ensures scripts execute after HTML parse but before
│   │   # DOMContentLoaded. type="module" only declared per-script if ES syntax requires.
│   ├── images/
│   └── favicon.ico
│
├── scripts/
│   ├── mirakl-empirical-verify.js      # AD16 reuse — already exists; first-customer smoke test
│   ├── rotate-master-key.md            # AD3 runbook (markdown, not executable)
│   ├── check-no-secrets.sh             # AD3 pre-commit hook
│   ├── rls-regression-suite.js         # AD30 — runs in CI on every deploy
│   └── seed-test-data.js               # populates db/seed/test/ into a fresh test DB
│
└── tests/
    ├── shared/
    │   ├── mirakl/
    │   │   ├── api-client.test.js
    │   │   ├── pri01-writer.test.js     # uses tests/fixtures/pri01-csv/ golden files
    │   │   ├── pri02-poller.test.js
    │   │   ├── pri03-parser.test.js
    │   │   ├── self-filter.test.js     # references p11 fixtures with placeholder zero-price + collisions
    │   │   ├── safe-error.test.js
    │   │   └── a01-pc01.test.js
    │   ├── audit/
    │   │   └── writer.test.js
    │   ├── crypto/
    │   │   └── envelope.test.js
    │   ├── money/
    │   │   └── index.test.js           # rounding direction asserts
    │   ├── state/
    │   │   ├── cron-state.test.js      # legal-transitions matrix coverage + concurrency rejection
    │   │   └── sku-freeze.test.js
    │   └── stripe/
    │       └── webhooks.test.js
    ├── worker/
    │   └── src/
    │       ├── engine/
    │       │   ├── decide.test.js       # references all 17 P11 fixtures (Step 5 enumeration)
    │       │   └── tier-classify.test.js
    │       └── safety/
    │           ├── circuit-breaker.test.js
    │           └── anomaly-freeze.test.js
    ├── integration/
    │   ├── rls-regression.test.js       # AD30
    │   ├── onboarding-flow.test.js      # signup → key → A01 → PC01 → OF21 → P11 → margin → dashboard
    │   ├── go-live-flow.test.js         # dry-run → consent modal → Stripe → cron flips active
    │   ├── deletion-grace.test.js       # 4-step + 7-day grace + cancel-mid-grace
    │   ├── pri01-pri02-cycle.test.js    # full write→poll→complete cycle against mock
    │   └── circuit-breaker-trip.test.js # synthesize 21% catalog change → cycle halt + audit + alert
    ├── fixtures/
    │   ├── p11/                         # 17 fixtures enumerated in Step 5 (DO NOT remove)
    │   │   ├── p11-tier1-undercut-succeeds.json
    │   │   ├── p11-tier1-floor-bound-hold.json
    │   │   ├── p11-tier1-tie-with-competitor-hold.json
    │   │   ├── p11-tier2a-recently-won-stays-watched.json
    │   │   ├── p11-tier2b-ceiling-raise-headroom.json
    │   │   ├── p11-tier3-no-competitors.json
    │   │   ├── p11-tier3-then-new-competitor.json
    │   │   ├── p11-all-competitors-below-floor.json
    │   │   ├── p11-all-competitors-above-ceiling.json
    │   │   ├── p11-self-active-in-p11.json
    │   │   ├── p11-self-marked-inactive-but-returned.json
    │   │   ├── p11-single-competitor-is-self.json
    │   │   ├── p11-zero-price-placeholder-mixed-in.json
    │   │   ├── p11-shop-name-collision.json
    │   │   ├── p11-pri01-pending-skip.json
    │   │   ├── p11-cooperative-absorption-within-threshold.json
    │   │   └── p11-cooperative-absorption-anomaly-freeze.json
    │   ├── pri01-csv/                    # golden-file expected outputs
    │   │   ├── single-channel-undercut.csv
    │   │   ├── multi-channel-passthrough.csv
    │   │   └── pri03-recovery-resubmit.csv
    │   ├── a01/                          # captured A01 responses (Easy-Store + future ops)
    │   │   └── easy-store-2026-04-30.json # from verification-results.json
    │   ├── pc01/                         # captured PC01 responses
    │   │   └── worten-2026-04-30.json   # SINGLE / SEMICOLON / 2 — production-grounded
    │   └── of21/                         # captured OF21 responses
    │       └── easy-store-test-sku-2026-04-30.json
    └── mocks/
        └── mirakl-server.js              # Fastify mock; replays fixtures; seeded from verification-results.json
```
