// ============================================================================
// preview — shapes a processed row list into the summary the UI shows
// before anything is actually saved: how many are new, how many are
// duplicates, how many couldn't be read, how many were self-transfers.
// ============================================================================

/**
 * @param {Array<{ tx: object|null, status: "new"|"duplicate"|"skipped"|"transfer", reason?: string }>} rows
 * @param {object} [bank] - the bank adapter detector.js identified, if any
 * @returns {{
 *   rows: Array, bankName: string|null,
 *   newCount: number, duplicateCount: number, skippedCount: number, transferCount: number,
 * }}
 */
export function buildPreview(rows, bank) {
  let newCount = 0, duplicateCount = 0, skippedCount = 0, transferCount = 0;
  for (const row of rows) {
    if (row.status === "new") newCount++;
    else if (row.status === "duplicate") duplicateCount++;
    else if (row.status === "transfer") transferCount++;
    else skippedCount++;
  }
  return {
    rows,
    bankName: bank ? bank.name : null,
    newCount, duplicateCount, skippedCount, transferCount,
  };
}
