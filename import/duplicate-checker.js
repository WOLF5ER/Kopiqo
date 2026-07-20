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

import { isSameMerchant, merchantKey } from "./utils/merchant-parser.js";

// Notes that carry NO counterparty identity — a bank's placeholder wording
// for a transfer rather than a name. When either side of a comparison is
// one of these, the note can't disambiguate anything, so date+amount is the
// best (and only) available evidence. Confirmed real case: Т-Банк's PDF
// statement anonymizes incoming P2P transfers as "Перевод себе" while the
// CSV export of the very same operation shows the sender's actual name —
// without this, importing both files doubles every such transfer.
const GENERIC_TRANSFER_NOTE_RE = /^(перевод(\s+себе)?|входящ[а-яё]+\s+перевод|исходящ[а-яё]+\s+перевод|перевод\s+по\s+номеру\s+телефона|transfer|incoming\s+transfer)$/i;

function isGenericTransferNote(note) {
  return GENERIC_TRANSFER_NOTE_RE.test(merchantKey(note));
}

/**
 * @param {object} candidate - a normalized tx about to be imported
 * @param {object} existing - an existing transaction (candidate.note vs existing.note)
 * @returns {boolean}
 */
export function isLikelyDuplicate(candidate, existing) {
  if (candidate.date !== existing.date) return false;
  if (candidate.type !== existing.type) return false;
  if (Math.round(candidate.amount) !== Math.round(existing.amount)) return false;
  const a = candidate.note || "";
  const b = existing.note || "";
  if (!a || !b) return a === b;
  if (isSameMerchant(a, b)) return true;
  // Same day, same direction, same amount, and at least one side is a
  // faceless transfer label — treat as the same operation seen through two
  // different exports' wording.
  if (isGenericTransferNote(a) || isGenericTransferNote(b)) return true;
  // Both sides were IMPORTED into the SAME Kopiqo account: they describe
  // the same real bank account, so a date+direction+amount collision is the
  // same operation rendered by two different export formats. Confirmed real
  // case: Т-Банк's PDF prints raw acquirer strings ("DODO PIZZA") where the
  // CSV of the same operations prints localized names ("Додо Пицца") — no
  // text comparison can bridge that, but the money evidence can. Scoped to
  // imported-vs-imported within one account so manual entries and other
  // accounts' statements are never swallowed by coincidence.
  return Boolean(candidate.imported && existing.imported)
    && candidate.accountId === existing.accountId;
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
