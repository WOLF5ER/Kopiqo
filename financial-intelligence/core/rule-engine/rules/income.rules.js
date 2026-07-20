// ============================================================================
// rules/income — signals about the user's income itself (not spending).
//
// Deliberately reads ONLY closedMonths, never `engine.cur` (the in-progress
// current month): a salary usually lands once a month, so on day 3 of a new
// month `cur.income` is near zero for everyone — comparing that partial
// figure against a historical median would falsely scream "income
// collapsed" every single month until payday. Waiting for a month to close
// before judging it is what keeps this rule honest.
// ============================================================================

/** @typedef {import("../../../types/index.js").Verdict} Verdict */

const MIN_MONTHS_FOR_TREND = 2;

/**
 * @param {ReturnType<typeof import("../../../engine.js").buildEngine>} engine
 * @returns {Verdict[]}
 */
export function evaluate(engine) {
  const { closedMonths, incMed } = engine;
  const verdicts = [];
  if (closedMonths.length < MIN_MONTHS_FOR_TREND || incMed <= 0) return verdicts;

  const last = closedMonths[closedMonths.length - 1];
  const ratio = last.income / incMed;

  if (ratio < 0.7) {
    verdicts.push({
      type: "income_drop",
      severity: "warning",
      priority: 70 + Math.round(Math.min(20, (0.7 - ratio) * 40)),
      confidence: 1,
      data: { month: last.mk, income: last.income, median: incMed, ratioPct: Math.round(ratio * 100) },
    });
  } else if (ratio > 1.3) {
    verdicts.push({
      type: "income_growth",
      severity: "positive",
      priority: 50 + Math.round(Math.min(15, (ratio - 1.3) * 20)),
      confidence: 1,
      data: { month: last.mk, income: last.income, median: incMed, ratioPct: Math.round(ratio * 100) },
    });
  }

  // Instability: how much recent income bounces around, independent of any
  // single month being high or low.
  const recent = closedMonths.slice(-6).map((m) => m.income).filter((v) => v > 0);
  if (recent.length >= 3) {
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((a, b) => a + (b - mean) ** 2, 0) / recent.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
    if (cv > 0.4) {
      verdicts.push({
        type: "income_unstable",
        severity: "info",
        priority: 35,
        confidence: 0.8,
        data: { monthsConsidered: recent.length, coefficientOfVariation: Math.round(cv * 100) / 100 },
      });
    }
  }

  return verdicts;
}
