// ============================================================================
// utils/merchant-parser — cleans a raw transaction description down to a
// comparable "merchant key": strips legal-entity prefixes (ООО, ИП, АО,
// LLC, Inc...), card/masking artifacts, and extra whitespace/punctuation.
//
// This is for COMPARISON only (duplicate detection, category matching) —
// the original description is always what gets shown to the user and saved
// as the transaction's note. Cleaning it here never touches that.
// ============================================================================

const LEGAL_PREFIXES = [
  "ооо", "зао", "оао", "пао", "ао", "ип", "нко",
  "llc", "ltd", "inc", "corp", "gmbh", "s.r.o",
];

/**
 * @param {string} raw
 * @returns {string} lowercased, prefix-stripped, whitespace-collapsed key
 */
export function merchantKey(raw) {
  let text = String(raw || "").toLowerCase().trim();
  // Drop a leading legal-entity token ("ооо пятёрочка" -> "пятёрочка").
  for (const prefix of LEGAL_PREFIXES) {
    const re = new RegExp(`^${prefix}\\.?\\s+`, "i");
    if (re.test(text)) { text = text.replace(re, ""); break; }
  }
  // Collapse punctuation/whitespace noise so minor formatting differences
  // ("Пятёрочка №1234" vs "Пятерочка 1234") don't defeat the comparison.
  text = text
    .replace(/ё/g, "е")
    .replace(/[.,№#*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

/**
 * Are two descriptions likely the same merchant? True on an exact key
 * match, or when one cleaned key contains the other (catches "Пятерочка"
 * vs "Пятерочка 1234" — a store number suffix some exports add).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function isSameMerchant(a, b) {
  const ka = merchantKey(a), kb = merchantKey(b);
  if (!ka || !kb) return ka === kb;
  return ka === kb || ka.includes(kb) || kb.includes(ka);
}
