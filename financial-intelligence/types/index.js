// ============================================================================
// financial-intelligence/types — shared shape documentation. Plain JSDoc
// typedefs, not TypeScript: this codebase is hand-written ES modules with no
// build step (see /import/'s existing style), so a .ts file would need a
// compiler nothing else here has. Other modules reference these via
// `@typedef {import("../types/index.js").Verdict} Verdict` comments, which
// editors and any future `tsc --checkJs` pass both understand.
// ============================================================================

/**
 * A Rule Engine finding — a DECISION, not yet human text. One rule file
 * (rules/*.rules.js) can emit zero or more of these per evaluate() call.
 * `data` carries exactly the numbers/names a Text Engine template needs to
 * fill in — Rule Engine itself never writes prose (see ТЗ Этап 3 vs 4: the
 * wording step is a separate, later stage so verdicts stay language- and
 * phrasing-agnostic, and so the same verdict could in principle feed an
 * LLM Adapter instead of the template Text Engine without Rule Engine
 * changing at all).
 *
 * @typedef {Object} Verdict
 * @property {string} type - stable rule identity, e.g. "category_growth".
 *   Text Engine looks up its template pool by this key.
 * @property {"critical"|"warning"|"info"|"positive"|"achievement"} severity
 * @property {number} priority - 0-100, higher sorts first within a run.
 *   Rule authors set a per-rule baseline and may nudge it by magnitude
 *   (e.g. a bigger overspend ratio sorts above a smaller one of the same
 *   type), but never invent numbers the underlying data doesn't support.
 * @property {number} confidence - 0-1, how sure the rule is. Most rules
 *   that fired on a clear threshold use 1; a couple of softer heuristics
 *   (e.g. subscription-detection-adjacent calls) use less.
 * @property {Object<string, any>} data - rule-specific fields for the text
 *   template (category id, percent, amount, month label, etc). Every value
 *   here must trace back to a field already present in the engine result —
 *   see engine.js's StatisticsResult/PatternResult JSDoc for what exists.
 */

/**
 * The final card shown in the UI — a Verdict plus the generated wording.
 * Text Engine (a later stage) is what adds title/description/
 * recommendation/icon/id/createdAt on top of a Verdict; nothing in
 * core/rule-engine constructs this shape directly.
 *
 * @typedef {Object} Insight
 * @property {string} id
 * @property {number} priority
 * @property {"critical"|"warning"|"info"|"positive"|"achievement"} severity
 * @property {string} type
 * @property {string} title
 * @property {string} description
 * @property {string} recommendation
 * @property {number} confidence
 * @property {string} createdAt - ISO timestamp
 * @property {string} icon - a lucide-react icon name, matched to `type`
 */

export {};
