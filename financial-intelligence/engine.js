// ============================================================================
// financial-intelligence/engine.js — Statistics Engine + Pattern Engine.
//
// This is an EXTRACTION, not a rewrite: every calculation here was already
// live in production, duplicated in two places — inlined inside
// AnalyticsPanel in app.compiled.js (the in-app "Аналитика" tab) and again
// inside analytics.compiled.js (the standalone analytics.html tool). Both
// copies had drifted apart (app.compiled.js's had gained monthlyCatIds /
// categoryTypeOverrides support the standalone tool never got). This file
// is now the single source of truth; both callers import from here instead
// of keeping their own copy, so a future fix or new metric is written once.
//
// Covers most of the ТЗ's Statistics Engine (monthly income/expense series,
// category forecasts via damped Holt-Winters, budget risk, 6-month balance
// forecast, goal ETA, safe-per-day spend, savings rate) and Pattern Engine
// (recurring payment/subscription detection, category growth/decline
// "movers", anomalies via a per-category MAD-based robust z-score) in one
// pass, because in the original code these were never separate concerns —
// splitting them into two modules that each re-walk the same transaction
// list would cost real computation for no benefit. buildEngine's return
// value below serves as both StatisticsResult and PatternResult from the
// ТЗ: rule-engine.js reads whichever fields a given rule needs from it.
//
// @typedef {Object} StatisticsResult
// @property {Array} clean - all income/expense rows, transfers and
//   zero/invalid amounts already excluded, sorted by date ascending
// @property {Array} expenses - clean, filtered to type "expense"
// @property {Array} incomes - clean, filtered to type "income"
// @property {Array} monthly - one entry per calendar month seen, in
//   {mk, income, expense, net, cats, incCats} shape (mk = "YYYY-MM")
// @property {Array} closedMonths - monthly, excluding the current month
// @property {Object} cur - this month's entry from `monthly`
// @property {string} curMk - this month's key ("YYYY-MM")
// @property {number} dim - days in the current month
// @property {number} today - today's day-of-month
// @property {number} daysLeft - days remaining in the current month
// @property {number} dailyRate - mean daily expense over the last 56 days
// @property {number[]} weekdayCoef - 7 multipliers (Mon..Sun) capturing
//   which days of the week run above/below the daily average
// @property {number} eomForecast - projected total expense by month end
// @property {number} eomLow - low end of the ~80% forecast interval
// @property {number} eomHigh - high end of the ~80% forecast interval
// @property {Array} cumCurve - day-by-day cumulative spend, fact then
//   projected, with a [low, high] band for the projected portion
// @property {Array} catForecasts - one entry per expense category:
//   {cat, mtd, forecast, histMedian, limit, trend}
// @property {Array} budgetRisks - catForecasts entries that have a budget
//   limit, each with {ratio, status: "over"|"risk"|"warn"|"ok"} — this IS
//   a rule-like verdict already; rule-engine.js turns it into an Insight
//   rather than recomputing it
// @property {number} balance - current total balance across accounts
// @property {Array} balanceCurve - monthly balance, fact then 6-month
//   projection: {mk, fact?, proj?}
// @property {number} monthlyNetForecast - projected income−expense for
//   next month
// @property {Array} goalStats - per savings goal: {name, target, saved,
//   monthlyContrib, etaMonths, etaDate}
// @property {Array} anomalies - expense rows whose amount is a robust
//   outlier within their own category (MAD-based z-score > 3)
// @property {Array} detectedRecurring - {cat, note, amount, day,
//   monthsSeen, activeNow} for spending patterns repeating ≥3 months with a
//   stable amount and day-of-month — this is Kopiqo's subscription/regular
//   payment detector
// @property {number} recurringMonthly - sum of detectedRecurring entries
//   still active this month
// @property {number} safePerDay - remaining safe daily spend to stay within
//   budget for the rest of the month
// @property {number|null} savingsRate - (income−expense)/income over the
//   last 3 closed months, or null if there was no income
// @property {Array} movers - catForecasts entries whose forecast diverges
//   from their historical median by >20% and >500 units — the category
//   growth/decline signal from the ТЗ's Pattern Engine
// @property {number} incMed - median monthly income over recent history
// @property {Object} customCategories, budgets, recurringTemplates - passed
//   through from the input dataset for callers that need the raw shape
// ============================================================================

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const MONTHS_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
function parseDate(s) {
  const d = /* @__PURE__ */ new Date(s + "T00:00:00");
  return isNaN(d) ? null : d;
}
function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
function stdev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1));
}
function mad(arr) {
  const m = median(arr);
  return median(arr.map((v) => Math.abs(v - m)));
}
function holtDamped(series, horizon = 1, alpha = 0.5, beta = 0.3, phi = 0.85) {
  const s = series.filter((v) => Number.isFinite(v));
  if (s.length === 0) return Array(horizon).fill(0);
  if (s.length < 3) return Array(horizon).fill(median(s));
  let level = s[0];
  let trend = s[1] - s[0];
  for (let i = 1; i < s.length; i++) {
    const prevLevel = level;
    level = alpha * s[i] + (1 - alpha) * (level + phi * trend);
    trend = beta * (level - prevLevel) + (1 - beta) * phi * trend;
  }
  const out = [];
  let phiSum = 0;
  for (let h = 1; h <= horizon; h++) {
    phiSum += Math.pow(phi, h);
    out.push(Math.max(0, level + phiSum * trend));
  }
  return out;
}

/**
 * Turns the app's raw storage shape (or a { "finance:state": "<json>" }
 * wrapper, as seen from window.storage) into the flat dataset buildEngine
 * expects. `categoryTypeOverrides` lets a caller mark additional category
 * ids as "monthly" cadence beyond what customCategories already states.
 * @param {any} raw
 * @param {Object<string,string>} [categoryTypeOverrides]
 */
function normalizeDataset(raw, categoryTypeOverrides) {
  const src = raw || {};
  const state = src.transactions ? src : src["finance:state"] ? JSON.parse(src["finance:state"]) : src;
  const transactions = Array.isArray(state.transactions) ? state.transactions : [];
  let budgets = {};
  const rawB = state.budgets || {};
  const vals = Object.values(rawB);
  if (vals.length && typeof vals[0] === "object" && vals[0] !== null) {
    for (const perAcc of vals)
      for (const [cat, lim] of Object.entries(perAcc))
        budgets[cat] = (budgets[cat] || 0) + (Number(lim) || 0);
  } else {
    for (const [cat, lim] of Object.entries(rawB))
      budgets[cat] = Number(lim) || 0;
  }
  const custom = {};
  (state.customCategories || []).forEach((c) => {
    if (c && c.id)
      custom[c.id] = { name: c.name || c.id, color: c.color || "#ABA58F", spendType: c.spendType };
  });
  const monthlyCatIds = /* @__PURE__ */ new Set([
    ...Object.entries(custom).filter(([, c]) => c.spendType === "monthly").map(([id]) => id),
    ...Object.entries(categoryTypeOverrides || {}).filter(([, v]) => v === "monthly").map(([id]) => id)
  ]);
  return {
    transactions,
    budgets,
    customCategories: custom,
    accounts: state.accounts || [],
    goals: state.goals || [],
    debts: state.debts || [],
    recurringTemplates: state.recurringTemplates || [],
    monthlyCatIds
  };
}
function buildEngine(dataset, now) {
  const { transactions, budgets, customCategories, accounts, goals, recurringTemplates, monthlyCatIds: datasetMonthly } = dataset;
  const taggedMonthlyCatIds = datasetMonthly || /* @__PURE__ */ new Set();
  const clean = [];
  for (const t of transactions) {
    if (!t || t.transferId)
      continue;
    if (t.category === "transfer" || t.category === "account_deleted")
      continue;
    const d = parseDate(t.date);
    const amount = Number(t.amount);
    if (!d || !Number.isFinite(amount) || amount <= 0)
      continue;
    if (t.type !== "expense" && t.type !== "income")
      continue;
    clean.push({ ...t, d, amount, mk: monthKey(d) });
  }
  clean.sort((a, b) => a.d - b.d);
  const expenses = clean.filter((t) => t.type === "expense");
  const incomes = clean.filter((t) => t.type === "income");
  const monthSet = new Set(clean.map((t) => t.mk));
  const curMk = monthKey(now);
  monthSet.add(curMk);
  const months = [...monthSet].sort();
  const byMonth = {};
  months.forEach((mk) => byMonth[mk] = { mk, income: 0, expense: 0, cats: {}, incCats: {} });
  for (const t of clean) {
    const b = byMonth[t.mk];
    if (t.type === "expense") {
      b.expense += t.amount;
      b.cats[t.category] = (b.cats[t.category] || 0) + t.amount;
    } else {
      b.income += t.amount;
      b.incCats[t.category] = (b.incCats[t.category] || 0) + t.amount;
    }
  }
  const monthly = months.map((mk) => ({ ...byMonth[mk], net: byMonth[mk].income - byMonth[mk].expense }));
  const closedMonths = monthly.filter((m) => m.mk < curMk);
  const cur = byMonth[curMk];
  const allExpCatsEarly = [...new Set(closedMonths.flatMap((m) => Object.keys(m.cats)).concat(Object.keys(cur.cats)))];
  const stableCatIds = new Set(allExpCatsEarly.filter((cat) => {
    const hist = closedMonths.slice(-8).map((m) => m.cats[cat] || 0).filter((v) => v > 0);
    if (hist.length < 2) return false;
    const hMean = mean(hist), hStdev = stdev(hist);
    if (hMean <= 0) return false;
    if (hStdev / hMean < 0.35) return true;
    const limit = budgets[cat];
    return Number.isFinite(limit) && limit > 0 && Math.abs(hMean - limit) / limit < 0.25;
  }));
  const doneForMonthCatIds = new Set(allExpCatsEarly.filter((cat) => {
    const hist = closedMonths.slice(-8).map((m2) => m2.cats[cat] || 0).filter((v) => v > 0);
    const m = median(hist);
    return m > 0 && (cur.cats[cat] || 0) >= m * 0.75;
  }));
  const y = now.getFullYear(), mo = now.getMonth();
  const dim = daysInMonth(y, mo);
  const today = now.getDate();
  const daysLeft = dim - today;
  const dayTotals = {};
  const from56 = new Date(now);
  from56.setDate(from56.getDate() - 56);
  for (const t of expenses)
    if (t.d >= from56 && t.d <= now && !t.recurringId && !taggedMonthlyCatIds.has(t.category) && !stableCatIds.has(t.category) && !doneForMonthCatIds.has(t.category)) {
      dayTotals[t.date] = (dayTotals[t.date] || 0) + t.amount;
    }
  const dailySeries = [];
  const weekdaySums = Array(7).fill(0), weekdayCnt = Array(7).fill(0);
  for (let i = 0; i < 56; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const v = dayTotals[key] || 0;
    dailySeries.push(v);
    const wd = (d.getDay() + 6) % 7;
    weekdaySums[wd] += v;
    weekdayCnt[wd]++;
  }
  const baseDaily = median(dailySeries.filter((v) => v > 0)) || mean(dailySeries);
  const overallDailyMean = mean(dailySeries) || 1;
  const weekdayCoef = weekdaySums.map((s, i) => weekdayCnt[i] ? clamp(s / weekdayCnt[i] / overallDailyMean, 0.35, 2.2) : 1);
  const dailyRate = mean(dailySeries) || baseDaily;
  let restExpect = 0;
  for (let dd = today + 1; dd <= dim; dd++) {
    const wd = (new Date(y, mo, dd).getDay() + 6) % 7;
    restExpect += dailyRate * weekdayCoef[wd];
  }
  const sigmaDay = stdev(dailySeries);
  const corridor = 1.28 * sigmaDay * Math.sqrt(Math.max(daysLeft, 0));
  const upcomingRecurring = (recurringTemplates || []).filter((rt) => {
    if (!rt.active || rt.type !== "expense" || rt.dayOfMonth <= today)
      return false;
    return !expenses.some((t) => t.recurringId === rt.id && t.mk === curMk);
  });
  const upcomingRecurringTotal = upcomingRecurring.reduce((s, rt) => s + rt.amount, 0);
  const eomForecast = cur.expense + restExpect + upcomingRecurringTotal;
  const eomLow = Math.max(cur.expense, eomForecast - corridor);
  const eomHigh = eomForecast + corridor;
  const cumCurve = [];
  let acc = 0;
  const spentByDay = {};
  for (const t of expenses)
    if (t.mk === curMk) {
      const dd = t.d.getDate();
      spentByDay[dd] = (spentByDay[dd] || 0) + t.amount;
    }
  for (let dd = 1; dd <= dim; dd++) {
    if (dd <= today) {
      acc += spentByDay[dd] || 0;
      cumCurve.push({ day: dd, fact: Math.round(acc) });
    } else {
      const prev = cumCurve[cumCurve.length - 1];
      const base = prev.proj != null ? prev.proj : prev.fact;
      const wd = (new Date(y, mo, dd).getDay() + 6) % 7;
      const step = dailyRate * weekdayCoef[wd];
      const proj = base + step;
      const frac = Math.sqrt((dd - today) / Math.max(daysLeft, 1));
      cumCurve.push({
        day: dd,
        proj: Math.round(proj),
        band: [Math.round(Math.max(acc, proj - corridor * frac)), Math.round(proj + corridor * frac)]
      });
    }
  }
  if (daysLeft > 0 && cumCurve[today - 1])
    cumCurve[today - 1].proj = cumCurve[today - 1].fact;
  const recurringCatIds = new Set((recurringTemplates || []).filter((rt) => rt.active && rt.type === "expense").map((rt) => rt.category));
  const allExpCats = [...new Set(expenses.map((t) => t.category))];
  const catForecasts = allExpCats.map((cat) => {
    const series = closedMonths.slice(-8).map((m) => m.cats[cat] || 0);
    const holt = holtDamped(series, 1)[0];
    const mtd = cur.cats[cat] || 0;
    const isTaggedMonthly = taggedMonthlyCatIds.has(cat);
    const histValsEarly = series.filter((v) => v > 0);
    const histMedianEarly = median(histValsEarly);
    const isFixedMonthly = isTaggedMonthly || recurringCatIds.has(cat) || stableCatIds.has(cat) || doneForMonthCatIds.has(cat);
    if (isFixedMonthly) {
      const limit2 = budgets[cat];
      const histVals2 = histValsEarly;
      const forecast2 = Math.max(mtd, histMedianEarly || holt);
      return { cat, mtd, forecast: forecast2, histMedian: histMedianEarly, limit: Number.isFinite(limit2) && limit2 > 0 ? limit2 : null, trend: 0, isFixed: true };
    }
    const pace = today >= 5 ? mtd / today * dim : holt;
    const w = clamp(today / dim, 0.15, 0.85);
    const forecast = Math.max(mtd, w * pace + (1 - w) * holt);
    const limit = budgets[cat];
    const histVals = series.filter((v) => v > 0);
    return {
      cat,
      mtd,
      forecast,
      histMedian: median(histVals),
      limit: Number.isFinite(limit) && limit > 0 ? limit : null,
      trend: series.length >= 4 ? mean(series.slice(-2)) - mean(series.slice(0, 2)) : 0,
      isFixed: false
    };
  }).sort((a, b) => b.forecast - a.forecast);
  const budgetRisks = catForecasts.filter((c) => c.limit && !c.isFixed).map((c) => {
    const ratio = c.forecast / c.limit;
    const status = c.mtd > c.limit ? "over" : ratio > 1 ? "risk" : ratio > 0.85 ? "warn" : "ok";
    return { ...c, ratio, status };
  }).sort((a, b) => b.ratio - a.ratio);
  let balance = (accounts || []).reduce((s, a) => s + (Number(a.balance) || 0), 0);
  const hasAccBalances = (accounts || []).some((a) => Number.isFinite(Number(a.balance)));
  if (!hasAccBalances)
    balance = clean.reduce((s, t) => s + (t.type === "income" ? t.amount : -t.amount), 0);
  const incSeries = closedMonths.slice(-8).map((m) => m.income);
  const expSeries = closedMonths.slice(-8).map((m) => m.expense);
  const incForecasts = holtDamped(incSeries, 6);
  const expForecasts = holtDamped(expSeries, 6);
  const incMed = median(incSeries.filter((v) => v > 0));
  const balanceCurve = [];
  const histTail = closedMonths.slice(-5);
  let run = balance;
  let backAcc = balance - (cur.income - cur.expense);
  const histPoints = [];
  for (let i = histTail.length - 1; i >= 0; i--) {
    histPoints.unshift({ mk: histTail[i].mk, value: backAcc });
    backAcc -= histTail[i].net;
  }
  histPoints.forEach((p) => balanceCurve.push({ mk: p.mk, fact: Math.round(p.value) }));
  balanceCurve.push({ mk: curMk, fact: Math.round(balance), proj: Math.round(balance) });
  run = balance + Math.max(0, incMed - cur.income) - restExpect;
  const projMonths = [];
  for (let h = 1; h <= 6; h++) {
    const d = new Date(y, mo + h, 1);
    projMonths.push(monthKey(d));
  }
  balanceCurve[balanceCurve.length - 1].proj = Math.round(balance);
  let runVal = run;
  projMonths.forEach((mk, i) => {
    if (i > 0)
      runVal += (incForecasts[i] || incMed) - (expForecasts[i] || median(expSeries));
    balanceCurve.push({ mk, proj: Math.round(runVal) });
  });
  const monthlyNetForecast = (incForecasts[1] || incMed) - (expForecasts[1] || median(expSeries));
  const goalStats = (goals || []).map((g) => {
    const target = Number(g.targetAmount || g.target || 0);
    const acc2 = (accounts || []).find((a) => a.id === g.accountId);
    let saved = Number(g.currentAmount);
    if (!Number.isFinite(saved))
      saved = acc2 ? Number(acc2.balance) || 0 : 0;
    const inflows = transactions.filter((t) => t.accountId === g.accountId && t.type === "income" && parseDate(t.date));
    const perMonth = {};
    inflows.forEach((t) => {
      const mk = monthKey(parseDate(t.date));
      perMonth[mk] = (perMonth[mk] || 0) + Number(t.amount || 0);
    });
    const contribs = Object.entries(perMonth).filter(([mk]) => mk < curMk).map(([, v]) => v);
    let monthlyContrib = median(contribs);
    if (!monthlyContrib && monthlyNetForecast > 0)
      monthlyContrib = monthlyNetForecast * 0.5;
    const left = Math.max(0, target - saved);
    const etaMonths = monthlyContrib > 0 ? Math.ceil(left / monthlyContrib) : null;
    let etaDate = null;
    if (etaMonths != null && etaMonths < 240) {
      const d = new Date(y, mo + etaMonths, 1);
      etaDate = `${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`;
    }
    return { name: g.name || g.title || "\u0426\u0435\u043B\u044C", target, saved, monthlyContrib, etaMonths, etaDate };
  }).filter((g) => g.target > 0);
  const anomalies = [];
  for (const cat of allExpCats) {
    const txs = expenses.filter((t) => t.category === cat);
    if (txs.length < 6)
      continue;
    const amounts = txs.map((t) => t.amount);
    const m = median(amounts), md = mad(amounts) || stdev(amounts) / 1.4826 || 1;
    for (const t of txs.slice(-120)) {
      const z = (t.amount - m) / (1.4826 * md);
      if (z > 3 && t.amount > m * 2)
        anomalies.push({ ...t, z, catMedian: m });
    }
  }
  anomalies.sort((a, b) => b.d - a.d);
  const recGroups = {};
  for (const t of expenses) {
    const key = `${t.category}|${(t.note || "").trim().toLowerCase()}`;
    (recGroups[key] = recGroups[key] || []).push(t);
  }
  const detectedRecurring = [];
  for (const [key, txs] of Object.entries(recGroups)) {
    const byMk = {};
    txs.forEach((t) => {
      (byMk[t.mk] = byMk[t.mk] || []).push(t);
    });
    const mks = Object.keys(byMk).sort();
    if (mks.length < 3)
      continue;
    // A recurring payment is ONE charge per month. Without this check the
    // month totals of a group with several operations a month (e.g. 1-3
    // transfers to the same person, different amounts each time) can be
    // stable enough to pass the spread test — and the reported "amount" is
    // then a median of monthly SUMS, i.e. a payment that never actually
    // happened. Confirmed against real data.
    if (!mks.every((mk) => byMk[mk].length === 1))
      continue;
    const monthAmounts = mks.map((mk) => byMk[mk].reduce((s, t) => s + t.amount, 0));
    const m = median(monthAmounts);
    const spread = mad(monthAmounts) / (m || 1);
    const days = mks.map((mk) => byMk[mk][0].d.getDate());
    const daySpread = mad(days);
    if (spread < 0.12 && daySpread <= 4 && m > 0) {
      const [cat] = key.split("|");
      const lastMk = mks[mks.length - 1];
      detectedRecurring.push({
        cat,
        // Original casing from the transaction itself — the group key is
        // lowercased for matching, but "Совкомбанк" should not surface to
        // the user as "совкомбанк".
        note: txs[0].note || "",
        amount: m,
        day: Math.round(median(days)),
        monthsSeen: mks.length,
        activeNow: lastMk >= monthKey(new Date(y, mo - 1, 1))
      });
    }
  }
  detectedRecurring.sort((a, b) => b.amount - a.amount);
  const recurringMonthly = detectedRecurring.filter((r) => r.activeNow).reduce((s, r) => s + r.amount, 0);
  const limitSum = Object.values(budgets).reduce((s, v) => s + v, 0);
  const monthEnvelope = limitSum > 0 ? limitSum : incMed > 0 ? incMed * 0.9 : eomForecast;
  const safePerDay = daysLeft > 0 ? Math.max(0, (monthEnvelope - cur.expense) / daysLeft) : 0;
  const last3 = closedMonths.slice(-3);
  const savingsRate = (() => {
    const inc = last3.reduce((s, m) => s + m.income, 0);
    const exp = last3.reduce((s, m) => s + m.expense, 0);
    return inc > 0 ? (inc - exp) / inc : null;
  })();
  const movers = catForecasts.filter((c) => c.histMedian > 0).map((c) => ({ ...c, deltaPct: (c.forecast - c.histMedian) / c.histMedian })).filter((c) => Math.abs(c.deltaPct) > 0.2 && Math.abs(c.forecast - c.histMedian) > 500).sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct)).slice(0, 4);
  return {
    clean,
    expenses,
    incomes,
    monthly,
    closedMonths,
    cur,
    curMk,
    dim,
    today,
    daysLeft,
    dailyRate,
    weekdayCoef,
    eomForecast,
    eomLow,
    eomHigh,
    cumCurve,
    catForecasts,
    budgetRisks,
    balance,
    balanceCurve,
    monthlyNetForecast,
    goalStats,
    anomalies,
    detectedRecurring,
    recurringMonthly,
    safePerDay,
    savingsRate,
    movers,
    incMed,
    customCategories,
    budgets,
    recurringTemplates
  };
}

export { monthKey, MONTHS_RU, parseDate, daysInMonth, clamp, median, mean, stdev, mad, holtDamped, normalizeDataset, buildEngine };
