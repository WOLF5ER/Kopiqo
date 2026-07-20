// ============================================================================
// xlsx-parser — thin wrapper around SheetJS (xlsx). Loaded lazily (only when
// the user actually picks an .xlsx file) so the CSV-only path never pays for
// it.
// ============================================================================

/**
 * @param {ArrayBuffer} arrayBuffer - raw file contents
 * @returns {Promise<{ headers: string[], rows: string[][] }>}
 */
export async function parseXLSX(arrayBuffer) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return { headers: [], rows: [] };
  const sheet = workbook.Sheets[firstSheetName];

  // header:1 -> array-of-arrays, raw cell values (dates come through as JS
  // Date objects thanks to cellDates above, which bank-detector understands
  // alongside plain strings).
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
  const nonEmpty = matrix.filter((row) => row.some((cell) => cell !== "" && cell !== null && cell !== undefined));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const [headerRow, ...dataRows] = nonEmpty;
  const headers = headerRow.map((h) => String(h).trim());
  const rows = dataRows.map((row) => headers.map((_, i) => {
    const cell = row[i];
    if (cell instanceof Date) return cell;
    return cell === undefined || cell === null ? "" : String(cell);
  }));
  return { headers, rows };
}
