// ============================================================================
// duplicate-checker — is a candidate transaction likely already in the
// user's account? Two transactions are treated as the same import candidate
// if they land on the same date, the same rounded amount, and their notes
// name the same merchant — catches re-imports of the same statement (or
// overlapping date ranges between two exports) without being so strict that
// two genuinely different purchases on the same day both get silently
// dropped.
//
// Merchant comparison goes through merchant-parser.js's isSameMerchant(),
// which strips legal-entity prefixes and store-number suffixes — a plain
// string-equality check would treat "ООО Пятёрочка" and "Пятёрочка" (the
// same store, described two different ways by two different exports) as
// unrelated and import it twice.
// ============================================================================

import { isSameMerchant } from "./utils/merchant-parser.js";

/**
 * @param {object} candidate - a normalized tx about to be imported
 * @param {object} existing - an existing transaction (candidate.note vs existing.note)
 * @returns {boolean}
 */
export function isLikelyDuplicate(candidate, existing) {
  if (candidate.date !== existing.date) return false;
  if (Math.round(candidate.amount) !== Math.round(existing.amount)) return false;
  const a = candidate.note || "";
  const b = existing.note || "";
  if (!a || !b) return a === b;
  return isSameMerchant(a, b);
}

/**
 * Checks a candidate against both the account's existing transactions and
 * the rows already accepted earlier in the same import batch (so a
 * statement that happens to list the same purchase twice doesn't import it
 * twice either).
 * @param {object} candidate
 * @param {object[]} existingTransactions
 * @param {object[]} acceptedSoFar - tx objects already marked "new" in this batch
 * @returns {boolean}
 */
export function isDuplicateAgainst(candidate, existingTransactions, acceptedSoFar) {
  return existingTransactions.some((e) => isLikelyDuplicate(candidate, e))
    || acceptedSoFar.some((tx) => isLikelyDuplicate(candidate, tx));
}
