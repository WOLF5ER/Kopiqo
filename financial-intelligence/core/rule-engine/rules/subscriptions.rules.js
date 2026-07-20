// ============================================================================
// rules/subscriptions — surfaces a detected recurring payment (see
// engine.js's detectedRecurring — same category/note, stable amount and
// day-of-month, ≥3 months running) the user hasn't already told Kopiqo
// about via a recurringTemplate. Named "recurring payment", not
// "subscription": confirmed against real data, this pattern also catches
// things that are recurring but aren't subscriptions in the Netflix sense
// — a scheduled transfer to a savings account, a recurring utility bill —
// so the verdict type stays accurate to what was actually detected rather
// than presuming which kind of recurring payment it is (that's a Text
// Engine wording choice, not a Rule Engine one).
// ============================================================================

/** @typedef {import("../../../types/index.js").Verdict} Verdict */

const MAX_SURFACED = 3;
const AMOUNT_TOLERANCE = 0.1; // 10% — a subscription's price can drift a little (currency, tax) and still be "the same" one
const DAY_TOLERANCE = 3;

function matchesKnownTemplate(detected, recurringTemplates) {
  return (recurringTemplates || []).some((rt) => {
    if (!rt.active || rt.type !== "expense") return false;
    if (rt.category !== detected.cat) return false;
    const amountClose = Math.abs(rt.amount - detected.amount) <= detected.amount * AMOUNT_TOLERANCE;
    const dayClose = rt.dayOfMonth == null || Math.abs(rt.dayOfMonth - detected.day) <= DAY_TOLERANCE;
    return amountClose && dayClose;
  });
}

/**
 * @param {ReturnType<typeof import("../../../engine.js").buildEngine>} engine
 * @returns {Verdict[]}
 */
export function evaluate(engine) {
  const { detectedRecurring, recurringTemplates } = engine;
  const verdicts = [];

  const unknown = detectedRecurring
    .filter((r) => r.activeNow && !matchesKnownTemplate(r, recurringTemplates))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, MAX_SURFACED);

  for (const r of unknown) {
    verdicts.push({
      type: "new_recurring_payment_detected",
      severity: "info",
      priority: 50,
      confidence: 0.75,
      data: { category: r.cat, note: r.note, amount: r.amount, dayOfMonth: r.day, monthsSeen: r.monthsSeen },
    });
  }

  return verdicts;
}
