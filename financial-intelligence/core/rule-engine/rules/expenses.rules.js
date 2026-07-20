// ============================================================================
// rules/expenses — overall spending vs income, at three different levels of
// certainty: what already definitely happened (a closed month), what next
// month looks likely to be (a statistical forecast), and what THIS month
// is trending toward (a forecast still gaining evidence day by day). Each
// gets its own type/severity so the UI — and the user — can tell "this
// already happened" apart from "this is a projection".
// ============================================================================

/** @typedef {import("../../../types/index.js").Verdict} Verdict */

/**
 * @param {ReturnType<typeof import("../../../engine.js").buildEngine>} engine
 * @returns {Verdict[]}
 */
export function evaluate(engine) {
  const { closedMonths, cur, eomForecast, incMed, monthlyNetForecast, curMk } = engine;
  const verdicts = [];

  // Certain: a month that's already over came in negative.
  const last = closedMonths[closedMonths.length - 1];
  if (last && last.net < 0) {
    const overspendRatio = last.income > 0 ? -last.net / last.income : 1;
    verdicts.push({
      type: "expenses_exceed_income",
      severity: "critical",
      priority: 90 + Math.round(Math.min(10, overspendRatio * 10)),
      confidence: 1,
      data: { month: last.mk, income: last.income, expense: last.expense, deficit: -last.net },
    });
  }

  // Speculative: the CURRENT month's own forecast is trending past what a
  // typical month brings in. Lower confidence — it's a projection, not a
  // fact, and can still turn around before month end.
  if (incMed > 0 && eomForecast > incMed) {
    verdicts.push({
      type: "forecast_may_exceed_income",
      severity: "warning",
      priority: 65,
      confidence: 0.7,
      data: { month: curMk, forecast: eomForecast, typicalIncome: incMed, currentExpense: cur.expense },
    });
  }

  // Forward-looking: NEXT month's statistical net forecast is negative.
  if (monthlyNetForecast < 0) {
    verdicts.push({
      type: "next_month_net_negative",
      severity: "warning",
      priority: 60,
      confidence: 0.6,
      data: { deficit: -monthlyNetForecast },
    });
  }

  return verdicts;
}
