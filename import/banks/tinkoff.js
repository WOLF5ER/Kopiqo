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

// PDF row reconstruction — confirmed against a real "Справка о движении
// средств" export. Each row's date and time wrap across separate visual
// lines within the same table cell ("19.07.2026" then "08:37" on the next
// line), so a plain single-line date+amount search (the generic fallback
// in parsers/pdf-parser.js) never finds anything. Т-Банк repeats the date
// and time twice per row (operation date/time, then processing date/time)
// — that four-token sequence is a reliable anchor marking where each row
// starts, regardless of how the description text wraps around it.
const ROW_ANCHOR_RE = /(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2})\s+(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2})/g;
const AMOUNT_RE = /[-+]\d[\d\s\u00a0']*[.,]\d{2}/;

/**
 * @param {string} flatText - full document text (extractPdfText's flatText)
 * @returns {Array<{date: string, description: string, amount: string}>}
 */
export function extractPdfRows(flatText) {
  const flat = flatText.replace(/\s+/g, " ").trim();
  const anchors = [...flat.matchAll(ROW_ANCHOR_RE)];
  const rows = [];

  for (let i = 0; i < anchors.length; i++) {
    const start = anchors[i].index + anchors[i][0].length;
    const end = i + 1 < anchors.length ? anchors[i + 1].index : flat.length;
    const chunk = flat.slice(start, end).trim();

    const amountMatch = chunk.match(AMOUNT_RE);
    if (!amountMatch) continue;

    // The amount appears twice (operation currency, then card currency —
    // the same value on a ruble-only statement); the description is
    // whatever's left after both, with the currency sign and the trailing
    // 4-digit card number stripped.
    const afterFirst = chunk.slice(amountMatch.index + amountMatch[0].length);
    const secondMatch = afterFirst.match(AMOUNT_RE);
    let description = secondMatch ? afterFirst.slice(secondMatch.index + secondMatch[0].length) : afterFirst;
    description = description
      .replace(/\u20bd/g, " ")
      .replace(/\s*\d{4}\s*$/, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!description) continue;
    rows.push({ date: anchors[i][1], amount: amountMatch[0], description });
  }
  return rows;
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
