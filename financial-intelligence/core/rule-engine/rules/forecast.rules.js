// ============================================================================
// rules/forecast — whole-month and multi-month projections, distinct from
// categories.rules.js's PER-CATEGORY budget checks: this file looks at the
// combined envelope (all budgeted categories together) and at the balance
// trajectory several months out.
// ============================================================================

/** @typedef {import("../../../types/index.js").Verdict} Verdict */

/**
 * @param {ReturnType<typeof import("../../../engine.js").buildEngine>} engine
 * @returns {Verdict[]}
 */
export function evaluate(engine) {
  const { eomForecast, budgets, balanceCurve, curMk } = engine;
  const verdicts = [];

  const totalBudget = Object.values(budgets || {}).reduce((s, v) => s + (Number(v) || 0), 0);
  if (totalBudget > 0 && eomForecast > totalBudget) {
    verdicts.push({
      type: "forecast_over_total_budget",
      severity: "warning",
      priority: 68,
      confidence: 0.75,
      data: { forecast: eomForecast, totalBudget, overBy: eomForecast - totalBudget },
    });
  }

  // First future month (proj set, no fact yet — i.e. strictly after the
  // current month) where the running balance projection dips below zero.
  const firstNegative = balanceCurve.find((p) => p.mk > curMk && p.proj != null && p.proj < 0);
  if (firstNegative) {
    verdicts.push({
      type: "balance_negative_forecast",
      severity: "critical",
      priority: 88,
      confidence: 0.6, // several months out — a real but not certain-yet forecast
      data: { month: firstNegative.mk, projectedBalance: firstNegative.proj },
    });
  }

  return verdicts;
}
