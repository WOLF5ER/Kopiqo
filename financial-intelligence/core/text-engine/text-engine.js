// ============================================================================
// core/text-engine — turns Rule Engine Verdicts into the human-readable
// Insight cards the UI shows. Template-based only, per the ТЗ ("Запрещается
// использовать искусственный интеллект"): every string here is written by
// hand in templates.ru.js, never generated.
//
// Kept deliberately decoupled from the rest of the app: this module knows
// nothing about React, lucide-react, the app's i18n dictionary, or its
// currency settings. Category names and money formatting are INJECTED by
// the caller (resolveCategoryName / formatMoney) rather than imported,
// because those are presentation concerns the app already owns (its own
// EXPENSE_CATEGORIES nameKey+t() system, its own currency choice) — this
// module would otherwise need to duplicate them or import from app UI
// code, either of which the ТЗ's "UI only displays, no business logic
// inside components" principle argues against doing from the other
// direction. Sensible defaults are provided so this file still works
// standalone (e.g. under a test harness) with no caller wiring at all.
// ============================================================================

import { TEMPLATES_RU } from "./templates.ru.js";

const TEMPLATE_POOLS = {
  ru: TEMPLATES_RU,
  // en/zh pools go here once written — text-engine.js needs no changes to
  // pick them up, only a `en: TEMPLATES_EN` entry (see templates.ru.js's
  // header for why they aren't filled in yet).
};

const FULL_MONTHS_RU = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

function defaultFormatMoney(n) {
  const v = Math.round(Number(n) || 0);
  return `${v.toLocaleString("ru-RU")} ₽`;
}

function defaultResolveCategoryName(id) {
  return id;
}

/** "2026-07" -> "июль 2026" */
function formatMonthLabel(mk) {
  if (typeof mk !== "string" || !/^\d{4}-\d{2}$/.test(mk)) return String(mk);
  const [y, m] = mk.split("-");
  const name = FULL_MONTHS_RU[Number(m) - 1] || mk;
  return `${name} ${y}`;
}

// A small stable string hash (djb2) — used only to pick a template variant
// deterministically from a verdict's own content, NOT Math.random(). This
// means the same verdict always reads the same way across re-renders (no
// wording "flicker" as the UI updates), while different verdicts of the
// same type still get variety because their data differs.
function stableHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (h * 33) ^ str.charCodeAt(i);
  return h >>> 0;
}

function fill(template, ctx) {
  return template.replace(/\{(\w+)\}/g, (_, key) => (key in ctx ? String(ctx[key]) : `{${key}}`));
}

// Builds the placeholder context for one verdict. Only the fields a
// template actually references need to be here; harmless to include a few
// extra. Money/date/category fields are pre-formatted here so
// templates.ru.js stays pure prose with no formatting logic of its own.
function buildContext(verdict, { resolveCategoryName, formatMoney }) {
  const d = verdict.data || {};
  const ctx = { ...d };
  if (d.category != null) ctx.categoryName = resolveCategoryName(d.category);
  if (d.month != null) ctx.month = formatMonthLabel(d.month);
  for (const moneyField of [
    "income", "expense", "median", "deficit", "forecast", "typicalIncome",
    "currentExpense", "histMedian", "spent", "limit", "amount", "totalBudget",
    "overBy", "projectedBalance", "target", "saved", "categoryMedian",
  ]) {
    if (ctx[moneyField] != null) ctx[moneyField] = formatMoney(ctx[moneyField]);
  }
  return ctx;
}

/**
 * @param {import("../../types/index.js").Verdict[]} verdicts - output of
 *   core/rule-engine/rule-engine.js's runRuleEngine()
 * @param {Object} [opts]
 * @param {"ru"} [opts.locale] - only "ru" has templates for now
 * @param {Date} [opts.now] - stamped onto each Insight's createdAt
 * @param {(categoryId: string) => string} [opts.resolveCategoryName] -
 *   defaults to returning the raw id
 * @param {(amount: number) => string} [opts.formatMoney] - defaults to a
 *   plain "N ₽" formatter
 * @returns {import("../../types/index.js").Insight[]} same order as input
 *   (already priority-sorted by the rule engine)
 */
export function generateInsights(verdicts, opts = {}) {
  const locale = opts.locale || "ru";
  const now = opts.now || new Date();
  const resolveCategoryName = opts.resolveCategoryName || defaultResolveCategoryName;
  const formatMoney = opts.formatMoney || defaultFormatMoney;
  const pool = TEMPLATE_POOLS[locale] || TEMPLATE_POOLS.ru;

  const insights = [];
  for (const verdict of verdicts) {
    const entry = pool[verdict.type];
    if (!entry || !entry.variants || !entry.variants.length) {
      console.warn(`[text-engine] no template for verdict type "${verdict.type}" — skipped`);
      continue;
    }
    const dataKey = `${verdict.type}:${JSON.stringify(verdict.data)}`;
    const variant = entry.variants[stableHash(dataKey) % entry.variants.length];
    const ctx = buildContext(verdict, { resolveCategoryName, formatMoney });

    insights.push({
      id: stableHash(dataKey).toString(36),
      priority: verdict.priority,
      severity: verdict.severity,
      type: verdict.type,
      title: fill(variant.title, ctx),
      description: fill(variant.description, ctx),
      recommendation: fill(variant.recommendation, ctx),
      confidence: verdict.confidence,
      createdAt: now.toISOString(),
      icon: entry.icon,
    });
  }
  return insights;
}
