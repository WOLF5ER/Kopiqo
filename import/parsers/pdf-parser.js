// ============================================================================
// parsers/pdf-parser — extracts transaction-like rows from a TEXT-based PDF
// bank statement. Deliberately does not use OCR: a PDF that's actually a
// scanned image (no extractable text layer) is detected and rejected with a
// clear reason rather than silently returning nothing.
//
// PDF.js gives back a flat list of positioned text fragments per page, not
// a table — there's no structural "this is column 2" information to read.
// Rather than clustering fragments by x-position into rigid columns (which
// breaks the moment two statements from the same bank lay out slightly
// differently, e.g. a name that pushes a column wider), this reconstructs
// visual lines from y-position, then scans each line for a date-shaped
// token and an amount-shaped token — whatever text is left on the line
// becomes the description. That's the same "find the two things we
// recognize, the rest is the label" approach real-world statement parsers
// tend to converge on, and it tolerates column drift a lot better.
// ============================================================================

const DATE_TOKEN_RE = /\b\d{1,2}[.\/]\d{1,2}[.\/]\d{4}\b/g;
const AMOUNT_TOKEN_RE = /[-+]?\d[\d\s\u00a0']*[.,]\d{2}\b/g;
const Y_LINE_TOLERANCE = 2.5; // pt — text items within this of each other count as the same visual line

/**
 * Groups a page's positioned text items into visual lines (by y-position),
 * each line's items already sorted left-to-right.
 */
function groupIntoLines(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x); // top-to-bottom, then left-to-right
  const lines = [];
  for (const item of sorted) {
    const line = lines.find((l) => Math.abs(l.y - item.y) <= Y_LINE_TOLERANCE);
    if (line) { line.items.push(item); line.y = (line.y + item.y) / 2; }
    else lines.push({ y: item.y, items: [item] });
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x);
  return lines;
}

/**
 * Pulls a date token, an amount token, and treats the rest as the
 * description — from one already-assembled line of text.
 * @returns {{date: string, amount: string, description: string} | null}
 */
function extractRowFromLine(text) {
  const dateMatches = [...text.matchAll(DATE_TOKEN_RE)];
  if (dateMatches.length === 0) return null;
  const firstDate = dateMatches[0][0];

  // Strip EVERY date-shaped token before hunting for amounts — a date like
  // 17.07.2026 contains a substring (17.07) that would otherwise itself
  // satisfy the amount pattern below.
  const withoutDates = text.replace(DATE_TOKEN_RE, " ");

  const amountMatches = [...withoutDates.matchAll(AMOUNT_TOKEN_RE)];
  if (amountMatches.length === 0) return null;
  // Prefer an explicitly signed number (the transaction amount, in most RU
  // bank PDF layouts) over an unsigned one (usually a running balance sitting
  // right next to it). With several signed candidates, take the first —
  // balance columns come after the amount column in reading order.
  const signed = amountMatches.filter((m) => m[0][0] === "-" || m[0][0] === "+");
  const amountMatch = signed.length > 0 ? signed[0] : amountMatches[0];

  const description = withoutDates.slice(0, amountMatch.index).replace(/\s{2,}/g, " ").trim();
  if (!description) return null;
  return { date: firstDate, amount: amountMatch[0], description };
}

/**
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<
 *   { ok: true, rows: Array<{date: string, description: string, amount: string}>, fullText: string } |
 *   { ok: false, reason: "no_text_layer" | "parse_failed" }
 * >}
 */
export async function parsePDF(arrayBuffer) {
  let pdfjsLib;
  try {
    pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://esm.sh/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs";
  } catch (e) {
    return { ok: false, reason: "parse_failed" };
  }

  let doc;
  try {
    doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  } catch (e) {
    return { ok: false, reason: "parse_failed" };
  }

  let totalChars = 0;
  const allRows = [];
  const textChunks = [];

  try {
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const items = content.items
        .filter((it) => it.str && it.str.trim())
        .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));
      totalChars += items.reduce((sum, it) => sum + it.str.length, 0);

      const lines = groupIntoLines(items);
      for (const line of lines) {
        const lineText = line.items.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim();
        textChunks.push(lineText);
        const row = extractRowFromLine(lineText);
        if (row) allRows.push(row);
      }
    }
  } catch (e) {
    return { ok: false, reason: "parse_failed" };
  }

  // A PDF with (essentially) no extractable text is a scan/image, not a
  // text-based statement — OCR is explicitly out of scope, so this is
  // reported as its own reason rather than "no operations found".
  if (totalChars < 20) {
    return { ok: false, reason: "no_text_layer" };
  }

  return { ok: true, rows: allRows, fullText: textChunks.join("\n") };
}
