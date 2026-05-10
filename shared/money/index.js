// shared/money/index.js
// SSoT for all price arithmetic — integer-cents discipline.
// Architecture: AD8 STEP 3 + Architectural Constraint #22 (no-float-price).
//
// NEVER perform price arithmetic outside this module.
// ESLint rule no-float-price mechanically enforces this.

/**
 * Converts a EUR decimal to integer cents.
 * Rounds to the nearest cent if the input has more than 2 decimal places.
 *
 * @param {number} eurDecimal - A non-negative EUR value (e.g., 17.99)
 * @returns {number} Integer cents (e.g., 1799)
 * @throws {Error} If input is NaN, null, undefined, non-numeric, or negative
 */
export function toCents (eurDecimal) {
  if (typeof eurDecimal !== 'number' || isNaN(eurDecimal)) {
    throw new Error(`toCents: invalid input — expected a non-negative number, got ${JSON.stringify(eurDecimal)}`);
  }
  if (eurDecimal < 0) {
    throw new Error(`toCents: invalid input — prices must be non-negative, got ${eurDecimal}`);
  }
  // Round to nearest cent to handle floating-point imprecision (e.g., 17.999 → 1800)
  return Math.round(eurDecimal * 100);
}

/**
 * Converts integer cents to a PT-locale currency display string.
 * Format: '€17,99' — € prefix, comma decimal separator, NO space between € and digits.
 *
 * Uses manual string building (not Intl.NumberFormat) to guarantee format across
 * Node.js ICU builds — Intl.NumberFormat('pt-PT') may emit a non-breaking space
 * between € and digits on some builds.
 *
 * @param {number} integerCents - Integer cents value (e.g., 1799)
 * @returns {string} PT-locale currency string (e.g., '€17,99')
 */
export function fromCents (integerCents) {
  // Divide by 100, format to exactly 2 decimal places, replace period with comma
  return '€' + (integerCents / 100).toFixed(2).replace('.', ',');
}

/**
 * Conservative floor rounding: rounds UP using Math.ceil.
 * Invariant: result >= rawFloorFloat — floor never sinks below the raw computed value.
 * Protects margin: the floor is the minimum acceptable price; we must never round it down.
 *
 * @param {number} rawFloorFloat - Computed floor price in cents (may be non-integer)
 * @returns {number} Integer cents, rounded up
 */
export function roundFloorCents (rawFloorFloat) {
  return Math.ceil(rawFloorFloat);
}

/**
 * Conservative ceiling rounding: rounds DOWN using Math.floor.
 * Invariant: result <= rawCeilingFloat — ceiling never exceeds the raw computed value.
 * Prevents accidental over-pricing: the ceiling is the maximum we may charge.
 *
 * @param {number} rawCeilingFloat - Computed ceiling price in cents (may be non-integer)
 * @returns {number} Integer cents, rounded down
 */
export function roundCeilingCents (rawCeilingFloat) {
  return Math.floor(rawCeilingFloat);
}

/**
 * Alias for fromCents — used as an eta view helper in Epic 8 templates.
 * Produces identical output: formatEur(1799) === fromCents(1799) === '€17,99'.
 *
 * @param {number} integerCents - Integer cents value (e.g., 1799)
 * @returns {string} PT-locale currency string (e.g., '€17,99')
 */
export const formatEur = fromCents;
