// ============================================================================
// core/rule-engine — runs every rules/*.rules.js module against one
// StatisticsResult+PatternResult (engine.js's buildEngine output) and
// collects their Verdicts, sorted by priority.
//
// Adding a new rule file is entirely additive: create
// rules/<domain>.rules.js exporting `evaluate(engine)`, add it to
// RULE_MODULES below. No existing rule file needs to change — this is what
// the ТЗ's "добавление нового правила не должно требовать изменения
// существующих файлов" means in practice.
//
// Contract: a rule module never throws for "nothing to report" — it
// returns []. If one DOES throw (a bug, or an engine field it expected
// turns out missing), that module's findings are dropped and every OTHER
// module still runs — one broken rule must not blank out the whole
// Insight screen.
// ============================================================================

import * as income from "./rules/income.rules.js";
import * as expenses from "./rules/expenses.rules.js";
import * as subscriptions from "./rules/subscriptions.rules.js";
import * as forecast from "./rules/forecast.rules.js";
import * as goals from "./rules/goals.rules.js";
import * as categories from "./rules/categories.rules.js";
import * as anomalies from "./rules/anomalies.rules.js";
import * as habits from "./rules/habits.rules.js";

const RULE_MODULES = [
  { name: "income", mod: income },
  { name: "expenses", mod: expenses },
  { name: "subscriptions", mod: subscriptions },
  { name: "forecast", mod: forecast },
  { name: "goals", mod: goals },
  { name: "categories", mod: categories },
  { name: "anomalies", mod: anomalies },
  { name: "habits", mod: habits },
];

/**
 * @param {ReturnType<typeof import("../../engine.js").buildEngine>} engine
 * @returns {import("../../types/index.js").Verdict[]} sorted by priority,
 *   highest first
 */
export function runRuleEngine(engine) {
  const verdicts = [];
  for (const { name, mod } of RULE_MODULES) {
    try {
      const found = mod.evaluate(engine);
      if (Array.isArray(found)) verdicts.push(...found);
    } catch (e) {
      console.error(`[rule-engine] rules/${name}.rules.js threw during evaluate():`, e);
    }
  }
  verdicts.sort((a, b) => b.priority - a.priority);
  return verdicts;
}
