/**
 * Helpers for numeric <Input> fields that keep the raw text in component state.
 *
 * Inputs store the user's text verbatim while typing, so a field can be
 * cleared and retyped freely — no stuck "0" and no typed "7" turning into
 * "077". Parsing happens on submit; tidying (leading-zero removal, minimum
 * clamping) happens on blur.
 */

/** Raw input text → finite number ("" or junk counts as 0). */
export function parseNumericInput(raw: string): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

/** Quantity blur-tidy: whole number ≥ min (default 1), leading zeros removed. */
export function tidyQuantityOnBlur(raw: string, min = 1): string {
  return String(Math.max(min, Math.trunc(parseNumericInput(raw))));
}

/** Amount blur-tidy: non-negative number, leading zeros and stray dots removed. */
export function tidyAmountOnBlur(raw: string): string {
  return String(Math.max(0, parseNumericInput(raw)));
}

/**
 * Optional-quantity blur-tidy: "" stays "" (no quantity entered), anything
 * else becomes a whole number ≥ 0 without leading zeros.
 */
export function tidyOptionalQuantityOnBlur(raw: string): string {
  if (raw.trim() === "") return "";
  return String(Math.max(0, Math.trunc(parseNumericInput(raw))));
}
