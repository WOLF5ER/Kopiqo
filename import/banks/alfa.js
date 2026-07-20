// ============================================================================
// banks/alfa — Альфа-Банк export adapter.
//
// Column names here are based on Alfa-Bank's commonly documented statement
// export format, not a verified real sample (unlike tinkoff.js, which was
// built from an actual file). Refine once a real export is available.
// ============================================================================

export const id = "alfa";
export const name = "Альфа-Банк";

const FINGERPRINT_HEADERS = ["описание операции", "сумма в валюте счета"];

function normalize(header) {
  return String(header).trim().toLowerCase().replace(/ё/g, "е");
}

const FINGERPRINT_TEXT = [/альфа-?банк/i, /alfa-?bank/i];

/**
 * @param {string} fullText
 * @returns {boolean}
 */
export function detectFromText(fullText) {
  return FINGERPRINT_TEXT.some((re) => re.test(fullText));
}

/**
 * @param {string[]} headers
 * @returns {number} confidence 0–1
 */
export function detect(headers) {
  const normalized = headers.map(normalize);
  const hits = FINGERPRINT_HEADERS.filter((h) => normalized.includes(h)).length;
  return hits / FINGERPRINT_HEADERS.length;
}

/**
 * @param {string[]} headers
 * @returns {{ dateIdx: number, descriptionIdx: number, amountIdx: number, categoryIdx: number } | null}
 */
export function getColumnMapping(headers) {
  const normalized = headers.map(normalize);
  const dateIdx = normalized.findIndex((h) => h === "дата операции" || h === "дата обработки");
  const descriptionIdx = normalized.indexOf("описание операции");
  const amountIdx = normalized.indexOf("сумма в валюте счета");
  const categoryIdx = normalized.indexOf("категория");

  if (dateIdx === -1 || descriptionIdx === -1 || amountIdx === -1) return null;
  return { dateIdx, descriptionIdx, amountIdx, categoryIdx };
}

const CATEGORY_MAP = {
  "супермаркеты": "food",
  "кафе и рестораны": "food",
  "транспорт": "transport",
  "топливо": "transport",
  "развлечения": "fun",
  "одежда": "shopping",
  "интернет-покупки": "shopping",
  "здоровье и красота": "health",
  "аптеки": "health",
  "коммунальные платежи": "housing",
  "переводы": "other_exp",
  "снятие наличных": "other_exp",
  "прочее": "other_exp",
};

/**
 * @param {string} bankLabel
 * @returns {string|null}
 */
export function mapCategory(bankLabel) {
  const key = String(bankLabel || "").trim().toLowerCase();
  return CATEGORY_MAP[key] || null;
}
