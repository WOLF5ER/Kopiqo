// ============================================================================
// transaction-normalizer — turns one raw statement row into the shape
// Kopiqo's transactions already use: { type, amount, category, date, note,
// accountId, tags }. Amount here is in the account's face-value currency;
// the caller (importer.js) applies the same display->storage conversion the
// manual entry form uses, so imported amounts land in the same units as
// everything else.
// ============================================================================

import { matchCategory, matchCategoryFromBankLabel, isLikelySelfTransfer } from "./category-matcher.js";

const MONTHS_RU = { "янв": 1, "фев": 2, "мар": 3, "апр": 4, "май": 5, "мая": 5, "июн": 6, "июл": 7, "авг": 8, "сен": 9, "окт": 10, "ноя": 11, "дек": 12 };

function pad2(n) { return String(n).padStart(2, "0"); }

/**
 * Parses a date from a JS Date (XLSX) or a string in one of several common
 * formats (DD.MM.YYYY, YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY, or "19 июл 2026")
 * into Kopiqo's YYYY-MM-DD.
 * @returns {string|null}
 */
export function parseStatementDate(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }
  const text = String(value || "").trim();
  if (!text) return null;

  // YYYY-MM-DD (already Kopiqo's own format, or ISO-ish)
  let m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // DD.MM.YYYY or DD/MM/YYYY (the common RU/EU bank export format)
  m = text.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
  if (m) return `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`;

  // "19 июл 2026" / "19 июля 2026"
  m = text.match(/^(\d{1,2})\s+([а-яё]{3})[а-яё]*\s+(\d{4})/i);
  if (m) {
    const month = MONTHS_RU[m[2].toLowerCase()];
    if (month) return `${m[3]}-${pad2(month)}-${pad2(m[1])}`;
  }

  // Last resort: let the JS Date parser take a shot (handles things like
  // "Jul 19, 2026" or "2026/07/19").
  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;

  return null;
}

/**
 * Parses an amount string, handling thousand separators (spaces, thin
 * spaces, apostrophes), a comma or dot decimal separator, and an optional
 * leading currency symbol.
 * @returns {number|null}
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

/**
 * @param {{date: any, description: string, amount: any, bankCategory?: string}} raw
 * @param {{accountId: string}} opts
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
  const category = type === "expense"
    ? (matchCategoryFromBankLabel(raw.bankCategory) || matchCategory(description))
    : "other_inc";

  return {
    ok: true,
    tx: {
      type, amount: absAmount, category, date,
      note: description, accountId: opts.accountId, tags: [], imported: true,
    },
  };
}
