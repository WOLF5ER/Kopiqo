// ============================================================================
// banks/sber — Сбербанк (Sberbank Online) export adapter.
//
// Column names here are based on Sberbank's commonly documented statement
// export format, not a verified real sample (unlike tinkoff.js, which was
// built from an actual file). Confidence scoring is intentionally more
// conservative as a result — refine FINGERPRINT_HEADERS and CATEGORY_MAP
// once a real export is available to test against.
// ============================================================================

export const id = "sber";
export const name = "Сбербанк";

const FINGERPRINT_HEADERS = ["сумма в валюте счета", "сумма в валюте операции"];

function normalize(header) {
  return String(header).trim().toLowerCase().replace(/ё/g, "е");
}

const FINGERPRINT_TEXT = [/сбербанк/i, /сбер\b/i, /sberbank/i];

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
  const dateIdx = normalized.indexOf("дата операции");
  const descriptionIdx = normalized.findIndex((h) => h === "описание" || h === "описание операции");
  const amountIdx = normalized.findIndex((h) => h === "сумма в валюте счета" || h === "сумма в валюте операции");
  const categoryIdx = normalized.indexOf("категория");

  if (dateIdx === -1 || descriptionIdx === -1 || amountIdx === -1) return null;
  return { dateIdx, descriptionIdx, amountIdx, categoryIdx };
}

const CATEGORY_MAP = {
  "супермаркеты": "food",
  "рестораны и кафе": "food",
  "фастфуд": "food",
  "транспорт": "transport",
  "азс": "transport",
  "автомобиль": "transport",
  "развлечения": "fun",
  "кино, театры и концерты": "fun",
  "одежда и обувь": "shopping",
  "интернет-магазины": "shopping",
  "аптеки": "health",
  "красота и здоровье": "health",
  "жкх и связь": "housing",
  "прочие расходы": "other_exp",
  "переводы": "other_exp",
  "наличные": "other_exp",
};

/**
 * @param {string} bankLabel
 * @returns {string|null}
 */
export function mapCategory(bankLabel) {
  const key = String(bankLabel || "").trim().toLowerCase();
  return CATEGORY_MAP[key] || null;
}
