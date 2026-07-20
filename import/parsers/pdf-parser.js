// ============================================================================
// parsers/pdf-parser — extracts a flat, reading-order text stream from a
// TEXT-based PDF bank statement using pdfjs-dist. Deliberately does not use
// OCR: a PDF that's actually a scanned image (no extractable text layer) is
// detected and rejected with a clear reason rather than silently returning
// nothing.
//
// This module only produces TEXT — it has no opinion about how a
// particular bank lays out its rows (some wrap date+time across two visual
// lines within one cell, some don't; some repeat the amount twice, some
// don't). That reconstruction is bank-specific and lives in each bank
// adapter's own extractPdfRows(), which importer.js calls after detecting
// which bank produced the statement. Banks without their own PDF adapter
// fall back to a generic single-line heuristic (also bank-agnostic) also
// defined here, as DEFAULT_ROW_EXTRACTOR.
// ============================================================================

const Y_LINE_TOLERANCE = 2.5; // pt — text items within this of each other count as the same visual line
const DATE_TOKEN_RE = /\b\d{1,2}[.\/]\d{1,2}[.\/]\d{4}\b/g;
const AMOUNT_TOKEN_RE = /[-+]?\d[\d\s\u00a0']*[.,]\d{2}\b/g;

/**
 * Groups a page's positioned text items into visual lines (by y-position),
 * each line's items already sorted left-to-right, and returns them
 * top-to-bottom.
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
 * Generic single-line fallback for banks without their own PDF row
 * extractor: finds a date token and an amount token on the SAME visual
 * line, treating whatever's left as the description. Works for simpler
 * statement layouts where a whole transaction fits on one line; banks that
 * wrap a row across several lines (see banks/tinkoff.js for an example of
 * handling that) need their own extractPdfRows().
 * @param {string} flatText - the full document text, lines joined by \n
 * @returns {Array<{date: string, description: string, amount: string}>}
 */
export function defaultRowExtractor(flatText) {
  const rows = [];
  for (const lineText of flatText.split("\n")) {
    const dateMatches = [...lineText.matchAll(DATE_TOKEN_RE)];
    if (dateMatches.length === 0) continue;
    const firstDate = dateMatches[0][0];

    const withoutDates = lineText.replace(DATE_TOKEN_RE, " ");
    const amountMatches = [...withoutDates.matchAll(AMOUNT_TOKEN_RE)];
    if (amountMatches.length === 0) continue;
    const signed = amountMatches.filter((m) => m[0][0] === "-" || m[0][0] === "+");
    const amountMatch = signed.length > 0 ? signed[0] : amountMatches[0];

    const description = withoutDates.slice(0, amountMatch.index).replace(/\s{2,}/g, " ").trim();
    if (!description) continue;
    rows.push({ date: firstDate, amount: amountMatch[0], description });
  }
  return rows;
}

/**
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<
 *   { ok: true, flatText: string } |
 *   { ok: false, reason: "no_text_layer" | "parse_failed" }
 * >}
 */
export async function extractPdfText(arrayBuffer) {
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
  const lineTexts = [];

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
        lineTexts.push(line.items.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim());
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

  return { ok: true, flatText: lineTexts.join("\n") };
}
