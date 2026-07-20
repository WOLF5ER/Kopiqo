// ============================================================================
// csv-parser — hand-rolled, dependency-free CSV reader.
//
// Bank export CSVs are rarely fancy (no nested quoting edge cases beyond the
// basics), so a small state machine here avoids pulling in a parsing library
// for what's fundamentally a solved, bounded problem. Handles:
//   - comma or semicolon delimiters (auto-detected from the header row)
//   - quoted fields, including embedded delimiters and escaped quotes ("")
//   - \r\n, \r, and \n line endings
//   - a trailing blank line at EOF
// ============================================================================

function detectDelimiter(headerLine) {
  const commaCount = (headerLine.match(/,/g) || []).length;
  const semiCount = (headerLine.match(/;/g) || []).length;
  return semiCount > commaCount ? ";" : ",";
}

/**
 * @param {string} text - raw CSV file contents
 * @returns {{ headers: string[], rows: string[][] }}
 */
export function parseCSV(text) {
  // Strip a UTF-8 BOM, which Excel loves to prepend.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const firstLineEnd = text.search(/\r\n|\r|\n/);
  const headerLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
  const delimiter = detectDelimiter(headerLine);

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === delimiter) { pushField(); i++; continue; }
    if (ch === "\r" || ch === "\n") {
      pushRow();
      if (ch === "\r" && text[i + 1] === "\n") i += 2; else i++;
      continue;
    }
    field += ch; i++;
  }
  // Final field/row, if the file doesn't end on a line break.
  if (field.length > 0 || row.length > 0) pushRow();

  const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0] === ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  const [headers, ...dataRows] = nonEmpty;
  return { headers: headers.map((h) => h.trim()), rows: dataRows };
}
