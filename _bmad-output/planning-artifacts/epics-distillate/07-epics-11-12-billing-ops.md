---
type: bmad-distillate-section
sources:
  - "../epics.md"
parent: "_index.md"
part: 7
of: 8
---

This section covers Epic 11 Billing — Stripe & Moloni (5 stories) and Epic 12 Operations & Failure Model (3 stories) — 8 stories total. Part 7 of 8 from epics.md.

## Epic 11: Billing — Stripe & Moloni

**Goal.** Customer billed via Stripe €50/marketplace/month on first Go-Live click. ONE Stripe Customer + ONE Stripe Subscription per MarketPilot customer (per F2); ONE SubscriptionItem per `customer_marketplace`. Stripe webhook drives `cron_state` transitions for payment-failure pause (with signature + replay protection). Founder generates Moloni invoices manually with PT NIF/IVA compliance; NIF captured at first Moloni invoice per F7. Concierge marketplace-add operates server-side (no self-serve UI at MVP).

**Coverage:** FR40, FR41 MVP, FR42 (refund — see split note), FR43, FR44; NFR-S4, NFR-S7, NFR-I2; ADs AD22 (with F2 + F7 + F12). UX-DR38.

**FR42 split (3 components, NONE customer-facing dev stories):**
1. **Legal track** — ToS clause "first-month money-back guarantee within 14 days of Go-Live, no questions asked"
2. **Operational track** — runbook for issuing the refund manually via Stripe Dashboard
3. **Optional Epic 8 micro-story** — small "Issue refund (Stripe Portal link)" link surfaced on `/admin/status`

**NFR-O4 binding:** → Story 11.5 (Moloni manual-invoice 24h SLA, ≤10min/invoice, 2-3hr/month aggregate Moloni-API Phase 2 trigger). NFR-O4 is operational-tier work supported by Story 11.5's `recordMoloniInvoice` admin route; the SLA itself is a founder commitment, the supporting tooling is dev work.

**Phase 2 reservations:** Schema supports multi-marketplace from day 1; Phase 2 ships self-serve add/remove UI without migration. Moloni API integration triggered Phase 2 when founder time exceeds 2-3 hr/month aggregate (today: manual ~5-10 min/customer/month).

---

### Story 11.1: Stripe Customer + Subscription + first SubscriptionItem creation on Go-Live (consumed by Story 8.6)
- **Trace:** Implements AD22 (with F2 + F12 schema linkage corrected); FRs FR40; NFRs NFR-I2 (idempotency on mutations), NFR-S7 (no card data stored — Stripe handles PCI-DSS). Size M.
- **Bob-trace:** SSoT: `shared/stripe/subscriptions.js` (`createCustomerAndSubscription`, `addSubscriptionItem`, `cancelSubscriptionAtPeriodEnd`, `getSubscriptionStatus`). Depends on Story 1.4 (customers.stripe_customer_id + stripe_subscription_id columns), Story 4.1 (customer_marketplaces.stripe_subscription_item_id column), Story 1.3 (pino redaction includes STRIPE_SECRET_KEY). Enables Story 8.6 (Go-Live consent modal calls into this), Story 11.2 (webhook handler), Story 11.3 (Customer Portal link), Story 10.1 (cancelSubscriptionAtPeriodEnd at deletion initiation), Story 11.4 (concierge marketplace-add).
- **Acceptance Criteria:**
  1. **Given** `shared/stripe/subscriptions.js` exports `createCustomerAndSubscription({customerId, customerMarketplaceId, customerEmail, paymentMethodId})` **When** called from Story 8.6's Go-Live consent flow (the FIRST customer_marketplace transitioning to ACTIVE) **Then** the function calls Stripe API to create:
      1. ONE Stripe Customer with metadata `{marketpilot_customer_id: customerId, customer_email: customerEmail}` — uses idempotency key `customer:${customerId}:create` per NFR-I2
      2. ONE Stripe Subscription on the new Customer with `cancel_at_period_end: false`, billing_cycle_anchor=now, items=[{price: 'price_marketplace_eur_50_per_month'}] — idempotency key `subscription:${customerId}:create`
      3. The single SubscriptionItem from the Subscription's `items.data[0]`
    **And** persists in ONE DB transaction:
      - `UPDATE customers SET stripe_customer_id = $1, stripe_subscription_id = $2 WHERE id = $3`
      - `UPDATE customer_marketplaces SET stripe_subscription_item_id = $1 WHERE id = $2`
    **And** returns `{stripeCustomerId, stripeSubscriptionId, stripeSubscriptionItemId}` for the caller to confirm before transitioning cron_state to ACTIVE.
  2. **Given** `addSubscriptionItem({customerId, customerMarketplaceId})` for Story 11.4 concierge marketplace-add **When** called for a SECOND (or later) customer_marketplace **Then** the function reads `customers.stripe_subscription_id` (from the first Go-Live), adds a new SubscriptionItem to that EXISTING Subscription via Stripe API — idempotency key `subscription_item:${customerMarketplaceId}:create` **And** Stripe proration applies (Stripe default: prorated charge for the partial period) **And** persists `stripe_subscription_item_id` on the new customer_marketplaces row.
  3. **Given** `cancelSubscriptionAtPeriodEnd({customerId})` for Story 10.1 deletion-initiation **When** called **Then** the function calls `subscription.update({ cancel_at_period_end: true })` on the customer's Subscription **And** Stripe stops renewing at end of current billing period; NO automatic refund for grace-period days (per AD21 + A1 lock) **And** idempotency key `subscription:${customerId}:cancel:${attemptId}` per NFR-I2 (attemptId is a fresh UUID per call to allow retries without effect).
  4. **Given** `getSubscriptionStatus({customerId})` is a read-only helper **When** called **Then** returns `{status, currentPeriodEnd, items: [{customerMarketplaceId, stripeSubscriptionItemId}]}` — used by Story 11.3 billing page to show current plan summary.
  5. **Given** the Stripe SDK initialization **When** the module loads **Then** it reads `STRIPE_SECRET_KEY` from env and verifies it starts with `sk_live_` or `sk_test_` (sanity check; reject startup with clear error if missing) **And** the secret is NEVER logged (Story 1.3 redaction list includes `STRIPE_SECRET_KEY`).
  6. **Given** unit tests in `tests/shared/stripe/subscriptions.test.js` **When** I run them against the Stripe SDK's mocked test mode **Then** they cover: createCustomerAndSubscription happy path; idempotency key reuse returns same result without duplicate creation; addSubscriptionItem on existing Subscription; cancelSubscriptionAtPeriodEnd preserves history; STRIPE_SECRET_KEY redaction in error stacks.

---

### Story 11.2: Stripe webhook `/_webhooks/stripe` — signature + replay protection + idempotency + cron_state transitions for ALL marketplaces
- **Trace:** Implements AD22 (webhook half); FRs FR43; NFRs NFR-S4 (signature + replay), NFR-I2 (idempotent webhook handling). Size L.
- **Bob-trace:** SSoT: `app/src/routes/_webhooks/stripe.js`, `shared/stripe/webhooks.js` (`verifySignature`, `checkReplay`, `processEvent`). Migration: `db/migrations/202604301215_create_stripe_webhook_events.sql` (idempotency tracking table — stores `(stripe_event_id, processed_at)` pairs). Depends on Story 4.1 (transitionCronState helper), Story 11.1 (Stripe SDK), Story 9.0 + Story 9.1 (audit emissions for `payment-failure-pause`), Story 4.6 + Story 12.2 (Resend client + templates for critical alert). Enables subscription state changes drive cron_state transitions across customer's marketplaces.
- **Acceptance Criteria:**
  1. **Given** the route `POST /_webhooks/stripe` (no auth middleware — public endpoint with signature-based authentication) **When** Stripe sends a webhook **Then** the route reads the raw body (NOT JSON-parsed yet — signature verification needs raw bytes per Stripe spec) and the `Stripe-Signature` header **And** calls `shared/stripe/webhooks.js`'s `verifySignature(rawBody, signatureHeader, STRIPE_WEBHOOK_SECRET)` — uses Stripe SDK's `webhooks.constructEvent()` which validates HMAC-SHA256 + timestamp tolerance **And** rejects with 401 if signature mismatches; 400 if signature header missing.
  2. **Given** signature verification passes **When** the route checks replay protection **Then** the request's timestamp (from the signature header's `t=` field) is compared against NOW(); if delta > 5 minutes (per NFR-S4), reject with 400 **And** the timestamp tolerance is configurable via env var `STRIPE_WEBHOOK_REPLAY_WINDOW_SEC` defaulting to `300`.
  3. **Given** the event passes signature + replay checks **When** the route checks idempotency **Then** it queries `SELECT 1 FROM stripe_webhook_events WHERE stripe_event_id = $1 LIMIT 1` (stored at first processing); if found → respond 200 immediately (Stripe expects 200 to stop retrying; we already processed this event) **And** if not found → process the event (below) AND insert `(stripe_event_id, processed_at)` row in the same transaction **And** the table has `stripe_event_id text PRIMARY KEY, processed_at timestamptz NOT NULL DEFAULT NOW()` + an index for retention pruning (Bob optionally adds a monthly cron to prune events older than 30 days — Stripe keeps event history accessible via API anyway).
  4. **Given** the event router (`processEvent({event, tx})`) **When** the event type is `customer.subscription.deleted` OR `customer.subscription.updated` with `status === 'canceled'` **Then** for the customer identified by `event.data.object.customer` (Stripe customer ID), the handler:
      1. Loads the MarketPilot customer via `SELECT id FROM customers WHERE stripe_customer_id = $1`
      2. Loads ALL their customer_marketplaces (one Subscription per customer per F2; Subscription cancel = all marketplaces affected)
      3. For each marketplace currently in ACTIVE state: `transitionCronState({tx, from: 'ACTIVE', to: 'PAUSED_BY_PAYMENT_FAILURE'})` — this `(from, to)` IS in Story 4.1's per-(from,to) audit event map → emits `payment-failure-pause` Atenção
      4. Marketplaces NOT in ACTIVE (e.g., already in DRY_RUN or PAUSED_BY_CUSTOMER) are SKIPPED — no transition
      5. Sends ONE critical alert email to the customer via `shared/resend/client.js` (Story 12.2's `critical-alert-payment-failure-pause.eta` template) with consolidated context (all affected marketplaces in one email, not N separate emails)
  5. **Given** the event type is `invoice.payment_succeeded` **When** processed **Then** the handler is a no-op at MVP (founder generates Moloni invoice manually per Story 11.5; Phase 2 trigger to auto-generate) **And** logs at `info` level for observability.
  6. **Given** the event type is `customer.subscription.updated` with `cancel_at_period_end: true` (set by Story 10.1's deletion initiation) **When** processed **Then** no immediate cron_state transition (the customer is already in PAUSED_BY_ACCOUNT_GRACE_PERIOD per Story 10.1's transaction) **And** the eventual `customer.subscription.deleted` arrives at end of billing period and DOES trigger the transition path above — but customer's cron_state is already PAUSED_BY_ACCOUNT_GRACE_PERIOD; the `(PAUSED_BY_ACCOUNT_GRACE_PERIOD, PAUSED_BY_PAYMENT_FAILURE)` transition is NOT in `LEGAL_CRON_TRANSITIONS` → the handler detects this case and skips silently (the deletion-grace cron will hard-delete the account anyway).
  7. **Given** all other event types **When** processed **Then** logged at `debug` level; no action; idempotency record inserted to short-circuit retries.
  8. **Given** an integration test **When** I run `tests/integration/stripe-webhook.test.js` **Then** it covers: valid signature → processed; invalid signature → 401; replay >5min → 400; duplicate event_id → 200 immediate; subscription.deleted → ALL customer's marketplaces transitioned to PAUSED_BY_PAYMENT_FAILURE + payment-failure-pause Atenção emitted + critical alert sent (mock Resend received); subscription canceled while in PAUSED_BY_ACCOUNT_GRACE_PERIOD → silent skip.

---

### Story 11.3: `/settings/billing` page + Stripe Customer Portal link
- **Trace:** Implements AD22 (Customer Portal link delegation); FRs FR40, FR43 (customer self-manages payment method via Stripe Portal). Size S.
- **Bob-trace:** SSoT: `app/src/routes/settings/billing.js` (replaces Story 8.11's stub), `shared/stripe/customer-portal.js` (`createPortalLink`). Depends on Story 8.11 (settings sectioned nav scaffold), Story 11.1 (`stripe_customer_id` persisted, `getSubscriptionStatus` helper). Enables customer manages payment method, views invoices, cancels subscription via Stripe-owned UX.
- **Pattern A/B/C contract:**
  - Behavior: FR40, FR43
  - Structure: UX skeleton §4.4 settings architecture
  - Visual: Pattern C — UX skeleton §4.4 settings + visual-DNA tokens (consistent chrome from Story 8.11).
- **Acceptance Criteria:**
  1. **Given** the route `GET /settings/billing` **When** an authenticated customer visits **Then** the page renders:
      - Current plan summary: `€50 × {N} marketplaces / month` where N is `SELECT COUNT(*) FROM customer_marketplaces WHERE customer_id = $1`
      - Next billing date from `getSubscriptionStatus({customerId}).currentPeriodEnd` formatted via `formatLisbon` helper
      - List of recent invoices (last 12 from Stripe API or cached in `moloni_invoices` from Story 11.5) with download links
      - "Abrir Stripe Customer Portal" CTA button
  2. **Given** the customer clicks "Abrir Stripe Customer Portal" **When** `POST /settings/billing/portal` runs **Then** the route calls `shared/stripe/customer-portal.js`'s `createPortalLink({stripeCustomerId, returnUrl: 'https://app.marketpilot.pt/settings/billing'})` which uses Stripe API's `billingPortal.sessions.create()` **And** redirects the customer to the returned `url` (Stripe-hosted UI) **And** in the Portal, customer can: update payment method, view invoices, cancel subscription **And** customer-initiated cancel in Portal triggers `customer.subscription.deleted` webhook → Story 11.2 handles cron_state transitions.
  3. **Given** the customer has no Stripe Customer yet (e.g., still in DRY_RUN, never clicked Go-Live) **When** they visit `/settings/billing` **Then** the page shows: *"Ainda não estás em billing ativo. Vais ser cobrado quando carregares 'Ir live'."* with a link to the dashboard's Go-Live CTA **And** the "Abrir Stripe Customer Portal" CTA is hidden (no Stripe Customer to portal into).

---

### Story 11.4: Concierge marketplace-add admin script (founder CLI for adding 2nd+ marketplace)
- **Trace:** Implements AD22 partial (concierge backend), FR41 MVP (concierge-only, NO self-serve UI); FRs FR41 MVP. Size M.
- **Bob-trace:** SSoT: `scripts/concierge-add-marketplace.js` (CLI; founder runs locally with .env.production-like config). Depends on Story 1.2 (envelope encryption — for new key), Story 3.3 (Mirakl smoke-test for key validation), Story 4.1 (customer_marketplaces row creation in PROVISIONING), Story 4.4 (onboarding scan — triggered for the new marketplace), Story 11.1 (`addSubscriptionItem`). Enables founder adds Tony's 2nd-5th Mirakl marketplaces without exposing customer to a UI that doesn't ship until Phase 2.
- **Acceptance Criteria:**
  1. **Given** `scripts/concierge-add-marketplace.js` is run as `node scripts/concierge-add-marketplace.js` with `.env` loaded **When** the script starts **Then** it prompts (interactive readline):
      1. Customer email (looks up `customers` row; aborts if not found)
      2. Marketplace operator (currently only `WORTEN` is valid at MVP — script rejects others with PT message)
      3. Marketplace instance URL (e.g., `https://marketplace.worten.pt` for a second Worten marketplace if applicable; or future Phase 2 marketplaces)
      4. Worten shop API key (input is masked — does NOT echo to terminal; key is held in process memory only, never written to disk)
  2. **Given** valid inputs **When** the script proceeds **Then** it runs in this sequence:
      1. **Validate the key** via the Mirakl smoke-test logic from Story 3.3 (lightweight P11 call against a known reference EAN); aborts with PT error if invalid
      2. **Encrypt the key** via `shared/crypto/envelope.js` (Story 1.2)
      3. **Create the customer_marketplaces row** in PROVISIONING state with operator + marketplace_instance_url; A01/PC01 columns NULL (CHECK constraint allows because PROVISIONING)
      4. **Persist the encrypted key** in `shop_api_key_vault`
      5. **Add Stripe SubscriptionItem** via Story 11.1's `addSubscriptionItem({customerId, customerMarketplaceId})` — Stripe proration kicks in
      6. **Trigger onboarding scan**: insert a `scan_jobs` row in PENDING state; the worker (Story 4.4) picks it up on its next tick
  3. **Given** the script logs progress **When** I run it **Then** each step logs to console with timestamp + status; the cleartext key NEVER appears in log output (verify by piping output to a file and grepping) **And** on success, prints a summary: "Marketplace added for {customer.email}. Scan queued. Stripe SubscriptionItem: {id}. Next billing cycle will include €50/month additional charge prorated for {N} days."
  4. **Given** any step fails **When** the failure is detected **Then** the script aborts with a clear PT error **And** rolls back any partial state: if Stripe SubscriptionItem was created, it's removed; if the customer_marketplaces row was created, it's deleted (CASCADE wipes the vault row) **And** logs the failure for founder follow-up.
  5. **Given** an integration test (CLI tests are tricky — use a programmatic test harness) **When** I run `tests/integration/concierge-add-marketplace.test.js` **Then** it covers: valid input happy path → all 6 steps complete; invalid key → abort + rollback; mid-step failure → rollback verified; cleartext key never in pino output.

---

### Story 11.5: `moloni_invoices` table + NIF capture flow at Day-3 pulse-check + admin record route
- **Trace:** Implements AD22 (with F7) — Moloni manual at MVP + NIF capture flow at Day-3 pulse-check per F7 amendment; FRs FR44; NFRs NFR-O4 (≤24h post-billing invoice generation, ≤10min target per invoice; aggregate >2-3 hr/month triggers Phase 2 Moloni API integration). Size M.
- **NFR-O4 binding:** This story is the supporting tooling for the Moloni manual-invoice 24h SLA. NFR-O4's SLA itself is operational-tier (Founder Operational Track); the supporting `recordMoloniInvoice` admin route is dev work in this story.
- **Atomicity:** Bundle B — `moloni_invoices` retained on customer deletion (FK NO ACTION); coordinated with Story 10.3 hard-delete.
- **Bob-trace:** SSoT: `app/src/routes/admin/moloni-record.js` (founder-only admin route to record invoice metadata), `app/src/views/pages/admin-moloni-record.eta`, `shared/moloni/invoice-metadata.js` (`recordMoloniInvoice`). Migration: `db/migrations/202604301213_create_moloni_invoices.sql`. Depends on Story 1.5 (founder-admin gate), Story 11.1 (stripe_payment_intent_id linkage for the invoice row), Story 1.4 (customer_profiles.nif column for NIF persistence). Enables founder records each Moloni invoice generated manually; NIF captured at first invoice and pre-filled subsequently; rows retained even after FR4 deletion.
- **Acceptance Criteria:**
  1. **Given** the migration `202604301213_create_moloni_invoices.sql` **When** applied **Then** `moloni_invoices` table exists per architecture: id PK, customer_id FK (NO CASCADE — fiscal record must survive customer deletion), customer_marketplace_id FK (nullable — covers multi-marketplace invoices), moloni_invoice_id text NOT NULL UNIQUE, stripe_payment_intent_id text NOT NULL, amount_cents integer NOT NULL, nif text NOT NULL, issued_at timestamptz NOT NULL, created_at **And** index `idx_moloni_invoices_customer ON moloni_invoices(customer_id, issued_at DESC)` **And** RLS: customer reads own; founder admin read-write **And** RLS regression suite extension **And** the FK to `customers(id)` is `ON DELETE NO ACTION` (NOT CASCADE) — verified by integration test attempting customer deletion while moloni_invoices rows exist; deletion blocks unless invoices are migrated to a fiscal-archive table first OR deleted manually by founder per legal review.
  2. **Given** the route `GET /admin/moloni-record/:customerId` (founder-only per Story 1.5 middleware) **When** Pedro visits to record a new invoice **Then** the page shows: customer's email + name, recent Stripe payments (from Stripe API), pre-filled NIF if `customer_profiles.nif` is populated (from prior invoices), input fields for Moloni invoice ID + amount + issued_at + NIF (editable).
  3. **Given** Pedro submits the form (`POST /admin/moloni-record/:customerId`) **When** `shared/moloni/invoice-metadata.js`'s `recordMoloniInvoice({customerId, moloniInvoiceId, stripePaymentIntentId, amountCents, nif, issuedAt, customerMarketplaceId})` runs **Then** in ONE transaction:
      1. INSERT `moloni_invoices` row with all fields
      2. UPDATE `customer_profiles` SET `nif = $1` WHERE `customer_id = $2 AND (nif IS NULL OR nif != $1)` — captures or updates NIF on the profile (per F7 — captured at first Moloni invoice generation, pre-filled subsequently)
    **And** returns success; founder closes the page.
  4. **Given** the F7 NIF capture flow at Day-3 pulse-check **When** Pedro emails the customer per NFR-O3 (operational protocol) **Then** the email includes the verbatim ask from architecture AD22 / Journey 1: *"Posso enviar a fatura Moloni para o NIF da {company}?"* **And** the customer's response (NIF) is recorded by Pedro via `/admin/moloni-record` on their first invoice generation **And** subsequent invoices for the same customer pre-fill NIF from `customer_profiles.nif` — Pedro doesn't need to ask again.
  5. **Given** an integration test **When** I run `tests/integration/moloni-record.test.js` **Then** it covers: founder records first invoice → NIF captured on customer_profiles; founder records second invoice → NIF pre-filled, no redundant capture; non-founder gets 403/404 (Story 1.5 gate); customer deletion attempt while moloni_invoices exist → NO action FK behavior preserves rows.

---

## Epic 12: Operations & Failure Model

**Goal.** 3-tier failure model active across the system (transient retry within cycle → sustained transient after 3 consecutive cycle failures emits PT-localized banner + `cycle-fail-sustained` Atenção event without Resend → per-SKU operational with 3-cycle-rule escalation to `pri01-fail-persistent` Atenção + Resend → critical with auth-invalid / circuit-breaker-trip / anomaly-freeze freezing customer's repricing immediately). Resend delivers critical-tier alerts ≤5 min in PT. UptimeRobot pings `/health` every 5 min. Sustained-transient threshold hardcoded at 3 cycles per F10. PC01 monthly re-pull cron catches operator-config drift.

**Coverage:** FR46, FR48; NFR-I4, NFR-I5, NFR-R5, NFR-P9. ADs: AD24 (with F10), AD25, AD26 partial.

**Constraints:** Resend used ONLY for critical-tier alerts (FR48 + NFR-Sc4 budget). No marketing emails, no day-3/day-7 pulse-check templates (those are founder-direct per NFR-O3 — Parallel Tracks → Founder Operational). UptimeRobot config is manual via UptimeRobot UI; documented in ops runbook (NOT a dev story).

**Phase 2 reservations:** `customer_marketplaces.sustained_transient_cycle_threshold` flagged as Phase 2 trigger only; no MVP migration (per F10).

---

### Story 12.1: 3-tier failure model finalization + sustained-transient classifier + `cycle-fail-sustained` event_type addition
- **Trace:** Implements AD24 (with F10 hardcoded threshold), AD18 (polling implies retry); FRs FR46, FR39 partial (sustained-transient banner emit — UI in Story 8.8); NFRs NFR-R4, NFR-R5. Size M.
- **Atomicity:** Bundle B — sustained-transient counter + audit emission must be transactional with cycle outcome.
- **Bob-trace:** SSoT: `worker/src/safety/failure-classifier.js`, `worker/src/safety/sustained-transient-detector.js`. Migration: `db/migrations/202604301220_add_cycle_fail_sustained_event_type.sql` (adds 27th row to `audit_log_event_types` — `cycle-fail-sustained` Atenção; per Pedro's guidance this is a NEW event-type addition since it's mandated by AD24 but not in AD20's enumerated 26-row seed). Depends on Story 5.1 (dispatcher cycles to count), Story 9.0 + Story 9.1 (audit foundation — extends with new event_type), Story 4.6 + Story 12.2 (Resend NOT used at sustained-transient tier per AD24, but module is consumed by other tiers). Enables sustained-transient banner trigger renders in Story 8.8 banner library (UX skeleton §9.9 verbatim).
- **Acceptance Criteria:**
  1. **Given** the migration `202604301220_add_cycle_fail_sustained_event_type.sql` **When** I apply it **Then** it INSERTs the 27th row into `audit_log_event_types`: `('cycle-fail-sustained', 'atencao', 'Verificações com a Worten estão lentas há 3+ ciclos consecutivos')` **And** Story 9.0's `EVENT_TYPES` JS constant in `shared/audit/event-types.js` is updated in the SAME PR with this story (keeps the lookup-table seed and the JS constant in sync — bidirectional integrity) **And** Story 9.0's integration test asserting taxonomy count is updated from 26 to 27 (or rephrased to assert "matches `EVENT_TYPES.length`" — Pedro to pick at Step 4 sweep).
  2. **Given** `worker/src/safety/sustained-transient-detector.js` exports `incrementCycleFailureCount(customerMarketplaceId)` and `resetCycleFailureCount(customerMarketplaceId)` **When** Story 5.1's dispatcher cycle completes **Then** on cycle success: `resetCycleFailureCount(customerMarketplaceId)` (clears the counter — usually 0 already, but defensive) **And** on cycle failure (e.g., persistent Mirakl 5xx after retry exhaustion across the cycle): `incrementCycleFailureCount(customerMarketplaceId)` returns the new count **And** the counter is stored in a small table `dispatcher_cycle_failures` with `(customer_marketplace_id PRIMARY KEY, consecutive_failures smallint NOT NULL DEFAULT 0, updated_at)` — Bob may instead use a column on customer_marketplaces; either works (small in-RAM cache acceptable too — calibrate during dogfood).
  3. **Given** the counter reaches 3 (per F10 hardcoded threshold) **When** the detector observes the 3rd consecutive failure **Then** in ONE transaction:
      1. Emit `cycle-fail-sustained` Atenção via writeAuditEvent with payload `{consecutiveFailures: 3, lastSuccessfulCycleAt: <timestamp>}`
      2. NO Resend email (per AD24 — sustained-transient is banner only, not critical-alert tier)
      3. Set a flag (e.g., a column on customer_marketplaces or a separate flag table) so Story 8.8's banner library renders the §9.9 banner on next dashboard load: *"Atrasos temporários — verificações com a Worten estão lentas. Sem ações de preço novas até estabilizar. Última verificação OK: {HH:MM}."*
  4. **Given** the threshold is hardcoded per F10 **When** I read `worker/src/safety/sustained-transient-detector.js` **Then** the constant `SUSTAINED_TRANSIENT_THRESHOLD = 3` is at module top (NOT read from `customer_marketplaces.sustained_transient_cycle_threshold` at MVP — that column is reserved for Phase 2 per F10 but no MVP migration created) **And** a code comment notes the Phase 2 trigger: *"// Phase 2: read from customer_marketplaces.sustained_transient_cycle_threshold if non-NULL (column already reserved per F10; not migrated at MVP)"*
  5. **Given** the 3-tier failure model is finalized **When** I read `worker/src/safety/failure-classifier.js` **Then** the module documents (in JSDoc + a constant `FAILURE_TIERS`) the three tiers:
      1. **Transient** (429, 5xx, transport): retry within cycle via `shared/mirakl/api-client.js` (Story 3.1's already-built retry/backoff); logged at `debug`; no audit event; no banner
      2. **Sustained-transient** (3+ consecutive cycle failures): handled by this story's detector → banner + Atenção; NO Resend
      3. **Critical** (auth invalid → key-revoked + Story 7.4 anomaly + Story 7.6 circuit-breaker + Story 11.2 payment-failure): freeze + Atenção + Resend (within ≤5 min per NFR-P9)
    **And** the per-SKU operational tier (Story 6.3's pri01-fail-persistent 3-cycle escalation) is documented as a sub-tier of "critical" — it triggers Resend per its own logic.
  6. **Given** an integration test **When** I run `tests/integration/sustained-transient.test.js` **Then** it covers: 1 failure → no banner; 2 failures → no banner; 3 consecutive failures → cycle-fail-sustained Atenção emitted + banner trigger flag set; subsequent successful cycle → counter reset, banner clears on next dashboard load; NO Resend at this tier (mock Resend received zero alerts).

---

### Story 12.2: `shared/resend/client.js` extension — PT-localized template helpers + 8 critical-alert templates
- **Trace:** Implements AD25 (Resend), AD24 (critical-tier alert); FRs FR48; NFRs NFR-I4 (PT-localized templates), NFR-P9 (≤5 min delivery), NFR-Sc4 (free tier 3k/mo budget). Size L.
- **Bob-trace:** SSoT: Extends `shared/resend/client.js` (Story 4.6's minimal SSoT — `sendCriticalAlert({to, subject, html})` interface PRESERVED) with `sendCriticalAlertWithTemplate({to, templateName, vars})`. Adds 8 PT-localized eta templates in `app/src/views/emails/`:
  - `critical-alert-anomaly-freeze.eta` (Story 7.4)
  - `critical-alert-circuit-breaker-trip.eta` (Story 7.6)
  - `critical-alert-circuit-breaker-per-sku-trip.eta` (Story 7.6)
  - `critical-alert-key-validation-fail.eta` (mid-life key revocation per UX skeleton §8.1)
  - `critical-alert-pri01-fail-persistent.eta` (Story 6.3)
  - `critical-alert-payment-failure-pause.eta` (Story 11.2)
  - `deletion-confirmation.eta` (Story 10.1; refactored to use renderTemplate)
  - `deletion-grace-reminder.eta` (Story 10.3)
  - `deletion-final.eta` (Story 10.3)
  - `scan-failed.eta` (Story 4.6; refactored to use renderTemplate)
  Depends on Story 4.6 (minimal SSoT), Story 7.1 (`formatEur` for prices in templates), Story 1.3 (pino redaction includes `RESEND_API_KEY`). Enables all critical-alert email surfaces use consistent PT templates.
- **Acceptance Criteria:**
  1. **Given** `shared/resend/client.js` (Story 4.6 minimal SSoT) **When** I extend it in this story **Then** the existing `sendCriticalAlert({to, subject, html})` interface is PRESERVED unchanged (existing call sites in Stories 4.6, 7.4, 7.6, 11.2 don't break) **And** a new sibling `sendCriticalAlertWithTemplate({to, templateName, vars})` is added — internally renders the eta template via the eta engine, then calls `sendCriticalAlert` with the rendered html **And** view helpers `formatEur` (Story 7.1) and `formatLisbon` (date helper) are registered with the eta instance used for emails.
  2. **Given** each of the 8+ PT-localized templates **When** rendered with the documented vars **Then** each follows visual-DNA tokens (Manrope/Inter, navy primary, no SPA framework) — emails render acceptably across major clients (Gmail, Outlook, Apple Mail) per a manual visual review **And** subject lines are PT-localized per UX skeleton §9 microcopy where applicable **And** body content is PT-localized verbatim from §9 microcopy for the events that have it; for events without explicit microcopy (e.g., critical-alert-circuit-breaker-per-sku-trip), Bob writes new PT copy following the established register (second-person singular `tu`, anti-promissory).
  3. **Given** existing call sites in Stories 4.6 and 7.4 **When** I migrate them to use `sendCriticalAlertWithTemplate` **Then** Story 4.6's `scan-failed.eta` rendering moves from inline html string to the templated path (same email content, just routed through the helper) **And** Story 7.4's anomaly-freeze critical alert similarly uses the templated path **And** the migration is mechanical — no behavior change, just consolidation.
  4. **Given** the Resend free tier 3k/mo budget per NFR-Sc4 **When** I sum expected email volume at MVP scale (10 customers × 2-3 critical alerts/month each ≈ 20-30 emails/month + deletion emails per customer that initiates ≈ 3 per deletion) **Then** total ≈ 30-50 emails/month — well within 3k/mo **And** the worker logs cumulative monthly send count to allow Phase 2 trigger detection (when count approaches 2k/mo, Bob upgrades Resend tier).
  5. **Given** an integration test **When** I run `tests/integration/resend-templates.test.js` **Then** for each of the 8+ templates: render with sample vars → assert html output matches a golden file (snapshot test); render with missing required vars → throws clear error **And** redaction holds: Resend API errors don't leak the API key (verified by injecting an invalid key and asserting pino output is `[REDACTED]`).

---

### Story 12.3: PC01 monthly re-pull cron + `platform-features-changed` event_type addition
- **Trace:** Implements AD26; FRs (architectural — defends writer from silent operator-config drift). Size S.
- **Bob-trace:** SSoT: `worker/src/jobs/pc01-monthly-repull.js`. Migration: `db/migrations/202604301221_add_platform_features_changed_event_type.sql` (adds 28th row to `audit_log_event_types` — `platform-features-changed` Atenção; per Pedro's guidance this is a 2nd new event-type addition not in AD20's enumerated 26-row seed). Depends on Story 3.2 (PC01 wrapper), Story 4.1 (`customer_marketplaces.platform_features_snapshot` JSONB column + `last_pc01_pulled_at`), Story 9.0 + Story 9.1 (audit foundation — extends with new event_type), Story 12.2 (Resend client + templates — for critical alert when PC01 changes). Enables operator-config drift detection (e.g., Worten enables `volume_pricing` → writer would break silently; this catches it before the next cycle).
- **Acceptance Criteria:**
  1. **Given** the migration `202604301221_add_platform_features_changed_event_type.sql` **When** I apply it **Then** it INSERTs the 28th row into `audit_log_event_types`: `('platform-features-changed', 'atencao', 'Configuração da plataforma operadora alterada — verifica antes do próximo ciclo')` **And** Story 9.0's `EVENT_TYPES` JS constant is updated in the SAME PR with this story (kept in sync per Story 12.1's pattern) **And** Story 9.0's integration test (count assertion) is updated from 27 (post-Story 12.1) to 28.
  2. **Given** `worker/src/jobs/pc01-monthly-repull.js` registered with `node-cron` to run on the 1st of each month at 04:00 Lisbon (`0 4 1 * *` — staggered from Story 9.1's 02:00 partition cron, Story 9.6's 03:00 archive cron, Story 10.3's 00:30 deletion cron) **When** the cron tick fires **Then** for each ACTIVE customer_marketplace (NOT in PROVISIONING / PAUSED_BY_*): decrypts the customer's apiKey, calls `shared/mirakl/pc01.js`'s `getPlatformConfiguration` (Story 3.2) **And** compares the new response against `customer_marketplaces.platform_features_snapshot` JSONB **And** if they DIFFER (deep-equal comparison; Bob picks a stable JSON-canonicalization library or writes one):
      1. Emits `platform-features-changed` Atenção via writeAuditEvent with payload `{previousSnapshot, newSnapshot, diffSummary: <list of changed keys>}`
      2. Sends critical alert via `shared/resend/client.js` (Story 12.2) using template `critical-alert-platform-features-changed.eta` (Bob adds this 9th template — derived from Story 12.2's set; or reuses the generic `critical-alert.eta` with conditional content)
      3. UPDATEs `customer_marketplaces.platform_features_snapshot = <newSnapshot>` AND `last_pc01_pulled_at = NOW()` (so the customer doesn't get repeat alerts for the same change month after month)
    **And** if they MATCH: only update `last_pc01_pulled_at = NOW()` (no audit event, no alert — silent steady state).
  3. **Given** the cron failure handling **When** PC01 fails for a customer (e.g., key revoked mid-month before the cron runs) **Then** the cron logs at `error` level via pino with `customer_marketplace_id`, but does NOT abort the entire cron run for that one failure **And** continues to the next customer marketplace **And** the `key-validation-fail` Atenção event will be emitted by the next dispatcher cycle anyway (Story 7.x or `shared/mirakl/api-client.js`'s 401 handling).
  4. **Given** an integration test **When** I run `tests/integration/pc01-monthly-repull.test.js` **Then** it covers: PC01 unchanged → no event, just timestamp update; PC01's `volume_pricing` field flips from false to true → `platform-features-changed` Atenção emitted + critical alert sent + snapshot updated; PC01 fetch fails (mock Mirakl 401) → error logged, cron continues.
