// ============================================================================
// transfer-linker — finds PAIRS of rows inside one imported statement that
// are two legs of the same internal transfer (−N leaving one of the user's
// cards, +N landing on another) and marks both as transfers, so neither leg
// inflates income or expense totals.
//
// This is the evidence-based complement to category-matcher.js's wording
// list (isLikelySelfTransfer): the wording list catches phrasings we've
// seen before; this pass catches internal transfers we HAVEN'T seen before,
// because whatever a bank calls them, it calls both legs the same thing and
// the amounts mirror each other on the same day. Verdicts come from the
// money movement, not from recognizing the words.
//
// Deliberately conservative pairing rule — a pair is linked only when ALL
// of these hold:
//   1. same date;
//   2. amounts are exact opposites (one income, one expense, equal value);
//   3. the two notes are the same merchant key (banks label both legs of an
//      internal transfer identically), OR both notes independently contain
//      explicit transfer wording.
// Rule 3 is what keeps purchase+refund pairs safe: "Оплата в X" −N and
// "Возврат покупки X" +N share neither an identical key nor transfer
// wording on both sides, so they are never linked. It also keeps a real
// external top-up ("Пополнение через <другой банк>" +N) from being eaten
// by a nearby unrelated −N: the top-up side carries no transfer wording.
// ============================================================================

import { merchantKey } from "./utils/merchant-parser.js";
import { isLikelySelfTransfer } from "./category-matcher.js";

function canPair(a, b) {
  if (a.tx.date !== b.tx.date) return false;
  if (a.tx.type === b.tx.type) return false;
  if (Math.round(a.tx.amount * 100) !== Math.round(b.tx.amount * 100)) return false;
  const keyA = merchantKey(a.tx.note);
  const keyB = merchantKey(b.tx.note);
  // Branch 1: banks label both legs of an internal transfer identically —
  // an exact key match with mirrored amounts on the same day is the
  // evidence-based signal that works for banks we've never seen.
  if (keyA && keyA === keyB) return true;
  // Branch 2: differing labels pair only when BOTH sides independently
  // carry the strict self-transfer wording list. NOT a looser "contains
  // 'перевод'" test — confirmed against real data, that would pair a real
  // incoming P2P payment (Т-Банк PDF anonymizes those as "Перевод себе")
  // with a same-day, same-amount deposit into the user's own savings, and
  // silently erase real income the user explicitly wants counted.
  return isLikelySelfTransfer(a.tx.note) && isLikelySelfTransfer(b.tx.note);
}

/**
 * Mutates the processed row list in place: rows recognized as two legs of
 * one internal transfer get status "transfer" (reason "transfer_pair").
 * Only rows currently statused "new" participate — rows already flagged by
 * the wording list, marked duplicate, or skipped are left alone. Each row
 * pairs at most once, matched greedily in statement order.
 *
 * @param {Array<{ tx: object|null, status: string, reason?: string }>} rows
 * @returns {number} how many rows were re-marked (always an even number)
 */
export function linkTransferPairs(rows) {
  const candidates = rows.filter((r) => r.status === "new" && r.tx);
  let linked = 0;

  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i];
    if (a.status !== "new") continue;
    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j];
      if (b.status !== "new") continue;
      if (!canPair(a, b)) continue;
      a.status = "transfer";
      a.reason = "transfer_pair";
      b.status = "transfer";
      b.reason = "transfer_pair";
      linked += 2;
      break;
    }
  }
  return linked;
}
