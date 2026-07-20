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
      "бристоль", "красное белое", "додо", "dodo pizza", "papa john",
      "суши", "sushi", "шаурма", "кофе", "coffee", "пекарня", "булочная",
    ],
  },
  {
    categoryId: "transport",
    keywords: [
      "такси", "яндекс.такси", "yandex taxi", "яндекс go", "yandex go", "uber",
      "gett", "ситимобил", "метро", "metro transport", "автобус", "жд", "ржд",
      "avia", "аэрофлот", "s7", "победа airlines",
      "шелл", "shell", "лукойл", "gazprom", "азс", "роснефть", "rosneft",
      "татнефть", "bp", "parking", "паркинг", "автомойка", "шиномонтаж",
      "каршеринг", "delimobil", "яндекс драйв", "belka car",
    ],
  },
  {
    categoryId: "fun",
    keywords: [
      "кино", "steam", "игра", "playstation", "xbox", "nintendo", "cinema",
      "netflix", "spotify", "ivi", "kinopoisk", "кинопоиск", "театр",
      "концерт", "twitch", "youtube premium", "epic games", "wink",
      "okko", "premier", "боулинг", "квест", "парк развлечений",
    ],
  },
  {
    categoryId: "shopping",
    keywords: [
      "wildberries", "ozon", "aliexpress", "avito", "zara", "h&m", "lamoda",
      "спортмастер", "detmir", "детский мир", "мвидео", "м.видео", "dns",
      "amazon", "яндекс маркет", "летуаль", "l'etoile", "золотое яблоко",
      "иль де ботэ", "streetbeat", "sunlight", "ювелир", "цветы", "flowers",
    ],
  },
  {
    categoryId: "health",
    keywords: [
      "аптека", "pharmacy", "apteka", "клиника", "clinic", "стоматолог",
      "dentist", "больница", "hospital", "инвитро", "гемотест", "здравсити",
      "ригла", "асна", "planeta zdorovia", "оптика", "фитнес", "fitness",
      "спортзал", "gym", "world class", "барбершоп", "парикмахер",
    ],
  },
  {
    categoryId: "housing",
    keywords: [
      "жкх", "коммунальные", "квартплата", "электроэнергия", "мосэнерго",
      "водоканал", "интернет провайдер", "ростелеком", "мтс домашний",
      "rent", "аренда квартиры", "мегафон", "билайн", "теле2", "yota",
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
