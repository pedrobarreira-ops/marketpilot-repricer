---
type: bmad-distillate-section
sources:
  - "../epics.md"
parent: "_index.md"
part: 5
of: 8
---

This section covers Epic 8 Customer Dashboard & Surfaces (Stories 8.1–8.12) — 12 stories. Part 5 of 8 from epics.md.

## Epic 8: Customer Dashboard & Surfaces

**Goal.** Customer can use the dashboard end-to-end: KPI cards (driven by `daily_kpi_snapshots` from Epic 9; visually consistent family with the free report's KPI categories), PT/ES toggle, margin editor with live worked-profit-example using a representative SKU from their own catalog, pause/resume single-click, Go-Live behind informed-consent modal, anomaly-freeze review modal, banners for paused/transient states (UX4 stack precedence). Founder admin status page lives here too — read-only, deliberately different aesthetic register. Interception pages (`/key-revoked`, `/payment-failed`, `/scan-failed`) override the dashboard root when triggered. Settings sectioned navigation (account, key, marketplaces concierge read-only, billing portal link, delete entry).

**Coverage:** FR29 (review modal UI), FR30, FR31, FR32, FR34, FR35, FR36, FR39 partial (banner UI), FR41 read-only UI, FR47. NFRs: NFR-P7, NFR-A1, NFR-A2, NFR-L1. ADs: AD15 surfacing, AD24 partial. UX-DRs: UX-DR1, UX-DR3, UX-DR4, UX-DR5, UX-DR13, UX-DR14, UX-DR15, UX-DR16, UX-DR17, UX-DR18, UX-DR19, UX-DR20, UX-DR21, UX-DR22, UX-DR24, UX-DR25, UX-DR26, UX-DR27, UX-DR28, UX-DR29, UX-DR30, UX-DR31, UX-DR32, UX-DR38.

**Visual targets:** `_bmad-output/design-references/bundle/project/dashboard-and-audit.html`. Per-story references use stable stub filenames in `screens/<NN>-<name>.html` (Pattern A) or skeleton fallbacks (Patterns B / C).

**Constraints:** Eta templates import `formatEur()` / `fromCents()` from `shared/money/index.js` (module shipped Epic 7). Dashboard rendering does NOT replicate the free report's 4-section narrative arc, rocket hero card, or three product tables (UX-DR13).

---

### Story 8.1: Dashboard root state-aware view + sticky header chrome
- **Trace:** Implements AD15 surfacing (cron_state-driven banner stack), UX-DR3 (interception override), UX-DR13 (KPI card visual treatment carries; report's narrative arc does NOT); FRs FR30 (dry-run state), FR34 partial (dashboard chrome — KPI cards in 8.2), FR35 partial (toggle UI in 8.3); NFRs NFR-P7, NFR-A1, NFR-L1. Size L.
- **Atomicity:** Bundle B — dashboard chrome surface; interception-redirect logic; banner library consumer.
- **Bob-trace:** SSoT: `app/src/routes/dashboard/index.js` (full version replacing Story 4.9's minimal stub), `app/src/views/layouts/default.eta`, `app/src/views/pages/dashboard.eta`, `app/src/middleware/interception-redirect.js`, `public/js/dashboard.js`. Depends on Story 4.9 (minimal stub being replaced), Story 4.1 (cron_state schema), Story 4.2 (sku_channels), Story 7.x (engine writes events Epic 9 consumes), Story 9.0 + Story 9.1 (audit foundation), Story 9.3 (5-surface query endpoints — KPI cards consume daily_kpi_snapshots). Enables Stories 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8 (all surface inside this dashboard chrome).
- **Pattern A/B/C contract:**
  - Behavior: FR30, FR34 partial, FR35 partial; UX-DR3, UX-DR13
  - Structure: UX skeleton §3.1 + §10
  - Visual: Pattern A — multiple state stubs in `screens/`: `05-dashboard-live.html` (healthy live), `06-dashboard-paused-by-customer.html`, `07-dashboard-paused-by-payment.html`, `08-dashboard-anomaly-attention.html`, `09-dashboard-circuit-breaker.html`, `10-dashboard-sustained-transient.html`.
- **Acceptance Criteria:**
  1. **Given** the route `GET /` and the `interception-redirect.js` middleware **When** an authenticated customer visits `/` **Then** the middleware reads `customer_marketplaces.cron_state` (RLS-aware client per Story 2.1) and:
      - `PROVISIONING` → redirect to `/onboarding/scan` (UX-DR2 forward-only)
      - `cron_state IN ('DRY_RUN', 'ACTIVE', 'PAUSED_BY_CUSTOMER', 'PAUSED_BY_PAYMENT_FAILURE', 'PAUSED_BY_CIRCUIT_BREAKER', 'PAUSED_BY_KEY_REVOKED', 'PAUSED_BY_ACCOUNT_GRACE_PERIOD')` → render `/` with state-appropriate view
      - state interception conditions (key revoked, payment failed, scan failed) → redirect to corresponding `/key-revoked`, `/payment-failed`, `/scan-failed` per UX-DR3 (only first time post-state-transition; subsequent visits land on `/` with persistent banner per UX-DR32)
  2. **Given** the dashboard page renders **When** the customer's cron_state is loaded **Then** the layout uses `app/src/views/layouts/default.eta` with sticky header (logo + channel toggle + pause/resume + Settings link + session avatar) + banner zone + body slot + footer **And** the sticky header uses `backdrop-filter: blur(12px)` and 85% bg opacity per UX skeleton §10 **And** the layout renders within NFR-P7 budget (≤2s broadband).
  3. **Given** the body slot **When** rendered for each state per UX skeleton §3.1 state table **Then** the visual treatments match:
      - **Loading**: skeleton KPI cards with shimmer (per UX skeleton's `shimmer` animation)
      - **DRY_RUN**: KPI cards populated with simulated values; "MODO SIMULAÇÃO" badge top-right; persistent dry-run banner (UX-DR8 + §9.5); prominent "Ir live" CTA (Story 8.6 modal)
      - **ACTIVE healthy**: full KPI cards, ambient washes, audit-log highlights row; margin editor accessible
      - **PAUSED_BY_CUSTOMER**: KPI cards greyed 60% opacity; pause icon top-left; grey banner (§9.4); "Retomar" button (Story 8.5)
      - **PAUSED_BY_PAYMENT_FAILURE**: KPI cards greyed; warning icon (NOT pause icon — UX-DR5); red banner (§9.6); "Atualizar pagamento" → Stripe Portal (Epic 11)
      - **PAUSED_BY_CIRCUIT_BREAKER**: KPI cards stale-watermarked; red banner (§9.8); "Investigar" + "Retomar" buttons
      - **PAUSED_BY_KEY_REVOKED**: redirected to `/key-revoked` interception (Story 8.9)
      - **Anomaly attention** (cron_state=ACTIVE but ≥1 SKU frozen): normal KPI cards; yellow banner (§9.7) with count; "Rever X eventos" → /audit Atenção feed
      - **Sustained transient** (cron_state=ACTIVE but ≥3 consecutive cycle failures): KPI cards stale-watermarked, timestamp visible; grey banner (§9.9); informational, no action
  4. **Given** UX-DR4 banner stacking precedence **When** multiple banner conditions hold simultaneously **Then** only the highest-precedence banner renders at a given time; lower-precedence banners reappear when the higher one clears **And** the precedence is encoded in `app/src/views/components/banners.eta` (Story 8.8) and consumed by this story's view template.
  5. **Given** UX-DR3 interception **When** a customer with cron_state=PAUSED_BY_KEY_REVOKED logs in for the first time post-state-transition **Then** they're redirected to `/key-revoked` (Story 8.9 interception page) **And** subsequent logins still in PAUSED_BY_KEY_REVOKED state revert to `/` with persistent red banner (UX-DR32 — interception only triggers once).
  6. **Given** the page is keyboard-accessible per NFR-A2 **When** I navigate via Tab / Shift+Tab **Then** focus order matches visual hierarchy (header → banner → KPI cards → margin editor → recent Atenção → footer); no focus traps; Escape closes any open modal.
  7. **Given** an integration test **When** I run `tests/integration/dashboard-state-machine.test.js` **Then** it covers all 7 cron_state variants, verifies the correct banner + CTA renders per state, and asserts UX-DR3 interception triggers only once per state-transition.

---

### Story 8.2: KPI cards row (3 status cards from free-report family + secondary catalog-value lines)
- **Trace:** Implements UX-DR13, UX-DR14 (channel-scoped); FRs FR34; NFRs NFR-A1, NFR-L1. Size M.
- **Bob-trace:** SSoT: `app/src/views/components/kpi-cards.eta`. Depends on Story 8.1 (dashboard chrome), Story 9.2 (`daily_kpi_snapshots` data source), Story 7.1 (`shared/money/index.js` `formatEur` for `valor de catálogo` lines). Enables Story 8.3 (channel toggle re-renders KPIs).
- **Pattern A/B/C contract:**
  - Behavior: FR34; UX-DR13, UX-DR14
  - Structure: UX skeleton §10 + free-report KPI categories family
  - Visual: Pattern A — `screens/05-dashboard-live.html` includes the rendered KPI card row.
- **Acceptance Criteria:**
  1. **Given** `app/src/views/components/kpi-cards.eta` **When** rendered with the current channel toggle (PT or ES) and customer_marketplace_id **Then** queries `daily_kpi_snapshots` for today's row matching `(customer_marketplace_id, channel_code, date=today_lisbon)` **And** displays 3 status cards in tonal tints (green / red / blue per UX skeleton §10):
      - **Em 1.º lugar**: count from `daily_kpi_snapshots.skus_in_first_count`; secondary line shows `valor de catálogo` summed via `shared/money/index.js`'s `formatEur`
      - **A perder posição**: count from `skus_losing_count`; secondary line shows `valor de catálogo at risk` from `catalog_value_at_risk_cents`
      - **Sem concorrência (Tier 3)**: count from `skus_exclusive_count`; secondary line shows `valor de catálogo` for Tier 3 SKUs
    **And** each card carries an uppercase eyebrow label (10-11px, 0.12em tracking, 700 weight per UX skeleton §10) **And** each card uses the 44-52px tabular display number with JetBrains Mono per UX skeleton's type stack **And** position deltas vs prior day (e.g., `+12 vs ontem`) appear if `daily_kpi_snapshots` for yesterday exists.
  2. **Given** the channel toggle (Story 8.3) is set to PT **When** the KPI cards render **Then** counts reflect only PT channel data (`channel_code = 'WRT_PT_ONLINE'`); ES counts excluded **And** vice versa when toggled to ES.
  3. **Given** the daily KPI snapshot query **When** today's row doesn't exist yet (e.g., before midnight refresh runs) **Then** the cards render with `0` placeholder counts and a small "Atualização em curso..." caption — never blank skeletons in steady state **And** the worker's 5-min "today" partial refresh (Story 9.2) populates incrementally.
  4. **Given** UX-DR13 (the dashboard does NOT replicate the report's narrative arc) **When** I inspect the dashboard **Then** there is NO rocket hero card "A um passo do 1.º" **And** there are NO "Maiores oportunidades", "Margem para subir", "Vitórias rápidas" tables **And** ONLY the 3 KPI cards from this story render in the KPI row.

---

### Story 8.3: PT/ES channel toggle pill in sticky header
- **Trace:** Implements UX-DR14 (single-select; "Both" is Phase 2); FRs FR35; NFRs NFR-L1. Size S.
- **Bob-trace:** SSoT: `app/src/views/components/channel-toggle.eta`, `public/js/dashboard.js` (toggle state management). Depends on Story 8.1, Story 8.2 (toggle re-renders KPI scope). Enables Story 8.4 (margin editor's worked-example SKU pool re-evaluates on toggle), Story 9.3 (audit feeds filter by channel).
- **Pattern A/B/C contract:**
  - Behavior: FR35; UX-DR14
  - Structure: UX skeleton §10 pill toggle pattern (carried verbatim from free report)
  - Visual: Pattern A — same toggle pill as free report's `MarketPilot.html` PT/ES toggle (carried verbatim per UX skeleton §10); rendered within `screens/05-dashboard-live.html` and other dashboard state stubs.
- **Acceptance Criteria:**
  1. **Given** the toggle component **When** rendered in the sticky header per UX skeleton §10's pill toggle pattern **Then** it shows `PT | ES` segmented buttons with the active channel highlighted **And** the toggle scope per UX-DR14: KPI cards (Story 8.2), margin editor's worked-example SKU candidate pool (Story 8.4), "Hoje" audit-log preview (Story 8.x), Recent Atenção items (Story 8.x) **And** the toggle does NOT scope the global banner zone (banners are system-level, not channel-level — exception: anomaly counts in §9.7 banner specify per-channel split when both have items).
  2. **Given** the toggle persists per-session **When** the customer toggles to ES, navigates to `/audit`, returns to `/` **Then** the toggle remains on ES (sticky between visits via local storage) **And** the default channel on first dashboard load is **PT** (founder is PT-based + most warm leads PT-primary per UX skeleton §4.2.2).
  3. **Given** UX-DR14 single-select at MVP **When** I attempt to render a "Both" merged view **Then** the option does NOT exist in the UI (no third button); the toggle is strictly PT XOR ES **And** "Both" merged view is flagged in epic-level Phase 2 reservations (NOT this story's scope — Phase 2 trigger requires cross-channel deduplication by EAN).
  4. **Given** the customer has a single-channel marketplace (e.g., only PT active) **When** the dashboard loads **Then** the toggle is hidden entirely (or shown disabled with a tooltip "Apenas PT ativo neste marketplace").

---

### Story 8.4: Margin editor inline panel with worked-profit-example
- **Trace:** Implements UX-DR15-21 (representative SKU rule, stated-margin assumption, live update mechanics); FRs FR36; NFRs NFR-A1, NFR-A2, NFR-L1. Size L.
- **Bob-trace:** SSoT: `app/src/views/components/margin-editor.eta`, `app/src/routes/dashboard/margin-edit.js` (POST handler), `public/js/margin-editor.js` (150ms-debounced live recompute). Depends on Story 8.1, Story 7.1 (`shared/money/index.js` floor/ceiling math + formatEur), Story 4.2 (sku_channels for representative-SKU selection), Story 4.8 (margin band stored on customer_marketplace). Enables customer can tune margin tolerance pre-Go-Live and post-Go-Live.
- **Pattern A/B/C contract:**
  - Behavior: FR36; UX-DR15-21
  - Structure: UX skeleton §4.3 + §4.3.3 box layout
  - Visual: Pattern A — `screens/07-margin-editor.html` (per the screen→stub mapping appendix).
- **Acceptance Criteria:**
  1. **Given** UX-DR15 representative-SKU selection rule **When** the margin editor mounts (or the channel toggle changes) **Then** the server-side handler picks the worked-example SKU by:
      1. Filter: `tier IN ('1', '2a', '2b')` AND `channel_code = current_toggle_channel` (Tier 3 silent SKUs make for a bad demo per UX-DR15)
      2. Filter: `current_price_cents` between catalog `p25` and `p75` price quartiles for the customer_marketplace + channel (avoid outliers per UX-DR15)
      3. Rank: ascending by `ABS(current_price_cents - catalog_median_price_cents)` (closest to median per UX-DR15)
      4. Pick top SKU
    **And** if zero SKUs satisfy the filter (UX-DR17 rare case): display the empty-state copy *"Adiciona produtos contestados ao catálogo para ver um exemplo prático. Os teus limites continuam a aplicar-se."*
  2. **Given** UX-DR16 "Ver outro" refresh button **When** clicked **Then** the editor cycles through the top 5 candidates by the same UX-DR15 rule (deterministic — same 5 candidates each time for the same catalog state) **And** it's a pure UX affordance — does NOT change engine behavior.
  3. **Given** UX-DR18 stated-margin assumption (conservative — floor of selected band) **When** computing the worked example **Then** the back-calculation uses:
      - `<5%` band (stored as 0.005 max_discount_pct) → assume **5% margin** (band's upper bound, treated as floor)
      - `5-10%` band → assume **5%**
      - `10-15%` band → assume **10%**
      - `15%+` band → assume **15%**
    **And** the assumption is displayed explicitly in the editor caveat per UX-DR19 + §9.11 microcopy verbatim.
  4. **Given** the editor anatomy per UX skeleton §4.3.3 **When** rendered **Then** two numeric inputs (`max_discount_pct`, `max_increase_pct`) appear with the worked-profit-example panel beside them **And** the example shows: SKU title + current_price + minimum_allowed_price (computed via `shared/money/index.js` `roundFloorCents`) + impact in euros + remaining margin estimate **And** the format follows §4.3.3's box layout (mocked in the visual stub).
  5. **Given** UX-DR20 live update on input **When** I change the input value **Then** the example recomputes via `public/js/margin-editor.js` debounced ~150ms **And** numeric inputs accept percentages with one decimal (e.g., `1.5%`) **And** client-side validation: 0-50% range, out-of-range = red border + inline message *"Valor entre 0% e 50%"*, save disabled **And** server-side re-validation on POST per AD28 (Fastify built-in JSON Schema).
  6. **Given** UX-DR21 explicit save action **When** the customer clicks "Guardar alterações" **Then** `POST /dashboard/margin` (handled by `app/src/routes/dashboard/margin-edit.js`) updates `customer_marketplaces.max_discount_pct` + `max_increase_pct` via the RLS-aware client **And** the response shows a confirmation toast: *"Margens guardadas. Aplicado a partir do próximo ciclo (~15 min)."* (verbatim per UX-DR21) **And** the next dispatcher cycle reads the new values; current in-flight cycle (if any) does NOT use the new values (mid-cycle behavior change is unsafe per Pedro's OQ-2 lock).
  7. **Given** the editor is keyboard-accessible per NFR-A2 **When** I use Tab → input → Tab → save button → Enter **Then** I can adjust + save without mouse interaction; ARIA labels announce `Reduzir até` and `Aumentar até` to screen readers per NFR-A1.

---

### Story 8.5: Pause / Resume buttons + customer-pause cron_state transitions
- **Trace:** Implements UX-DR5 (paused-state distinction), AD15 (cron_state transitions); FRs FR32; NFRs NFR-A2. Size M.
- **Bob-trace:** SSoT: `app/src/routes/dashboard/pause-resume.js` (`POST /pause`, `POST /resume`), `app/src/views/components/pause-button.eta`, `public/js/pause-resume.js` (confirmation modal). Depends on Story 8.1, Story 4.1 (transitionCronState helper + LEGAL_CRON_TRANSITIONS includes the pause/resume tuples), Story 9.0 + Story 9.1 (transitionCronState emits `customer-paused` / `customer-resumed` per the per-(from,to) map). Enables customer can freeze repricing in 1 click anytime.
- **Pattern A/B/C contract:**
  - Behavior: FR32; UX-DR5
  - Structure: UX skeleton §9.3, §9.4
  - Visual: Pattern A — pause button rendered within `screens/05-dashboard-live.html` (live state) and `screens/06-dashboard-paused-by-customer.html` (paused state).
- **Acceptance Criteria:**
  1. **Given** `app/src/views/components/pause-button.eta` **When** the customer's cron_state is `ACTIVE` **Then** the button renders with label `"Pausar repricing"` and `pause_circle` filled icon (per §9.3 microcopy) **And** clicking opens a confirmation modal with verbatim copy: *"Tens a certeza? O cron vai parar e os preços ficam onde estão até retomares."* + [Cancelar] [Pausar] buttons (per §9.3).
  2. **Given** the customer confirms pause **When** `POST /pause` runs **Then** the route calls `transitionCronState({tx, customerMarketplaceId, from: 'ACTIVE', to: 'PAUSED_BY_CUSTOMER', context: {initiated_at: NOW()}})` **And** the helper emits `customer-paused` Notável audit event per the per-(from,to) map (Story 4.1 + Story 9.0) **And** the dashboard re-renders in PAUSED_BY_CUSTOMER state per Story 8.1's state-aware view; banner per §9.4 verbatim.
  3. **Given** the customer's cron_state is `PAUSED_BY_CUSTOMER` **When** the dashboard renders **Then** the button changes to label `"Retomar repricing"` with `play_circle` filled icon **And** clicking immediately (no confirmation modal — resume is single-click per FR32) calls `POST /resume` → `transitionCronState({from: 'PAUSED_BY_CUSTOMER', to: 'ACTIVE'})` → emits `customer-resumed` Notável.
  4. **Given** UX-DR5 distinct visual treatment **When** the customer is in PAUSED_BY_PAYMENT_FAILURE state **Then** the pause button is hidden (replaced by "Atualizar pagamento" CTA — Story 8.x); pause/resume only applies to PAUSED_BY_CUSTOMER state **And** `customer-paused` event NEVER fires for non-customer-initiated paused states (the per-(from,to) map distinguishes).
  5. **Given** keyboard accessibility per NFR-A2 **When** I Tab to the pause button + Enter **Then** the confirmation modal opens; Escape cancels; Tab through modal to confirm + Enter completes the action **And** screen-reader-readable button labels (NFR-A1).

---

### Story 8.6: Go-Live consent modal + Stripe redirect
- **Trace:** Implements UX-DR24 ("Tu confirmas. Nós executamos."), AD15 (DRY_RUN → ACTIVE transition without audit event per per-(from,to) map); FRs FR31; NFRs NFR-A2, NFR-L1. Size M.
- **Bob-trace:** SSoT: `app/src/routes/dashboard/go-live.js` (`POST /go-live`), `app/src/views/modals/go-live-consent.eta`, `public/js/go-live-modal.js`. Depends on Story 8.1, Story 4.1 (transitionCronState DRY_RUN → ACTIVE), Story 11.1 (Stripe Customer + Subscription + first SubscriptionItem creation — see cross-epic note). Enables customer flips to live billing-active state. Cross-epic note: Stripe wiring lives in Epic 11 (Story 11.1). Story 8.6 ships the consent modal + DRY_RUN → ACTIVE transition + the Stripe redirect SHELL; until Story 11.1 ships, this story uses a stub Stripe redirect.
- **Pattern A/B/C contract:**
  - Behavior: FR31; UX-DR24
  - Structure: UX skeleton §3.6 + §9.1
  - Visual: Pattern A — `screens/08-modal-go-live.html` per the screen→stub mapping appendix.
- **Acceptance Criteria:**
  1. **Given** the customer is in `DRY_RUN` state with the dashboard's "Ir live" CTA visible (per Story 8.1's state-aware view) **When** they click "Ir live" **Then** the Go-Live consent modal opens (`app/src/views/modals/go-live-consent.eta`) with verbatim copy from §9.1:
      - **Título:** "Pronto para ir live?"
      - **Corpo:** "Até **{N} produtos** poderão ter preços ajustados, dentro da margem de **{X}%** que configuraste. Os preços são otimizados a cada 15 minutos, sempre dentro da tua tolerância — nunca abaixo do floor, nunca acima do ceiling.\n\nTu confirmas. Nós executamos. Tu podes parar a qualquer momento."
      - **Checkbox:** "☐ Compreendo e autorizo o repricing automático"
      - **Botão (off, disabled):** "Confirmar e ir live (€50/mês)"
      - **Cancelar:** "Manter em modo simulação"
    **And** `{N}` is `SELECT COUNT(*) FROM sku_channels WHERE customer_marketplace_id = $1 AND tier IN ('1', '2a', '2b')` (repriceable count from most recent scan) **And** `{X}%` is `(customer_marketplaces.max_discount_pct * 100)` formatted with one decimal.
  2. **Given** the checkbox state **When** unchecked → "Confirmar e ir live" button is disabled with grey styling **When** checked → button enables, navy gradient (`linear-gradient(135deg, var(--mp-primary), var(--mp-primary-2))`) per UX skeleton §10 **And** keyboard navigation works without mouse (NFR-A2): Tab → checkbox → Space to toggle → Tab → submit → Enter.
  3. **Given** the customer confirms with the box checked **When** `POST /go-live` runs **Then** the route initiates Stripe Customer + Subscription + first SubscriptionItem creation via Story 11.1's helpers (or stub during interim) **And** on Stripe success: calls `transitionCronState({tx, from: 'DRY_RUN', to: 'ACTIVE'})` — note this `(from, to)` is in `LEGAL_CRON_TRANSITIONS` but NOT in the per-(from,to) audit event map (no `go-live-flipped` event exists in AD20; the customer-visible signal is the cron_state itself + the start of `cycle-start` Rotina events on the next dispatcher tick) **And** redirects to `/` (dashboard re-renders in ACTIVE state per Story 8.1) **And** on Stripe failure: modal stays open with PT-localized error from `getSafeErrorMessage`-equivalent for Stripe errors.
  4. **Given** UX-DR24 trust footer copy **When** the modal renders **Then** below the body: "Tu confirmas. Nós executamos. Tu podes parar a qualquer momento." (already in §9.1's body — repeat as footer for emphasis if visual stub specifies).

---

### Story 8.7: Anomaly review modal (consumes Story 7.4 endpoints)
- **Trace:** Implements UX-DR8, UX-DR24 ("Nada acontece até confirmares."); FRs FR29; NFRs NFR-A2. Size M.
- **Bob-trace:** SSoT: `app/src/views/modals/anomaly-review.eta`, `public/js/anomaly-review.js`. Depends on Story 8.1, Story 7.4 (`POST /audit/anomaly/:skuChannelId/{accept,reject}` endpoints), Story 9.3 (audit feed Atenção surface — modal opens from there). Enables customer reviews per-SKU anomaly freezes without leaving the audit log.
- **Pattern A/B/C contract:**
  - Behavior: FR29; UX-DR8, UX-DR24
  - Structure: UX skeleton §3.7 + §9.2
  - Visual: Pattern A — `screens/09-modal-anomaly-review.html` per the screen→stub mapping appendix.
- **Acceptance Criteria:**
  1. **Given** the modal `app/src/views/modals/anomaly-review.eta` **When** the customer clicks an `anomaly-freeze` Atenção feed entry (Story 9.3) OR the dashboard banner (§9.7) **Then** the modal opens with verbatim §9.2 copy:
      - **Título:** "Mudança externa de preço · {SKU name}"
      - **Corpo:** "Detetámos uma alteração ao preço deste produto fora dos nossos ciclos:\n  Antes:  €{old}\n  Agora:  €{new}    ({±deviation}%)\nComo a mudança é maior que 40%, congelámos o repricing deste produto até confirmares. Pode ser uma promoção intencional ou um erro do teu ERP.\n\nNada acontece até confirmares."
      - **Botão A:** "Confirmar — usar €{new} como novo list_price"
      - **Botão B:** "Rejeitar — manter €{old} como list_price"
      - **Link:** "Ver histórico no audit log →" (jumps to Story 9.4 search-by-SKU for that SKU)
  2. **Given** prices in the modal **When** the modal queries the audit_log row + sku_channels current state **Then** `{old}` is the `audit_log.payload.previousListPriceCents` formatted via `formatEur` (Story 7.1) **And** `{new}` is the `audit_log.payload.newListPriceCents` (or current `current_price_cents` if absorbed but frozen) formatted via `formatEur` **And** `{±deviation}%` is `audit_log.payload.deviationPct * 100` formatted with one decimal sign-prefixed (e.g., `+47.8%`).
  3. **Given** the customer clicks "Confirmar" **When** `POST /audit/anomaly/:skuChannelId/accept` (Story 7.4 endpoint) runs **Then** the route runs the unfreeze-with-new-baseline flow per Story 7.4 — sets `list_price_cents = current_price_cents`, clears frozen state, sets `audit_log.resolved_at = NOW()` on the original event **And** the modal closes and the dashboard banner re-evaluates (anomaly count decrements by 1).
  4. **Given** the customer clicks "Rejeitar" **When** `POST /audit/anomaly/:skuChannelId/reject` runs **Then** the route runs the unfreeze-preserving-old-baseline flow — `list_price_cents` unchanged, clears frozen state, sets `resolved_at = NOW()` **And** Story 7.3's cooperative-absorption will detect `current_price ≠ last_set_price` again on next cycle — customer is informed in the modal that whole-tool pause is the only permanent override at MVP.
  5. **Given** UX-DR24 + §9.2 emphasis **When** the modal renders **Then** the line "Nada acontece até confirmares." is visually emphasized (bolder weight or italic per visual stub).

---

### Story 8.8: Banner library + UX4 stack precedence
- **Trace:** Implements UX-DR4 (precedence), UX-DR5 (paused-state distinction); FRs FR39 partial (banner UI; classifier in Epic 12); NFRs NFR-L1. Size M.
- **Bob-trace:** SSoT: `app/src/views/components/banners.eta` (precedence-aware library). Depends on Story 8.1 (chrome that hosts banners). Enables Stories 8.1, 8.5, 8.7, 8.9 all consume this library.
- **Pattern A/B/C contract:**
  - Behavior: FR39 partial; UX-DR4, UX-DR5
  - Structure: UX skeleton §9.3-§9.9
  - Visual: Pattern A — banner variants rendered within state-stub files (`screens/05-...html` through `screens/10-...html`).
- **Acceptance Criteria:**
  1. **Given** `app/src/views/components/banners.eta` **When** rendered with the dashboard's current cron_state + auxiliary state (anomaly_count, sustained_transient_active) **Then** the component evaluates banner conditions in precedence order per UX-DR4:
      1. `payment_failure` — red, `warning` filled icon, §9.6 copy
      2. `circuit_breaker` — red, `gpp_maybe` filled icon, §9.8 copy
      3. `anomaly_attention` (per-SKU count > 0) — yellow, `error` filled icon, §9.7 copy with per-channel split if both have items
      4. `sustained_transient` (≥3 consecutive cycle failures) — grey, `schedule` filled icon, §9.9 copy
      5. `paused_by_customer` — grey, `pause_circle` filled icon, §9.4 copy
      6. `provisioning` — grey defensive fallback ("Catálogo a ser carregado…")
      7. `dry_run` — blue, `science` filled icon, §9.5 copy
    **And** only the highest-precedence banner renders; lower-precedence ones reappear only when the higher clears.
  2. **Given** UX-DR5 visual distinction **When** I render the customer-paused banner (§9.4) vs the payment-failed banner (§9.6) **Then** customer-pause uses calm grey + `pause_circle` filled **And** payment-failed uses warning-amber + `warning` filled **And** they DO NOT share an icon (per UX-DR5: "Same icon for both = trust failure").
  3. **Given** keyboard accessibility per NFR-A2 **When** a banner has a CTA button (e.g., "Retomar repricing") **Then** the button is focusable via Tab + activatable via Enter / Space **And** ARIA roles announce the banner severity (`role="alert"` for red banners; `role="status"` for grey/blue).
  4. **Given** the per-channel split for anomaly banner **When** anomaly count > 0 in BOTH channels **Then** §9.7 banner copy renders with `{N_pt} no PT · {N_es} no ES` literal split per microcopy spec.

---

### Story 8.9: Interception pages — `/key-revoked`, `/payment-failed`
- **Trace:** Implements UX-DR31 (key-revoked override), UX-DR32 (payment-failed first-time interception only); FRs FR43 partial (`/payment-failed`); Worten 401 detection covered in worker code; NFRs NFR-L1. Size M.
- **Bob-trace:** SSoT: `app/src/routes/interceptions/key-revoked.js`, `app/src/routes/interceptions/payment-failed.js`, `app/src/views/pages/key-revoked.eta`, `app/src/views/pages/payment-failed.eta`. Depends on Story 8.1 (interception-redirect middleware), Story 4.1 (cron_state PAUSED_BY_KEY_REVOKED + PAUSED_BY_PAYMENT_FAILURE), Story 4.3 (rotation flow at `/onboarding/key`). Enables customer recovers from mid-life key revocation OR Stripe failed payment without re-onboarding.
- **Pattern A/B/C contract:**
  - Behavior: FR43 partial; UX-DR31, UX-DR32
  - Structure: UX skeleton §8.1
  - Visual: Pattern A — `screens/14-key-revoked.html`, `screens/15-payment-failed.html` per the screen→stub mapping appendix.
- **Acceptance Criteria:**
  1. **Given** the cron_state is `PAUSED_BY_KEY_REVOKED` **When** the customer logs in for the first time post-state-transition **Then** UX-DR31 interception triggers: redirected to `/key-revoked` (page renders with verbatim §8.1 copy) **And** the page has prominent "Configurar nova chave →" button leading to `/onboarding/key` in **rotation mode** (UI variant of Story 4.3 noting old-key-destruction-on-success-of-validation) **And** the page has a secondary "Como gerar uma chave Worten?" link opening Story 4.3's modal (Pattern A stub).
  2. **Given** the customer successfully validates a new key via the rotation flow **When** Story 4.3 completes the validation **Then** `transitionCronState({from: 'PAUSED_BY_KEY_REVOKED', to: 'ACTIVE'})` (this transition is in `LEGAL_CRON_TRANSITIONS` but NOT in the per-(from,to) audit event map — no audit event) **And** the customer is redirected to `/` healthy live state **And** NO scan repeat (catalog snapshot retained from original onboarding) **And** NO re-onboarding required.
  3. **Given** the cron_state is `PAUSED_BY_PAYMENT_FAILURE` **When** the customer logs in for the FIRST TIME post-state-transition (UX-DR32) **Then** redirected to `/payment-failed` interception page with §9.6-style copy + "Atualizar pagamento" CTA → Stripe Customer Portal (Story 11.4) **And** subsequent logins still in PAUSED_BY_PAYMENT_FAILURE state revert to `/` with persistent red banner (UX-DR32 — interception only triggers ONCE per state-transition; tracked via session state or last-shown-interception timestamp).
  4. **Given** UX-DR2 forward-only state machine **When** a customer NOT in PAUSED_BY_KEY_REVOKED visits `/key-revoked` directly **Then** redirected to `/` **And** same for `/payment-failed` — direct visits without the matching state redirect to `/`.

---

### Story 8.10: `/admin/status` founder page (reuses customer audit-log UI)
- **Trace:** Implements UX-DR28 (read-only, edits only via Supabase Studio), UX-DR29 (deliberately different visual register), UX-DR30 (reuse customer audit-log UI); FRs FR6, FR47; NFRs NFR-O3. Size L.
- **Bob-trace:** SSoT: `app/src/routes/admin/status.js`, `app/src/views/pages/admin-status.eta`, `app/src/views/components/admin-mode-banner.eta` (red banner shown when impersonating customer audit log). Depends on Story 1.5 (founder_admins seed + admin-auth middleware), Story 9.3 (5-surface query endpoints — admin reuses `/audit?as_admin={customer_id}`), Story 4.1 (cron_state schema for per-customer rollup). Enables founder Day-1 monitoring without context-switching between Supabase Studio + UptimeRobot + customer audit log.
- **Pattern A/B/C contract:**
  - Behavior: FR6, FR47; UX-DR28, UX-DR29, UX-DR30
  - Structure: UX skeleton §7
  - Visual: Pattern A — `screens/13-admin-status.html` per the screen→stub mapping appendix; UX-DR29 mandates deliberately different visual register (monospace dominant, dense tables, no ambient washes, slate/cool greys).
- **Acceptance Criteria:**
  1. **Given** the route `GET /admin/status` gated by Story 1.5's `founder-admin-only` middleware **When** an authenticated founder admin (email in `founder_admins`) visits **Then** the page renders with the layout per UX skeleton §7.2:
      - **Sistema row**: `/health` status (200 / 503), uptime % (30d), Mirakl P11 latency p95 (last 1h), PRI01 → PRI02 stuck count
      - **Customers row** (sortable by name): per-customer status pill + cron_state + last cycle age + Atenção count + winning-count / total
      - **Recent critical events row**: cross-customer audit-log tail filtered to Atenção priority, last 24h, paginated 50 per page
  2. **Given** UX-DR29 deliberately different visual register **When** the page renders **Then** monospace font dominates (JetBrains Mono for tabular data) **And** dense tables (no ambient washes, no celebratory animations) **And** color palette uses slate/cool greys (NOT the customer dashboard's navy primary + tonal tints) **And** if Pedro shares a screenshot, no customer thinks "why does Pedro have a different/nicer view of my data?" — the visual register makes "founder doesn't see your data the way you do" trust commitment legible.
  3. **Given** UX-DR30 reuse pattern **When** Pedro clicks a customer row **Then** the route opens `/audit?as_admin={customer_id}` (Story 9.3's audit-log query endpoint; admin-auth middleware reads `?as_admin=` param + verifies the requesting user is in founder_admins + uses service-role DB connection — RLS bypass) **And** the customer-side audit log UI renders (NO duplicate UI built) **And** a subtle red admin-mode banner across the top (`app/src/views/components/admin-mode-banner.eta`) makes the impersonation context visible: *"⚠ A ver o audit log de {customer.email} como administrador. Modo apenas leitura."*
  4. **Given** UX-DR28 read-only posture **When** Pedro tries to edit any customer data through `/admin/*` **Then** there is NO edit UI — `/admin/status` is strictly read-only; edits require Supabase Studio (deliberate friction so accidental edits are impossible) **And** the founder NEVER logs in as a customer impersonator at MVP — the `?as_admin=` reuse is read-only + service-role-bound; no auth.users impersonation.
  5. **Given** an integration test **When** I run `tests/integration/admin-status.test.js` **Then** it covers: founder admin sees full page; non-founder customer gets 403 (or 404 per Story 1.5's middleware); `/audit?as_admin={customer_B_id}` from founder shows customer B's audit log with red admin-mode banner; non-founder cannot use `?as_admin=` param.

---

### Story 8.11: Settings sectioned navigation (5 pages)
- **Trace:** Implements UX-DR22 (sectioned nav, accordion on mobile), UX-DR38 (concierge marketplace-add); FRs FR1 (account email + password change via Supabase Auth), FR4 deletion entry, FR41 MVP read-only marketplaces, FR43 billing portal link; NFRs NFR-L1. Size L.
- **Bob-trace:** SSoT: `app/src/routes/settings/account.js`, `app/src/routes/settings/key.js`, `app/src/routes/settings/marketplaces.js`, `app/src/routes/settings/billing.js`, `app/src/routes/settings/delete.js` (delete entry — full flow lands in Epic 10), `app/src/views/pages/settings-account.eta`, `app/src/views/pages/settings-key.eta`, `app/src/views/pages/settings-marketplaces.eta`, `app/src/views/pages/settings-billing.eta`, `app/src/views/pages/settings-delete.eta`, `app/src/views/components/settings-sidebar.eta`. Depends on Story 8.1 (chrome), Story 1.4 (account email/password via Supabase Auth), Story 1.2 + Story 4.3 (key vault status), Story 4.1 (marketplaces table for read-only list), Story 11.4 (Stripe Customer Portal link — interim stub if Epic 11 hasn't shipped), Story 10.1 (delete flow — Epic 10). Enables customer manages account from one section.
- **Pattern A/B/C contract:**
  - Behavior: FR1, FR4, FR41, FR43; UX-DR22, UX-DR38
  - Structure: UX skeleton §4.4 settings architecture
  - Visual: Pattern C — UX skeleton §4.4 settings architecture + visual-DNA tokens + consistent chrome from already-shipped designed pages. No per-page stubs (the 5 pages share consistent chrome from Epic 8's dashboard chrome).
- **Acceptance Criteria:**
  1. **Given** `app/src/views/components/settings-sidebar.eta` **When** rendered on desktop (≥768px viewport) **Then** sidebar with 5 entries: Conta, Chave Worten, Marketplaces, Faturação, Eliminar conta **And** the active section is highlighted; navigation between sections uses standard links (no SPA-style routing) **And** below 768px the sidebar collapses to an accordion per UX-DR22 (mobile accordion).
  2. **Given** `/settings/account` **When** the customer visits **Then** the page shows email (read-only at MVP — change via Supabase Auth flow) + password change form + last login timestamp **And** the page is keyboard-accessible (NFR-A2).
  3. **Given** `/settings/key` **When** the customer visits **Then** the page shows the vault status pill: *"🔒 Encriptada · Validada às {HH:MM} em {DD/MM}"* (read from `shop_api_key_vault.last_validated_at` per Story 4.3's signal) **And** a "Rotacionar chave" button triggers the rotation flow (same UX as Story 4.3's `/onboarding/key` in rotation mode) **And** rotation success: §5.2 confirmation copy *"A chave anterior é destruída no momento da nova validação."* + audit event NOT emitted (rotation isn't in AD20 taxonomy; the new `last_validated_at` timestamp is the signal) **And** the page NEVER displays plaintext key material (NFR-S1).
  4. **Given** `/settings/marketplaces` per UX-DR38 **When** the customer visits **Then** the page shows a read-only list of active marketplaces (e.g., "Worten PT" active; "Worten ES" if added concierge — both under one shop API key for Worten per FR41 MVP) **And** an inactive "Adicionar marketplace" button with hover tooltip: *"Contacta-nos em hello@marketpilot.pt para adicionar mais marketplaces. Tratamos de tudo: nova chave, scan, configuração — e somamos €50/mês na próxima fatura."* (verbatim per UX skeleton §8.5) **And** there is NO "Add Marketplace" UI form / wizard (FR41 MVP — concierge-only).
  5. **Given** `/settings/billing` **When** the customer visits **Then** shows current plan summary (€50 × N marketplaces/month) + next billing date + last invoice link + "Abrir Stripe Customer Portal" CTA (Story 11.4 link) **And** until Story 11.4 ships, the CTA is a placeholder with caption *"Disponível em breve"* — non-blocking interim.
  6. **Given** `/settings/delete` (entry only — full flow in Epic 10) **When** the customer visits **Then** the page describes what gets wiped vs retained (per UX skeleton §8.4 Step 1 verbatim) **And** has a "Continuar com a eliminação" button → opens Story 10.1's multi-step modal flow **And** is discoverable but not visually prominent (small text link in bottom of `/settings/account` per UX-DR22, OR a clear sidebar entry — pick one and document).

---

### Story 8.12: Mobile-focused critical-alert response surface
- **Trace:** Implements UX-DR26, UX-DR27 (mobile chrome strips channel toggle, margin editor, settings sidebar, firehose); FRs FR48 (alert delivery — recipient-side mobile rendering); NFRs NFR-P7 (≤4s on 3G mobile). Size M.
- **Bob-trace:** SSoT: `app/src/views/layouts/mobile-alert.eta` (stripped layout for `/?alert=X` query param), `public/css/mobile.css` (mobile breakpoint overrides). Depends on Story 8.1 (route handler detects `?alert=X` and serves stripped layout), Story 8.7 (anomaly review modal accessible mobile), Story 8.5 (pause button mobile-reachable). Enables Pedro Journey 3's "22:47 mobile critical-alert response" works as designed.
- **Pattern A/B/C contract:**
  - Behavior: FR48; NFR-P7; UX-DR26, UX-DR27
  - Structure: UX skeleton §6
  - Visual: Pattern A — `screens/21-mobile-critical-alert.html` per the screen→stub mapping appendix.
- **Acceptance Criteria:**
  1. **Given** the route `GET /?alert=anomaly` (or `?alert=circuit-breaker` etc.) on mobile viewport (<768px) **When** the request is detected **Then** Story 8.1's route handler serves `app/src/views/layouts/mobile-alert.eta` instead of the full dashboard layout **And** the stripped variant shows: large status banner (UX4 stack precedence per Story 8.8), pause button reachable in ≤2 taps, "Ver detalhes" link to the matching Atenção feed entry (Story 9.3) **And** NO KPI cards, NO margin editor, NO firehose — per UX-DR27 mobile chrome strips.
  2. **Given** mobile bottom action bar per UX-DR26 **When** the stripped layout renders **Then** a persistent bottom action bar carries pause + "ver alertas" buttons only **And** the bar sits ABOVE iOS Safari's safe-area inset (test on iPhone SE / iPhone 14 simulators) — flagged in Step 4 Notes-for-Pedro per OQ-7.
  3. **Given** Atenção feed entry detail (UX-DR26 surface 2) **When** the customer taps "Ver detalhes" on a single anomaly-review entry **Then** the entry is fully readable + actionable on mobile: Story 8.7's anomaly-review modal renders mobile-optimized (accept/reject buttons stacked vertically, hit targets ≥44px) **And** circuit-breaker-trip entries similarly fit mobile (pause / resume buttons stacked).
  4. **Given** NFR-P7 mobile budget (≤4s on 3G) **When** the stripped variant renders **Then** KPI cards render skeleton/shimmer placeholders within 800ms; full data within 4s budget **And** the Atenção feed loads from a separate lighter endpoint (count + top 3 entries) before the Notable feed loads — customer can act on critical events before full audit log is rendered (UX skeleton §6.3) **And** firehose surface is excluded from the mobile bundle entirely (lazy-loaded only when explicitly requested — never on first paint).
