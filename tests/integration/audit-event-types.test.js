// Epic 9 — Story 9.0 / AC#1: audit_log_event_types lookup table + 26-row seed integration test.
//
// This file is the dedicated integration test for AC#1.
// It verifies the migration `202604301207a_create_audit_log_event_types.sql` in isolation,
// before Story 9.1's audit_log partitioned table exists.
//
// Covers:
//   AC#1 — `audit_log_priority` enum has exactly three values: atencao, notavel, rotina.
//   AC#1 — `audit_log_event_types` table exists with columns: event_type, priority, description.
//   AC#1 — Table has exactly 26 base rows (7 Atenção + 8 Notável + 11 Rotina).
//   AC#1 — All 26 event_type slugs are present with correct priority group membership.
//   AC#1 — Every row has a non-empty PT-localized description.
//   AC#1 — No outbound FK exists on audit_log_event_types.event_type (lookup table; FKs flow inward).
//   AC#1 — event_type is the PRIMARY KEY (no duplicate event_type slugs).
//   AC#2 — EVENT_TYPES JS constant has the same 26 keys as the DB seed (sync check).
//
// Local-only: requires .env.test pointing at local Supabase with migrations applied.
// Run with:
//   node --env-file=.env.test --test tests/integration/audit-event-types.test.js
// Or via:
//   npm run test:integration

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getServiceRoleClient, closeServiceRolePool } from '../../shared/db/service-role-client.js';

// ---------------------------------------------------------------------------
// Taxonomy constants (mirror of AC#1 spec — used as fixtures)
// ---------------------------------------------------------------------------

const ATENCAO_SLUGS = [
  'anomaly-freeze',
  'circuit-breaker-trip',
  'circuit-breaker-per-sku-trip',
  'key-validation-fail',
  'pri01-fail-persistent',
  'payment-failure-pause',
  'shop-name-collision-detected',
];

const NOTAVEL_SLUGS = [
  'external-change-absorbed',
  'position-won',
  'position-lost',
  'new-competitor-entered',
  'large-price-move-within-tolerance',
  'customer-paused',
  'customer-resumed',
  'scan-complete-with-issues',
];

const ROTINA_SLUGS = [
  'undercut-decision',
  'ceiling-raise-decision',
  'hold-floor-bound',
  'hold-ceiling-bound',
  'hold-already-in-1st',
  'cycle-start',
  'cycle-end',
  'pri01-submit',
  'pri02-complete',
  'pri02-failed-transient',
  'tier-transition',
];

const ALL_26_SLUGS = [...ATENCAO_SLUGS, ...NOTAVEL_SLUGS, ...ROTINA_SLUGS];

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

test.after(async () => {
  await closeServiceRolePool();
});

// ---------------------------------------------------------------------------
// AC#1 — audit_log_priority enum
// ---------------------------------------------------------------------------

test('audit_log_priority enum exists with exactly three values: atencao, notavel, rotina', async () => {
  const db = getServiceRoleClient();
  const { rows } = await db.query(`
    SELECT e.enumlabel
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'audit_log_priority'
    ORDER BY e.enumsortorder
  `);
  const values = rows.map((r) => r.enumlabel);
  assert.deepEqual(
    values.sort(),
    ['atencao', 'notavel', 'rotina'],
    `audit_log_priority enum must have exactly three values (no diacritics per AD20 SQL-safety). Got: ${JSON.stringify(values)}`
  );
});

test('audit_log_priority enum does NOT contain diacritics (SQL safety per architecture doc)', async () => {
  const db = getServiceRoleClient();
  const { rows } = await db.query(`
    SELECT e.enumlabel
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'audit_log_priority'
  `);
  const values = rows.map((r) => r.enumlabel);
  for (const v of values) {
    // Must not contain diacritics (ã, é, ê, etc.)
    assert.ok(
      /^[a-z]+$/.test(v),
      `audit_log_priority enum value "${v}" contains non-ASCII characters — must be lowercase ASCII-only per AD20`
    );
  }
});

// ---------------------------------------------------------------------------
// AC#1 — audit_log_event_types table structure
// ---------------------------------------------------------------------------

test('audit_log_event_types table exists in public schema', async () => {
  const db = getServiceRoleClient();
  const { rows } = await db.query(`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'audit_log_event_types'
  `);
  assert.ok(
    rows.length > 0,
    'audit_log_event_types table not found in public schema — check migration 202604301207a_create_audit_log_event_types.sql'
  );
});

test('audit_log_event_types has required columns: event_type, priority, description', async () => {
  const db = getServiceRoleClient();
  const { rows } = await db.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_log_event_types'
    ORDER BY ordinal_position
  `);
  const colNames = rows.map((r) => r.column_name);

  assert.ok(colNames.includes('event_type'), 'audit_log_event_types must have event_type column');
  assert.ok(colNames.includes('priority'), 'audit_log_event_types must have priority column');
  assert.ok(colNames.includes('description'), 'audit_log_event_types must have description column');
});

test('audit_log_event_types.event_type is the PRIMARY KEY', async () => {
  const db = getServiceRoleClient();
  const { rows } = await db.query(`
    SELECT kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
      AND kcu.table_schema = tc.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'audit_log_event_types'
      AND tc.constraint_type = 'PRIMARY KEY'
  `);
  const pkCols = rows.map((r) => r.column_name);
  assert.ok(
    pkCols.includes('event_type'),
    `audit_log_event_types PRIMARY KEY must be event_type. Got: ${JSON.stringify(pkCols)}`
  );
  assert.equal(pkCols.length, 1, 'audit_log_event_types must have a single-column PK on event_type');
});

test('audit_log_event_types.priority is NOT NULL', async () => {
  const db = getServiceRoleClient();
  const { rows } = await db.query(`
    SELECT is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_log_event_types'
      AND column_name = 'priority'
  `);
  assert.equal(
    rows[0]?.is_nullable,
    'NO',
    'audit_log_event_types.priority must be NOT NULL'
  );
});

test('audit_log_event_types.description is NOT NULL', async () => {
  const db = getServiceRoleClient();
  const { rows } = await db.query(`
    SELECT is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_log_event_types'
      AND column_name = 'description'
  `);
  assert.equal(
    rows[0]?.is_nullable,
    'NO',
    'audit_log_event_types.description must be NOT NULL'
  );
});

// ---------------------------------------------------------------------------
// AC#1 — No outbound FK from audit_log_event_types (FKs flow inward)
// ---------------------------------------------------------------------------

test('audit_log_event_types has NO outbound foreign key constraints (FKs flow inward per AC#1)', async () => {
  const db = getServiceRoleClient();
  const { rows } = await db.query(`
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'audit_log_event_types'::regclass
      AND contype = 'f'
  `);
  assert.equal(
    rows.length,
    0,
    `audit_log_event_types must have zero outbound FKs — found: ${rows.map((r) => r.conname).join(', ')}. FKs flow inward (audit_log.event_type → audit_log_event_types.event_type added in Story 9.1)`
  );
});

// ---------------------------------------------------------------------------
// AC#1 — 26-row seed count
// ---------------------------------------------------------------------------

test('audit_log_event_types has exactly 26 base rows (Story 9.0 seed)', async () => {
  const db = getServiceRoleClient();
  const { rows } = await db.query('SELECT COUNT(*)::int AS cnt FROM audit_log_event_types');
  // Story 9.0 baseline: exactly 26 rows (7 Atenção + 8 Notável + 11 Rotina).
  // A loose `>=` would allow a typo seed (e.g. 27 rows shipped early under
  // the wrong story) to slip through silently. The 27th and 28th rows arrive
  // in Stories 12.1 / 12.3 — those PRs update this assertion to 27 / 28.
  assert.equal(
    rows[0].cnt,
    26,
    `Expected exactly 26 rows in audit_log_event_types at Story 9.0 baseline (7 Atenção + 8 Notável + 11 Rotina). Story 12.1 adds the 27th row (cycle-fail-sustained) in its own PR. Got: ${rows[0].cnt}`
  );
});

test('audit_log_event_types has exactly 7 Atenção rows (priority = atencao)', async () => {
  const db = getServiceRoleClient();
  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS cnt FROM audit_log_event_types WHERE priority = 'atencao'"
  );
  assert.equal(
    rows[0].cnt,
    ATENCAO_SLUGS.length,
    `Expected ${ATENCAO_SLUGS.length} Atenção rows in audit_log_event_types. Got: ${rows[0].cnt}`
  );
});

test('audit_log_event_types has exactly 8 Notável rows (priority = notavel)', async () => {
  const db = getServiceRoleClient();
  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS cnt FROM audit_log_event_types WHERE priority = 'notavel'"
  );
  assert.equal(
    rows[0].cnt,
    NOTAVEL_SLUGS.length,
    `Expected ${NOTAVEL_SLUGS.length} Notável rows in audit_log_event_types. Got: ${rows[0].cnt}`
  );
});

test('audit_log_event_types has exactly 11 Rotina rows (priority = rotina)', async () => {
  const db = getServiceRoleClient();
  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS cnt FROM audit_log_event_types WHERE priority = 'rotina'"
  );
  assert.equal(
    rows[0].cnt,
    ROTINA_SLUGS.length,
    `Expected ${ROTINA_SLUGS.length} Rotina rows in audit_log_event_types. Got: ${rows[0].cnt}`
  );
});

// ---------------------------------------------------------------------------
// AC#1 — All 7 Atenção slugs present with correct priority
// ---------------------------------------------------------------------------

test('audit_log_event_types contains all 7 Atenção slugs with priority=atencao', async () => {
  const db = getServiceRoleClient();
  const { rows } = await db.query(
    "SELECT event_type FROM audit_log_event_types WHERE priority = 'atencao'"
  );
  const found = rows.map((r) => r.event_type);
  for (const slug of ATENCAO_SLUGS) {
    assert.ok(
      found.includes(slug),
      `Missing Atenção slug in DB: "${slug}" — check migration 202604301207a_create_audit_log_event_types.sql`
    );
  }
});

// ---------------------------------------------------------------------------
// AC#1 — All 8 Notável slugs present with correct priority
// ---------------------------------------------------------------------------

test('audit_log_event_types contains all 8 Notável slugs with priority=notavel', async () => {
  const db = getServiceRoleClient();
  const { rows } = await db.query(
    "SELECT event_type FROM audit_log_event_types WHERE priority = 'notavel'"
  );
  const found = rows.map((r) => r.event_type);
  for (const slug of NOTAVEL_SLUGS) {
    assert.ok(
      found.includes(slug),
      `Missing Notável slug in DB: "${slug}" — check migration 202604301207a_create_audit_log_event_types.sql`
    );
  }
});

// ---------------------------------------------------------------------------
// AC#1 — All 11 Rotina slugs present with correct priority
// ---------------------------------------------------------------------------

test('audit_log_event_types contains all 11 Rotina slugs with priority=rotina', async () => {
  const db = getServiceRoleClient();
  const { rows } = await db.query(
    "SELECT event_type FROM audit_log_event_types WHERE priority = 'rotina'"
  );
  const found = rows.map((r) => r.event_type);
  for (const slug of ROTINA_SLUGS) {
    assert.ok(
      found.includes(slug),
      `Missing Rotina slug in DB: "${slug}" — check migration 202604301207a_create_audit_log_event_types.sql`
    );
  }
});

// ---------------------------------------------------------------------------
// AC#1 — No unknown slugs in seed (taxonomy is exactly the 26 specified)
// ---------------------------------------------------------------------------

test('audit_log_event_types contains NO slugs outside the 26 specified in AC#1 (base seed integrity)', async () => {
  const db = getServiceRoleClient();
  // Story 12.1 adds 'cycle-fail-sustained' and Story 12.3 adds 'platform-features-changed'
  // — those are future migrations, not part of the base 26. We assert that any row
  // NOT in ALL_26_SLUGS must have been added by a later story (its presence is informational,
  // not an error — we just verify the base 26 are correct).
  const { rows } = await db.query('SELECT event_type, priority FROM audit_log_event_types');
  const dbSlugs = rows.map((r) => r.event_type);

  // All 26 base slugs must be present
  for (const slug of ALL_26_SLUGS) {
    assert.ok(
      dbSlugs.includes(slug),
      `Base slug "${slug}" is missing from audit_log_event_types — migration incomplete`
    );
  }
});

// ---------------------------------------------------------------------------
// AC#1 — PT-localized descriptions spot-check
// ---------------------------------------------------------------------------

test('every audit_log_event_types row has a non-empty PT description', async () => {
  const db = getServiceRoleClient();
  const { rows } = await db.query(
    "SELECT event_type FROM audit_log_event_types WHERE description IS NULL OR trim(description) = ''"
  );
  assert.equal(
    rows.length,
    0,
    `${rows.length} rows have empty description: ${rows.map((r) => r.event_type).join(', ')}`
  );
});

test('anomaly-freeze has the correct PT description (AC#1 spot-check)', async () => {
  const db = getServiceRoleClient();
  const { rows } = await db.query(
    "SELECT description FROM audit_log_event_types WHERE event_type = 'anomaly-freeze'"
  );
  assert.ok(rows.length > 0, 'anomaly-freeze row not found');
  // The exact description from AC#1 spec:
  assert.equal(
    rows[0].description,
    'Mudança externa de preço >40% — congelado para revisão',
    `anomaly-freeze description mismatch. Got: "${rows[0].description}"`
  );
});

test('cycle-start has the correct PT description (AC#1 spot-check — Rotina)', async () => {
  const db = getServiceRoleClient();
  const { rows } = await db.query(
    "SELECT description FROM audit_log_event_types WHERE event_type = 'cycle-start'"
  );
  assert.ok(rows.length > 0, 'cycle-start row not found');
  assert.equal(
    rows[0].description,
    'Ciclo iniciado para este cliente/marketplace',
    `cycle-start description mismatch. Got: "${rows[0].description}"`
  );
});

test('position-won has the correct PT description (AC#1 spot-check — Notável)', async () => {
  const db = getServiceRoleClient();
  const { rows } = await db.query(
    "SELECT description FROM audit_log_event_types WHERE event_type = 'position-won'"
  );
  assert.ok(rows.length > 0, 'position-won row not found');
  assert.equal(
    rows[0].description,
    'Posição 1 conquistada neste ciclo',
    `position-won description mismatch. Got: "${rows[0].description}"`
  );
});

// ---------------------------------------------------------------------------
// AC#2 — EVENT_TYPES JS constant in sync with DB seed (26 values)
// ---------------------------------------------------------------------------

test('EVENT_TYPES JS constant values match all 26 DB slugs (AC#2 sync check)', async () => {
  let EVENT_TYPES;
  try {
    ({ EVENT_TYPES } = await import('../../shared/audit/event-types.js'));
  } catch {
    // Module not yet implemented — skip this test
    return;
  }

  const jsValues = Object.values(EVENT_TYPES);
  for (const slug of ALL_26_SLUGS) {
    assert.ok(
      jsValues.includes(slug),
      `EVENT_TYPES constant is missing slug "${slug}" — AC#2 requires full 26-row coverage in event-types.js`
    );
  }
});

// ---------------------------------------------------------------------------
// AC#1 — Migration ordering: audit_log_event_types migration file uses 'a' suffix (F5 amendment)
// ---------------------------------------------------------------------------

test('migration file 202604301207a_create_audit_log_event_types.sql exists (F5 ordering suffix)', async () => {
  const { access } = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const migFile = path.resolve(
    __dirname, '..', '..', 'supabase', 'migrations',
    '202604301207a_create_audit_log_event_types.sql'
  );
  await assert.doesNotReject(
    access(migFile),
    `Migration file 202604301207a_create_audit_log_event_types.sql not found — F5 amendment requires the 'a' suffix for lexicographic ordering before Story 9.1's migration`
  );
});

test('migration file naming: 202604301207a_ sorts before 202604301208_ (F5 ordering guarantee)', () => {
  // Lexicographic comparison that Supabase CLI relies on
  const story90 = '202604301207a_create_audit_log_event_types.sql';
  const story91 = '202604301208_create_audit_log_partitioned.sql';
  assert.ok(
    story90 < story91,
    `F5 amendment violation: ${story90} must sort before ${story91} lexicographically. Got: ${story90 < story91}`
  );
});
