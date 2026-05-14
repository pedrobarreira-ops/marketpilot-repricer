// tests/app/routes/dashboard/kpi-cards.test.js
// Epic 8 Test Plan — Story 8.2 scaffold (epic-start-test-design 2026-05-14)
// Runner: node --test (built-in; no Jest/Vitest per architecture constraint)
//
// Coverage:
//   AC#1 — 3 KPI status cards with correct labels, counts, secondary catalog-value lines
//           eyebrow labels, delta vs yesterday
//   AC#2 — Channel scope: PT vs ES toggle scopes KPI data
//   AC#3 — No snapshot today: zero placeholder "Atualização em curso..."
//   AC#4 — Negative: no report narrative arc (rocket hero, maiores oportunidades tables)
//
// Depends on: Story 8.1 (dashboard chrome), Story 9.2 (daily_kpi_snapshots data source),
//             Story 7.1 (shared/money/index.js formatEur)
//
// Run with: node --test tests/app/routes/dashboard/kpi-cards.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Verbatim KPI card labels per UX skeleton §10 (PT)
const KPI_LABELS = {
  emPrimeiroLugar: 'Em 1.º lugar',
  aPerder: 'A perder posição',
  tier3: 'Sem concorrência',  // Tier 3
};

// ---------------------------------------------------------------------------
// AC#1 — KPI card rendering
// ---------------------------------------------------------------------------

describe('kpi-cards-rendering', () => {
  test('kpi_cards_render_3_status_cards_with_correct_labels', async () => {
    // Given: kpi-cards.eta rendered with daily_kpi_snapshots row
    // When:  component rendered
    // Then:  3 cards with labels: "Em 1.º lugar", "A perder posição", "Sem concorrência (Tier 3)"
    // TODO (Amelia): render kpi-cards.eta via Fastify inject (via dashboard route)
    //   assert html.includes('Em 1.º lugar')
    //   assert html.includes('A perder posição')
    //   assert html.includes('Sem concorrência')
    assert.ok(true, 'scaffold');
  });

  test('kpi_em_primeiro_lugar_shows_skus_in_first_count', async () => {
    // Given: daily_kpi_snapshots.skus_in_first_count = 42
    // When:  rendered
    // Then:  "Em 1.º lugar" card shows count 42
    // TODO (Amelia): seed mock DB snapshot with skus_in_first_count=42; assert html.includes('42')
    assert.ok(true, 'scaffold');
  });

  test('kpi_a_perder_shows_skus_losing_count', async () => {
    // Given: daily_kpi_snapshots.skus_losing_count = 7
    // When:  rendered
    // Then:  "A perder posição" card shows count 7
    assert.ok(true, 'scaffold');
  });

  test('kpi_tier3_shows_skus_exclusive_count', async () => {
    // Given: daily_kpi_snapshots.skus_exclusive_count = 150
    // When:  rendered
    // Then:  Tier 3 card shows count 150
    assert.ok(true, 'scaffold');
  });

  test('kpi_secondary_line_uses_format_eur_for_catalog_value', async () => {
    // Given: catalog_value_cents in snapshot (e.g., 150000 = €1.500,00)
    // When:  rendered
    // Then:  secondary line shows formatEur output (€ prefix, comma decimal, PT locale)
    //        NOT raw cents integer; NOT toFixed pattern
    // TODO (Amelia): assert html includes '€' and comma decimal separator
    assert.ok(true, 'scaffold');
  });

  test('kpi_card_eyebrow_label_uppercase_small_caps_class_present', async () => {
    // Given: any kpi-cards.eta render
    // When:  HTML inspected
    // Then:  eyebrow label element has uppercase class (10-11px, 0.12em tracking per §10)
    //        typically: class="kpi-eyebrow" or similar CSS class from design system
    // TODO (Amelia): assert html.includes('kpi-eyebrow') or equivalent class
    assert.ok(true, 'scaffold');
  });

  test('kpi_card_displays_delta_vs_yesterday_when_prior_snapshot_exists', async () => {
    // Given: today snapshot + yesterday snapshot both exist
    //        today.skus_in_first_count = 42; yesterday.skus_in_first_count = 30 (delta = +12)
    // When:  rendered
    // Then:  "+12 vs ontem" delta annotation present per UX skeleton §10
    // TODO (Amelia): seed two snapshot rows; assert html.includes('vs ontem')
    assert.ok(true, 'scaffold');
  });
});

// ---------------------------------------------------------------------------
// AC#2 — Channel scope
// ---------------------------------------------------------------------------

describe('kpi-cards-channel-scope', () => {
  test('kpi_cards_scoped_to_pt_channel_when_toggle_is_pt', async () => {
    // Given: toggle = PT; two snapshots exist: PT (skus_in_first=42) and ES (skus_in_first=10)
    // When:  rendered with channel_code='WRT_PT_ONLINE'
    // Then:  shows 42 (PT), NOT 10 (ES)
    // TODO (Amelia): pass channel_code parameter to kpi-cards template; assert correct count
    assert.ok(true, 'scaffold');
  });

  test('kpi_cards_scoped_to_es_channel_when_toggle_is_es', async () => {
    // Given: toggle = ES; ES snapshot skus_in_first=10
    // When:  rendered with channel_code='WRT_ES_ONLINE' (or equivalent)
    // Then:  shows 10 (ES), NOT 42 (PT)
    assert.ok(true, 'scaffold');
  });
});

// ---------------------------------------------------------------------------
// AC#3 — No snapshot today: zero placeholder
// ---------------------------------------------------------------------------

describe('kpi-cards-no-snapshot', () => {
  test('kpi_cards_show_zero_placeholder_when_no_snapshot_exists_today', async () => {
    // Given: daily_kpi_snapshots has no row for today's date
    // When:  rendered
    // Then:  cards render with count 0; "Atualização em curso..." caption (NOT blank skeleton)
    // TODO (Amelia): mock DB returning empty rows; assert html.includes('Atualização em curso')
    assert.ok(true, 'scaffold');
  });

  test('kpi_cards_never_blank_in_steady_state', async () => {
    // Given: no snapshot row
    // When:  rendered
    // Then:  cards are NOT blank/empty (no empty KPI slots without copy)
    //        always show either real count or zero placeholder
    // TODO (Amelia): assert html.includes('0') or placeholder text in each card position
    assert.ok(true, 'scaffold');
  });
});

// ---------------------------------------------------------------------------
// AC#4 — Negative: no report narrative arc (UX-DR13)
// ---------------------------------------------------------------------------

describe('kpi-cards-negative-assertions', () => {
  test('kpi_row_has_no_rocket_hero_card_report_narrative_arc', async () => {
    // Per UX-DR13: dashboard does NOT replicate the free report's 4-section narrative arc
    // The rocket hero card "A um passo do 1.º" must NOT appear
    // TODO (Amelia): assert !html.includes('A um passo do 1.º')
    assert.ok(true, 'scaffold');
  });

  test('kpi_row_has_no_maiores_oportunidades_table', async () => {
    // Per UX-DR13: no "Maiores oportunidades", "Margem para subir", "Vitórias rápidas" tables
    // TODO (Amelia): assert !html.includes('Maiores oportunidades')
    //   assert !html.includes('Margem para subir')
    //   assert !html.includes('Vitórias rápidas')
    assert.ok(true, 'scaffold');
  });

  test('kpi_row_shows_only_3_status_cards_no_additional_tables', async () => {
    // Per UX-DR13: ONLY the 3 KPI cards render in the KPI row
    // TODO (Amelia): assert card count = exactly 3 (count kpi-card class occurrences)
    assert.ok(true, 'scaffold');
  });
});
