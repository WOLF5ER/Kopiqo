// ============================================================================
// importer — the single entry point the UI calls. Takes a File object and
// the app's current transactions (for dedup), returns a preview list ready
// to show the user before anything is actually saved.
// ============================================================================

import { parseCSV } from "./csv-parser.js";
import { parseXLSX } from "./xlsx-parser.js";
import { detectColumns } from "./bank-detector.js";
import { normalizeRow } from "./transaction-normalizer.js";

/**
 * Two transactions are treated as the same import candidate if they land on
 * the same date, the same rounded amount, and their notes are a close
 * enough match — catches re-imports of the same statement (or overlapping
 * date ranges between two exports) without being so strict that two
 * genuinely different $5 coffees on the same day both get silently dropped
 * — those still differ enough in note text to pass.
 */
function isLikelyDuplicate(candidate, existing) {
  if (candidate.date !== existing.date) return false;
  if (Math.round(candidate.amount) !== Math.round(existing.amount)) return false;
  const a = (candidate.note || "").toLowerCase().trim();
  const b = (existing.note || "").toLowerCase().trim();
  if (!a || !b) return a === b;
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * @param {File} file
 * @param {{ accountId: string, existingTransactions: object[] }} opts
 * @returns {Promise<{
 *   ok: true,
 *   rows: Array<{ tx: object, status: "new"|"duplicate"|"skipped"|"transfer", reason?: string }>,
 *   newCount: number, duplicateCount: number, skippedCount: number, transferCount: number,
 * } | { ok: false, reason: string }>}
 */
export async function importStatementFile(file, opts) {
  const name = (file.name || "").toLowerCase();
  let parsed;
  try {
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      const buf = await file.arrayBuffer();
      parsed = await parseXLSX(buf);
    } else {
      const text = await file.text();
      parsed = parseCSV(text);
    }
  } catch (e) {
    return { ok: false, reason: "parse_failed" };
  }

  if (!parsed.headers.length || !parsed.rows.length) {
    return { ok: false, reason: "empty_file" };
  }

  const columns = detectColumns(parsed.headers);
  if (!columns) {
    return { ok: false, reason: "columns_not_recognized" };
  }

  const existing = opts.existingTransactions || [];
  const rows = [];
  let newCount = 0, duplicateCount = 0, skippedCount = 0, transferCount = 0;

  for (const row of parsed.rows) {
    const raw = {
      date: row[columns.dateIdx],
      description: row[columns.descriptionIdx],
      amount: row[columns.amountIdx],
      bankCategory: columns.categoryIdx !== -1 ? row[columns.categoryIdx] : undefined,
    };
    const result = normalizeRow(raw, { accountId: opts.accountId });
    if (!result.ok) {
      if (result.reason === "self_transfer") {
        transferCount++;
        rows.push({ tx: null, status: "transfer", reason: result.reason });
      } else {
        skippedCount++;
        rows.push({ tx: null, status: "skipped", reason: result.reason });
      }
      continue;
    }
    const isDup = existing.some((e) => isLikelyDuplicate(result.tx, e))
      || rows.some((r) => r.status === "new" && isLikelyDuplicate(result.tx, r.tx));
    if (isDup) {
      duplicateCount++;
      rows.push({ tx: result.tx, status: "duplicate" });
    } else {
      newCount++;
      rows.push({ tx: result.tx, status: "new" });
    }
  }

  return { ok: true, rows, newCount, duplicateCount, skippedCount, transferCount };
}
