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

// PDF row reconstruction — handles two confirmed real-world Т-Банк PDF
// layouts, which differ in where the two times land:
//   (a) "Справка о движении средств": both dates + both amounts + the start
//       of the description share one visual line; the two times sit ALONE
//       on the very next line, followed by any wrapped description text.
//         "19.07.2026 19.07.2026 -2 247.76 ₽ -2 247.76 ₽ AIA*5ka MOSCOW 7342"
//         "08:37 08:43 RU"
//   (b) a regular card statement export, where each date is immediately
//       followed by its own time on the SAME line as everything else.
//         "19.07.2026 08:37 19.07.2026 08:43 -2 247.76 ₽ -2 247.76 ₽ ... 7342"
// The line-start anchor (two DD.MM.YYYY dates, each with an optional
// same-line HH:MM) covers both; when the time wasn't already on the anchor
// line, it's pulled from the next line instead, together with any wrapped
// description text after it.
const DATE_LINE_RE = /^(\d{2}\.\d{2}\.\d{4})(?:\s+(\d{2}:\d{2}))?\s+\d{2}\.\d{2}\.\d{4}(?:\s+\d{2}:\d{2})?\s+([-+]\d[\d\s\u00a0']*[.,]\d{2})\s*\S*\s*[-+]\d[\d\s\u00a0']*[.,]\d{2}\s*\S*\s*(.*)$/;
const TIME_PAIR_RE = /^(\d{2}:\d{2})\s+(\d{2}:\d{2})\s*(.*)$/;
const CARD_TAIL_RE = /\s+\d{4}\s*$/;

/**
 * @param {string} flatText - full document text (extractPdfText's flatText,
 *   lines joined by \n — pdf-parser.js's own visual-line grouping)
 * @returns {Array<{date: string, description: string, amount: string}>}
 */
export function extractPdfRows(flatText) {
  const lines = flatText.split("\n").map((l) => l.trim()).filter(Boolean);
  const rows = [];

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(DATE_LINE_RE);
    if (!m) continue;

    const [, opDate, timeOnSameLine, amount, descStart] = m;
    // Strip the trailing 4-digit card number from whatever description text
    // landed on the anchor line itself.
    let description = descStart.replace(CARD_TAIL_RE, "").trim();

    // Only pull from the next line when this layout didn't already have the
    // time inline (layout a) — otherwise the next line is the following
    // transaction's own anchor and must be left alone.
    if (!timeOnSameLine) {
      const next = lines[i + 1];
      if (next) {
        const timeMatch = next.match(TIME_PAIR_RE);
        if (timeMatch) {
          const continuation = timeMatch[3].replace(CARD_TAIL_RE, "").trim();
          if (continuation) description = `${description} ${continuation}`.trim();
          i++; // this line is consumed as part of the current row
        }
      }
    }

    if (!description) continue;
    rows.push({ date: opDate, amount, description });
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
