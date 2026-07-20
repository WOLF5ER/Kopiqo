// ============================================================================
// importer — the single entry point the UI calls. Takes a File object and
// the app's current transactions (for dedup), returns a preview ready to
// show the user before anything is actually saved.
//
// This is orchestration only — every actual concern (parsing a file format,
// identifying a bank, normalizing a row, checking for duplicates, shaping
// the preview) lives in its own module. Adding a new file format or bank
// means adding a module elsewhere in /import, not touching this file.
// ============================================================================

import { parseCSV } from "./parsers/csv-parser.js";
import { parseXLSX } from "./parsers/xlsx-parser.js";
import { extractPdfText, defaultRowExtractor } from "./parsers/pdf-parser.js";
import { detectBank, detectBankFromText } from "./detector.js";
import { normalizeRow } from "./normalizer.js";
import { isDuplicateAgainst } from "./duplicate-checker.js";
import { linkTransferPairs } from "./transfer-linker.js";
import { buildPreview } from "./preview.js";

/**
 * Reads a CSV/XLSX file into { rows: [{date, description, amount, bankCategory}], bank }.
 */
async function readTabularFile(file, isXlsx) {
  const parsed = isXlsx ? await parseXLSX(await file.arrayBuffer()) : parseCSV(await file.text());
  if (!parsed.headers.length || !parsed.rows.length) {
    return { ok: false, reason: "empty_file" };
  }
  const detected = detectBank(parsed.headers);
  if (!detected) {
    return { ok: false, reason: "columns_not_recognized" };
  }
  const { bank, columns } = detected;
  // A "Статус"/status column, when the bank's export has one, marks
  // operations the bank itself never completed (declined, reversed) — those
  // never actually moved money and must not be imported as real spending.
  // Only rows explicitly NOT ok are dropped; unrecognized status text is
  // kept rather than silently discarded, since a stricter allow-list would
  // risk losing legitimate rows over wording Kopiqo doesn't yet know.
  const statusIdx = columns.statusIdx;
  const hasStatusColumn = typeof statusIdx === "number" && statusIdx !== -1;
  const FAILED_STATUS_RE = /^(failed|declined|отклон|отмен|ошибк|error)/i;
  const rawRows = parsed.rows
    .filter((row) => {
      if (!hasStatusColumn) return true;
      const status = String(row[statusIdx] || "").trim();
      return !FAILED_STATUS_RE.test(status);
    })
    .map((row) => ({
      date: row[columns.dateIdx],
      description: row[columns.descriptionIdx],
      amount: row[columns.amountIdx],
      bankCategory: columns.categoryIdx !== -1 ? row[columns.categoryIdx] : undefined,
    }));
  return { ok: true, rawRows, bank };
}

/**
 * Reads a PDF file into { rows: [{date, description, amount}], bank }.
 */
async function readPdfFile(file) {
  const result = await extractPdfText(await file.arrayBuffer());
  if (!result.ok) return result;

  const bank = detectBankFromText(result.flatText);
  const rawRows = bank.extractPdfRows ? bank.extractPdfRows(result.flatText) : defaultRowExtractor(result.flatText);
  if (rawRows.length === 0) return { ok: false, reason: "no_operations_found" };

  return { ok: true, rawRows, bank };
}

/**
 * @param {File} file
 * @param {{ accountId: string, existingTransactions: object[] }} opts
 * @returns {Promise<
 *   { ok: true, rows: Array, bankName: string|null, newCount: number, duplicateCount: number, skippedCount: number, transferCount: number } |
 *   { ok: false, reason: string }
 * >}
 */
export async function importStatementFile(file, opts) {
  const name = (file.name || "").toLowerCase();
  let read;
  try {
    if (name.endsWith(".pdf")) {
      read = await readPdfFile(file);
    } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      read = await readTabularFile(file, true);
    } else {
      read = await readTabularFile(file, false);
    }
  } catch (e) {
    return { ok: false, reason: "parse_failed" };
  }

  if (!read.ok) return read;
  const { rawRows, bank } = read;

  const existing = opts.existingTransactions || [];

  // Pass 1 — normalize every raw row. Rows the wording list already
  // recognizes as self-transfers are flagged here; everything readable
  // starts out "new".
  const rows = rawRows.map((raw) => {
    const result = normalizeRow(raw, { accountId: opts.accountId, bank });
    if (!result.ok) {
      const status = result.reason === "self_transfer" ? "transfer" : "skipped";
      return { tx: null, status, reason: result.reason };
    }
    return { tx: result.tx, status: "new" };
  });

  // Pass 2 — link transfer pairs by money movement (see transfer-linker.js).
  // Runs BEFORE dedup so both legs of an internal transfer get flagged even
  // when one of them would otherwise collide with an existing transaction.
  linkTransferPairs(rows);

  // Pass 3 — dedup what's still "new" against the account's EXISTING
  // transactions only. Deliberately NOT against other rows of this same
  // batch: banks don't list one operation twice in one statement, so
  // identical rows inside a single file are real repeats (confirmed case:
  // three identical purchase refunds in the same minute) — deduping them
  // against each other silently loses real money.
  for (const row of rows) {
    if (row.status !== "new") continue;
    if (isDuplicateAgainst(row.tx, existing, [])) {
      row.status = "duplicate";
    }
  }

  return { ok: true, ...buildPreview(rows, bank) };
}
