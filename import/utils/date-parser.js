// ============================================================================
// utils/date-parser — turns a statement's raw date value (a JS Date from
// XLSX, or a string in one of several common formats) into Kopiqo's own
// YYYY-MM-DD. Shared by every parser/bank adapter so date handling only
// needs to be right in one place.
// ============================================================================

const MONTHS_RU = { "янв": 1, "фев": 2, "мар": 3, "апр": 4, "май": 5, "мая": 5, "июн": 6, "июл": 7, "авг": 8, "сен": 9, "окт": 10, "ноя": 11, "дек": 12 };

function pad2(n) { return String(n).padStart(2, "0"); }

/**
 * @param {any} value - a JS Date, or a string in DD.MM.YYYY, YYYY-MM-DD,
 *   DD/MM/YYYY, "19 июл 2026", or most other common formats
 * @returns {string|null} Kopiqo's YYYY-MM-DD, or null if unparseable
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
