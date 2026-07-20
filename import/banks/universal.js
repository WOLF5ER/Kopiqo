// ============================================================================
// banks/universal — the fallback adapter, used when no bank-specific
// adapter recognizes a statement. Matches columns by generic alias lists
// rather than knowing any one bank's exact header set — this is the same
// logic the very first version of the importer shipped with, kept as the
// catch-all so an unfamiliar bank's export still has a reasonable chance of
// working instead of failing outright.
// ============================================================================

export const id = "universal";
export const name = "Универсальный формат";

const ALIASES = {
  date: ["дата", "date", "operation date", "дата операции", "дата платежа", "дата транзакции"],
  description: [
    "описание", "назначение платежа", "description", "merchant", "операция",
    "наименование", "детали операции", "название", "payee", "narrative",
  ],
  amount: [
    "сумма", "amount", "сумма операции", "сумма в валюте счета", "сумма платежа",
    "value", "сумма операции в валюте счёта",
  ],
  category: ["категория", "category", "тип операции"],
  status: ["статус", "status", "статус операции", "статус платежа"],
};

function normalize(header) {
  return String(header).trim().toLowerCase().replace(/ё/g, "е");
}

/**
 * The universal adapter has no bank name to fingerprint text against.
 */
export function detectFromText() {
  return false;
}

/**
 * The universal adapter never claims a file confidently — it's the
 * fallback other adapters are tried before, so detect() always reports low
 * confidence and lets detector.js fall through to it last.
 */
export function detect() {
  return 0.1;
}

/**
 * @param {string[]} headers
 * @returns {{ dateIdx: number, descriptionIdx: number, amountIdx: number, categoryIdx: number } | null}
 */
export function getColumnMapping(headers) {
  const normalized = headers.map(normalize);

  const findIdx = (field) => {
    const aliases = ALIASES[field];
    for (const alias of aliases) {
      const exact = normalized.indexOf(alias);
      if (exact !== -1) return exact;
    }
    for (let i = 0; i < normalized.length; i++) {
      if (aliases.some((alias) => normalized[i].includes(alias))) return i;
    }
    return -1;
  };

  const dateIdx = findIdx("date");
  const descriptionIdx = findIdx("description");
  const amountIdx = findIdx("amount");
  const categoryIdx = findIdx("category");
  const statusIdx = findIdx("status");

  if (dateIdx === -1 || descriptionIdx === -1 || amountIdx === -1) return null;
  return { dateIdx, descriptionIdx, amountIdx, categoryIdx, statusIdx };
}

// No bank-specific category vocabulary — the universal adapter leaves
// category mapping entirely to category-matcher.js's keyword rules.
export function mapCategory() {
  return null;
}
