// ============================================================================
// rules/anomalies — turns engine.js's already-detected statistical outliers
// (a category's own robust z-score > 3, i.e. a purchase far outside that
// category's own normal range) into "worth a look" cards. Severity is
// "info", not "warning": an unusually large purchase isn't necessarily a
// problem (a category's own history flags it as unusual, not the rule
// engine judging it as bad) — see ТЗ's own wording, "обратить внимание".
// ============================================================================

/** @typedef {import("../../../types/index.js").Verdict} Verdict */

const MAX_SURFACED = 3;

/**
 * @param {ReturnType<typeof import("../../../engine.js").buildEngine>} engine
 * @returns {Verdict[]}
 */
export function evaluate(engine) {
  const { anomalies } = engine;
  const verdicts = [];

  const top = [...anomalies].sort((a, b) => b.z - a.z).slice(0, MAX_SURFACED);
  for (const a of top) {
    verdicts.push({
      type: "unusual_transaction",
      severity: "info",
      priority: 45 + Math.round(Math.min(20, a.z * 3)),
      confidence: Math.min(1, a.z / 6),
      data: { category: a.category, amount: a.amount, categoryMedian: a.catMedian, note: a.note || null, date: a.date },
    });
  }

  return verdicts;
}
