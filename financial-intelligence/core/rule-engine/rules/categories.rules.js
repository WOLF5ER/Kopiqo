// ============================================================================
// rules/categories — per-category growth/decline and budget-limit status.
//
// Every number here already exists in the engine result (movers,
// budgetRisks) — this file's only job is turning an already-computed
// figure into a decision, never recomputing the underlying math. That's
// deliberate: budgetRisks' own `status` field ("over"/"risk"/"warn"/"ok")
// IS the verdict for budget rules; re-deriving the same threshold here
// would be exactly the duplicate logic the ТЗ asks to avoid.
// ============================================================================

/** @typedef {import("../../../types/index.js").Verdict} Verdict */

/**
 * @param {ReturnType<typeof import("../../../engine.js").buildEngine>} engine
 * @returns {Verdict[]}
 */
export function evaluate(engine) {
  const { movers, budgetRisks } = engine;
  const verdicts = [];

  for (const m of movers) {
    if (m.deltaPct > 0.25) {
      verdicts.push({
        type: "category_growth",
        severity: "warning",
        priority: 60 + Math.round(Math.min(30, m.deltaPct * 40)),
        confidence: 0.85,
        data: { category: m.cat, forecast: m.forecast, histMedian: m.histMedian, percentChange: Math.round(m.deltaPct * 100) },
      });
    } else if (m.deltaPct < -0.25) {
      verdicts.push({
        type: "category_decline",
        severity: "positive",
        priority: 40 + Math.round(Math.min(20, Math.abs(m.deltaPct) * 30)),
        confidence: 0.85,
        data: { category: m.cat, forecast: m.forecast, histMedian: m.histMedian, percentChange: Math.round(m.deltaPct * 100) },
      });
    }
  }

  for (const b of budgetRisks) {
    if (b.status === "over") {
      verdicts.push({
        type: "budget_over",
        severity: "critical",
        priority: 85 + Math.round(Math.min(15, (b.ratio - 1) * 15)),
        confidence: 1,
        data: { category: b.cat, spent: b.mtd, limit: b.limit, ratioPct: Math.round(b.ratio * 100) },
      });
    } else if (b.status === "risk") {
      verdicts.push({
        type: "budget_risk",
        severity: "warning",
        priority: 72,
        confidence: 0.9,
        data: { category: b.cat, forecast: b.forecast, limit: b.limit, ratioPct: Math.round(b.ratio * 100) },
      });
    } else if (b.status === "warn") {
      verdicts.push({
        type: "budget_warn",
        severity: "info",
        priority: 42,
        confidence: 0.7,
        data: { category: b.cat, forecast: b.forecast, limit: b.limit, ratioPct: Math.round(b.ratio * 100) },
      });
    }
  }

  return verdicts;
}
