// ============================================================================
// utils/amount-parser — turns a statement's raw amount value into a signed
// number. Handles thousand separators (spaces, thin spaces, apostrophes), a
// comma or dot decimal separator, and stray currency symbols/letters.
// ============================================================================

/**
 * @param {any} value - a number (from XLSX), or a string like "-1 250,50",
 *   "1250.00", "$85.00"
 * @returns {number|null} null if the value can't be parsed as a number
 */
export function parseStatementAmount(value) {
  if (typeof value === "number") return isNaN(value) ? null : value;
  let text = String(value || "").trim();
  if (!text) return null;
  text = text.replace(/[^\d,.\-+\s\u00a0']/g, ""); // strip currency symbols/letters
  text = text.replace(/[\s\u00a0']/g, ""); // strip thousand separators
  // If both , and . appear, the last one is the decimal separator.
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    text = lastComma > lastDot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (lastComma !== -1) {
    text = text.replace(",", ".");
  }
  const num = parseFloat(text);
  return isNaN(num) ? null : num;
}
