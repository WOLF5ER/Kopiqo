// ============================================================================
// banks/tinkoff — Т-Банк (Tinkoff) CSV export adapter.
//
// Column knowledge and the category vocabulary below are both taken from an
// actual exported statement, not guessed: header row is
// "Дата операции";"Дата платежа";"Номер карты";"Статус";"Сумма операции";
// "Валюта операции";"Сумма платежа";"Валюта платежа";"Кэшбэк";"Категория";
// "MCC";"Описание";"Бонусы (включая кэшбэк)";"Округление на
// инвесткопилку";"Сумма операции с округлением"
// ============================================================================

export const id = "tinkoff";
export const name = "Т-Банк";

// A combination distinctive enough that no other bank's export is likely to
// accidentally match it — "MCC" (merchant category code) and "Округление на
// инвесткопилку" (a Tinkoff-specific round-up savings feature) together are
// effectively a fingerprint.
const FINGERPRINT_HEADERS = ["номер карты", "mcc", "округление на инвесткопилку"];

function normalize(header) {
  return String(header).trim().toLowerCase().replace(/ё/g, "е");
}

const FINGERPRINT_TEXT = [/т-банк/i, /тинькофф/i, /tinkoff/i];

/**
 * Text-based detection for PDF statements, where there are no column
 * headers to read — just the bank's own name appearing somewhere in the
 * document (letterhead, footer, etc.).
 * @param {string} fullText - all extracted text from the PDF, joined
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
  const descriptionIdx = normalized.indexOf("описание");
  const amountIdx = normalized.indexOf("сумма операции");
  const categoryIdx = normalized.indexOf("категория");

  if (dateIdx === -1 || descriptionIdx === -1 || amountIdx === -1) return null;
  return { dateIdx, descriptionIdx, amountIdx, categoryIdx };
}

// Т-Банк's own category vocabulary (the "Категория" column's actual
// values), mapped to Kopiqo's expense category ids. This is a far more
// reliable signal than guessing from the merchant name alone, so
// normalizer.js prefers it over category-matcher.js's keyword rules
// whenever a value here is recognized.
const CATEGORY_MAP = {
  "фастфуд": "food",
  "рестораны": "food",
  "супермаркеты": "food",
  "продукты": "food",
  "заправки": "transport",
  "автоуслуги": "transport",
  "транспорт": "transport",
  "такси": "transport",
  "каршеринг": "transport",
  "кино": "fun",
  "цифровые товары": "fun",
  "развлечения": "fun",
  "хобби": "fun",
  "различные товары": "shopping",
  "одежда и обувь": "shopping",
  "цветы": "shopping",
  "аптеки": "health",
  "медицина": "health",
  "красота": "health",
  "жкх и связь": "housing",
  "коммунальные услуги": "housing",
  "сервис": "other_exp",
  "финансы": "other_exp",
  "переводы": "other_exp",
  "наличные": "other_exp",
  "госуслуги": "other_exp",
  "животные": "other_exp",
  "другое": "other_exp",
};

/**
 * @param {string} bankLabel - the statement's own "Категория" value for a row
 * @returns {string|null} a Kopiqo expense category id, or null if unrecognized
 */
export function mapCategory(bankLabel) {
  const key = String(bankLabel || "").trim().toLowerCase();
  return CATEGORY_MAP[key] || null;
}
