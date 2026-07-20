// ============================================================================
// financial-intelligence/ui/IntelligencePanel.js — "Kopiqo Intelligence"
// screen: a Financial Health summary plus Insight cards sorted by priority.
//
// Pure display, no business logic (per ТЗ's "UI должен только отображать
// результаты работы движка"): the four core/ stages already produced
// everything shown here — this component's only job is running that
// pipeline through useMemo (so it only re-runs when the underlying data
// actually changes, matching Этап 6's "пересчитывать только после
// изменения данных" — React's own memoization already satisfies that
// requirement at this data scale, no separate cache module needed) and
// laying the results out.
//
// Written with React.createElement rather than JSX syntax: this project
// ships plain ES modules straight to the browser with no build step (see
// AnalyticsPanel in app.compiled.js, the closest precedent), so a file
// using `<Foo/>` syntax simply wouldn't run — there's nothing to compile it.
//
// Data flows in as props from the main App component, which already loads
// transactions/budgets/etc into its own state for every other tab — this
// deliberately does NOT fetch window.storage itself (unlike AnalyticsPanel,
// which does, and duplicates a fetch the app already performs elsewhere).
// category-name and money-formatting resolution are injected via props for
// the same reason engine.js's callers inject them into text-engine.js:
// this module has no business knowing the app's i18n/currency internals.
// ============================================================================

import React, { useMemo } from "react";
import { normalizeDataset, buildEngine } from "../engine.js";
import { runRuleEngine } from "../core/rule-engine/rule-engine.js";
import { generateInsights } from "../core/text-engine/text-engine.js";
import { computeHealthScore } from "../core/health-score/health-score.js";

const e = React.createElement;

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2, positive: 3, achievement: 4 };

/**
 * @param {Object} props
 * @param {boolean} props.visible
 * @param {Array} props.transactions
 * @param {Object} props.budgets
 * @param {Array} props.customCategories
 * @param {Array} props.accounts
 * @param {Array} props.goals
 * @param {Array} props.recurringTemplates
 * @param {(categoryId: string) => string} props.resolveCategoryName
 * @param {(amount: number) => string} props.formatMoney
 * @param {(key: string) => string} props.t
 * @param {Object<string, React.ComponentType>} props.iconMap - lucide-react
 *   components keyed by the names templates.ru.js's icon field uses
 *   (TrendingUp, TrendingDown, AlertTriangle, AlertCircle, Activity, Info,
 *   Repeat, PiggyBank, Trophy, Target, Eye). Passed in rather than
 *   imported: this module has no lucide-react dependency of its own.
 */
export default function IntelligencePanel(props) {
  const {
    visible, transactions, budgets, customCategories, accounts, goals,
    recurringTemplates, resolveCategoryName, formatMoney, t, iconMap,
  } = props;

  const { insights, health } = useMemo(() => {
    if (!visible) return { insights: [], health: null };
    try {
      const dataset = normalizeDataset({
        transactions: transactions || [],
        budgets: budgets || {},
        customCategories: customCategories || [],
        accounts: accounts || [],
        goals: goals || [],
        recurringTemplates: recurringTemplates || [],
      });
      const engine = buildEngine(dataset, new Date());
      const verdicts = runRuleEngine(engine);
      const generatedInsights = generateInsights(verdicts, { now: new Date(), resolveCategoryName, formatMoney });
      const healthResult = computeHealthScore(engine);
      return { insights: generatedInsights, health: healthResult };
    } catch (err) {
      console.error("[IntelligencePanel] failed to build insights:", err);
      return { insights: [], health: null };
    }
    // transactions/budgets/etc are plain data from storage — a shallow
    // length+identity check isn't reliable for arrays that get replaced
    // wholesale on every save, so we depend on the arrays/objects
    // themselves; React's default memo comparison (reference equality)
    // is exactly what's needed here since the app already creates new
    // array/object references on every change (never mutates in place).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, transactions, budgets, customCategories, accounts, goals, recurringTemplates]);

  if (!visible) return null;

  if (!health) {
    return e("div", { className: "gb-intel-empty" }, t("intel_loading") || "…");
  }

  const bandLabel = {
    critical: t("intel_band_critical") || "Требует внимания",
    weak: t("intel_band_weak") || "Есть над чем поработать",
    fair: t("intel_band_fair") || "Неплохо",
    good: t("intel_band_good") || "Хорошо",
    excellent: t("intel_band_excellent") || "Отлично",
  }[health.band];

  const sorted = [...insights].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);
  });

  return e("div", { className: "gb-intel" }, [
    e("div", { className: "gb-intel-health", key: "health" }, [
      e("div", { className: "gb-intel-health-score", key: "score" }, [
        String(health.score),
        e("span", { key: "max" }, "/100"),
      ]),
      e("div", { className: "gb-intel-health-body", key: "body" }, [
        e("p", { className: `gb-intel-health-band is-${health.band}`, key: "band" }, bandLabel),
        e(
          "p",
          { className: "gb-intel-health-hint", key: "hint" },
          t("intel_health_hint") || "Финансовое здоровье собрано из накоплений, бюджетов, стабильности дохода и ещё нескольких факторов."
        ),
      ]),
    ]),
    sorted.length === 0
      ? e("div", { className: "gb-intel-empty", key: "empty" }, t("intel_empty") || "Пока ничего примечательного — заглядывайте позже.")
      : e(
          "div",
          { className: "gb-intel-cards", key: "cards" },
          sorted.map((ins) =>
            e("div", { className: `gb-intel-card is-${ins.severity}`, key: ins.id }, [
              e(
                "div",
                { className: "gb-intel-card-icon", key: "icon" },
                e((iconMap && iconMap[ins.icon]) || (iconMap && iconMap.Info), { size: 16 })
              ),
              e("div", { className: "gb-intel-card-body", key: "body" }, [
                e("p", { className: "gb-intel-card-title", key: "title" }, ins.title),
                e("p", { className: "gb-intel-card-desc", key: "desc" }, ins.description),
                e("p", { className: "gb-intel-card-reco", key: "reco" }, ins.recommendation),
              ]),
            ])
          )
        ),
  ]);
}
