// ============================================================================
// rules/habits — sustained behavior over the last few months, as opposed
// to a single month's numbers (that's expenses.rules.js's job). Right now
// this covers what engine.js's savingsRate (last-3-closed-months
// income/expense ratio) can support; deliberately doesn't invent
// time-of-day or day-of-week pattern rules the engine doesn't compute yet
// (weekdayCoef exists for the current-month forecast curve, not as a
// historical baseline to compare against — there's nothing yet to detect a
// CHANGE against without fabricating a number).
// ============================================================================

/** @typedef {import("../../../types/index.js").Verdict} Verdict */

/**
 * @param {ReturnType<typeof import("../../../engine.js").buildEngine>} engine
 * @returns {Verdict[]}
 */
export function evaluate(engine) {
  const { savingsRate } = engine;
  const verdicts = [];
  if (savingsRate == null) return verdicts;

  if (savingsRate < 0) {
    verdicts.push({
      type: "negative_savings_rate",
      severity: "warning",
      priority: 70,
      confidence: 0.85,
      data: { savingsRatePct: Math.round(savingsRate * 100) },
    });
  } else if (savingsRate >= 0.2) {
    verdicts.push({
      type: "healthy_savings_rate",
      severity: "positive",
      priority: 55,
      confidence: 0.85,
      data: { savingsRatePct: Math.round(savingsRate * 100) },
    });
  }

  return verdicts;
}
