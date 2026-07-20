// ============================================================================
// core/health-score — a single 0-100 "Financial Health" number plus the
// component breakdown behind it (ТЗ Этап 5). Every component reads a field
// engine.js already computes — nothing here re-walks the transaction list.
// Each component is scored 0-100 on its own scale (documented per-function)
// then combined by a fixed weight; weights sum to 1 so the total stays in
// 0-100 without extra normalization.
//
// A component whose underlying data doesn't exist yet for this user (no
// budgets set, no goals, no income history) returns a neutral score (60,
// deliberately on the "fine" side of 50) rather than 0 — someone with no
// goals set isn't financially unhealthy for that reason alone; the score
// should reflect what's actually knowable, not punish missing setup.
// ============================================================================

import { clamp, median } from "../../engine.js";

const WEIGHTS = {
  incomeExpenseBalance: 0.20, // savings rate over the last 3 closed months
  budgetDiscipline: 0.15,     // how categories with a budget are tracking
  incomeStability: 0.15,      // month-to-month income variability
  reserveBuffer: 0.15,        // balance vs a typical month's expense
  goalsProgress: 0.10,        // savings goals moving, not stalled
  subscriptionLoad: 0.10,     // recurring commitments vs income
  impulsivity: 0.15,          // rate of statistically unusual purchases
};

function lerpScore(value, lowValue, lowScore, highValue, highScore) {
  if (lowValue === highValue) return highScore;
  const t = clamp((value - lowValue) / (highValue - lowValue), 0, 1);
  return lowScore + t * (highScore - lowScore);
}

/** savingsRate: null (no income history) -> neutral. -20%→0, 0%→40, 20%→80, capped 100. */
function scoreIncomeExpenseBalance(engine) {
  const { savingsRate } = engine;
  if (savingsRate == null) return 60;
  if (savingsRate <= -0.2) return 0;
  if (savingsRate <= 0) return lerpScore(savingsRate, -0.2, 0, 0, 40);
  if (savingsRate <= 0.2) return lerpScore(savingsRate, 0, 40, 0.2, 80);
  return lerpScore(savingsRate, 0.2, 80, 0.4, 100);
}

/** Share of budgeted categories that are "ok"/"warn" rather than "risk"/"over". No budgets set -> neutral. */
function scoreBudgetDiscipline(engine) {
  const { budgetRisks } = engine;
  if (!budgetRisks.length) return 60;
  const healthy = budgetRisks.filter((b) => b.status === "ok" || b.status === "warn").length;
  return Math.round((healthy / budgetRisks.length) * 100);
}

/** Coefficient of variation of recent closed-month incomes. 0 -> 100, ≥0.6 -> 0. Fewer than 3 months -> neutral. */
function scoreIncomeStability(engine) {
  const recent = engine.closedMonths.slice(-6).map((m) => m.income).filter((v) => v > 0);
  if (recent.length < 3) return 60;
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const variance = recent.reduce((a, b) => a + (b - mean) ** 2, 0) / recent.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  return Math.round(lerpScore(cv, 0, 100, 0.6, 0));
}

/** Balance ÷ a typical month's expense, in months of runway. 0 months -> 0, 3+ -> 100. */
function scoreReserveBuffer(engine) {
  const { balance, closedMonths } = engine;
  const typicalMonthlyExpense = median(closedMonths.slice(-6).map((m) => m.expense).filter((v) => v > 0));
  if (!typicalMonthlyExpense) return 60; // no expense history yet to size a "typical month" against
  const monthsOfRunway = balance / typicalMonthlyExpense;
  return Math.round(lerpScore(monthsOfRunway, 0, 0, 3, 100));
}

/** Mean progress across goals (saved/target, capped at 100%), minus a penalty per stalled goal. No goals -> neutral. */
function scoreGoalsProgress(engine) {
  const { goalStats } = engine;
  if (!goalStats.length) return 60;
  const progressPct = goalStats.map((g) => clamp(g.target > 0 ? g.saved / g.target : 0, 0, 1) * 100);
  const base = progressPct.reduce((a, b) => a + b, 0) / progressPct.length;
  const stalledCount = goalStats.filter((g) => !(g.monthlyContrib > 0) && g.saved < g.target).length;
  return Math.round(clamp(base - stalledCount * 20, 0, 100));
}

/** Active recurring commitments ÷ typical income. 0% -> 100, ≥40% -> 0. No income baseline -> neutral. */
function scoreSubscriptionLoad(engine) {
  const { recurringMonthly, incMed } = engine;
  if (!(incMed > 0)) return 60;
  const ratio = recurringMonthly / incMed;
  return Math.round(lerpScore(ratio, 0, 100, 0.4, 0));
}

/** Rate of statistically unusual purchases among recent expenses. 0% -> 100, ≥8% -> 0. Too little history -> neutral. */
function scoreImpulsivity(engine) {
  const { anomalies, expenses } = engine;
  if (expenses.length < 10) return 60;
  const rate = anomalies.length / expenses.length;
  return Math.round(lerpScore(rate, 0, 100, 0.08, 0));
}

const COMPONENT_SCORERS = {
  incomeExpenseBalance: scoreIncomeExpenseBalance,
  budgetDiscipline: scoreBudgetDiscipline,
  incomeStability: scoreIncomeStability,
  reserveBuffer: scoreReserveBuffer,
  goalsProgress: scoreGoalsProgress,
  subscriptionLoad: scoreSubscriptionLoad,
  impulsivity: scoreImpulsivity,
};

/**
 * @param {number} score 0-100
 * @returns {"critical"|"weak"|"fair"|"good"|"excellent"}
 */
export function scoreBand(score) {
  if (score < 35) return "critical";
  if (score < 55) return "weak";
  if (score < 70) return "fair";
  if (score < 85) return "good";
  return "excellent";
}

/**
 * @param {ReturnType<typeof import("../../engine.js").buildEngine>} engine
 * @returns {{
 *   score: number,
 *   band: "critical"|"weak"|"fair"|"good"|"excellent",
 *   components: Object<string, { score: number, weight: number }>,
 * }}
 */
export function computeHealthScore(engine) {
  const components = {};
  let total = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    const raw = COMPONENT_SCORERS[key](engine);
    const score = Math.round(clamp(raw, 0, 100));
    components[key] = { score, weight };
    total += score * weight;
  }
  return {
    score: Math.round(clamp(total, 0, 100)),
    band: scoreBand(Math.round(clamp(total, 0, 100))),
    components,
  };
}
