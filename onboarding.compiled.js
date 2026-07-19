// onboarding/core/registry.js
var scenarios = /* @__PURE__ */ new Map();
function registerScenario(config) {
  if (!config || typeof config.id !== "string" || !config.id) {
    throw new Error("registerScenario: config.id (non-empty string) is required");
  }
  if (!Array.isArray(config.steps) || config.steps.length === 0) {
    throw new Error(`registerScenario("${config.id}"): steps must be a non-empty array`);
  }
  const stepIds = /* @__PURE__ */ new Set();
  for (const step of config.steps) {
    if (!step || typeof step.id !== "string" || !step.id) {
      throw new Error(`registerScenario("${config.id}"): every step needs a string id`);
    }
    if (stepIds.has(step.id)) {
      throw new Error(`registerScenario("${config.id}"): duplicate step id "${step.id}"`);
    }
    stepIds.add(step.id);
  }
  scenarios.set(config.id, {
    version: 1,
    trigger: { type: "manual" },
    ...config
  });
}
function unregisterScenario(id) {
  scenarios.delete(id);
}
function getScenario(id) {
  return scenarios.get(id) || null;
}
function getAllScenarios() {
  return Array.from(scenarios.values());
}
function getAutoTriggerScenarios(context) {
  return getAllScenarios().filter((s) => {
    if (!s.trigger || s.trigger.type !== "auto") return false;
    if (typeof s.trigger.when === "function") return !!s.trigger.when(context);
    return false;
  });
}

// onboarding/core/progress.js
function defaultProgress() {
  return {
    engineVersion: 1,
    completed: {},
    // scenarioId -> version completed
    active: null,
    // { scenarioId, stepId } | null
    seenFeatures: [],
    // featureIds shown via showFeature()
    checklist: {
      expense: false,
      income: false,
      category: false,
      budget: false,
      analytics: false,
      goal: false,
      export: false
    },
    demo: { active: false, prompted: false, createdAt: null }
  };
}
function createProgressStore(getProfile, setProfile) {
  const read = () => ({ ...defaultProgress(), ...getProfile().onboarding || {} });
  const write = (patch) => {
    const profile = getProfile();
    const next = { ...read(), ...patch };
    setProfile({ ...profile, onboarding: next });
    return next;
  };
  return {
    get: read,
    setActive(active) {
      return write({ active });
    },
    isCompleted(scenarioId, version) {
      const cur = read();
      return (cur.completed[scenarioId] || 0) >= version;
    },
    markCompleted(scenarioId, version) {
      const cur = read();
      return write({ completed: { ...cur.completed, [scenarioId]: version }, active: null });
    },
    markFeatureSeen(featureId) {
      const cur = read();
      if (cur.seenFeatures.includes(featureId)) return cur;
      return write({ seenFeatures: [...cur.seenFeatures, featureId] });
    },
    hasSeenFeature(featureId) {
      return read().seenFeatures.includes(featureId);
    },
    updateChecklist(key, value = true) {
      const cur = read();
      if (cur.checklist[key] === value) return cur;
      return write({ checklist: { ...cur.checklist, [key]: value } });
    },
    /** Reset one scenario's completion (undefined id = reset everything). */
    reset(scenarioId) {
      const cur = read();
      if (!scenarioId) return write(defaultProgress());
      const completed = { ...cur.completed };
      delete completed[scenarioId];
      const active = cur.active && cur.active.scenarioId === scenarioId ? null : cur.active;
      return write({ completed, active });
    },
    setDemo(demoPatch) {
      const cur = read();
      return write({ demo: { ...cur.demo, ...demoPatch } });
    }
  };
}

// onboarding/core/engine.js
function shallowMatches(payload, match) {
  if (!payload) return false;
  return Object.entries(match).every(([k, v]) => payload[k] === v);
}
async function callHook(step, hookName, ctx) {
  const hook = step && step[hookName];
  if (typeof hook !== "function") return;
  try {
    await hook(ctx);
  } catch (e) {
    console.error(`Onboarding: ${hookName} hook failed for step "${step.id}":`, e);
  }
}
function createEngine(progressStore, bus, ctx = {}) {
  const subscribers = /* @__PURE__ */ new Set();
  let stepUnsub = null;
  let paused = false;
  let local = progressStore.get();
  const notify = () => subscribers.forEach((fn) => fn(getState()));
  function getState() {
    return { active: local.active, paused, completed: local.completed, checklist: local.checklist, demo: local.demo };
  }
  function setActive(active) {
    local = { ...local, active };
    progressStore.setActive(active);
  }
  function markCompleted(scenarioId, version) {
    local = { ...local, completed: { ...local.completed, [scenarioId]: version }, active: null };
    progressStore.markCompleted(scenarioId, version);
  }
  function isCompleted(scenarioId, version) {
    return (local.completed[scenarioId] || 0) >= version;
  }
  function clearStepListener() {
    if (stepUnsub) {
      stepUnsub();
      stepUnsub = null;
    }
  }
  const completionArmers = {
    event(step, scenarioId) {
      stepUnsub = bus.on(step.completeWhen.event, (payload) => {
        const match = step.completeWhen.match;
        if (match && !shallowMatches(payload, match)) return;
        advance(scenarioId, step.id);
      });
    },
    action() {
    },
    manual() {
    }
  };
  function armCompletion(step, scenarioId) {
    clearStepListener();
    const kind = step.completeWhen && step.completeWhen.type;
    const armer = kind && completionArmers[kind];
    if (armer) armer(step, scenarioId);
  }
  async function enterStep(scenario, step) {
    await callHook(step, "beforeEnter", ctx);
    paused = false;
    setActive({ scenarioId: scenario.id, stepId: step.id });
    armCompletion(step, scenario.id);
    notify();
    await callHook(step, "afterEnter", ctx);
  }
  async function start(scenarioId, opts = {}) {
    const scenario = getScenario(scenarioId);
    if (!scenario) {
      console.warn(`Onboarding: unknown scenario "${scenarioId}"`);
      return;
    }
    if (!opts.force && isCompleted(scenarioId, scenario.version)) return;
    const firstStep = scenario.steps[0];
    await enterStep(scenario, firstStep);
  }
  async function advance(scenarioId, fromStepId) {
    const scenario = getScenario(scenarioId);
    if (!scenario) return;
    const step = scenario.steps.find((s) => s.id === fromStepId);
    if (!step) return;
    await callHook(step, "beforeLeave", ctx);
    clearStepListener();
    const nextId = step.nextStep;
    const nextStep = nextId && scenario.steps.find((s) => s.id === nextId);
    if (!nextStep) {
      markCompleted(scenarioId, scenario.version);
      notify();
      await callHook(step, "afterLeave", ctx);
      return;
    }
    await enterStep(scenario, nextStep);
    await callHook(step, "afterLeave", ctx);
  }
  function skip(scenarioId, stepId) {
    const step = getScenario(scenarioId)?.steps.find((s) => s.id === stepId);
    if (step && step.optional) advance(scenarioId, stepId);
  }
  function pause() {
    paused = true;
    clearStepListener();
    notify();
  }
  function resume() {
    if (!local.active) return;
    paused = false;
    const scenario = getScenario(local.active.scenarioId);
    const step = scenario && scenario.steps.find((s) => s.id === local.active.stepId);
    if (step) armCompletion(step, local.active.scenarioId);
    notify();
  }
  function complete() {
    if (local.active) {
      const scenario = getScenario(local.active.scenarioId);
      markCompleted(local.active.scenarioId, scenario ? scenario.version : 1);
    }
    clearStepListener();
    notify();
  }
  function reset(scenarioId) {
    clearStepListener();
    if (!scenarioId) {
      local = { ...local, completed: {}, active: null };
    } else {
      const completed = { ...local.completed };
      delete completed[scenarioId];
      const active = local.active && local.active.scenarioId === scenarioId ? null : local.active;
      local = { ...local, completed, active };
    }
    progressStore.reset(scenarioId);
    notify();
  }
  function showFeature(featureId) {
    if (local.seenFeatures.includes(featureId)) return;
    local = { ...local, seenFeatures: [...local.seenFeatures, featureId] };
    progressStore.markFeatureSeen(featureId);
    notify();
  }
  function refreshFromStorage() {
    local = progressStore.get();
  }
  function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }
  return { start, advance, skip, pause, resume, complete, reset, showFeature, getState, subscribe, refreshFromStorage };
}

// onboarding/scenarios/first-launch.js
var first_launch_default = {
  id: "first-launch",
  version: 2,
  trigger: {
    type: "auto",
    // ctx = { getAppState, getProfile } supplied by the host at init time.
    when: (ctx) => {
      const state = ctx.getAppState ? ctx.getAppState() : null;
      const profile = ctx.getProfile ? ctx.getProfile() : null;
      const demoResolved = !!(profile && profile.onboarding && profile.onboarding.demo && profile.onboarding.demo.prompted);
      return !!state && state.transactions.length === 0 && state.accounts.length <= 1 && demoResolved;
    }
  },
  steps: [
    {
      id: "welcome",
      title: "onboarding_fl_welcome_title",
      description: "onboarding_fl_welcome_desc",
      target: null,
      placement: "center",
      completeWhen: { type: "action" },
      actionLabel: "onboarding_fl_welcome_action",
      nextStep: "open-add-form"
    },
    {
      id: "open-add-form",
      title: "onboarding_fl_expense_title",
      description: "onboarding_fl_expense_desc",
      target: '[data-tour="add-transaction-btn"]',
      placement: "bottom",
      completeWhen: { type: "event", event: "transaction_form_opened" },
      beforeEnter: () => {
        if (window.__kopiqoSetTab) window.__kopiqoSetTab("calendar");
      },
      nextStep: "pick-type"
    },
    {
      id: "pick-type",
      title: "onboarding_fl_type_title",
      description: "onboarding_fl_type_desc",
      target: '[data-tour="tx-type-toggle"]',
      placement: "bottom",
      completeWhen: { type: "event", event: "transaction_type_selected" },
      nextStep: "enter-amount"
    },
    {
      id: "enter-amount",
      title: "onboarding_fl_amount_title",
      description: "onboarding_fl_amount_desc",
      target: '[data-tour="tx-amount-input"]',
      placement: "auto",
      completeWhen: { type: "event", event: "transaction_amount_entered" },
      nextStep: "submit-transaction"
    },
    {
      id: "submit-transaction",
      title: "onboarding_fl_submit_title",
      description: "onboarding_fl_submit_desc",
      target: '[data-tour="tx-submit-btn"]',
      placement: "top",
      completeWhen: { type: "event", event: "transaction_created" },
      nextStep: "goto-categories"
    },
    {
      id: "goto-categories",
      title: "onboarding_fl_categories_title",
      description: "onboarding_fl_categories_desc",
      target: '[data-tour="nav-budgets"]',
      placement: "auto",
      completeWhen: { type: "event", event: "tab_opened", match: { tab: "budgets" } },
      nextStep: "categories-list-tour"
    },
    {
      id: "categories-list-tour",
      title: "onboarding_fl_catlist_title",
      description: "onboarding_fl_catlist_desc",
      target: '[data-tour="category-list"]',
      placement: "auto",
      completeWhen: { type: "action" },
      actionLabel: "onboarding_got_it",
      nextStep: "categories-add-tour"
    },
    {
      id: "categories-add-tour",
      title: "onboarding_fl_catadd_title",
      description: "onboarding_fl_catadd_desc",
      target: '[data-tour="add-category-btn"]',
      placement: "auto",
      completeWhen: { type: "action" },
      actionLabel: "onboarding_got_it",
      nextStep: "goto-analytics"
    },
    {
      id: "goto-analytics",
      title: "onboarding_fl_analytics_title",
      description: "onboarding_fl_analytics_desc",
      target: '[data-tour="nav-analytics"]',
      placement: "auto",
      completeWhen: { type: "event", event: "analytics_opened" },
      nextStep: "analytics-overview-tour"
    },
    {
      id: "analytics-overview-tour",
      title: "onboarding_fl_an_overview_title",
      description: "onboarding_fl_an_overview_desc",
      target: '[data-tour="analytics-tab-overview"]',
      placement: "auto",
      completeWhen: { type: "action" },
      actionLabel: "onboarding_got_it",
      nextStep: "analytics-categories-tour"
    },
    {
      id: "analytics-categories-tour",
      title: "onboarding_fl_an_categories_title",
      description: "onboarding_fl_an_categories_desc",
      target: '[data-tour="analytics-tab-categories"]',
      placement: "auto",
      completeWhen: { type: "action" },
      actionLabel: "onboarding_got_it",
      nextStep: "analytics-forecast-tour"
    },
    {
      id: "analytics-forecast-tour",
      title: "onboarding_fl_an_forecast_title",
      description: "onboarding_fl_an_forecast_desc",
      target: '[data-tour="analytics-tab-forecast"]',
      placement: "auto",
      completeWhen: { type: "action" },
      actionLabel: "onboarding_got_it",
      nextStep: "done"
    },
    {
      id: "done",
      title: "onboarding_fl_done_title",
      description: "onboarding_fl_done_desc",
      target: null,
      placement: "center",
      completeWhen: { type: "action" },
      actionLabel: "onboarding_fl_done_action"
      // no nextStep -> engine marks the scenario completed
    }
  ]
};

// onboarding/scenarios/analytics-tour.js
var analytics_tour_default = {
  id: "analytics-tour",
  version: 1,
  trigger: { type: "manual" },
  steps: [
    {
      id: "open-analytics",
      title: "onboarding_at_open_title",
      description: "onboarding_at_open_desc",
      target: '[data-tour="nav-analytics"]',
      placement: "top",
      completeWhen: { type: "event", event: "analytics_opened" },
      nextStep: "explain-sections"
    },
    {
      id: "explain-sections",
      title: "onboarding_at_sections_title",
      description: "onboarding_at_sections_desc",
      target: null,
      placement: "center",
      completeWhen: { type: "action" },
      actionLabel: "onboarding_got_it"
      // no nextStep -> scenario completes
    }
  ]
};

// onboarding/scenarios/index.js
function registerAllScenarios() {
  registerScenario(first_launch_default);
  registerScenario(analytics_tour_default);
}

// onboarding/demo/generateDemoData.js
var SAVINGS_ACCOUNT_ID = "acc_demo_savings";
var SUBS_CATEGORY_ID = "cat_demo_subs";
var GOAL_ID = "goal_demo_vacation";
var seed = 42;
function rnd() {
  seed = seed * 1103515245 + 12345 & 2147483647;
  return seed / 2147483647;
}
function between(min, max) {
  return Math.round(min + rnd() * (max - min));
}
function pad(n) {
  return String(n).padStart(2, "0");
}
function dateStr(y, mo, d) {
  return `${y}-${pad(mo + 1)}-${pad(d)}`;
}
function mkId(tag) {
  return `demo_${tag}_${Math.floor(rnd() * 1e9).toString(36)}`;
}
function mkTx(type, category, amount, y, mo, d, note, accountId) {
  return { id: mkId("tx"), type, category, amount, date: dateStr(y, mo, d), note, accountId, demoSeed: true };
}
function generateDemoData(now = /* @__PURE__ */ new Date()) {
  const transactions = [];
  const MAIN = "acc_default";
  for (let m = 3; m >= 0; m--) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const y = monthDate.getFullYear(), mo = monthDate.getMonth();
    const daysInThisMonth = new Date(y, mo + 1, 0).getDate();
    const upTo = m === 0 ? now.getDate() : daysInThisMonth;
    if (upTo >= 5) transactions.push(mkTx("income", "salary", between(93e3, 97e3), y, mo, 5, "\u0417\u0430\u0440\u043F\u043B\u0430\u0442\u0430", MAIN));
    if (upTo >= 1) transactions.push(mkTx("expense", "housing", 35e3, y, mo, 1, "\u0410\u0440\u0435\u043D\u0434\u0430", MAIN));
    if (upTo >= 3) transactions.push(mkTx("expense", SUBS_CATEGORY_ID, 799, y, mo, 3, "\u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0438", MAIN));
    for (let d = 2; d <= upTo; d += 4) transactions.push(mkTx("expense", "food", between(700, 2200), y, mo, d, "\u041F\u0440\u043E\u0434\u0443\u043A\u0442\u044B", MAIN));
    for (let d = 3; d <= upTo; d += 6) transactions.push(mkTx("expense", "transport", between(250, 600), y, mo, d, "\u0422\u0440\u0430\u043D\u0441\u043F\u043E\u0440\u0442", MAIN));
    if (upTo >= 14) transactions.push(mkTx("expense", "fun", between(1200, 3e3), y, mo, 14, "\u0420\u0430\u0437\u0432\u043B\u0435\u0447\u0435\u043D\u0438\u044F", MAIN));
    if (upTo >= 20) transactions.push(mkTx("expense", "shopping", between(1500, 4e3), y, mo, 20, "\u041F\u043E\u043A\u0443\u043F\u043A\u0438", MAIN));
    if (upTo >= 6) {
      const xferId = mkId("xfer");
      transactions.push({ id: mkId("tx"), type: "expense", amount: 1e4, category: "transfer", date: dateStr(y, mo, 6), note: "", accountId: MAIN, transferId: xferId, demoSeed: true });
      transactions.push({ id: mkId("tx"), type: "income", amount: 1e4, category: "transfer", date: dateStr(y, mo, 6), note: "", accountId: SAVINGS_ACCOUNT_ID, transferId: xferId, demoSeed: true });
    }
  }
  return {
    accounts: [{ id: SAVINGS_ACCOUNT_ID, name: "\u041D\u0430\u043A\u043E\u043F\u043B\u0435\u043D\u0438\u044F", icon: "target", color: "#8FAFC2", demoSeed: true }],
    customCategories: [{ id: SUBS_CATEGORY_ID, name: "\u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0438", icon: "smartphone", color: "#BE9BB8", spendType: "monthly", demoSeed: true }],
    transactions,
    recurringTemplates: [
      { id: mkId("rt"), active: true, type: "expense", category: "housing", amount: 35e3, dayOfMonth: 1, accountId: MAIN, note: "\u0410\u0440\u0435\u043D\u0434\u0430", demoSeed: true },
      { id: mkId("rt"), active: true, type: "income", category: "salary", amount: 95e3, dayOfMonth: 5, accountId: MAIN, note: "\u0417\u0430\u0440\u043F\u043B\u0430\u0442\u0430", demoSeed: true }
    ],
    budgets: { [MAIN]: { food: 25e3, transport: 8e3, fun: 6e3, shopping: 1e4, housing: 35e3, [SUBS_CATEGORY_ID]: 1e3 } },
    goals: [{ id: GOAL_ID, name: "\u041E\u0442\u043F\u0443\u0441\u043A", targetRub: 15e4, accountId: SAVINGS_ACCOUNT_ID, icon: "plane", color: "#8FAFC2", demoSeed: true }]
  };
}

// onboarding/ui/Overlay.js
import React2, { useState, useEffect as useEffect2, useRef as useRef2, useCallback as useCallback2 } from "react";

// onboarding/ui/Spotlight.js
import React, { useRef, useEffect, useCallback } from "react";

// onboarding/core/findVisibleTarget.js
function findVisibleTarget(selector) {
  const candidates = document.querySelectorAll(selector);
  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return el;
  }
  return candidates[0] || null;
}

// onboarding/core/isActuallyVisible.js
function isActuallyVisible(el) {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const vw = window.innerWidth, vh = window.innerHeight;
  const points = [
    [r.left + r.width / 2, r.top + r.height / 2],
    [r.left + Math.min(4, r.width / 4), r.top + Math.min(4, r.height / 4)],
    [r.right - Math.min(4, r.width / 4), r.top + Math.min(4, r.height / 4)],
    [r.left + Math.min(4, r.width / 4), r.bottom - Math.min(4, r.height / 4)],
    [r.right - Math.min(4, r.width / 4), r.bottom - Math.min(4, r.height / 4)]
  ];
  let sampled = 0;
  let hits = 0;
  for (const [x, y] of points) {
    if (x < 0 || y < 0 || x > vw || y > vh) continue;
    sampled++;
    const hit = document.elementFromPoint(x, y);
    if (hit && (hit === el || el.contains(hit))) hits++;
  }
  if (sampled === 0) return false;
  return hits / sampled >= 0.4;
}

// onboarding/ui/Spotlight.js
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var DIM = "rgba(20, 20, 15, 0.55)";
var SETTLE_DELAY_MS = 220;
function Spotlight({ rect, targetSelector, hasTarget, padding = 8, radius = 12, duration = 300, reducedMotion, viewport, insets }) {
  const topRef = useRef(null);
  const bottomRef = useRef(null);
  const leftRef = useRef(null);
  const rightRef = useRef(null);
  const ringRef = useRef(null);
  const hiddenRef = useRef(false);
  const safeTop = insets && insets.top || 0;
  const safeBottom = insets && insets.bottom || 0;
  const setPieceVisible = (visible) => {
    [topRef, bottomRef, leftRef, rightRef, ringRef].forEach((r) => {
      if (r.current) r.current.style.display = visible ? "" : "none";
    });
  };
  const applyGeometry = useCallback((r) => {
    const vv = window.visualViewport;
    const vw = vv ? vv.width : window.innerWidth;
    const vh = vv ? vv.height : window.innerHeight;
    const ox = vv ? vv.offsetLeft : 0, oy = vv ? vv.offsetTop : 0;
    const rawTop = r.top - oy, rawLeft = r.left - ox;
    const cutTop = Math.max(rawTop - padding, safeTop);
    const cutLeft = rawLeft - padding;
    const cutWidth = r.width + padding * 2;
    const cutBottom = Math.min(rawTop - padding + r.height + padding * 2, vh - safeBottom);
    const cutRight = cutLeft + cutWidth;
    const rowHeight = Math.max(0, cutBottom - cutTop);
    if (topRef.current) Object.assign(topRef.current.style, { top: "0px", left: "0px", width: vw + "px", height: Math.max(0, cutTop) + "px" });
    if (bottomRef.current) Object.assign(bottomRef.current.style, { top: cutBottom + "px", left: "0px", width: vw + "px", height: Math.max(0, vh - cutBottom) + "px" });
    if (leftRef.current) Object.assign(leftRef.current.style, { top: cutTop + "px", left: "0px", width: Math.max(0, cutLeft) + "px", height: rowHeight + "px" });
    if (rightRef.current) Object.assign(rightRef.current.style, { top: cutTop + "px", left: cutRight + "px", width: Math.max(0, vw - cutRight) + "px", height: rowHeight + "px" });
    if (ringRef.current) Object.assign(ringRef.current.style, { top: cutTop + "px", left: cutLeft + "px", width: cutWidth + "px", height: rowHeight + "px" });
  }, [padding, safeTop, safeBottom]);
  useEffect(() => {
    if (!rect) return;
    const el = targetSelector ? findVisibleTarget(targetSelector) : null;
    if (el && !isActuallyVisible(el)) {
      hiddenRef.current = true;
      setPieceVisible(false);
      return;
    }
    hiddenRef.current = false;
    setPieceVisible(true);
    applyGeometry(rect);
  }, [rect, applyGeometry, targetSelector]);
  useEffect(() => {
    if (!targetSelector) return;
    let raf = null;
    let settleTimer = null;
    const update = () => {
      const el = findVisibleTarget(targetSelector);
      raf = null;
      if (!el) return;
      if (!isActuallyVisible(el)) {
        if (!hiddenRef.current) {
          hiddenRef.current = true;
          setPieceVisible(false);
        }
      } else {
        if (hiddenRef.current) {
          hiddenRef.current = false;
          setPieceVisible(true);
        }
        if (ringRef.current) ringRef.current.style.transition = "none";
        applyGeometry(el.getBoundingClientRect());
      }
    };
    const scheduleSettleCheck = () => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        const el = findVisibleTarget(targetSelector);
        if (!el) return;
        if (!isActuallyVisible(el)) {
          el.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center", inline: "nearest" });
        }
      }, SETTLE_DELAY_MS);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
      scheduleSettleCheck();
    };
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", schedule);
      vv.addEventListener("scroll", schedule);
    }
    return () => {
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      if (vv) {
        vv.removeEventListener("resize", schedule);
        vv.removeEventListener("scroll", schedule);
      }
      if (raf) cancelAnimationFrame(raf);
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, [targetSelector, applyGeometry, reducedMotion]);
  if (!rect) {
    if (hasTarget) return null;
    return /* @__PURE__ */ jsx(
      "div",
      {
        style: {
          position: "fixed",
          inset: 0,
          background: DIM,
          zIndex: 1e5,
          transition: reducedMotion ? "none" : `opacity ${duration}ms ease`
        }
      }
    );
  }
  const ringTransition = reducedMotion ? "none" : `top ${duration}ms ease, left ${duration}ms ease, width ${duration}ms ease, height ${duration}ms ease`;
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx("div", { ref: topRef, style: { position: "fixed", background: DIM, zIndex: 1e5 } }),
    /* @__PURE__ */ jsx("div", { ref: bottomRef, style: { position: "fixed", background: DIM, zIndex: 1e5 } }),
    /* @__PURE__ */ jsx("div", { ref: leftRef, style: { position: "fixed", background: DIM, zIndex: 1e5 } }),
    /* @__PURE__ */ jsx("div", { ref: rightRef, style: { position: "fixed", background: DIM, zIndex: 1e5 } }),
    /* @__PURE__ */ jsx(
      "div",
      {
        ref: ringRef,
        style: {
          position: "fixed",
          borderRadius: radius,
          boxShadow: "0 0 0 2px rgba(255,255,255,0.55), 0 0 24px rgba(255,255,255,0.25)",
          zIndex: 1e5,
          pointerEvents: "none",
          transition: ringTransition
        }
      }
    )
  ] });
}

// onboarding/core/ensureVisible.js
function ensureVisible(el, opts = {}) {
  return new Promise((resolve) => {
    if (!el) {
      resolve();
      return;
    }
    if (isActuallyVisible(el)) {
      resolve();
      return;
    }
    el.scrollIntoView({ behavior: opts.reducedMotion ? "auto" : "smooth", block: "center", inline: "nearest" });
    setTimeout(resolve, opts.reducedMotion ? 0 : 350);
  });
}

// onboarding/ui/placement.js
var GAP = 12;
var EDGE_MARGIN = 8;
var NARROW_SCREEN_MAX = 480;
function clampWithin(value, size, min, max) {
  return Math.min(Math.max(min, value), Math.max(min, max - size));
}
function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
function computePlacement(rect, cardSize, requested, viewport, insets) {
  const vw = viewport ? viewport.width : typeof window !== "undefined" ? window.innerWidth : 0;
  const vh = viewport ? viewport.height : typeof window !== "undefined" ? window.innerHeight : 0;
  const safeTop = insets && insets.top || 0;
  const safeBottom = insets && insets.bottom || 0;
  const minY = EDGE_MARGIN + safeTop;
  const maxY = vh - safeBottom - EDGE_MARGIN;
  const minX = EDGE_MARGIN;
  const maxX = vw - EDGE_MARGIN;
  if (!rect) {
    return { placement: "center", top: clampWithin(vh / 2 - cardSize.height / 2, cardSize.height, minY, maxY), left: clampWithin(vw / 2 - cardSize.width / 2, cardSize.width, minX, maxX) };
  }
  const isNarrow = vw <= NARROW_SCREEN_MAX;
  let placement = requested;
  if (!placement || placement === "auto") {
    const space = {
      top: rect.top - safeTop,
      bottom: vh - safeBottom - rect.bottom,
      ...isNarrow ? {} : { left: rect.left, right: vw - rect.right }
    };
    placement = Object.entries(space).sort((a, b) => b[1] - a[1])[0][0];
  } else if (isNarrow && (placement === "left" || placement === "right")) {
    placement = rect.top - safeTop > vh - safeBottom - rect.bottom ? "top" : "bottom";
  }
  let top, left;
  if (placement === "bottom") {
    top = rect.bottom + GAP;
    left = clampWithin(rect.left + rect.width / 2 - cardSize.width / 2, cardSize.width, minX, maxX);
  } else if (placement === "top") {
    top = rect.top - cardSize.height - GAP;
    left = clampWithin(rect.left + rect.width / 2 - cardSize.width / 2, cardSize.width, minX, maxX);
  } else if (placement === "left") {
    left = rect.left - cardSize.width - GAP;
    top = clampWithin(rect.top + rect.height / 2 - cardSize.height / 2, cardSize.height, minY, maxY);
  } else if (placement === "right") {
    left = rect.right + GAP;
    top = clampWithin(rect.top + rect.height / 2 - cardSize.height / 2, cardSize.height, minY, maxY);
  } else {
    top = vh / 2 - cardSize.height / 2;
    left = vw / 2 - cardSize.width / 2;
  }
  top = clampWithin(top, cardSize.height, minY, maxY);
  left = clampWithin(left, cardSize.width, minX, maxX);
  const cardBox = { top, bottom: top + cardSize.height, left, right: left + cardSize.width };
  if (rectsOverlap(cardBox, { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right })) {
    const spaceAbove = rect.top - safeTop;
    const spaceBelow = vh - safeBottom - rect.bottom;
    if (spaceAbove >= cardSize.height || spaceAbove >= spaceBelow) {
      top = Math.max(safeTop + EDGE_MARGIN, rect.top - cardSize.height - GAP);
    } else {
      top = Math.min(vh - safeBottom - cardSize.height - EDGE_MARGIN, rect.bottom + GAP);
    }
  }
  return { placement, top, left };
}

// onboarding/core/safeInsets.js
var MAX_INSET = 90;
function getSafeInsets() {
  let top = 0;
  let bottom = 0;
  const candidates = document.querySelectorAll("body *");
  for (const el of candidates) {
    const style = window.getComputedStyle(el);
    if (style.position !== "fixed" && style.position !== "sticky") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 1 || rect.height > MAX_INSET) continue;
    if (Math.abs(rect.top) <= 2 && rect.width >= window.innerWidth * 0.5) {
      top = Math.max(top, rect.height);
    }
    if (Math.abs(window.innerHeight - rect.bottom) <= 2 && rect.width >= window.innerWidth * 0.5) {
      bottom = Math.max(bottom, rect.height);
    }
  }
  return { top: Math.min(top, MAX_INSET), bottom: Math.min(bottom, MAX_INSET) };
}

// onboarding/ui/Overlay.js
import { Fragment as Fragment2, jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
var cardStyle = (top, left, visible, reducedMotion) => ({
  position: "fixed",
  top,
  left,
  width: "min(320px, calc(100vw - 24px))",
  boxSizing: "border-box",
  background: "var(--surface)",
  color: "var(--ink)",
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 16,
  boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
  zIndex: 100001,
  fontFamily: "'Inter', sans-serif",
  opacity: visible ? 1 : 0,
  transition: reducedMotion ? "none" : "opacity 200ms ease, top 300ms ease, left 300ms ease"
});
var primaryBtnStyle = { background: "var(--sage-fill)", color: "#FFFFFF", border: "none", borderRadius: 8, padding: "11px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Inter', sans-serif", minHeight: 40 };
var skipBtnStyle = { background: "none", border: "none", color: "var(--muted)", fontSize: 14, cursor: "pointer", fontFamily: "'Inter', sans-serif", padding: "11px 6px", minHeight: 40 };
var closeBtnStyle = { background: "none", border: "1px solid var(--border)", borderRadius: 8, color: "var(--muted)", fontSize: 16, cursor: "pointer", lineHeight: 1, width: 34, height: 34, flexShrink: 0, fontFamily: "'Inter', sans-serif" };
function OnboardingOverlay({ engine, getScenario: getScenario2, t }) {
  const translate = typeof t === "function" ? t : (s) => s;
  const [state, setState] = useState(() => engine.getState());
  const [rect, setRect] = useState(null);
  const rectForStepRef = useRef2(null);
  const insufficientlyVisibleRef = useRef2(false);
  const [cardSize, setCardSize] = useState({ width: 320, height: 140 });
  const measuredForStepRef = useRef2(null);
  const cardRef = useRef2(null);
  const reducedMotion = prefersReducedMotion();
  useEffect2(() => engine.subscribe(setState), [engine]);
  const active = state.active;
  const scenario = active ? getScenario2(active.scenarioId) : null;
  const step = scenario ? scenario.steps.find((s) => s.id === active.stepId) : null;
  const recomputeRect = useCallback2(() => {
    if (!step || !step.target) {
      rectForStepRef.current = step ? step.id : null;
      setRect(null);
      return;
    }
    const el = findVisibleTarget(step.target);
    if (!el) {
      rectForStepRef.current = step.id;
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const vv2 = window.visualViewport;
    const ox = vv2 ? vv2.offsetLeft : 0, oy = vv2 ? vv2.offsetTop : 0;
    insufficientlyVisibleRef.current = !isActuallyVisible(el);
    rectForStepRef.current = step.id;
    setRect({ top: r.top - oy, bottom: r.bottom - oy, left: r.left - ox, right: r.right - ox, width: r.width, height: r.height });
  }, [step]);
  useEffect2(() => {
    if (rectForStepRef.current !== (step && step.id)) {
      rectForStepRef.current = step ? "__pending__" : null;
      setRect(null);
    }
  }, [step]);
  useEffect2(() => {
    if (!step) return;
    let cancelled = false;
    (async () => {
      if (step.target) {
        const el = findVisibleTarget(step.target);
        await ensureVisible(el, { reducedMotion });
      }
      if (!cancelled) recomputeRect();
    })();
    return () => {
      cancelled = true;
    };
  }, [step, recomputeRect, reducedMotion]);
  useEffect2(() => {
    if (!step) return;
    let raf = null;
    const scheduleRecompute = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        recomputeRect();
        raf = null;
      });
    };
    window.addEventListener("resize", scheduleRecompute);
    window.addEventListener("scroll", scheduleRecompute, true);
    const vv2 = window.visualViewport;
    if (vv2) {
      vv2.addEventListener("resize", scheduleRecompute);
      vv2.addEventListener("scroll", scheduleRecompute);
    }
    return () => {
      window.removeEventListener("resize", scheduleRecompute);
      window.removeEventListener("scroll", scheduleRecompute, true);
      if (vv2) {
        vv2.removeEventListener("resize", scheduleRecompute);
        vv2.removeEventListener("scroll", scheduleRecompute);
      }
      if (raf) cancelAnimationFrame(raf);
    };
  }, [step, recomputeRect]);
  useEffect2(() => {
    if (!step || !cardRef.current) return;
    const r = cardRef.current.getBoundingClientRect();
    if (r.width && r.height) {
      const changed = Math.abs(r.width - cardSize.width) > 1 || Math.abs(r.height - cardSize.height) > 1;
      if (changed || measuredForStepRef.current !== step.id) {
        measuredForStepRef.current = step.id;
        setCardSize({ width: r.width, height: r.height });
      }
    }
  });
  useEffect2(() => {
    if (!step) return;
    const raf = requestAnimationFrame(() => {
      if (cardRef.current) cardRef.current.focus();
    });
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        engine.pause();
        return;
      }
      if (e.key === "Tab" && cardRef.current) {
        const focusables = cardRef.current.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])');
        if (focusables.length === 0) return;
        const first = focusables[0], last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [step, engine]);
  if (!step || state.paused) return null;
  const spotlightCfg = step.spotlight || {};
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  const viewport = vv ? { width: vv.width, height: vv.height } : { width: window.innerWidth, height: window.innerHeight };
  const insets = getSafeInsets();
  const placement = computePlacement(rect, cardSize, step.placement, viewport, insets);
  const waitingOnTarget = !!step.target && (rect === null || rectForStepRef.current !== step.id || insufficientlyVisibleRef.current);
  const notYetMeasured = measuredForStepRef.current !== step.id;
  const showPrimaryAction = step.completeWhen && step.completeWhen.type !== "event";
  return /* @__PURE__ */ jsxs2(Fragment2, { children: [
    /* @__PURE__ */ jsx2(
      Spotlight,
      {
        rect,
        targetSelector: step.target,
        hasTarget: !!step.target,
        padding: spotlightCfg.padding ?? 8,
        radius: spotlightCfg.radius ?? 12,
        duration: reducedMotion ? 0 : spotlightCfg.duration ?? 300,
        reducedMotion,
        viewport,
        insets
      }
    ),
    /* @__PURE__ */ jsxs2(
      "div",
      {
        ref: cardRef,
        role: "dialog",
        "aria-labelledby": "gb-onboarding-title",
        "aria-describedby": "gb-onboarding-desc",
        tabIndex: -1,
        style: cardStyle(placement.top, placement.left, !waitingOnTarget && !notYetMeasured, reducedMotion),
        children: [
          /* @__PURE__ */ jsx2("h3", { id: "gb-onboarding-title", style: { margin: "0 0 6px", fontSize: 15, fontWeight: 700 }, children: translate(step.title) }),
          /* @__PURE__ */ jsx2("p", { id: "gb-onboarding-desc", style: { margin: "0 0 14px", fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }, children: translate(step.description) }),
          /* @__PURE__ */ jsxs2("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }, children: [
            step.optional && /* @__PURE__ */ jsx2("button", { type: "button", onClick: () => engine.skip(active.scenarioId, step.id), style: skipBtnStyle, children: translate("onboarding_skip") }),
            showPrimaryAction && /* @__PURE__ */ jsx2("button", { type: "button", autoFocus: true, onClick: () => engine.advance(active.scenarioId, step.id), style: primaryBtnStyle, children: translate(step.actionLabel || "onboarding_got_it") }),
            /* @__PURE__ */ jsx2("button", { type: "button", onClick: () => engine.pause(), "aria-label": translate("onboarding_close"), style: closeBtnStyle, children: "\xD7" })
          ] })
        ]
      }
    )
  ] });
}

// onboarding/ui/DemoPrompt.js
import React3 from "react";
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
var overlayStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 100001,
  background: "rgba(20, 20, 15, 0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20
};
var demoCardStyle = {
  background: "var(--surface)",
  color: "var(--ink)",
  borderRadius: 16,
  padding: 28,
  maxWidth: 440,
  width: "100%",
  boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
  fontFamily: "'Inter', sans-serif"
};
var optionStyle = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "14px 16px",
  marginTop: 10,
  background: "var(--surface2)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  color: "var(--ink)",
  cursor: "pointer",
  fontFamily: "'Inter', sans-serif"
};
var optionTitleStyle = { fontSize: 14, fontWeight: 700, marginBottom: 3 };
var optionDescStyle = { fontSize: 12, color: "var(--muted)" };
function DemoPrompt({ onChoice, t }) {
  const translate = typeof t === "function" ? t : (s) => s;
  return /* @__PURE__ */ jsx3("div", { style: overlayStyle, role: "dialog", "aria-labelledby": "gb-demo-title", children: /* @__PURE__ */ jsxs3("div", { style: demoCardStyle, children: [
    /* @__PURE__ */ jsx3("h2", { id: "gb-demo-title", style: { margin: "0 0 6px", fontSize: 18, fontWeight: 700 }, children: translate("onboarding_demo_title") }),
    /* @__PURE__ */ jsx3("p", { style: { margin: "0 0 4px", fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }, children: translate("onboarding_demo_subtitle") }),
    /* @__PURE__ */ jsxs3("button", { type: "button", style: optionStyle, onClick: () => onChoice("empty"), children: [
      /* @__PURE__ */ jsx3("div", { style: optionTitleStyle, children: translate("onboarding_demo_empty_title") }),
      /* @__PURE__ */ jsx3("div", { style: optionDescStyle, children: translate("onboarding_demo_empty_desc") })
    ] }),
    /* @__PURE__ */ jsxs3("button", { type: "button", style: optionStyle, onClick: () => onChoice("demo"), children: [
      /* @__PURE__ */ jsx3("div", { style: optionTitleStyle, children: translate("onboarding_demo_seed_title") }),
      /* @__PURE__ */ jsx3("div", { style: optionDescStyle, children: translate("onboarding_demo_seed_desc") })
    ] })
  ] }) });
}

// onboarding/ui/DevPanel.js
import React4, { useState as useState2, useEffect as useEffect3 } from "react";
import { jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
var panelStyle = {
  position: "fixed",
  top: 0,
  right: 0,
  bottom: 0,
  width: "min(340px, 100vw)",
  zIndex: 100002,
  background: "var(--surface)",
  color: "var(--ink)",
  borderLeft: "1px solid var(--border)",
  boxShadow: "-12px 0 30px rgba(0,0,0,0.25)",
  padding: 16,
  overflowY: "auto",
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 12
};
var sectionTitle = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--sage-text)", margin: "16px 0 8px" };
var rowStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border)" };
var btnStyle = { background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--ink)", cursor: "pointer", padding: "3px 8px", fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" };
var dangerBtnStyle = { ...btnStyle, color: "var(--rose-text)", borderColor: "var(--rose-fill)" };
var pre = { background: "var(--surface2)", borderRadius: 8, padding: 10, fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 180, overflowY: "auto" };
function DevPanel({ api, bus }) {
  const [open, setOpen] = useState2(false);
  const [, forceTick] = useState2(0);
  useEffect3(() => bus.on("__dev_panel_toggle", (payload) => {
    if (payload && payload.force === "open") setOpen(true);
    else if (payload && payload.force === "close") setOpen(false);
    else setOpen((v) => !v);
  }), [bus]);
  useEffect3(() => {
    if (!open) return;
    const id = setInterval(() => forceTick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [open]);
  if (!open) return null;
  const state = api.getState();
  return /* @__PURE__ */ jsxs4("div", { style: panelStyle, children: [
    /* @__PURE__ */ jsxs4("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [
      /* @__PURE__ */ jsx4("b", { style: { fontSize: 13 }, children: "Onboarding Dev Panel" }),
      /* @__PURE__ */ jsx4("button", { type: "button", style: btnStyle, onClick: () => setOpen(false), children: "\xD7" })
    ] }),
    /* @__PURE__ */ jsx4("div", { style: sectionTitle, children: "\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0439 \u0448\u0430\u0433" }),
    /* @__PURE__ */ jsx4("div", { children: state.active ? `${state.active.scenarioId} \u2192 ${state.active.stepId}` : "\u2014" }),
    /* @__PURE__ */ jsx4("div", { style: sectionTitle, children: "\u0421\u0446\u0435\u043D\u0430\u0440\u0438\u0438" }),
    state.registeredScenarios.map((s) => /* @__PURE__ */ jsxs4("div", { style: rowStyle, children: [
      /* @__PURE__ */ jsxs4("span", { children: [
        s.id,
        " ",
        /* @__PURE__ */ jsxs4("span", { style: { color: "var(--muted)" }, children: [
          "v",
          s.version,
          " \xB7 ",
          s.steps,
          " \u0448\u0430\u0433(\u043E\u0432)"
        ] })
      ] }),
      /* @__PURE__ */ jsxs4("span", { style: { display: "flex", gap: 4 }, children: [
        /* @__PURE__ */ jsx4("button", { type: "button", style: btnStyle, onClick: () => api.start(s.id, { force: true }), children: "\u0417\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C" }),
        /* @__PURE__ */ jsx4("button", { type: "button", style: dangerBtnStyle, onClick: () => api.reset(s.id), children: "\u0421\u0431\u0440\u043E\u0441" })
      ] })
    ] }, s.id)),
    /* @__PURE__ */ jsx4("div", { style: sectionTitle, children: "\u0417\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u043E" }),
    /* @__PURE__ */ jsx4("pre", { style: pre, children: JSON.stringify(state.completed, null, 2) }),
    /* @__PURE__ */ jsx4("div", { style: sectionTitle, children: "\u0427\u0435\u043A-\u043B\u0438\u0441\u0442" }),
    /* @__PURE__ */ jsx4("pre", { style: pre, children: JSON.stringify(state.checklist, null, 2) }),
    /* @__PURE__ */ jsx4("div", { style: sectionTitle, children: "Demo" }),
    /* @__PURE__ */ jsx4("pre", { style: pre, children: JSON.stringify(state.demo, null, 2) }),
    /* @__PURE__ */ jsx4("button", { type: "button", style: { ...dangerBtnStyle, width: "100%", marginTop: 16, padding: 8 }, onClick: () => api.reset(), children: "\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u0432\u0435\u0441\u044C \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441" })
  ] });
}

// onboarding/index.js
function initOnboarding({ getProfile, setProfile, bus, getAppState, applyDemoData }) {
  registerAllScenarios();
  const progressStore = createProgressStore(getProfile, setProfile);
  const triggerCtx = { getProfile, getAppState };
  const engine = createEngine(progressStore, bus, { getProfile, setProfile, bus });
  const isEmptyAccount = () => {
    const state = getAppState ? getAppState() : null;
    return !!state && state.transactions.length === 0 && state.accounts.length <= 1;
  };
  const needsDemoPrompt = isEmptyAccount() && !progressStore.get().demo.prompted;
  function runAutoTrigger() {
    const existing = progressStore.get().active;
    if (existing && getScenario(existing.scenarioId)) {
      engine.resume();
      return;
    }
    if (existing) progressStore.setActive(null);
    const candidates = getAutoTriggerScenarios(triggerCtx);
    const next = candidates.find((s) => !progressStore.isCompleted(s.id, s.version));
    if (next) engine.start(next.id);
  }
  if (!needsDemoPrompt) {
    setTimeout(runAutoTrigger, 400);
  }
  function resolveDemoPrompt(choice) {
    progressStore.setDemo({ prompted: true });
    engine.refreshFromStorage();
    if (choice === "demo" && typeof applyDemoData === "function") {
      applyDemoData(generateDemoData());
      progressStore.setDemo({ active: true, createdAt: (/* @__PURE__ */ new Date()).toISOString() });
      getAllScenarios().forEach((s) => {
        if (s.id === "first-launch") progressStore.markCompleted(s.id, s.version);
      });
      engine.refreshFromStorage();
    } else {
      setTimeout(runAutoTrigger, 300);
    }
  }
  if (typeof document !== "undefined" && !document.__onboardingDevShortcutBound) {
    document.__onboardingDevShortcutBound = true;
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        bus.emit("__dev_panel_toggle", {});
      }
    });
  }
  return {
    start: engine.start,
    advance: engine.advance,
    skip: engine.skip,
    pause: engine.pause,
    resume: engine.resume,
    complete: engine.complete,
    reset: engine.reset,
    showFeature: engine.showFeature,
    subscribe: engine.subscribe,
    registerScenario,
    unregisterScenario,
    needsDemoPrompt,
    resolveDemoPrompt,
    devPanel: () => bus.emit("__dev_panel_toggle", { force: "open" }),
    closeDevPanel: () => bus.emit("__dev_panel_toggle", { force: "close" }),
    getState: () => ({
      loaded: true,
      ...engine.getState(),
      registeredScenarios: getAllScenarios().map((s) => ({ id: s.id, version: s.version, steps: s.steps.length }))
    }),
    // Exposed for the rendering layer (Stage 3) and Dev Panel (Stage 6) —
    // not part of the documented Developer API surface.
    _getScenario: getScenario,
    _engine: engine
  };
}
export {
  DemoPrompt,
  DevPanel,
  OnboardingOverlay,
  initOnboarding
};
