// ============================================================================
// normalizer — turns one raw statement row into the shape Kopiqo's
// transactions already use: { type, amount, category, date, note,
// accountId, tags }. Amount here is in the account's face-value currency;
// the caller (importer.js) applies the same display->storage conversion the
// manual entry form uses, so imported amounts land in the same units as
// everything else.
// ============================================================================

import { parseStatementDate } from "./utils/date-parser.js";
import { parseStatementAmount } from "./utils/amount-parser.js";
import { matchCategory, isLikelySelfTransfer } from "./category-matcher.js";

/**
 * @param {{date: any, description: string, amount: any, bankCategory?: string}} raw
 * @param {{accountId: string, bank?: object}} opts - `bank` is the adapter
 *   detector.js identified for this statement (has its own mapCategory());
 *   omitted or without a match, falls back to keyword-based matchCategory().
 * @returns {{ ok: true, tx: object } | { ok: false, reason: string }}
 */
export function normalizeRow(raw, opts) {
  const date = parseStatementDate(raw.date);
  if (!date) return { ok: false, reason: "bad_date" };

  const amount = parseStatementAmount(raw.amount);
  if (amount === null || amount === 0) return { ok: false, reason: "bad_amount" };

  const description = String(raw.description || "").trim();
  if (!description) return { ok: false, reason: "bad_description" };

  // Moving money between the user's own accounts isn't income or an
  // expense — it's the same money, just relocated. Importing it as either
  // would inflate both totals for nothing that was actually earned or
  // spent, so these are flagged separately rather than categorized at all.
  if (isLikelySelfTransfer(description)) {
    return { ok: false, reason: "self_transfer" };
  }

  const type = amount < 0 ? "expense" : "income";
  const absAmount = Math.abs(amount);
  const bankCategory = opts.bank && opts.bank.mapCategory ? opts.bank.mapCategory(raw.bankCategory) : null;
  const category = type === "expense" ? (bankCategory || matchCategory(description)) : "other_inc";

  return {
    ok: true,
    tx: {
      type, amount: absAmount, category, date,
      note: description, accountId: opts.accountId, tags: [], imported: true,
    },
  };
}
