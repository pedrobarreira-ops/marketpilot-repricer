# Story 7.1: `shared/money/index.js` + `no-float-price` ESLint Rule

**Sprint-status key:** `7-1-shared-money-index-js-no-float-price-eslint-rule`
**Status:** ready-for-dev
**Size:** S
**Calendar position:** CALENDAR-EARLY — ships between Epic 1 and Epic 2. Unblocks Bundle C dispatch deadlock: Story 7.2 (and the full 7.2→7.3→7.6→7.8 chain) depends on this module.

---

## Narrative

**As a** BAD subagent implementing any engine story (7.2–7.8) or Epic 8 eta templates,
**I want** a single `shared/money/index.js` module with `toCents`, `fromCents`, `roundFloorCents`, `roundCeilingCents`, `formatEur`, and a companion `eslint-rules/no-float-price.js` custom ESLint rule,
**So that** all price arithmetic in the codebase flows through integer-cents discipline (no floats in DB or wire format), rounding directions are conservative (floor never sinks below raw, ceiling never exceeds raw), PT-locale display is consistent, and the ESLint rule mechanically prevents float-price math from leaking outside this SSoT module.

---

## Trace

- **Architecture decisions:** AD8 STEP 3 (money primitives for engine floor/ceiling math), Architectural Constraint #22 (`no-float-price` rule — "No float-price math outside `shared/money/index.js`")
- **Functional requirements:** FR21 (per-SKU floor/ceiling math foundation)
- **Amendment:** none specific to this story
- **Epic section:** `_bmad-output/planning-artifacts/epics-distillate/04-epic-7-engine-safety.md`, Story 7.1
- **Architecture implementation patterns:** `_bmad-output/planning-artifacts/architecture-distillate/04-implementation-patterns.md` — "Format — Money" section + "Structural — 11 SSoT Modules"

---

## SSoT Module Introduced

**`shared/money/index.js`** — the single source of truth for all price arithmetic. Exports:
- `toCents(eurDecimal)` — converts a EUR decimal to integer cents; throws on invalid inputs
- `fromCents(integerCents)` — converts integer cents to PT-locale display string (`'€17,99'`)
- `roundFloorCents(rawFloorFloat)` — conservative floor: `Math.ceil(rawFloorFloat)` (floor never sinks below raw)
- `roundCeilingCents(rawCeilingFloat)` — conservative ceiling: `Math.floor(rawCeilingFloat)` (ceiling never exceeds raw)
- `formatEur(integerCents)` — alias or same function as `fromCents`; used as eta view helper in Epic 8

**`eslint-rules/no-float-price.js`** — custom ESLint rule that flags float-price math patterns outside `shared/money/index.js`:
- `<var>.toFixed(2)` where `<var>` is a price-like identifier
- `parseFloat(<expr>)` assigned to a price-like identifier
- `<var> * 100` or `<var> * 0.01` where `<var>` is a price-like identifier
- `Math.round(<expr> * 100) / 100` (ad-hoc cents pattern)

---

## Dependencies

- **Story 1.1** (DONE): `eslint.config.js` exists at repo root; `eslint-rules/` directory exists with existing custom rules. This story adds a new rule to that directory and registers it in `eslint.config.js`.

**No other dependencies.** This is the calendar-early dispatch rationale: the module has no runtime deps on any Epic 5/6 code, only on the ESLint config (Story 1.1).

**Enables (blocked until this story is done):**
- **Story 7.2** (`worker/src/engine/decide.js`) — calls `roundFloorCents`, `roundCeilingCents` in AD8 STEP 3
- **Stories 7.3–7.7** — transitively depend on 7.2
- **Story 7.8** — Bundle C integration gate; full cycle includes STEP 3 math
- **Epic 8 eta templates** — use `formatEur()` / `fromCents()` as view helpers for price display

---

## Critical Constraints (Do Not Violate)

1. **Integer cents ONLY in code and DB** — `price` values MUST be integers (`1799` not `17.99`). The Mirakl API returns prices as JSON floats (e.g., `21.54`) → converted to cents at the boundary in `shared/mirakl/api-client.js`'s response normaliser. `shared/money/index.js` handles the boundary conversion via `toCents`.

2. **Conservative rounding direction is non-negotiable:**
   - `roundFloorCents` uses `Math.ceil` — floor can only round UP (protects margin; the floor is the minimum acceptable price, so we must never round it down)
   - `roundCeilingCents` uses `Math.floor` — ceiling can only round DOWN (prevents accidental over-pricing; the ceiling is the maximum we may charge)
   - Getting these directions backwards would cause subtle financial bugs (underprice on floor, overprice on ceiling)

3. **PT locale for `fromCents` / `formatEur`**: comma as decimal separator, `€` prefix, NO space between `€` and digits. Example: `1799` → `'€17,99'`. This is the Intl.NumberFormat pattern for `'pt-PT'` locale. Never use period as decimal separator.

4. **`no-float-price` rule must allowlist `shared/money/index.js`** — the very patterns it forbids are the legitimate ones that implement `toCents` etc. The rule uses filename-based allowlisting exactly as `no-raw-INSERT-audit-log.js` does (via `context.filename`). Pattern: see `eslint-rules/no-raw-INSERT-audit-log.js` for the allowlist implementation approach.

5. **Register `no-float-price` in `eslint.config.js`** — scoped to `app/**/*.js`, `worker/**/*.js`, `shared/**/*.js` (same scope as existing rules). Import the new rule and add an entry in the flat config array. Follow the pattern of `noRawInsertAuditLog` or `noRawCronStateUpdate` (the most recent additions).

6. **No default export** — all exports must be named. `export function toCents(...) {}`, NOT `export default { toCents }`. ESLint `no-default-export` rule enforces this.

7. **JSDoc on every exported function** — every exported function in `shared/money/index.js` MUST carry `@param`, `@returns`, `@throws` annotations (ESLint `jsdoc/require-jsdoc` rule with `publicOnly: true` is active on `shared/**/*.js`). The `no-float-price` ESLint rule file lives under `eslint-rules/` — the `jsdoc/require-jsdoc` rule is NOT scoped to `eslint-rules/`, so JSDoc is optional there (but include module-level comments for clarity).

8. **`formatEur` must produce output IDENTICAL to `fromCents`** — it should be either an alias (`export const formatEur = fromCents`) or the exact same function. Eta templates call `formatEur`; the unit tests assert `formatEur(1799) === fromCents(1799)`. If they diverge, Epic 8 display will be inconsistent with audit log calculations.

9. **Test file already exists as scaffold** — `tests/shared/money/index.test.js` was pre-seeded by the Epic 7 test design subagent. The TODO comments are Amelia's implementation guide. DO NOT recreate or replace this file; implement the real imports and assertions to replace the `assert.ok(true, 'scaffold')` stubs. The test file uses `node --test` (built-in runner — no Jest/Vitest).

---

## File-Touch List

### New files

| File | Purpose |
|------|---------|
| `shared/money/index.js` | SSoT money module: `toCents`, `fromCents`, `roundFloorCents`, `roundCeilingCents`, `formatEur` |
| `eslint-rules/no-float-price.js` | Custom ESLint rule: forbids float-price math outside `shared/money/index.js` |

### Modified files

| File | Change |
|------|--------|
| `eslint.config.js` | Import `noFloatPrice` from `./eslint-rules/no-float-price.js` and register it in the flat config array, scoped to `['app/**/*.js', 'worker/**/*.js', 'shared/**/*.js']` |
| `tests/shared/money/index.test.js` | Replace all `assert.ok(true, 'scaffold')` stubs with real imports from `../../../shared/money/index.js` and real assertions per each TODO comment |

**No new test file needed** — the scaffold at `tests/shared/money/index.test.js` already exists with full AC coverage from the Epic 7 test design phase.

---

## Acceptance Criteria

### AC1 — `toCents(eurDecimal)`

**Given** `shared/money/index.js` exports `toCents`
**When** I call it with valid EUR decimal inputs
**Then:**
- `toCents(17.99)` → `1799` (integer)
- `toCents(0)` → `0`
- `toCents(0.01)` → `1`
- For inputs with more than 2 decimal places (e.g., `17.999`): rounds to nearest cent before converting → `toCents(17.999)` → `1800`; `toCents(17.994)` → `1799`

**And** for invalid inputs:
- `toCents(NaN)` → throws
- `toCents(undefined)` → throws
- `toCents(null)` → throws
- `toCents(-1)` → throws (prices are non-negative)
- `toCents('17.99')` → throws (string inputs not accepted)

---

### AC2 — `fromCents(integerCents)`

**Given** `shared/money/index.js` exports `fromCents`
**When** I call it with integer cents inputs
**Then:**
- `fromCents(1799)` → `'€17,99'` — PT locale: comma as decimal separator, `€` prefix, NO space between `€` and digits
- `fromCents(0)` → `'€0,00'`
- `fromCents(1)` → `'€0,01'`
- `fromCents(1050)` → `'€10,50'`

**And** the output:
- Starts with `€` (prefix, not suffix)
- Uses comma (`,`) as decimal separator (NOT period)
- Never has a space between `€` and the number

**Implementation note:** Use `Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(cents / 100)` OR manually build the string. Either approach is fine as long as the output format matches exactly. Watch out: `Intl.NumberFormat` for `pt-PT` may emit a non-breaking space between `€` and digits in some Node.js versions — verify in tests and strip if needed, OR build manually to guarantee format.

---

### AC3 — `roundFloorCents(rawFloorFloat)`

**Given** `shared/money/index.js` exports `roundFloorCents`
**When** I call it with a float input representing a computed floor price in cents
**Then:**
- `roundFloorCents(1798.7)` → `1799` (Math.ceil — conservative, floor never sinks below raw)
- `roundFloorCents(1799)` → `1799` (exact integer passes through unchanged)
- `roundFloorCents(1798.5)` → `1799` (Math.ceil(1798.5) = 1799)
- For any non-integer `x`: `roundFloorCents(x) >= x` (the invariant — floor is always at or above raw)

---

### AC4 — `roundCeilingCents(rawCeilingFloat)`

**Given** `shared/money/index.js` exports `roundCeilingCents`
**When** I call it with a float input representing a computed ceiling price in cents
**Then:**
- `roundCeilingCents(1801.3)` → `1801` (Math.floor — conservative, ceiling never exceeds raw)
- `roundCeilingCents(1801)` → `1801` (exact integer passes through unchanged)
- `roundCeilingCents(1801.5)` → `1801` (Math.floor(1801.5) = 1801)
- For any non-integer `x`: `roundCeilingCents(x) <= x` (the invariant — ceiling is always at or below raw)

---

### AC5 — `formatEur(integerCents)`

**Given** `shared/money/index.js` exports `formatEur`
**When** Epic 8 eta templates register it as a view helper and call `formatEur(1799)`
**Then** it renders `'€17,99'` — identical output to `fromCents(1799)`

**And** `formatEur` is either:
- `export const formatEur = fromCents` (alias), or
- A standalone function with identical logic

Either way: `formatEur(1799) === fromCents(1799)` must always hold.

---

### AC6 — `eslint-rules/no-float-price.js` rule

**Given** `eslint-rules/no-float-price.js` is registered in `eslint.config.js` with plugin name `local-money` and rule name `no-float-price`
**When** ESLint runs on source files under `app/`, `worker/`, `shared/` (excluding `shared/money/index.js`)
**Then** each of the following patterns triggers a lint error with message:
> `"Float-price math forbidden. Use shared/money/index.js (toCents, fromCents, roundFloorCents, roundCeilingCents) for all price arithmetic."`

Forbidden patterns (heuristic: identifier contains `price`, `floor`, `ceiling`, `cost`, or `margin`):
1. `const price = someValue.toFixed(2)` — `.toFixed(2)` on a price-like identifier
2. `const price = parseFloat('17.99')` — `parseFloat()` assigned to a price-like identifier
3. `const priceCents = price * 100` — multiply by 100 where LHS/RHS involves price-like identifier
4. `Math.round(price * 100) / 100` — ad-hoc cents rounding pattern

**And** the rule does NOT trigger for any of the above patterns inside `shared/money/index.js` (allowlist by filename suffix).

**And** the ESLint error message contains both `'shared/money/index.js'` and at least one of `'toCents'`, `'fromCents'`, `'roundFloorCents'`, `'roundCeilingCents'`.

**Implementation note:** Follow the exact same allowlist pattern as `eslint-rules/no-raw-INSERT-audit-log.js` uses: normalize `context.filename` (or `context.getFilename()`) with `.replace(/\\/g, '/')` for cross-platform Windows/POSIX paths, then check `filename.endsWith('shared/money/index.js')`. This is critical on Windows where the worktree paths use backslashes.

**ESLint config registration pattern** (add to `eslint.config.js`):
```js
import noFloatPrice from './eslint-rules/no-float-price.js';
// ... in the config array:
{
  files: ['app/**/*.js', 'worker/**/*.js', 'shared/**/*.js'],
  plugins: { 'local-money': noFloatPrice },
  rules: {
    'local-money/no-float-price': 'error',
  },
},
```

---

### AC7 — Unit tests in `tests/shared/money/index.test.js`

**Given** the scaffold at `tests/shared/money/index.test.js` (pre-seeded by Epic 7 test design)
**When** I implement `shared/money/index.js` and update the test file to replace scaffolds with real assertions
**Then** `node --test tests/shared/money/index.test.js` passes with zero failures

**Test coverage required:**
- Round-trip: `fromCents(toCents(17.99)) === '€17,99'` (no drift)
- Conservative rounding directions for both floor (1798.5 → 1799) and ceiling (1801.5 → 1801)
- PT locale: output includes `,` and starts with `€`
- Error cases: NaN, undefined, null, negative, string input all throw from `toCents`
- `formatEur` alias consistency: `formatEur(1799) === fromCents(1799)`
- ESLint rule: fires on violations outside `shared/money/index.js`; does NOT fire inside `shared/money/index.js`

**Do NOT recreate or replace this file.** Implement by removing the `// TODO (Amelia):` comment lines and replacing `assert.ok(true, 'scaffold')` with real import + assertion code.

---

## Implementation Notes

### `shared/money/index.js` structure

```js
// shared/money/index.js
// SSoT for all price arithmetic — integer-cents discipline.
// Architecture: AD8 STEP 3 + Constraint #22 (no-float-price).
//
// NEVER perform price arithmetic outside this module.
// ESLint rule no-float-price enforces this.

/**
 * Converts a EUR decimal to integer cents.
 * Rounds to the nearest cent if the input has more than 2 decimal places.
 *
 * @param {number} eurDecimal - A non-negative EUR value (e.g., 17.99)
 * @returns {number} Integer cents (e.g., 1799)
 * @throws {Error} If input is NaN, null, undefined, non-numeric string, or negative
 */
export function toCents (eurDecimal) { ... }

/**
 * Converts integer cents to a PT-locale currency display string.
 * Format: '€17,99' (€ prefix, comma decimal separator, NO space between € and digits).
 *
 * @param {number} integerCents - Integer cents value (e.g., 1799)
 * @returns {string} PT-locale currency string (e.g., '€17,99')
 */
export function fromCents (integerCents) { ... }

/**
 * Conservative floor rounding: rounds UP (Math.ceil).
 * Invariant: result >= rawFloorFloat (floor never sinks below raw computed value).
 * Protects margin — the floor is the minimum acceptable price; never round it down.
 *
 * @param {number} rawFloorFloat - Computed floor price in cents (may be non-integer)
 * @returns {number} Integer cents, rounded up
 */
export function roundFloorCents (rawFloorFloat) {
  return Math.ceil(rawFloorFloat);
}

/**
 * Conservative ceiling rounding: rounds DOWN (Math.floor).
 * Invariant: result <= rawCeilingFloat (ceiling never exceeds raw computed value).
 * Prevents accidental over-pricing — the ceiling is the maximum we may charge.
 *
 * @param {number} rawCeilingFloat - Computed ceiling price in cents (may be non-integer)
 * @returns {number} Integer cents, rounded down
 */
export function roundCeilingCents (rawCeilingFloat) {
  return Math.floor(rawCeilingFloat);
}

/**
 * Alias for fromCents — used as eta view helper in Epic 8 templates.
 * Produces identical output: formatEur(1799) === fromCents(1799) === '€17,99'.
 */
export const formatEur = fromCents;
```

### `fromCents` PT-locale implementation caveat

`Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(cents / 100)` MAY produce `€ 17,99` (with a non-breaking space U+00A0 between `€` and digits) on some Node.js versions. The spec requires NO space. Either:
- Test the output and strip the space if present, OR
- Build the string manually: `'€' + (cents / 100).toFixed(2).replace('.', ',')`

The manual approach is simpler and guaranteed cross-platform. Use it.

### ESLint rule implementation approach

The `no-float-price` rule should detect the 4 forbidden AST patterns using selector strings in the `create()` function. Reference the existing rules in `eslint-rules/` for:
- Allowlist pattern (check `context.filename` endsWith `'shared/money/index.js'`)
- Plugin shape export (`export default { rules: { 'no-float-price': rule } }`)
- Rule meta structure (`type: 'problem'`, `messages` map)

The heuristic for "price-like identifier" (contains `price`, `floor`, `ceiling`, `cost`, `margin`) can be checked on variable names in the AST. A practical approach: detect the pattern syntactically (e.g., any `.toFixed(2)` call, any `parseFloat(...)` call, any `* 100` or `/ 100` multiplication where the operand is a non-literal) and flag it everywhere outside the allowlist module — this is conservative (may have minor false positives) but matches the spirit of the spec. The AC#6 test cases provide the ground truth for what must trigger and what must not.

### ESLint test approach for AC6

The unit tests for the ESLint rule in `tests/shared/money/index.test.js` (AC#6 section) use the `ESLint` class from `eslint` to programmatically lint a temporary code string:

```js
import { ESLint } from 'eslint';
const eslint = new ESLint({ cwd: repoRoot, overrideConfigFile: '...' });
const results = await eslint.lintText(code, { filePath: 'some/path/outside/money.js' });
// assert results[0].messages.some(m => m.ruleId === 'local-money/no-float-price')
```

The scaffold already shows the TODO structure. Follow it exactly.

### `tests/shared/money/index.test.js` is pre-seeded

The test file at `tests/shared/money/index.test.js` was created by the Epic 7 test design subagent on 2026-05-10. It contains 27 test cases across 7 `describe` blocks (AC#1–AC#7), all currently using `assert.ok(true, 'scaffold')` stubs. Amelia's task is to:
1. Add `import { toCents, fromCents, roundFloorCents, roundCeilingCents, formatEur } from '../../../shared/money/index.js'` at the top
2. Replace each scaffold with the real assertion described in the `// TODO` comment

Do NOT change the test structure, describe block names, or test case names — the Epic 7 test plan references them by name for coverage tracking.

---

## Out of Scope for This Story

- Engine decision logic → **Story 7.2** (uses `roundFloorCents`, `roundCeilingCents` from this module)
- Cooperative-absorption math → **Story 7.3**
- Circuit-breaker math → **Story 7.6**
- Any eta view-helper registration → **Epic 8** (registers `formatEur` as an eta helper in `app/src/lib/view-helpers.js`)
- Any DB migration — this story ships pure JS; no schema changes

---

## Dev Agent Record

### Agent Model Used

_to be filled by dev agent_

### Debug Log References

_to be filled by dev agent_

### Completion Notes List

_to be filled by dev agent_

### File List

_to be filled by dev agent_

### Change Log

_to be filled by dev agent_
