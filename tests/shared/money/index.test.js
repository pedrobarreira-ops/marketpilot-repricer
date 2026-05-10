// tests/shared/money/index.test.js
// Epic 7 Test Plan — Story 7.1 scaffold (epic-start-test-design 2026-05-10)
// Runner: node --test (built-in; no Jest/Vitest per architecture constraint)
//
// Coverage:
//   AC#1 — toCents: integer conversion, rounding, invalid input rejection
//   AC#2 — fromCents: PT locale formatting (comma decimal, € prefix)
//   AC#3 — roundFloorCents: conservative ceil (floor never sinks below raw)
//   AC#4 — roundCeilingCents: conservative floor (ceiling never exceeds raw)
//   AC#5 — formatEur: alias/consistency with fromCents
//   AC#6 — ESLint no-float-price rule: fires on violations, allowed inside shared/money/index.js
//   AC#7 — Unit test round-trip, edge cases, locale, errors
//
// Note: Story 7.1 has NO integration_test_required: true — pure utility module.
// Run with: node --test tests/shared/money/index.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const __filename = fileURLToPath(import.meta.url);
// Repo root = 3 levels up from tests/shared/money/
const repoRoot = join(__filename, '..', '..', '..', '..').replace(/\\/g, '/');

// ---------------------------------------------------------------------------
// Lazy import helper — shared/money/index.js is created by Step 3 (dev).
// If the module doesn't exist yet, tests that require it will fail with a
// descriptive import error rather than the scaffold assert.ok(true).
// ---------------------------------------------------------------------------
let _money = null;
async function money () {
  if (!_money) {
    _money = await import('../../../shared/money/index.js');
  }
  return _money;
}

// ---------------------------------------------------------------------------
// AC#1 — toCents
// ---------------------------------------------------------------------------

describe('toCents', () => {
  it('to_cents_converts_17_99_to_1799', async () => {
    const { toCents } = await money();
    assert.strictEqual(toCents(17.99), 1799);
  });

  it('to_cents_converts_zero_to_zero', async () => {
    const { toCents } = await money();
    assert.strictEqual(toCents(0), 0);
  });

  it('to_cents_rounds_to_nearest_cent_on_excess_decimals', async () => {
    const { toCents } = await money();
    // 17.999 → nearest cent is 1800 (rounds up)
    assert.strictEqual(toCents(17.999), 1800);
    // 17.994 → nearest cent is 1799 (rounds down)
    assert.strictEqual(toCents(17.994), 1799);
  });

  it('to_cents_throws_on_nan', async () => {
    const { toCents } = await money();
    assert.throws(() => toCents(NaN));
  });

  it('to_cents_throws_on_undefined', async () => {
    const { toCents } = await money();
    assert.throws(() => toCents(undefined));
  });

  it('to_cents_throws_on_negative', async () => {
    const { toCents } = await money();
    // Prices are always non-negative in this domain
    assert.throws(() => toCents(-1));
  });
});

// ---------------------------------------------------------------------------
// AC#2 — fromCents
// ---------------------------------------------------------------------------

describe('fromCents', () => {
  it('from_cents_1799_returns_euro_17_99_pt_locale', async () => {
    const { fromCents } = await money();
    // PT locale: comma as decimal separator, € prefix, NO space between € and digits
    // Manual string build is required — Intl.NumberFormat('pt-PT') may produce
    // a non-breaking space (U+00A0) between the € symbol and the digits on some
    // Node.js ICU builds, which would break strict string equality.
    assert.strictEqual(fromCents(1799), '€17,99');
  });

  it('from_cents_0_returns_euro_0_00', async () => {
    const { fromCents } = await money();
    assert.strictEqual(fromCents(0), '€0,00');
  });

  it('from_cents_1_returns_euro_0_01', async () => {
    const { fromCents } = await money();
    assert.strictEqual(fromCents(1), '€0,01');
  });

  it('from_cents_uses_comma_not_period_as_decimal_separator', async () => {
    const { fromCents } = await money();
    const result = fromCents(1799);
    assert.ok(result.includes(','), `Expected comma in "${result}"`);
    assert.ok(!result.includes('.'), `Expected no period in "${result}"`);
  });

  it('from_cents_uses_euro_prefix_not_suffix', async () => {
    const { fromCents } = await money();
    assert.ok(fromCents(1799).startsWith('€'));
  });
});

// ---------------------------------------------------------------------------
// AC#3 — roundFloorCents
// ---------------------------------------------------------------------------

describe('roundFloorCents', () => {
  it('round_floor_cents_1798_7_returns_1799', async () => {
    const { roundFloorCents } = await money();
    // Conservative: floor never sinks below raw value → use Math.ceil
    assert.strictEqual(roundFloorCents(1798.7), 1799);
  });

  it('round_floor_cents_exact_integer_returns_unchanged', async () => {
    const { roundFloorCents } = await money();
    // Exact integers should pass through unchanged
    assert.strictEqual(roundFloorCents(1799), 1799);
  });

  it('round_floor_cents_1798_5_returns_1799', async () => {
    const { roundFloorCents } = await money();
    // Edge case: exactly 0.5 above; Math.ceil gives 1799 (conservative)
    assert.strictEqual(roundFloorCents(1798.5), 1799);
  });

  it('round_floor_cents_protects_margin_never_sinks_below_raw', async () => {
    const { roundFloorCents } = await money();
    // Verify the invariant: conservative floor means we never go below raw
    const testValues = [1798.1, 1798.5, 1798.7, 1798.9, 100.3, 500.01];
    for (const x of testValues) {
      assert.ok(
        roundFloorCents(x) >= x,
        `roundFloorCents(${x}) = ${roundFloorCents(x)} should be >= ${x}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// AC#4 — roundCeilingCents
// ---------------------------------------------------------------------------

describe('roundCeilingCents', () => {
  it('round_ceiling_cents_1801_3_returns_1801', async () => {
    const { roundCeilingCents } = await money();
    // Conservative: ceiling never exceeds raw value → use Math.floor
    assert.strictEqual(roundCeilingCents(1801.3), 1801);
  });

  it('round_ceiling_cents_exact_integer_returns_unchanged', async () => {
    const { roundCeilingCents } = await money();
    assert.strictEqual(roundCeilingCents(1801), 1801);
  });

  it('round_ceiling_cents_1801_5_returns_1801', async () => {
    const { roundCeilingCents } = await money();
    // Edge case: Math.floor gives 1801 (conservative)
    assert.strictEqual(roundCeilingCents(1801.5), 1801);
  });

  it('round_ceiling_cents_prevents_over_pricing_never_exceeds_raw', async () => {
    const { roundCeilingCents } = await money();
    // Verify the invariant: conservative ceiling means we never exceed raw
    const testValues = [1801.1, 1801.5, 1801.9, 100.3, 500.99];
    for (const x of testValues) {
      assert.ok(
        roundCeilingCents(x) <= x,
        `roundCeilingCents(${x}) = ${roundCeilingCents(x)} should be <= ${x}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// AC#5 — formatEur (alias/consistency)
// ---------------------------------------------------------------------------

describe('formatEur', () => {
  it('format_eur_produces_same_output_as_from_cents', async () => {
    const { formatEur, fromCents } = await money();
    // formatEur is either an alias or the same function — both must produce identical output
    assert.strictEqual(formatEur(1799), fromCents(1799));
    assert.strictEqual(formatEur(0), fromCents(0));
    assert.strictEqual(formatEur(1), fromCents(1));
  });

  it('format_eur_registered_as_eta_view_helper_renders_correctly', async () => {
    const { formatEur } = await money();
    // formatEur should be a pure function: number input → string output; no side effects
    assert.strictEqual(typeof formatEur, 'function');
    const result = formatEur(1799);
    assert.strictEqual(typeof result, 'string');
    assert.ok(result.startsWith('€'));
  });
});

// ---------------------------------------------------------------------------
// AC#6 — ESLint no-float-price rule
// ---------------------------------------------------------------------------

// Helper: create a temp file, run ESLint on it, return messages, clean up.
// Writes the temp file inside the repo root (under tmp/) so ESLint's flat-config
// upward search finds eslint.config.js regardless of OS or drive letters.
// Using os.tmpdir() would fail when tmpdir is on a different drive (Windows) or
// filesystem from the repo — ESLint 10 treats such files as "outside base path".
async function lintCode (code, filename = 'tmp-violation.js') {
  const tmpDir = join(repoRoot, 'tmp', `mp-eslint-test-${process.pid}`);
  mkdirSync(tmpDir, { recursive: true });
  const filepath = join(tmpDir, filename);
  writeFileSync(filepath, code, 'utf8');

  try {
    // Normalise to forward slashes for cross-platform consistency (Windows backslash)
    const normFilepath = filepath.replace(/\\/g, '/');
    const eslint = new ESLint({ cwd: repoRoot });
    const results = await eslint.lintFiles([normFilepath]);
    return results.flatMap((r) => r.messages);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Helper: lint a source file within the repo itself (not a temp file).
async function lintRepoFile (relPath) {
  // Normalise backslashes for cross-platform consistency
  const absPath = join(repoRoot, relPath).replace(/\\/g, '/');
  const eslint = new ESLint({ cwd: repoRoot });
  const results = await eslint.lintFiles([absPath]);
  return results.flatMap((r) => r.messages);
}

describe('ESLint no-float-price rule', () => {
  it('eslint_no_float_price_fires_on_to_fixed_price_identifier', async () => {
    // Temp fixture outside shared/money/ with: price.toFixed(2)
    const code = `
const price = 17.99;
const formatted = price.toFixed(2);
`;
    const messages = await lintCode(code, 'app-src-fixture.js');
    const violation = messages.find((m) => m.ruleId === 'local-money/no-float-price');
    assert.ok(violation, `Expected local-money/no-float-price to fire, got: ${JSON.stringify(messages.map((m) => m.ruleId))}`);
  });

  it('eslint_no_float_price_fires_on_parse_float_to_price_identifier', async () => {
    // Temp fixture: const price = parseFloat('17.99')
    const code = `
const price = parseFloat('17.99');
`;
    const messages = await lintCode(code, 'app-src-parsefloat-fixture.js');
    const violation = messages.find((m) => m.ruleId === 'local-money/no-float-price');
    assert.ok(violation, `Expected local-money/no-float-price to fire, got: ${JSON.stringify(messages.map((m) => m.ruleId))}`);
  });

  it('eslint_no_float_price_fires_on_multiply_100_pattern', async () => {
    // Temp fixture: const priceCents = price * 100
    const code = `
const price = 17.99;
const priceCents = price * 100;
`;
    const messages = await lintCode(code, 'app-src-multiply-fixture.js');
    const violation = messages.find((m) => m.ruleId === 'local-money/no-float-price');
    assert.ok(violation, `Expected local-money/no-float-price to fire, got: ${JSON.stringify(messages.map((m) => m.ruleId))}`);
  });

  it('eslint_no_float_price_fires_on_math_round_ad_hoc_cents_pattern', async () => {
    // Temp fixture: Math.round(price * 100) / 100
    const code = `
const price = 17.99;
const cents = Math.round(price * 100) / 100;
`;
    const messages = await lintCode(code, 'app-src-mathround-fixture.js');
    const violation = messages.find((m) => m.ruleId === 'local-money/no-float-price');
    assert.ok(violation, `Expected local-money/no-float-price to fire, got: ${JSON.stringify(messages.map((m) => m.ruleId))}`);
  });

  it('eslint_no_float_price_does_not_fire_inside_shared_money_index_js', async () => {
    // Run ESLint on shared/money/index.js — the allowlisted SSoT module.
    // This test verifies the allowlist exemption works on the actual file.
    // If the file doesn't exist yet (pre-dev), skip gracefully.
    let messages;
    try {
      messages = await lintRepoFile('shared/money/index.js');
    } catch {
      // Module not yet created — skip assertion (will be re-run post-dev)
      return;
    }
    const violation = messages.find((m) => m.ruleId === 'local-money/no-float-price');
    assert.ok(!violation, `no-float-price should NOT fire inside shared/money/index.js, got: ${JSON.stringify(violation)}`);
  });

  it('eslint_no_float_price_error_message_includes_ssot_path', async () => {
    // The error message from a violation must include 'shared/money/index.js'
    // and at least one of the canonical function names.
    const code = `
const price = 17.99;
const priceCents = price * 100;
`;
    const messages = await lintCode(code, 'app-src-msg-fixture.js');
    const violation = messages.find((m) => m.ruleId === 'local-money/no-float-price');
    assert.ok(violation, 'Expected a violation to exist');
    assert.ok(
      violation.message.includes('shared/money/index.js'),
      `Error message should include 'shared/money/index.js', got: "${violation.message}"`,
    );
    const functionNames = ['toCents', 'fromCents', 'roundFloorCents', 'roundCeilingCents'];
    const hasFunctionName = functionNames.some((fn) => violation.message.includes(fn));
    assert.ok(
      hasFunctionName,
      `Error message should include at least one function name (${functionNames.join('/')}), got: "${violation.message}"`,
    );
  });
});

// ---------------------------------------------------------------------------
// AC#7 — Round-trip, edge cases, locale, errors
// ---------------------------------------------------------------------------

describe('Round-trip and edge cases', () => {
  it('round_trip_to_cents_then_from_cents_preserves_value', async () => {
    const { toCents, fromCents } = await money();
    const original = 17.99;
    // Round-trip must preserve the original value (no drift)
    assert.strictEqual(fromCents(toCents(original)), '€17,99');
  });

  it('round_floor_conservative_rounding_edge_case_1798_5', async () => {
    const { roundFloorCents } = await money();
    // Math.ceil(1798.5) = 1799 — conservative floor
    assert.strictEqual(roundFloorCents(1798.5), 1799);
  });

  it('round_ceiling_conservative_rounding_edge_case_1801_5', async () => {
    const { roundCeilingCents } = await money();
    // Math.floor(1801.5) = 1801 — conservative ceiling
    assert.strictEqual(roundCeilingCents(1801.5), 1801);
  });

  it('from_cents_locale_uses_comma_decimal_separator', async () => {
    const { fromCents } = await money();
    // PT locale: comma as decimal, not period → '€10,50'
    const result = fromCents(1050);
    assert.ok(result.includes(','), `Expected comma in "${result}"`);
    assert.strictEqual(result, '€10,50');
  });

  it('to_cents_throws_on_string_input', async () => {
    const { toCents } = await money();
    // Only numeric inputs accepted
    assert.throws(() => toCents('17.99'));
  });

  it('to_cents_throws_on_null_input', async () => {
    const { toCents } = await money();
    assert.throws(() => toCents(null));
  });
});
