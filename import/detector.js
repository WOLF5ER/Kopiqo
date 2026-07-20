// ============================================================================
// detector — figures out which bank a statement came from, so importer.js
// can use that bank's own column knowledge and category vocabulary instead
// of guessing generically.
//
// Adding support for a new bank is entirely additive: create banks/<name>.js
// exporting { id, name, detect(headers), getColumnMapping(headers),
// mapCategory(bankLabel) }, then add it to BANK_ADAPTERS below. No changes
// needed here or in importer.js.
// ============================================================================

import * as tinkoff from "./banks/tinkoff.js";
import * as sber from "./banks/sber.js";
import * as alfa from "./banks/alfa.js";
import * as universal from "./banks/universal.js";

// Universal is deliberately last and excluded from the "best match" race —
// it always scores a flat, low confidence (see banks/universal.js) and
// exists purely as the fallback below.
const BANK_ADAPTERS = [tinkoff, sber, alfa];

const CONFIDENT_THRESHOLD = 0.5;

/**
 * @param {string[]} headers
 * @returns {{ bank: object, columns: object }} the best-matching bank
 *   adapter and its column mapping for these headers, or the universal
 *   fallback if nothing else recognizes them. Returns null only if not even
 *   the universal adapter can find a usable date/description/amount triplet.
 */
export function detectBank(headers) {
  let best = null;
  let bestScore = 0;
  for (const adapter of BANK_ADAPTERS) {
    const score = adapter.detect(headers);
    if (score > bestScore) { bestScore = score; best = adapter; }
  }

  if (best && bestScore >= CONFIDENT_THRESHOLD) {
    const columns = best.getColumnMapping(headers);
    if (columns) return { bank: best, columns };
  }

  const columns = universal.getColumnMapping(headers);
  if (!columns) return null;
  return { bank: universal, columns };
}

/**
 * Bank identification for PDF statements, where there's no header row to
 * match against — just the bank's own name appearing somewhere in the
 * extracted text (letterhead, footer, etc.). Purely for attaching the
 * right category vocabulary (bank.mapCategory) and showing the user which
 * bank was recognized; PDF row extraction itself (pdf-parser.js) doesn't
 * depend on which bank it is.
 * @param {string} fullText
 * @returns {object} the matching bank adapter, or the universal fallback
 */
export function detectBankFromText(fullText) {
  for (const adapter of BANK_ADAPTERS) {
    if (adapter.detectFromText && adapter.detectFromText(fullText)) return adapter;
  }
  return universal;
}
