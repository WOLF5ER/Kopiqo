// ============================================================================
// bank-detector — maps a statement's actual column headers to the three
// fields Kopiqo needs (date, description, amount), by matching against a
// list of known aliases per field. Different banks and export tools name
// these columns differently; this is the lookup table that bridges that gap.
//
// Extending it for a bank/tool not covered here is just adding a string to
// the relevant alias list — no other code needs to change.
// ============================================================================

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
};

function normalize(header) {
  return String(header).trim().toLowerCase().replace(/ё/g, "е");
}

/**
 * @param {string[]} headers
 * @returns {{ dateIdx: number, descriptionIdx: number, amountIdx: number } | null}
 *   Indices into the headers/rows arrays, or null if any required field
 *   couldn't be matched.
 */
export function detectColumns(headers) {
  const normalized = headers.map(normalize);

  const findIdx = (field) => {
    const aliases = ALIASES[field];
    // Exact match first, then a "contains" fallback for headers with extra
    // words the alias lists don't anticipate verbatim.
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

  if (dateIdx === -1 || descriptionIdx === -1 || amountIdx === -1) return null;
  return { dateIdx, descriptionIdx, amountIdx };
}
