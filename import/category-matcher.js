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
