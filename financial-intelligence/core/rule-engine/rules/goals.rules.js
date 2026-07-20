// ============================================================================
// rules/goals — status of the user's savings goals (engine.js's goalStats).
// Deliberately silent for a goal that's simply progressing normally — a
// verdict fires only when there's something worth telling the user: it
// stalled, it's basically done, or it just got fully funded.
// ============================================================================

/** @typedef {import("../../../types/index.js").Verdict} Verdict */

/**
 * @param {ReturnType<typeof import("../../../engine.js").buildEngine>} engine
 * @returns {Verdict[]}
 */
export function evaluate(engine) {
  const { goalStats } = engine;
  const verdicts = [];

  for (const g of goalStats) {
    if (g.saved >= g.target) {
      verdicts.push({
        type: "goal_completed",
        severity: "achievement",
        priority: 80,
        confidence: 1,
        data: { name: g.name, target: g.target, saved: g.saved },
      });
    } else if (g.etaMonths != null && g.etaMonths <= 1) {
      verdicts.push({
        type: "goal_almost_done",
        severity: "positive",
        priority: 58,
        confidence: 0.85,
        data: { name: g.name, target: g.target, saved: g.saved, etaDate: g.etaDate },
      });
    } else if (!(g.monthlyContrib > 0)) {
      verdicts.push({
        type: "goal_stalled",
        severity: "warning",
        priority: 62,
        confidence: 0.7,
        data: { name: g.name, target: g.target, saved: g.saved },
      });
    }
  }

  return verdicts;
}
