// ============================================================================
// category-matcher — keyword-based classifier from a transaction's
// description to one of Kopiqo's expense category ids.
//
// The category ids here (food, transport, fun, ...) match EXPENSE_CATEGORIES
// in app.jsx exactly, so a match can be dropped straight into a transaction
// object's `category` field with no further translation.
//
// Extending this is additive only: add keywords to an existing entry, or a
// new { categoryId, keywords } entry for a category not covered yet. Order
// matters only in that the first match wins, so put more specific rules
// before broader ones if they'd ever overlap.
// ============================================================================

const RULES = [
  {
    categoryId: "food",
    keywords: [
      "пятерочка", "пятёрочка", "магнит", "перекресток", "перекрёсток", "лента",
      "ашан", "auchan", "дикси", "вкусвилл", "metro", "spar", "billa",
      "supermarket", "grocery", "restaurant", "cafe", "кафе", "ресторан",
      "столовая", "кофейня", "starbucks", "mcdonald", "kfc", "burger",
    ],
  },
  {
    categoryId: "transport",
    keywords: [
      "такси", "яндекс.такси", "yandex taxi", "uber", "gett", "ситимобил",
      "метро", "metro transport", "автобус", "жд", "ржд", "avia", "аэрофлот",
      "шелл", "shell", "лукойл", "gazprom", "азс", "parking", "паркинг",
      "каршеринг", "delimobil", "яндекс драйв",
    ],
  },
  {
    categoryId: "fun",
    keywords: [
      "кино", "steam", "игра", "playstation", "xbox", "cinema", "netflix",
      "spotify", "ivi", "kinopoisk", "кинопоиск", "театр", "концерт",
      "twitch", "youtube premium", "epic games",
    ],
  },
  {
    categoryId: "shopping",
    keywords: [
      "wildberries", "ozon", "aliexpress", "avito", "zara", "h&m", "lamoda",
      "спортмастер", "detmir", "детский мир", "мвидео", "м.видео", "dns",
      "amazon", "яндекс маркет",
    ],
  },
  {
    categoryId: "health",
    keywords: [
      "аптека", "pharmacy", "apteka", "клиника", "clinic", "стоматолог",
      "dentist", "больница", "hospital", "инвитро", "гемотест",
    ],
  },
  {
    categoryId: "housing",
    keywords: [
      "жкх", "коммунальные", "квартплата", "электроэнергия", "мосэнерго",
      "водоканал", "интернет провайдер", "ростелеком", "мтс домашний",
      "rent", "аренда квартиры",
    ],
  },
];

const FALLBACK_CATEGORY_ID = "other_exp";

/**
 * @param {string} description
 * @returns {string} a Kopiqo expense category id
 */
export function matchCategory(description) {
  const text = String(description || "").toLowerCase();
  for (const rule of RULES) {
    if (rule.keywords.some((kw) => text.includes(kw))) return rule.categoryId;
  }
  return FALLBACK_CATEGORY_ID;
}

// ============================================================================
// Bank-provided category labels — many statements (T-Bank/Tinkoff included)
// already classify each transaction themselves ("Фастфуд", "Заправки",
// "Супермаркеты", ...). That's a far more reliable signal than guessing from
// the merchant name, so when a statement has its own Category column,
// importer.js prefers this mapping over matchCategory() above — the keyword
// matcher only kicks in as a fallback for statements without one, or for a
// bank label this table doesn't recognize yet.
//
// Extending for another bank's label set is additive: add its labels
// (lowercased) to the relevant entry below.
// ============================================================================
const BANK_LABEL_MAP = {
  food: ["фастфуд", "рестораны", "супермаркеты", "продукты"],
  transport: ["заправки", "автоуслуги", "транспорт", "такси", "каршеринг"],
  fun: ["кино", "цифровые товары", "развлечения", "хобби"],
  shopping: ["различные товары", "одежда и обувь", "цветы", "маркетплейс"],
  health: ["аптеки", "медицина", "красота"],
  housing: ["жкх и связь", "коммунальные услуги"],
  other_exp: ["сервис", "финансы", "переводы", "наличные", "госуслуги", "животные", "другое", "прочее"],
};

/**
 * @param {string} bankLabel - the statement's own category value for a row
 * @returns {string|null} a Kopiqo expense category id, or null if this bank
 *   label isn't recognized (caller should fall back to matchCategory())
 */
export function matchCategoryFromBankLabel(bankLabel) {
  const text = String(bankLabel || "").trim().toLowerCase();
  if (!text) return null;
  for (const [categoryId, labels] of Object.entries(BANK_LABEL_MAP)) {
    if (labels.includes(text)) return categoryId;
  }
  return null;
}

// ============================================================================
// Self-transfers — moving money between the user's own accounts/cards. These
// must NOT be counted as ordinary income/expense (they'd inflate both
// totals for money that never actually left the person's own pocket), which
// is a different thing from a P2P payment to someone else (a real expense).
// Detection is deliberately conservative: it only flags the wording banks
// themselves use for their OWN internal transfers, never generic "Переводы"
// entries with a person's name attached (those are real spending).
// ============================================================================
const SELF_TRANSFER_PATTERNS = [
  /между\s+(своими\s+)?счетами/i,
  /перевод\s+(себе|самому\s+себе|на\s+свой\s+счет)/i,
  /пополнение\s+своего\s+счета/i,
  /own\s+account/i,
  /internal\s+transfer/i,
];

/**
 * @param {string} description
 * @returns {boolean}
 */
export function isLikelySelfTransfer(description) {
  const text = String(description || "");
  return SELF_TRANSFER_PATTERNS.some((re) => re.test(text));
}
