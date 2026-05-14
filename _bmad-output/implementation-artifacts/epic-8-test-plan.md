# Epic 8 Test Plan — Customer Dashboard & Surfaces

**Generated:** 2026-05-14
**Epic:** Epic 8 — Customer Dashboard & Surfaces (Stories 8.1–8.12)
**Runner:** `node --test` (built-in; no Jest/Vitest per architecture constraint)
**UI strategy:** Pattern A surfaces use Fastify inject + HTML string assertions against
verbatim PT copy from UX skeleton. No browser automation at MVP (desktop ≥1280px primary;
NFR-P7 budget verified via response timing in integration tests where feasible).

---

## Overview

Epic 8 delivers the customer-facing operational surfaces: state-aware dashboard root (8.1),
KPI cards row (8.2), PT/ES channel toggle (8.3), margin editor with worked-profit-example
(8.4), pause/resume buttons (8.5), Go-Live consent modal + Stripe redirect shell (8.6),
anomaly-review modal (8.7), banner library + UX4 stack precedence (8.8), interception pages
for key-revoked and payment-failed (8.9), founder admin status page (8.10), settings
sectioned navigation for 5 pages (8.11), and mobile critical-alert response surface (8.12).

All UI stories use Pattern A (visual stub reference + UX skeleton § contract), Pattern B
(skeleton fallback), or Pattern C (UX skeleton + visual-DNA tokens). No SPA framework,
no bundler per architectural constraints.

### Stories

| Story | Title | Size | `integration_test_required` |
|-------|-------|------|-----------------------------|
| 8.1 | Dashboard root state-aware view + sticky header chrome | L | yes — RLS + state machine |
| 8.2 | KPI cards row | M | no (unit + route) |
| 8.3 | PT/ES channel toggle | S | no (unit) |
| 8.4 | Margin editor inline panel | L | yes — RLS (POST /dashboard/margin) |
| 8.5 | Pause/Resume buttons + cron_state transitions | M | yes — RLS + transitionCronState |
| 8.6 | Go-Live consent modal + Stripe redirect | M | yes — RLS + transitionCronState |
| 8.7 | Anomaly review modal | M | no (unit — consumes Story 7.4 endpoints) |
| 8.8 | Banner library + UX4 stack precedence | M | no (unit) |
| 8.9 | Interception pages — `/key-revoked`, `/payment-failed` | M | no (unit) |
| 8.10 | `/admin/status` founder page | L | yes — founder-admin-only middleware |
| 8.11 | Settings sectioned navigation (5 pages) | L | no (unit + route) |
| 8.12 | Mobile critical-alert response surface | M | no (unit) |

### Key Constraints

- **No SPA, no bundler:** HTML rendered by Eta templates; `public/js/*.js` are per-page
  vanilla scripts with `defer`. Tests assert HTML string content via Fastify inject.
- **cron_state machine:** All dashboard state assertions depend on `shared/state/cron-state.js`
  (`transitionCronState`) and `LEGAL_CRON_TRANSITIONS` — tests mock the DB client and
  assert the correct transition tuple is called.
- **formatEur / fromCents:** Money display depends on `shared/money/index.js` (Story 7.1).
  Tests importing money functions must ensure the dependency exists before running.
- **Banner precedence (UX-DR4):** Payment failure > circuit breaker > anomaly attention >
  sustained transient > paused by customer > provisioning > dry run. Tests verify only the
  highest-precedence banner renders when multiple conditions hold.
- **UX-DR5 visual distinction:** Customer-paused (grey + pause_circle) vs payment-failed
  (warning-amber + warning icon) must NEVER share an icon — static assertion in test.
- **UX-DR32 first-time interception:** `/payment-failed` interception fires only once per
  state-transition; subsequent visits render `/` with persistent banner.
- **NFR-A1 / NFR-A2 accessibility:** ARIA labels and keyboard navigability verified via
  HTML string assertions (role="alert", aria-label attributes, button disabled states).
- **No refurbished products, no multi-marketplace at MVP:** Negative assertions where relevant.

---

## Story 8.1: Dashboard root state-aware view + sticky header chrome

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Dashboard route (full) | `app/src/routes/dashboard/index.js` (replaces Story 4.9 minimal stub) |
| Default layout | `app/src/views/layouts/default.eta` |
| Dashboard view | `app/src/views/pages/dashboard.eta` |
| Interception redirect middleware | `app/src/middleware/interception-redirect.js` |
| Dashboard JS | `public/js/dashboard.js` |

### Test Files

- `tests/app/routes/dashboard/index.test.js` (scaffold committed at Epic-Start — unit/route)
- `tests/integration/dashboard-state-machine.test.js` (scaffold committed at Epic-Start — integration)

**`integration_test_required: true`** — AC#7 requires live Postgres with RLS + all 7 cron_state
variants seeded. AC#5 UX-DR3 interception once-per-state-transition requires session state.

### Behavioral Tests (index.test.js)

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `provisioning_state_redirects_to_onboarding_scan` | 302 → /onboarding/scan |
| AC#1 | `dry_run_state_renders_200_with_modo_simulacao_badge` | 200 + "MODO SIMULAÇÃO" badge |
| AC#1 | `active_healthy_state_renders_full_kpi_cards` | 200 + KPI slot rendered |
| AC#1 | `paused_by_customer_renders_grey_banner` | 200 + §9.4 copy + grey styling |
| AC#1 | `paused_by_payment_failure_renders_red_banner_with_warning_icon` | "warning" icon |
| AC#1 | `paused_by_circuit_breaker_renders_red_banner_with_investigate_button` | "Investigar" |
| AC#1 | `paused_by_key_revoked_redirects_to_key_revoked_page` | 302 → /key-revoked |
| AC#1 | `anomaly_attention_active_shows_yellow_banner_with_sku_count` | yellow + count |
| AC#1 | `sustained_transient_active_shows_grey_informational_banner` | §9.9 copy |
| AC#2 | `layout_includes_sticky_header_with_backdrop_blur` | backdrop-filter: blur(12px) |
| AC#2 | `layout_includes_banner_zone_body_slot_footer` | structural slots present |
| AC#3 | `dry_run_state_shows_kpi_simulated_values_and_ir_live_cta` | "Ir live" CTA |
| AC#4 | `multiple_banner_conditions_only_highest_precedence_renders` | UX-DR4 precedence |
| AC#5 | `key_revoked_interception_fires_only_first_time_subsequent_lands_on_dashboard` | UX-DR32 |
| AC#6 | `page_keyboard_accessible_focus_order_header_banner_kpi_margin_footer` | tab order |
| AC#6 | `escape_closes_open_modal_when_present` | modal dismiss |

### Integration Tests (dashboard-state-machine.test.js)

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#7 | `all_7_cron_state_variants_render_correct_banner_and_cta` | parametric: 7 states |
| AC#7 | `ux_dr3_interception_triggers_only_once_per_state_transition` | session flag |
| AC#7 | `rls_prevents_customer_a_seeing_customer_b_dashboard` | cross-tenant 403/404 |

---

## Story 8.2: KPI cards row

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| KPI cards component | `app/src/views/components/kpi-cards.eta` |

### Test File

`tests/app/routes/dashboard/kpi-cards.test.js` (scaffold committed at Epic-Start)

### Behavioral Tests

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `kpi_cards_render_3_status_cards_with_correct_labels` | 3 cards: "Em 1.º lugar", "A perder posição", "Sem concorrência (Tier 3)" |
| AC#1 | `kpi_em_primeiro_lugar_shows_skus_in_first_count` | count from `skus_in_first_count` |
| AC#1 | `kpi_a_perder_shows_skus_losing_count` | count from `skus_losing_count` |
| AC#1 | `kpi_tier3_shows_skus_exclusive_count` | count from `skus_exclusive_count` |
| AC#1 | `kpi_secondary_line_uses_format_eur_for_catalog_value` | formatEur output present |
| AC#1 | `kpi_card_eyebrow_label_uppercase_small_caps_styling` | uppercase label class |
| AC#1 | `kpi_card_displays_delta_vs_yesterday_when_prior_snapshot_exists` | "+12 vs ontem" |
| AC#2 | `kpi_cards_scoped_to_pt_channel_when_toggle_is_pt` | channel_code='WRT_PT_ONLINE' |
| AC#2 | `kpi_cards_scoped_to_es_channel_when_toggle_is_es` | channel_code='WRT_ES_ONLINE' |
| AC#3 | `kpi_cards_show_zero_placeholder_when_no_snapshot_exists_today` | "Atualização em curso..." |
| AC#3 | `kpi_cards_never_blank_in_steady_state` | no empty skeleton in steady state |
| AC#4 | `kpi_row_has_no_rocket_hero_card_report_narrative_arc` | NOT present: "A um passo do 1.º" |
| AC#4 | `kpi_row_has_no_maiores_oportunidades_table` | negative assertion: report tables absent |

---

## Story 8.3: PT/ES channel toggle pill in sticky header

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Channel toggle component | `app/src/views/components/channel-toggle.eta` |
| Toggle JS (state management) | `public/js/dashboard.js` (extended) |

### Test File

`tests/app/routes/dashboard/channel-toggle.test.js` (scaffold committed at Epic-Start)

### Behavioral Tests

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `toggle_renders_pt_es_segmented_buttons_in_sticky_header` | PT \| ES pills present |
| AC#1 | `toggle_scopes_kpi_cards_margin_editor_and_audit_preview` | data-toggle-scope attrs |
| AC#1 | `toggle_does_not_scope_global_banner_zone` | banner zone outside toggle scope |
| AC#2 | `toggle_state_sticky_across_navigation_via_local_storage` | localStorage usage |
| AC#2 | `default_channel_is_pt_on_first_load` | PT active by default |
| AC#3 | `no_both_merged_view_button_exists` | only PT and ES, no "Both" third button |
| AC#4 | `toggle_hidden_when_customer_has_single_channel_only` | single-channel: hidden or disabled |
| AC#4 | `single_channel_shows_tooltip_apenas_pt_ativo` | tooltip copy verbatim |

---

## Story 8.4: Margin editor inline panel with worked-profit-example

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Margin editor component | `app/src/views/components/margin-editor.eta` |
| Margin edit route (POST) | `app/src/routes/dashboard/margin-edit.js` |
| Margin editor JS | `public/js/margin-editor.js` (150ms-debounced live recompute) |

### Test File

`tests/app/routes/dashboard/margin-edit.test.js` (scaffold committed at Epic-Start)

**`integration_test_required: true`** — POST /dashboard/margin requires RLS-aware client
with real customer_marketplace row to verify scope isolation.

### Behavioral Tests

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `representative_sku_selection_filters_tier_1_2a_2b_only` | tier NOT IN ('3') |
| AC#1 | `representative_sku_selection_filters_by_current_toggle_channel` | channel_code scope |
| AC#1 | `representative_sku_selection_picks_closest_to_catalog_median` | rank by ABS distance |
| AC#1 | `representative_sku_empty_state_shows_verbatim_copy` | "Adiciona produtos contestados..." |
| AC#2 | `ver_outro_cycles_through_top_5_candidates_deterministically` | same 5 each time |
| AC#2 | `ver_outro_does_not_change_engine_behavior` | pure UX, no DB side-effect |
| AC#3 | `margin_assumption_below_5pct_assumes_5pct_floor` | band → assumed margin |
| AC#3 | `margin_assumption_5_to_10_pct_band_assumes_5pct` | 5-10% band → 5% |
| AC#3 | `margin_assumption_10_to_15_pct_band_assumes_10pct` | 10-15% band → 10% |
| AC#3 | `margin_assumption_15_plus_band_assumes_15pct` | 15%+ band → 15% |
| AC#3 | `margin_assumption_displayed_explicitly_per_ux_dr19` | caveat copy visible |
| AC#4 | `editor_shows_sku_title_current_price_minimum_allowed_price_impact` | §4.3.3 anatomy |
| AC#4 | `minimum_allowed_price_computed_via_round_floor_cents` | uses money SSoT |
| AC#5 | `live_update_debounced_150ms_on_input_change` | JS debounce timing |
| AC#5 | `input_accepts_percentage_with_one_decimal` | e.g., 1.5% accepted |
| AC#5 | `out_of_range_input_shows_red_border_and_disables_save` | 0-50% guard |
| AC#5 | `out_of_range_error_message_verbatim_pt_copy` | "Valor entre 0% e 50%" |
| AC#6 | `post_margin_updates_customer_marketplaces_via_rls_client` | UPDATE with RLS |
| AC#6 | `post_margin_response_shows_verbatim_confirmation_toast` | "Margens guardadas. Aplicado a partir do próximo ciclo (~15 min)." |
| AC#6 | `post_margin_mid_cycle_in_flight_cycle_not_affected` | no mid-cycle interrupt |
| AC#7 | `margin_editor_keyboard_accessible_tab_input_save_enter` | NFR-A2 |
| AC#7 | `aria_labels_announce_reduzir_ate_and_aumentar_ate` | NFR-A1 |

---

## Story 8.5: Pause/Resume buttons + customer-pause cron_state transitions

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Pause/Resume route | `app/src/routes/dashboard/pause-resume.js` |
| Pause button component | `app/src/views/components/pause-button.eta` |
| Pause/Resume JS | `public/js/pause-resume.js` (confirmation modal) |

### Test File

`tests/app/routes/dashboard/pause-resume.test.js` (scaffold committed at Epic-Start)

**`integration_test_required: true`** — transitionCronState requires real DB for
optimistic-concurrency guard; RLS ensures customer can only pause their own marketplace.

### Behavioral Tests

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `pause_button_renders_pausar_repricing_label_when_active` | "Pausar repricing" + pause_circle |
| AC#1 | `pause_button_click_opens_confirmation_modal_with_verbatim_copy` | "Tens a certeza?..." exact |
| AC#1 | `confirmation_modal_has_cancelar_and_pausar_buttons` | two buttons |
| AC#2 | `post_pause_calls_transition_cron_state_active_to_paused_by_customer` | tuple (ACTIVE→PAUSED_BY_CUSTOMER) |
| AC#2 | `post_pause_emits_customer_paused_notavel_audit_event` | Notável event |
| AC#2 | `post_pause_rerenders_dashboard_in_paused_by_customer_state` | §9.4 banner |
| AC#3 | `resume_button_renders_retomar_repricing_label_when_paused_by_customer` | "Retomar repricing" + play_circle |
| AC#3 | `resume_is_single_click_no_confirmation_modal` | no modal on resume |
| AC#3 | `post_resume_calls_transition_cron_state_paused_by_customer_to_active` | tuple (PAUSED_BY_CUSTOMER→ACTIVE) |
| AC#3 | `post_resume_emits_customer_resumed_notavel_audit_event` | Notável event |
| AC#4 | `pause_button_hidden_when_state_is_paused_by_payment_failure` | button not rendered |
| AC#4 | `customer_paused_event_never_fires_for_non_customer_initiated_states` | audit guard |
| AC#5 | `pause_button_keyboard_accessible_tab_enter_modal_escape` | NFR-A2 |
| AC#5 | `pause_resume_screen_reader_labels_announced` | NFR-A1 |

---

## Story 8.6: Go-Live consent modal + Stripe redirect

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Go-Live route (POST) | `app/src/routes/dashboard/go-live.js` |
| Go-Live consent modal | `app/src/views/modals/go-live-consent.eta` |
| Go-Live JS | `public/js/go-live-modal.js` |

### Test File

`tests/app/routes/dashboard/go-live.test.js` (scaffold committed at Epic-Start)

**`integration_test_required: true`** — DRY_RUN → ACTIVE transition via transitionCronState
requires real DB. Stripe wiring is stub until Story 11.1 ships.

### Behavioral Tests

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `go_live_modal_opens_with_verbatim_titulo_pronto_para_ir_live` | "Pronto para ir live?" |
| AC#1 | `modal_body_shows_n_products_count_from_tier_1_2a_2b` | COUNT from sku_channels |
| AC#1 | `modal_body_shows_margin_percentage_from_customer_marketplace` | max_discount_pct × 100 |
| AC#1 | `modal_has_checkbox_compreendo_e_autorizo_repricing_automatico` | checkbox verbatim |
| AC#1 | `modal_cancel_button_says_manter_em_modo_simulacao` | "Manter em modo simulação" |
| AC#2 | `confirm_button_disabled_when_checkbox_unchecked` | disabled attribute |
| AC#2 | `confirm_button_enables_with_navy_gradient_when_checkbox_checked` | enabled + styling class |
| AC#2 | `keyboard_tab_checkbox_space_tab_submit_enter_works` | NFR-A2 |
| AC#3 | `post_go_live_calls_stripe_subscription_creation_stub` | Stripe helper called |
| AC#3 | `post_go_live_on_stripe_success_transitions_dry_run_to_active` | DRY_RUN→ACTIVE |
| AC#3 | `post_go_live_does_not_emit_go_live_flipped_audit_event` | no AD20 event for go-live |
| AC#3 | `post_go_live_redirects_to_dashboard_active_state` | 302 → / (ACTIVE) |
| AC#3 | `post_go_live_on_stripe_failure_modal_stays_open_with_pt_error` | getSafeErrorMessage |
| AC#4 | `modal_footer_repeats_tu_confirmas_nos_executamos_copy` | UX-DR24 verbatim |

---

## Story 8.7: Anomaly review modal (consumes Story 7.4 endpoints)

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Anomaly review modal | `app/src/views/modals/anomaly-review.eta` |
| Anomaly review JS | `public/js/anomaly-review.js` |

### Test File

`tests/app/routes/dashboard/anomaly-review.test.js` (scaffold committed at Epic-Start)

Note: This story consumes `POST /audit/anomaly/:skuChannelId/{accept,reject}` from Story 7.4.
Tests here verify the modal rendering and client-side invocation. Story 7.4's RLS tests cover
the endpoint security.

### Behavioral Tests

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `modal_opens_with_verbatim_titulo_mudanca_externa_de_preco` | "Mudança externa de preço · {SKU name}" |
| AC#1 | `modal_body_shows_antes_agora_and_deviation_pct` | "Antes:", "Agora:", "±{deviation}%" |
| AC#1 | `modal_body_verbatim_como_a_mudanca_e_maior_que_40_pct` | exact PT copy |
| AC#1 | `modal_body_verbatim_nada_acontece_ate_confirmares` | UX-DR24 copy |
| AC#2 | `old_price_formatted_via_format_eur_from_audit_log_payload` | formatEur applied |
| AC#2 | `new_price_formatted_via_format_eur` | formatEur applied |
| AC#2 | `deviation_pct_sign_prefixed_one_decimal` | e.g., "+47.8%" |
| AC#3 | `confirmar_button_calls_post_anomaly_accept_endpoint` | /audit/anomaly/:id/accept |
| AC#3 | `accept_closes_modal_and_decrements_anomaly_banner_count` | count decrement |
| AC#4 | `rejeitar_button_calls_post_anomaly_reject_endpoint` | /audit/anomaly/:id/reject |
| AC#4 | `reject_closes_modal_and_decrements_anomaly_banner_count` | count decrement |
| AC#5 | `nada_acontece_ate_confirmares_visually_emphasized` | bold/italic styling class |

---

## Story 8.8: Banner library + UX4 stack precedence

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Banner library | `app/src/views/components/banners.eta` |

### Test File

`tests/app/views/banners.test.js` (scaffold committed at Epic-Start)

### Behavioral Tests

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `payment_failure_banner_renders_when_state_paused_by_payment_failure` | red + warning icon |
| AC#1 | `circuit_breaker_banner_renders_when_state_paused_by_circuit_breaker` | red + gpp_maybe icon |
| AC#1 | `anomaly_attention_banner_renders_when_anomaly_count_gt_0` | yellow + error icon |
| AC#1 | `sustained_transient_banner_renders_when_3_consecutive_failures` | grey + schedule icon |
| AC#1 | `paused_by_customer_banner_renders_calm_grey_pause_circle` | grey + pause_circle |
| AC#1 | `dry_run_banner_renders_blue_science_icon` | blue + science icon |
| AC#1 | `only_highest_precedence_banner_renders_when_multiple_conditions` | one banner only |
| AC#1 | `lower_precedence_banner_reappears_after_higher_clears` | reappearance logic |
| AC#2 | `customer_paused_and_payment_failed_do_not_share_icon` | UX-DR5: icons differ |
| AC#2 | `customer_paused_uses_calm_grey_not_warning_amber` | colour class distinction |
| AC#2 | `payment_failed_uses_warning_amber_not_calm_grey` | colour class distinction |
| AC#3 | `red_banners_have_role_alert_aria_attribute` | role="alert" |
| AC#3 | `grey_blue_banners_have_role_status_aria_attribute` | role="status" |
| AC#3 | `banner_cta_button_focusable_tab_enter_space` | NFR-A2 |
| AC#4 | `anomaly_banner_shows_per_channel_split_when_both_channels_have_items` | "{N_pt} no PT · {N_es} no ES" |

---

## Story 8.9: Interception pages — `/key-revoked`, `/payment-failed`

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Key-revoked route | `app/src/routes/interceptions/key-revoked.js` |
| Payment-failed route | `app/src/routes/interceptions/payment-failed.js` |
| Key-revoked view | `app/src/views/pages/key-revoked.eta` |
| Payment-failed view | `app/src/views/pages/payment-failed.eta` |

### Test File

`tests/app/routes/interceptions/key-revoked-payment-failed.test.js` (scaffold committed at Epic-Start)

### Behavioral Tests

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `key_revoked_page_renders_with_configurar_nova_chave_button` | "Configurar nova chave →" |
| AC#1 | `key_revoked_page_links_to_onboarding_key_in_rotation_mode` | /onboarding/key?rotation=true |
| AC#1 | `key_revoked_page_has_como_gerar_chave_worten_link` | help modal trigger |
| AC#2 | `successful_key_rotation_transitions_paused_by_key_revoked_to_active` | cron_state → ACTIVE |
| AC#2 | `key_rotation_success_no_scan_repeat_catalog_retained` | no re-scan |
| AC#2 | `key_rotation_no_reonboarding_required` | not redirected to /onboarding/* |
| AC#3 | `payment_failed_first_login_post_transition_redirects_to_payment_failed_page` | UX-DR32 first-time |
| AC#3 | `payment_failed_page_has_atualizar_pagamento_cta_stripe_portal_link` | Stripe portal CTA |
| AC#3 | `payment_failed_subsequent_login_still_in_state_lands_on_dashboard_with_banner` | not interception |
| AC#4 | `direct_visit_to_key_revoked_without_matching_state_redirects_to_dashboard` | UX-DR2 guard |
| AC#4 | `direct_visit_to_payment_failed_without_matching_state_redirects_to_dashboard` | UX-DR2 guard |

---

## Story 8.10: `/admin/status` founder page

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Admin status route | `app/src/routes/admin/status.js` |
| Admin status view | `app/src/views/pages/admin-status.eta` |
| Admin mode banner | `app/src/views/components/admin-mode-banner.eta` |

### Test Files

- `tests/integration/admin-status.test.js` (scaffold committed at Epic-Start)

**`integration_test_required: true`** — founder-admin-only middleware gate + service-role DB
bypass for `?as_admin=` reuse of customer audit log require real Supabase with seeded
`founder_admins` rows.

### Behavioral Tests (admin-status.test.js)

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `founder_admin_sees_full_admin_status_page` | 200 + sistema + customers + events rows |
| AC#1 | `sistema_row_shows_health_endpoint_status_uptime_p11_latency_pri01_stuck_count` | all 4 fields |
| AC#1 | `customers_row_shows_per_customer_status_pill_cron_state_last_cycle_age_atencao_count` | per-customer |
| AC#2 | `admin_page_uses_monospace_font_slate_cool_grey_no_ambient_washes` | UX-DR29 visual register |
| AC#2 | `admin_page_layout_distinct_from_customer_dashboard_visual_register` | no navy primary tints |
| AC#3 | `founder_clicking_customer_row_opens_audit_log_with_as_admin_param` | /audit?as_admin={id} |
| AC#3 | `as_admin_audit_view_shows_red_admin_mode_banner` | admin-mode-banner.eta rendered |
| AC#3 | `admin_mode_banner_verbatim_copy` | "A ver o audit log de {email} como administrador. Modo apenas leitura." |
| AC#4 | `admin_status_page_has_no_edit_ui` | UX-DR28: read-only |
| AC#4 | `founder_never_logs_in_as_customer_impersonator` | no auth.users impersonation |
| AC#5 | `non_founder_customer_gets_403_or_404_on_admin_status` | access denied |
| AC#5 | `non_founder_cannot_use_as_admin_param` | RLS + middleware block |
| AC#5 | `as_admin_from_founder_shows_correct_customer_audit_log` | right customer data |

---

## Story 8.11: Settings sectioned navigation (5 pages)

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Settings routes | `app/src/routes/settings/account.js`, `key.js`, `marketplaces.js`, `billing.js`, `delete.js` |
| Settings views | `app/src/views/pages/settings-*.eta` (5 pages) |
| Settings sidebar | `app/src/views/components/settings-sidebar.eta` |

### Test File

`tests/app/routes/settings/settings-nav.test.js` (scaffold committed at Epic-Start)

### Behavioral Tests

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `settings_sidebar_renders_5_entries_on_desktop` | Conta, Chave Worten, Marketplaces, Faturação, Eliminar conta |
| AC#1 | `active_section_is_highlighted_in_sidebar` | active class on current section |
| AC#1 | `sidebar_collapses_to_accordion_below_768px` | UX-DR22 mobile accordion |
| AC#2 | `settings_account_shows_email_readonly_and_password_change_form` | email readonly field |
| AC#2 | `settings_account_keyboard_accessible` | NFR-A2 |
| AC#3 | `settings_key_shows_vault_status_pill_encriptada_validada_timestamp` | "Encriptada · Validada às" |
| AC#3 | `settings_key_rotacionar_chave_button_triggers_rotation_flow` | links to /onboarding/key?rotation=true |
| AC#3 | `settings_key_never_displays_plaintext_key_material` | no raw key in HTML |
| AC#3 | `settings_key_rotation_success_shows_verbatim_confirmation_copy` | "A chave anterior é destruída no momento da nova validação." |
| AC#3 | `settings_key_rotation_does_not_emit_audit_event` | no AD20 key-rotation event type |
| AC#4 | `settings_marketplaces_shows_read_only_active_marketplace_list` | "Worten PT" listed |
| AC#4 | `settings_marketplaces_adicionar_marketplace_button_has_concierge_tooltip` | tooltip verbatim |
| AC#4 | `settings_marketplaces_no_add_marketplace_form_wizard` | FR41 MVP: no form |
| AC#5 | `settings_billing_shows_current_plan_next_billing_date_last_invoice` | billing summary |
| AC#5 | `settings_billing_stripe_portal_cta_available_or_placeholder` | "Abrir Stripe Customer Portal" or "Disponível em breve" |
| AC#6 | `settings_delete_entry_page_describes_what_gets_wiped_vs_retained` | §8.4 Step 1 copy |
| AC#6 | `settings_delete_continuar_com_eliminacao_button_links_to_epic_10_flow` | links to deletion modal |

---

## Story 8.12: Mobile critical-alert response surface

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Mobile alert layout | `app/src/views/layouts/mobile-alert.eta` |
| Mobile CSS | `public/css/mobile.css` |

### Test File

`tests/app/routes/dashboard/mobile-alert.test.js` (scaffold committed at Epic-Start)

### Behavioral Tests

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `get_root_with_alert_anomaly_param_mobile_viewport_serves_stripped_layout` | mobile-alert.eta |
| AC#1 | `stripped_layout_shows_large_status_banner_pause_button_ver_detalhes_link` | 3 elements |
| AC#1 | `stripped_layout_has_no_kpi_cards_margin_editor_firehose` | UX-DR27 strips |
| AC#2 | `mobile_bottom_action_bar_renders_with_pause_and_ver_alertas_buttons_only` | UX-DR26 |
| AC#2 | `bottom_action_bar_positioned_above_ios_safe_area_inset` | padding-bottom: env(safe-area-inset-bottom) |
| AC#3 | `ver_detalhes_link_opens_anomaly_review_modal_mobile_optimized` | stacked buttons 44px targets |
| AC#3 | `anomaly_review_modal_accept_reject_buttons_stacked_vertically_on_mobile` | flex-direction: column |
| AC#4 | `nfr_p7_mobile_kpi_skeleton_renders_within_800ms` | performance budget |
| AC#4 | `firehose_excluded_from_mobile_first_paint` | no firehose on initial load |
| AC#4 | `atencao_feed_loads_lightweight_count_plus_top_3_entries_before_notable` | priority loading |

---

## Cross-Cutting Concerns

### cron_state Machine (AD15)

All state-transition tests (Stories 8.1, 8.5, 8.6) must verify the correct
`(from, to)` pair is passed to `transitionCronState`. Illegal transitions not in
`LEGAL_CRON_TRANSITIONS` must throw. Tests use a mock `transitionCronState` that
captures the call parameters for assertion.

**Audit events per transition:**
- `ACTIVE → PAUSED_BY_CUSTOMER` → emits `customer-paused` Notável (Story 8.5)
- `PAUSED_BY_CUSTOMER → ACTIVE` → emits `customer-resumed` Notável (Story 8.5)
- `DRY_RUN → ACTIVE` (Go-Live) → NO audit event (not in AD20 per-(from,to) map; Story 8.6)
- `PAUSED_BY_KEY_REVOKED → ACTIVE` (rotation) → NO audit event (Story 8.9)

### Banner Precedence (UX-DR4)

Full precedence stack for `banners.eta` (Story 8.8):
1. `payment_failure` — red, warning filled icon, §9.6 copy
2. `circuit_breaker` — red, gpp_maybe filled icon, §9.8 copy
3. `anomaly_attention` (per-SKU count > 0) — yellow, error filled icon, §9.7 copy
4. `sustained_transient` (≥3 consecutive cycle failures) — grey, schedule filled icon, §9.9 copy
5. `paused_by_customer` — grey, pause_circle filled icon, §9.4 copy
6. `provisioning` — grey defensive fallback
7. `dry_run` — blue, science filled icon, §9.5 copy

Test verifies: when conditions 2 + 3 + 5 hold simultaneously, only banner #2 renders.

### Interception-Redirect Semantics (UX-DR3 / UX-DR32)

- `/key-revoked` fires ONCE per state-transition to PAUSED_BY_KEY_REVOKED.
  Subsequent visits with same state → `/` with red banner.
- `/payment-failed` fires ONCE per state-transition to PAUSED_BY_PAYMENT_FAILURE.
  Tracked via session state or `last_shown_interception_at` timestamp.
- Direct visits without matching cron_state → 302 to `/` (Story 8.9 AC#4).

### Representative SKU Rule (UX-DR15, Story 8.4)

Selection pipeline (server-side):
1. Filter: `tier IN ('1', '2a', '2b')` AND channel_code = toggle channel
2. Filter: `current_price_cents` in [p25, p75] price quartile for marketplace + channel
3. Rank: ascending by `ABS(current_price_cents - catalog_median_price_cents)`
4. Pick top 1

"Ver outro" (UX-DR16) cycles through top 5 by same rule — deterministic, pure UX.

### Accessibility Baseline (NFR-A1 / NFR-A2)

Every interactive surface (modals, buttons, forms) must assert:
- `role="alert"` on red banners, `role="status"` on grey/blue banners
- `aria-label` on icon-only buttons (pause, play, close)
- All form inputs have associated `<label>` elements or `aria-label`
- Disabled state via `disabled` attribute (not just CSS)
- Keyboard: Tab → focus → Enter/Space → action works

### No Float Math in Eta Templates

Eta templates importing `shared/money/index.js` must NOT do ad-hoc `* 0.01` or
`.toFixed(2)` price formatting. The `formatEur` / `fromCents` helpers must be used.
Static assertion tests verify `!html.includes('toFixed')` and `!html.includes('* 0.01')`.

### Pattern A Visual Reference

All Pattern A stories reference `screens/<NN>-<name>.html` stubs in
`_bmad-output/design-references/screens/`. Scaffold tests assert key CSS class names
and HTML structure from those stubs. BAD subagents must open the visual stub before
writing the Eta template to ensure visual fidelity.

---

## AC Coverage Map

| Story | AC | Test File | Test Name | Status |
|-------|----|-----------|-----------|--------|
| 8.1 | AC#1 | dashboard/index.test.js | `provisioning_state_redirects_to_onboarding_scan` | scaffold |
| 8.1 | AC#1 | dashboard/index.test.js | `dry_run_state_renders_200_with_modo_simulacao_badge` | scaffold |
| 8.1 | AC#1 | dashboard/index.test.js | all 7 cron_state variants | scaffold |
| 8.1 | AC#2 | dashboard/index.test.js | `layout_includes_sticky_header_with_backdrop_blur` | scaffold |
| 8.1 | AC#4 | dashboard/index.test.js | `multiple_banner_conditions_only_highest_precedence_renders` | scaffold |
| 8.1 | AC#5 | dashboard/index.test.js | `key_revoked_interception_fires_only_first_time` | scaffold |
| 8.1 | AC#7 | dashboard-state-machine.test.js | `all_7_cron_state_variants_render_correct_banner_and_cta` | scaffold |
| 8.2 | AC#1 | kpi-cards.test.js | `kpi_cards_render_3_status_cards_with_correct_labels` | scaffold |
| 8.2 | AC#3 | kpi-cards.test.js | `kpi_cards_show_zero_placeholder_when_no_snapshot_exists_today` | scaffold |
| 8.2 | AC#4 | kpi-cards.test.js | `kpi_row_has_no_rocket_hero_card_report_narrative_arc` | scaffold |
| 8.3 | AC#1 | channel-toggle.test.js | `toggle_renders_pt_es_segmented_buttons_in_sticky_header` | scaffold |
| 8.3 | AC#3 | channel-toggle.test.js | `no_both_merged_view_button_exists` | scaffold |
| 8.3 | AC#4 | channel-toggle.test.js | `toggle_hidden_when_customer_has_single_channel_only` | scaffold |
| 8.4 | AC#1 | margin-edit.test.js | `representative_sku_selection_filters_tier_1_2a_2b_only` | scaffold |
| 8.4 | AC#3 | margin-edit.test.js | `margin_assumption_below_5pct_assumes_5pct_floor` | scaffold |
| 8.4 | AC#5 | margin-edit.test.js | `out_of_range_input_shows_red_border_and_disables_save` | scaffold |
| 8.4 | AC#6 | margin-edit.test.js | `post_margin_response_shows_verbatim_confirmation_toast` | scaffold |
| 8.5 | AC#1 | pause-resume.test.js | `pause_button_renders_pausar_repricing_label_when_active` | scaffold |
| 8.5 | AC#2 | pause-resume.test.js | `post_pause_calls_transition_cron_state_active_to_paused_by_customer` | scaffold |
| 8.5 | AC#3 | pause-resume.test.js | `resume_is_single_click_no_confirmation_modal` | scaffold |
| 8.5 | AC#4 | pause-resume.test.js | `pause_button_hidden_when_state_is_paused_by_payment_failure` | scaffold |
| 8.6 | AC#1 | go-live.test.js | `go_live_modal_opens_with_verbatim_titulo_pronto_para_ir_live` | scaffold |
| 8.6 | AC#2 | go-live.test.js | `confirm_button_disabled_when_checkbox_unchecked` | scaffold |
| 8.6 | AC#3 | go-live.test.js | `post_go_live_does_not_emit_go_live_flipped_audit_event` | scaffold |
| 8.6 | AC#3 | go-live.test.js | `post_go_live_transitions_dry_run_to_active` | scaffold |
| 8.7 | AC#1 | anomaly-review.test.js | `modal_opens_with_verbatim_titulo_mudanca_externa_de_preco` | scaffold |
| 8.7 | AC#1 | anomaly-review.test.js | `modal_body_verbatim_nada_acontece_ate_confirmares` | scaffold |
| 8.7 | AC#3 | anomaly-review.test.js | `confirmar_button_calls_post_anomaly_accept_endpoint` | scaffold |
| 8.8 | AC#1 | banners.test.js | `only_highest_precedence_banner_renders_when_multiple_conditions` | scaffold |
| 8.8 | AC#2 | banners.test.js | `customer_paused_and_payment_failed_do_not_share_icon` | scaffold |
| 8.8 | AC#3 | banners.test.js | `red_banners_have_role_alert_aria_attribute` | scaffold |
| 8.9 | AC#1 | key-revoked-payment-failed.test.js | `key_revoked_page_renders_with_configurar_nova_chave_button` | scaffold |
| 8.9 | AC#3 | key-revoked-payment-failed.test.js | `payment_failed_subsequent_login_still_in_state_lands_on_dashboard_with_banner` | scaffold |
| 8.9 | AC#4 | key-revoked-payment-failed.test.js | `direct_visit_to_key_revoked_without_matching_state_redirects_to_dashboard` | scaffold |
| 8.10 | AC#1 | admin-status.test.js | `founder_admin_sees_full_admin_status_page` | scaffold |
| 8.10 | AC#3 | admin-status.test.js | `as_admin_audit_view_shows_red_admin_mode_banner` | scaffold |
| 8.10 | AC#4 | admin-status.test.js | `admin_status_page_has_no_edit_ui` | scaffold |
| 8.10 | AC#5 | admin-status.test.js | `non_founder_customer_gets_403_or_404_on_admin_status` | scaffold |
| 8.11 | AC#1 | settings-nav.test.js | `settings_sidebar_renders_5_entries_on_desktop` | scaffold |
| 8.11 | AC#3 | settings-nav.test.js | `settings_key_never_displays_plaintext_key_material` | scaffold |
| 8.11 | AC#4 | settings-nav.test.js | `settings_marketplaces_no_add_marketplace_form_wizard` | scaffold |
| 8.12 | AC#1 | mobile-alert.test.js | `stripped_layout_has_no_kpi_cards_margin_editor_firehose` | scaffold |
| 8.12 | AC#2 | mobile-alert.test.js | `mobile_bottom_action_bar_renders_with_pause_and_ver_alertas_buttons_only` | scaffold |
| 8.12 | AC#4 | mobile-alert.test.js | `firehose_excluded_from_mobile_first_paint` | scaffold |

**Total test cases at scaffold:** ~130
(16 dashboard-root + 13 kpi-cards + 8 channel-toggle + 21 margin-editor + 14 pause-resume +
14 go-live + 11 anomaly-review + 15 banners + 11 key-revoked-payment-failed +
13 admin-status + 16 settings-nav + 10 mobile-alert)

---

## Notes for Amelia (ATDD Step 2)

1. **Story 8.1 dashboard chrome replaces Story 4.9 stub:** `app/src/routes/dashboard/index.js`
   was a minimal stub for Story 4.9. Story 8.1 replaces it with the full state-aware view. The
   Story 4.9 test (`dry-run-minimal.test.js`) covers the pre-Epic 8 behaviour; its assertions
   become a subset of Story 8.1's full DRY_RUN coverage.

2. **Interception redirect middleware (Story 8.1 AC#1):** `app/src/middleware/interception-redirect.js`
   is NEW in Story 8.1. The PROVISIONING → /onboarding/scan redirect that existed in Story 4.9
   was inline in the route; Story 8.1 extracts it into this dedicated middleware. Tests should
   mock the middleware's DB call (one query: `SELECT cron_state, ...`).

3. **`transitionCronState` mock pattern (Stories 8.5, 8.6):** Import `transitionCronState` from
   `shared/state/cron-state.js` and use `mock.module()` to replace it with a spy. Assert the spy
   was called with the exact `(from, to)` tuple. The real implementation has optimistic-concurrency;
   the mock can return `{ rows: [{ id: 'cm-uuid' }] }` to simulate success.

4. **Stripe stub pattern (Story 8.6):** Until Story 11.1 ships, `go-live.js` uses a stub Stripe
   redirect. Tests should not fail when the Stripe module is absent — use dynamic import with
   fallback or the stub export. The AC#3 test for `on_stripe_failure_modal_stays_open_with_pt_error`
   can be simulated by making the stub throw a Stripe-like error.

5. **formatEur in Eta templates (Stories 8.2, 8.4, 8.7):** The `formatEur` helper from
   `shared/money/index.js` must be registered as an Eta view helper. Verify it's wired up in
   `app/src/server.js`'s Eta configuration before writing template assertions.

6. **Banner precedence encoding (Story 8.8):** The precedence is ENCODED in `banners.eta`
   (not computed at runtime from external config). Tests should verify the ordering by checking
   that when `conditions.payment_failure = true` AND `conditions.anomaly_attention = true`,
   only the payment_failure banner renders. The template uses an `if/else if` chain in precedence
   order — verify the chain order via static assertion (read the file source).

7. **`?as_admin=` param (Story 8.10):** The admin-mode param is honored by the audit-log route
   (Story 9.3), not the admin-status route itself. Story 8.10's route `GET /admin/status` renders
   the customer overview table; clicking a customer row navigates to `/audit?as_admin={id}`.
   For Story 8.10 integration tests, stub the Story 9.3 audit endpoint and verify the admin-mode
   banner renders from `admin-mode-banner.eta`.

8. **Settings sidebar accordion (Story 8.11 AC#1):** The accordion behaviour for mobile
   (below 768px) is CSS-driven (via `@media`). Tests assert the HTML structure has the correct
   accordion class names (e.g., `settings-sidebar--accordion`) for the CSS to target. No JS
   needed for the accordion at MVP.

9. **Mobile safe-area inset (Story 8.12 AC#2):** The `env(safe-area-inset-bottom)` value is a
   CSS env variable. Tests can assert the CSS rule exists in `public/css/mobile.css` via a
   static source read (readFile), not via a browser render.

10. **NFR-P7 performance budget (Story 8.12 AC#4):** The 800ms skeleton timing is a design
    guideline. At MVP, assert via Fastify inject timing (`Date.now()` before/after) that the
    stripped mobile layout responds in under 100ms (server-side; network latency excluded).
    The 4s full-data budget is end-to-end and not testable without a browser.
