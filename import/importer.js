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
  const rawRows = parsed.rows.map((row) => ({
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
  const rows = [];
  const acceptedSoFar = [];

  for (const raw of rawRows) {
    const result = normalizeRow(raw, { accountId: opts.accountId, bank });
    if (!result.ok) {
      const status = result.reason === "self_transfer" ? "transfer" : "skipped";
      rows.push({ tx: null, status, reason: result.reason });
      continue;
    }
    if (isDuplicateAgainst(result.tx, existing, acceptedSoFar)) {
      rows.push({ tx: result.tx, status: "duplicate" });
    } else {
      acceptedSoFar.push(result.tx);
      rows.push({ tx: result.tx, status: "new" });
    }
  }

  return { ok: true, ...buildPreview(rows, bank) };
}
