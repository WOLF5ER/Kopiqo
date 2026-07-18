import React, { useState, useMemo, useEffect } from "react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, Area, Legend, ReferenceLine, } from "recharts";
/* ============================================================================
   Kopiqo Analytics — анализатор и прогнозатор.
   Понимает формат finance:state приложения Kopiqo:
   { transactions, budgets, customCategories, accounts, goals, debts,
     recurringTemplates } — включая переводы (transferId), маркеры удалённых
   счетов (category: "account_deleted") и лимиты по категориям.
   ========================================================================== */
/* ------------------------------- Константы ------------------------------- */
const CAT_META = {
    food: { name: "Еда", color: "#D9A85C" },
    transport: { name: "Транспорт", color: "#8FAFC2" },
    housing: { name: "Жильё", color: "#BE9BB8" },
    fun: { name: "Развлечения", color: "#84AC96" },
    health: { name: "Здоровье", color: "#D69A91" },
    shopping: { name: "Покупки", color: "#C8B27C" },
    other_exp: { name: "Прочее", color: "#ABA58F" },
    salary: { name: "Зарплата", color: "#75A084" },
    freelance: { name: "Фриланс", color: "#8FAFC2" },
    gift: { name: "Подарки", color: "#BE9BB8" },
    other_inc: { name: "Другой доход", color: "#ABA58F" },
};
const MONTHS_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const WEEKDAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const C = {
    bg: "#F3EEE3", card: "#FBF8F0", cardSoft: "#F7F2E7",
    ink: "#45412F", muted: "#8C8875", line: "#E4DCC9",
    sage: "#9AC1A7", sageDark: "#75A084",
    clay: "#D9695C", amber: "#D9A85C", blue: "#8FAFC2", plum: "#BE9BB8",
};
/* --------------------------- Утилиты и статистика -------------------------- */
const fmtMoney = (v, cur = "₽") => {
    const n = Math.round(v);
    const s = Math.abs(n).toLocaleString("ru-RU");
    return `${n < 0 ? "−" : ""}${s} ${cur}`;
};
const fmtShort = (v) => {
    const a = Math.abs(v);
    if (a >= 1e6)
        return (v / 1e6).toFixed(1).replace(".", ",") + " млн";
    if (a >= 1e3)
        return Math.round(v / 1e3) + " тыс";
    return String(Math.round(v));
};
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const parseDate = (s) => { const d = new Date(s + "T00:00:00"); return isNaN(d) ? null : d; };
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const median = (arr) => {
    if (!arr.length)
        return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
const stdev = (arr) => {
    if (arr.length < 2)
        return 0;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1));
};
const mad = (arr) => {
    const m = median(arr);
    return median(arr.map((v) => Math.abs(v - m)));
};
/* Прогноз Хольта с затуханием тренда (damped trend). Устойчив на коротких
   рядах: при <3 точках откатывается на медиану. */
function holtDamped(series, horizon = 1, alpha = 0.5, beta = 0.3, phi = 0.85) {
    const s = series.filter((v) => Number.isFinite(v));
    if (s.length === 0)
        return Array(horizon).fill(0);
    if (s.length < 3)
        return Array(horizon).fill(median(s));
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
/* ------------------------- Нормализация данных Kopiqo ----------------------- */
function normalizeDataset(raw) {
    const src = raw || {};
    const state = src.transactions ? src : (src["finance:state"] ? JSON.parse(src["finance:state"]) : src);
    const transactions = Array.isArray(state.transactions) ? state.transactions : [];
    // Бюджеты: либо { category: limit }, либо { accountId: { category: limit } }.
    let budgets = {};
    const rawB = state.budgets || {};
    const vals = Object.values(rawB);
    if (vals.length && typeof vals[0] === "object" && vals[0] !== null) {
        for (const perAcc of vals)
            for (const [cat, lim] of Object.entries(perAcc))
                budgets[cat] = (budgets[cat] || 0) + (Number(lim) || 0);
    }
    else {
        for (const [cat, lim] of Object.entries(rawB))
            budgets[cat] = Number(lim) || 0;
    }
    const custom = {};
    (state.customCategories || []).forEach((c) => {
        if (c && c.id)
            custom[c.id] = { name: c.name || c.id, color: c.color || "#ABA58F" };
    });
    return {
        transactions,
        budgets,
        customCategories: custom,
        accounts: state.accounts || [],
        goals: state.goals || [],
        debts: state.debts || [],
        recurringTemplates: state.recurringTemplates || [],
    };
}
const catName = (id, custom) => (CAT_META[id] && CAT_META[id].name) || (custom[id] && custom[id].name) || id;
const catColor = (id, custom) => (CAT_META[id] && CAT_META[id].color) || (custom[id] && custom[id].color) || "#ABA58F";
/* --------------------------------- Движок --------------------------------- */
function buildEngine(dataset, now) {
    const { transactions, budgets, customCategories, accounts, goals, recurringTemplates } = dataset;
    // Чистый поток: без переводов между счетами и без служебных маркеров.
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
    /* --- Месячные ряды --- */
    const monthSet = new Set(clean.map((t) => t.mk));
    const curMk = monthKey(now);
    monthSet.add(curMk);
    const months = [...monthSet].sort();
    const byMonth = {};
    months.forEach((mk) => (byMonth[mk] = { mk, income: 0, expense: 0, cats: {}, incCats: {} }));
    for (const t of clean) {
        const b = byMonth[t.mk];
        if (t.type === "expense") {
            b.expense += t.amount;
            b.cats[t.category] = (b.cats[t.category] || 0) + t.amount;
        }
        else {
            b.income += t.amount;
            b.incCats[t.category] = (b.incCats[t.category] || 0) + t.amount;
        }
    }
    const monthly = months.map((mk) => ({ ...byMonth[mk], net: byMonth[mk].income - byMonth[mk].expense }));
    const closedMonths = monthly.filter((m) => m.mk < curMk); // завершённые месяцы
    const cur = byMonth[curMk];
    /* --- Текущий месяц: темп, прогноз до конца месяца --- */
    const y = now.getFullYear(), mo = now.getMonth();
    const dim = daysInMonth(y, mo);
    const today = now.getDate();
    const daysLeft = dim - today;
    // Дневные расходы за последние 56 дней (для устойчивого темпа и недельного профиля).
    const dayTotals = {}; // 'YYYY-MM-DD' -> sum
    const from56 = new Date(now);
    from56.setDate(from56.getDate() - 56);
    for (const t of expenses)
        if (t.d >= from56 && t.d <= now) {
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
        const wd = (d.getDay() + 6) % 7; // Пн=0
        weekdaySums[wd] += v;
        weekdayCnt[wd]++;
    }
    const baseDaily = median(dailySeries.filter((v) => v > 0)) || mean(dailySeries);
    const overallDailyMean = mean(dailySeries) || 1;
    const weekdayCoef = weekdaySums.map((s, i) => weekdayCnt[i] ? clamp((s / weekdayCnt[i]) / overallDailyMean, 0.35, 2.2) : 1);
    const dailyRate = mean(dailySeries) || baseDaily;
    // Прогноз до конца месяца: факт + ожидание по оставшимся дням с учётом дня недели.
    let restExpect = 0;
    for (let dd = today + 1; dd <= dim; dd++) {
        const wd = (new Date(y, mo, dd).getDay() + 6) % 7;
        restExpect += dailyRate * weekdayCoef[wd];
    }
    const sigmaDay = stdev(dailySeries);
    const corridor = 1.28 * sigmaDay * Math.sqrt(Math.max(daysLeft, 0)); // ~80% интервал
    const eomForecast = cur.expense + restExpect;
    const eomLow = Math.max(cur.expense, eomForecast - corridor);
    const eomHigh = eomForecast + corridor;
    // Кумулятивная кривая месяца: факт и прогнозная лента.
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
        }
        else {
            const prev = cumCurve[cumCurve.length - 1];
            const base = (prev.proj != null ? prev.proj : prev.fact);
            const wd = (new Date(y, mo, dd).getDay() + 6) % 7;
            const step = dailyRate * weekdayCoef[wd];
            const proj = base + step;
            const frac = Math.sqrt((dd - today) / Math.max(daysLeft, 1));
            cumCurve.push({
                day: dd, proj: Math.round(proj),
                band: [Math.round(Math.max(acc, proj - corridor * frac)), Math.round(proj + corridor * frac)],
            });
        }
    }
    // сшивка линий на сегодняшнем дне
    if (daysLeft > 0 && cumCurve[today - 1])
        cumCurve[today - 1].proj = cumCurve[today - 1].fact;
    /* --- Прогноз по категориям (Хольт по завершённым месяцам + текущий темп) --- */
    const allExpCats = [...new Set(expenses.map((t) => t.category))];
    const catForecasts = allExpCats.map((cat) => {
        const series = closedMonths.slice(-8).map((m) => m.cats[cat] || 0);
        const holt = holtDamped(series, 1)[0];
        const mtd = cur.cats[cat] || 0;
        // темп текущего месяца, растянутый на весь месяц (с защитой в начале месяца)
        const pace = today >= 5 ? (mtd / today) * dim : holt;
        const w = clamp(today / dim, 0.15, 0.85); // чем дальше месяц, тем больше вес факта
        const forecast = Math.max(mtd, w * pace + (1 - w) * holt);
        const limit = budgets[cat];
        const histVals = series.filter((v) => v > 0);
        return {
            cat, mtd, forecast,
            histMedian: median(histVals),
            limit: Number.isFinite(limit) && limit > 0 ? limit : null,
            trend: series.length >= 4 ? mean(series.slice(-2)) - mean(series.slice(0, 2)) : 0,
        };
    }).sort((a, b) => b.forecast - a.forecast);
    const budgetRisks = catForecasts
        .filter((c) => c.limit)
        .map((c) => {
        const ratio = c.forecast / c.limit;
        const status = c.mtd > c.limit ? "over" : ratio > 1 ? "risk" : ratio > 0.85 ? "warn" : "ok";
        return { ...c, ratio, status };
    })
        .sort((a, b) => b.ratio - a.ratio);
    /* --- Баланс и прогноз на 6 месяцев --- */
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
    // восстановим баланс на начало хвоста истории
    let backAcc = balance - (cur.income - cur.expense);
    const histPoints = [];
    for (let i = histTail.length - 1; i >= 0; i--) {
        histPoints.unshift({ mk: histTail[i].mk, value: backAcc });
        backAcc -= histTail[i].net;
    }
    histPoints.forEach((p) => balanceCurve.push({ mk: p.mk, fact: Math.round(p.value) }));
    balanceCurve.push({ mk: curMk, fact: Math.round(balance), proj: Math.round(balance) });
    // остаток текущего месяца
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
    /* --- Цели: срок достижения --- */
    const goalStats = (goals || []).map((g) => {
        const target = Number(g.targetAmount || g.target || 0);
        const acc2 = (accounts || []).find((a) => a.id === g.accountId);
        let saved = Number(g.currentAmount);
        if (!Number.isFinite(saved))
            saved = acc2 ? Number(acc2.balance) || 0 : 0;
        // средний месячный прирост: переводы на счёт цели за последние месяцы
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
        return { name: g.name || g.title || "Цель", target, saved, monthlyContrib, etaMonths, etaDate };
    }).filter((g) => g.target > 0);
    /* --- Аномалии: робастный z-скор по MAD внутри категории --- */
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
    /* --- Повторяющиеся платежи: ≥3 месяцев, похожая сумма и день --- */
    const recGroups = {};
    for (const t of expenses) {
        const key = `${t.category}|${(t.note || "").trim().toLowerCase()}`;
        (recGroups[key] = recGroups[key] || []).push(t);
    }
    const detectedRecurring = [];
    for (const [key, txs] of Object.entries(recGroups)) {
        const byMk = {};
        txs.forEach((t) => { (byMk[t.mk] = byMk[t.mk] || []).push(t); });
        const mks = Object.keys(byMk).sort();
        if (mks.length < 3)
            continue;
        const monthAmounts = mks.map((mk) => byMk[mk].reduce((s, t) => s + t.amount, 0));
        const m = median(monthAmounts);
        const spread = mad(monthAmounts) / (m || 1);
        const days = mks.map((mk) => byMk[mk][0].d.getDate());
        const daySpread = mad(days);
        if (spread < 0.12 && daySpread <= 4 && m > 0) {
            const [cat, note] = key.split("|");
            const lastMk = mks[mks.length - 1];
            detectedRecurring.push({
                cat, note, amount: m, day: Math.round(median(days)),
                monthsSeen: mks.length, activeNow: lastMk >= monthKey(new Date(y, mo - 1, 1)),
            });
        }
    }
    detectedRecurring.sort((a, b) => b.amount - a.amount);
    const recurringMonthly = detectedRecurring.filter((r) => r.activeNow).reduce((s, r) => s + r.amount, 0);
    /* --- Безопасный дневной лимит --- */
    const limitSum = Object.values(budgets).reduce((s, v) => s + v, 0);
    const monthEnvelope = limitSum > 0 ? limitSum : incMed > 0 ? incMed * 0.9 : eomForecast;
    const safePerDay = daysLeft > 0 ? Math.max(0, (monthEnvelope - cur.expense) / daysLeft) : 0;
    /* --- Норма сбережений и динамика --- */
    const last3 = closedMonths.slice(-3);
    const savingsRate = (() => {
        const inc = last3.reduce((s, m) => s + m.income, 0);
        const exp = last3.reduce((s, m) => s + m.expense, 0);
        return inc > 0 ? (inc - exp) / inc : null;
    })();
    // Сравнение категорий: текущий прогноз vs медиана прошлых месяцев
    const movers = catForecasts
        .filter((c) => c.histMedian > 0)
        .map((c) => ({ ...c, deltaPct: (c.forecast - c.histMedian) / c.histMedian }))
        .filter((c) => Math.abs(c.deltaPct) > 0.2 && Math.abs(c.forecast - c.histMedian) > 500)
        .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
        .slice(0, 4);
    return {
        clean, expenses, incomes, monthly, closedMonths, cur, curMk,
        dim, today, daysLeft, dailyRate, weekdayCoef,
        eomForecast, eomLow, eomHigh, cumCurve,
        catForecasts, budgetRisks, balance, balanceCurve, monthlyNetForecast,
        goalStats, anomalies, detectedRecurring, recurringMonthly,
        safePerDay, savingsRate, movers, incMed,
        customCategories, budgets, recurringTemplates,
    };
}
/* ------------------------------ Демо-данные ------------------------------- */
function mulberry32(seed) {
    return function () {
        let t = (seed += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function makeDemo(now) {
    const rnd = mulberry32(20260717);
    const tx = [];
    let idc = 1;
    const push = (d, type, category, amount, note, accountId = "main") => tx.push({
        id: "d" + idc++, type, category, amount: Math.round(amount),
        date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
        note, accountId,
    });
    const start = new Date(now.getFullYear(), now.getMonth() - 7, 1);
    for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
        const day = d.getDate(), wd = (d.getDay() + 6) % 7;
        const mIdx = d.getMonth();
        // Доходы
        if (day === 5)
            push(d, "income", "salary", 78000 + rnd() * 4000, "Аванс");
        if (day === 20)
            push(d, "income", "salary", 92000 + rnd() * 5000, "Зарплата");
        if (day === 12 && rnd() < 0.6)
            push(d, "income", "freelance", 8000 + rnd() * 22000, "Проект");
        // Фиксированные
        if (day === 1)
            push(d, "expense", "housing", 42000, "Аренда");
        if (day === 3)
            push(d, "expense", "housing", 5200 + rnd() * 1800, "Коммуналка");
        if (day === 7)
            push(d, "expense", "fun", 599, "Подписка на музыку");
        if (day === 15)
            push(d, "expense", "health", 1490, "Спортзал");
        // Еда: будни чаще
        if (rnd() < (wd < 5 ? 0.85 : 0.6))
            push(d, "expense", "food", 400 + rnd() * 1400, "Продукты");
        if (wd >= 5 && rnd() < 0.5)
            push(d, "expense", "food", 1200 + rnd() * 1800, "Кафе");
        // Транспорт по будням
        if (wd < 5 && rnd() < 0.9)
            push(d, "expense", "transport", 120 + rnd() * 260, "Метро/такси");
        // Развлечения по выходным
        if (wd >= 5 && rnd() < 0.45)
            push(d, "expense", "fun", 800 + rnd() * 2500, "Выходные");
        // Покупки волнами (растут к концу истории)
        if (rnd() < 0.12)
            push(d, "expense", "shopping", (900 + rnd() * 4000) * (1 + mIdx / 18), "Маркетплейс");
        if (rnd() < 0.05)
            push(d, "expense", "health", 500 + rnd() * 2500, "Аптека");
        if (rnd() < 0.05)
            push(d, "expense", "other_exp", 300 + rnd() * 1500, "");
        // Взнос на цель
        if (day === 21)
            push(d, "income", "other_inc", 15000, "Взнос на отпуск", "vacation");
    }
    // Аномалии
    const a1 = new Date(now);
    a1.setDate(a1.getDate() - 9);
    push(a1, "expense", "shopping", 38900, "Новый телефон");
    const a2 = new Date(now);
    a2.setDate(a2.getDate() - 23);
    push(a2, "expense", "health", 14500, "Стоматолог");
    return {
        transactions: tx,
        budgets: { food: 32000, transport: 7000, fun: 14000, shopping: 15000, health: 8000 },
        customCategories: [],
        accounts: [
            { id: "main", name: "Основной", balance: 118400 },
            { id: "vacation", name: "Отпуск", balance: 105000 },
        ],
        goals: [{ id: "g1", name: "Отпуск на море", targetAmount: 180000, accountId: "vacation" }],
        debts: [],
        recurringTemplates: [
            { id: "r1", active: true, category: "fun", amount: 599, note: "Подписка на музыку", startMonth: "2026-01" },
        ],
    };
}
/* ================================ UI-детали ================================ */
const S = {
    page: {
        minHeight: "100vh", background: C.bg, color: C.ink,
        fontFamily: "'Avenir Next','Segoe UI',system-ui,-apple-system,sans-serif",
        padding: "0 0 64px",
    },
    wrap: { maxWidth: 1060, margin: "0 auto", padding: "0 20px" },
    card: {
        background: C.card, border: `1px solid ${C.line}`, borderRadius: 18,
        padding: "18px 20px", boxShadow: "0 1px 0 rgba(69,65,47,0.03)",
    },
    h2: { margin: "0 0 4px", fontSize: 16, fontWeight: 700, letterSpacing: "0.01em" },
    sub: { margin: 0, fontSize: 12.5, color: C.muted, lineHeight: 1.45 },
    num: { fontVariantNumeric: "tabular-nums" },
};
function Kpi({ label, value, hint, tone }) {
    const toneColor = tone === "good" ? C.sageDark : tone === "bad" ? C.clay : tone === "warn" ? "#B7801F" : C.ink;
    return (React.createElement("div", { style: { ...S.card, padding: "14px 18px", flex: "1 1 150px", minWidth: 150 } },
        React.createElement("div", { style: { fontSize: 11.5, color: C.muted, textTransform: "uppercase", letterSpacing: "0.07em" } }, label),
        React.createElement("div", { style: { ...S.num, fontSize: 22, fontWeight: 700, color: toneColor, margin: "4px 0 2px" } }, value),
        hint && React.createElement("div", { style: { fontSize: 12, color: C.muted } }, hint)));
}
function SectionTitle({ children, sub }) {
    return (React.createElement("div", { style: { margin: "30px 0 12px" } },
        React.createElement("h2", { style: { ...S.h2, fontSize: 17 } }, children),
        sub && React.createElement("p", { style: S.sub }, sub)));
}
function Progress({ value, color }) {
    return (React.createElement("div", { style: { height: 7, borderRadius: 4, background: C.cardSoft, overflow: "hidden", border: `1px solid ${C.line}` } },
        React.createElement("div", { style: { width: `${clamp(value * 100, 0, 100)}%`, height: "100%", background: color, borderRadius: 4, transition: "width .4s" } })));
}
function ChartTip({ active, payload, label, cur, labelFmt }) {
    if (!active || !payload || !payload.length)
        return null;
    return (React.createElement("div", { style: { background: "#FFFDF7", border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 12px", fontSize: 12.5 } },
        React.createElement("div", { style: { fontWeight: 700, marginBottom: 4 } }, labelFmt ? labelFmt(label) : label),
        payload.filter(p => p.value != null && p.dataKey !== "band").map((p, i) => (React.createElement("div", { key: i, style: { color: p.stroke || p.fill, ...S.num } },
            p.name,
            ": ",
            Array.isArray(p.value) ? `${fmtMoney(p.value[0], cur)} – ${fmtMoney(p.value[1], cur)}` : fmtMoney(p.value, cur))))));
}
const mkLabel = (mk) => {
    const [yy, mm] = mk.split("-").map(Number);
    return `${MONTHS_RU[mm - 1]} ’${String(yy).slice(2)}`;
};
/* ================================= Экраны ================================= */
function ImportScreen({ onLoad, error }) {
    const [text, setText] = useState("");
    return (React.createElement("div", { style: { ...S.wrap, paddingTop: 60, maxWidth: 640 } },
        React.createElement("div", { style: { textAlign: "center", marginBottom: 26 } },
            React.createElement("div", { style: {
                    width: 54, height: 54, borderRadius: 16, background: C.sage, margin: "0 auto 14px",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26,
                } }, "\u25D4"),
            React.createElement("h1", { style: { margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.01em" } }, "Kopiqo \u0410\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0430"),
            React.createElement("p", { style: { ...S.sub, fontSize: 14, marginTop: 6 } }, "\u0412 \u0432\u0430\u0448\u0435\u043C \u043E\u0431\u043B\u0430\u0447\u043D\u043E\u043C \u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0439 \u2014 \u0432\u0441\u0442\u0430\u0432\u044C\u0442\u0435 JSON \u0432\u0440\u0443\u0447\u043D\u0443\u044E \u0438\u043B\u0438 \u043F\u043E\u0441\u043C\u043E\u0442\u0440\u0438\u0442\u0435 \u0434\u0435\u043C\u043E")),
        React.createElement("div", { style: S.card },
            React.createElement("h2", { style: S.h2 }, "\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0441\u0432\u043E\u0438 \u0434\u0430\u043D\u043D\u044B\u0435"),
            React.createElement("p", { style: S.sub },
                "\u0412\u0441\u0442\u0430\u0432\u044C\u0442\u0435 JSON \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u044F Kopiqo \u2014 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u0435 \u043A\u043B\u044E\u0447\u0430 ",
                React.createElement("code", null, "finance:state"),
                " \u0438\u0437 localStorage (\u043A\u043B\u044E\u0447 \u0432\u0438\u0434\u0430 ",
                React.createElement("code", null, "kopiqo:<user_id>:finance:state"),
                ") \u0438\u043B\u0438 \u043F\u043E\u043B\u044F",
                " ",
                React.createElement("code", null, "data"),
                " \u0438\u0437 \u0442\u0430\u0431\u043B\u0438\u0446\u044B ",
                React.createElement("code", null, "finance_data"),
                " \u0432 Supabase."),
            React.createElement("textarea", { value: text, onChange: (e) => setText(e.target.value), placeholder: '{"transactions":[\u2026],"budgets":{\u2026},"accounts":[\u2026],"goals":[\u2026]}', spellCheck: false, style: {
                    width: "100%", boxSizing: "border-box", height: 130, marginTop: 12,
                    border: `1px solid ${C.line}`, borderRadius: 12, background: "#FFFDF7",
                    padding: 12, fontSize: 12, fontFamily: "ui-monospace,Menlo,monospace", color: C.ink, resize: "vertical",
                } }),
            error && React.createElement("div", { style: { color: C.clay, fontSize: 13, marginTop: 8 } }, error),
            React.createElement("div", { style: { display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" } },
                React.createElement("button", { onClick: () => onLoad(text), style: btnStyle(true) }, "\u041F\u0440\u043E\u0430\u043D\u0430\u043B\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u0442\u044C"),
                React.createElement("button", { onClick: () => onLoad(null), style: btnStyle(false) }, "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043D\u0430 \u0434\u0435\u043C\u043E-\u0434\u0430\u043D\u043D\u044B\u0445"))),
        React.createElement("p", { style: { ...S.sub, textAlign: "center", marginTop: 18 } }, "\u0412\u0441\u0435 \u0432\u044B\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u044F \u0432\u044B\u043F\u043E\u043B\u043D\u044F\u044E\u0442\u0441\u044F \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E \u0432 \u044D\u0442\u043E\u043C \u043E\u043A\u043D\u0435 \u2014 \u0434\u0430\u043D\u043D\u044B\u0435 \u043D\u0438\u043A\u0443\u0434\u0430 \u043D\u0435 \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u044F\u044E\u0442\u0441\u044F.")));
}
const btnStyle = (primary) => ({
    border: `1px solid ${primary ? C.sageDark : C.line}`,
    background: primary ? C.sage : "#FFFDF7",
    color: primary ? "#2F4636" : C.ink,
    borderRadius: 12, padding: "10px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer",
});
/* --------------------------------- Обзор ---------------------------------- */
function Overview({ E, cur }) {
    const m = E.monthly.slice(-8).map((x) => ({
        mk: x.mk, label: mkLabel(x.mk),
        Доход: Math.round(x.income), Расход: Math.round(x.expense), Итог: Math.round(x.net),
        isCur: x.mk === E.curMk,
    }));
    const sr = E.savingsRate;
    return (React.createElement(React.Fragment, null,
        React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginTop: 18 } },
            React.createElement(Kpi, { label: "\u0411\u0430\u043B\u0430\u043D\u0441", value: fmtMoney(E.balance, cur), hint: "\u043F\u043E \u0432\u0441\u0435\u043C \u0441\u0447\u0435\u0442\u0430\u043C" }),
            React.createElement(Kpi, { label: "\u041F\u043E\u0442\u0440\u0430\u0447\u0435\u043D\u043E \u0432 \u044D\u0442\u043E\u043C \u043C\u0435\u0441\u044F\u0446\u0435", value: fmtMoney(E.cur.expense, cur), hint: `из них повторяющиеся ~${fmtShort(E.recurringMonthly)}` }),
            React.createElement(Kpi, { label: "\u041F\u0440\u043E\u0433\u043D\u043E\u0437 \u0440\u0430\u0441\u0445\u043E\u0434\u043E\u0432 \u0437\u0430 \u043C\u0435\u0441\u044F\u0446", value: fmtMoney(E.eomForecast, cur), hint: `коридор ${fmtShort(E.eomLow)} – ${fmtShort(E.eomHigh)}`, tone: E.budgets && Object.keys(E.budgets).length && E.eomForecast > Object.values(E.budgets).reduce((s, v) => s + v, 0) ? "warn" : undefined }),
            React.createElement(Kpi, { label: "\u041C\u043E\u0436\u043D\u043E \u0442\u0440\u0430\u0442\u0438\u0442\u044C \u0432 \u0434\u0435\u043D\u044C", value: fmtMoney(E.safePerDay, cur), hint: `осталось ${E.daysLeft} дн.`, tone: E.safePerDay < E.dailyRate * 0.7 ? "warn" : "good" }),
            React.createElement(Kpi, { label: "\u041D\u043E\u0440\u043C\u0430 \u0441\u0431\u0435\u0440\u0435\u0436\u0435\u043D\u0438\u0439", value: sr == null ? "—" : `${Math.round(sr * 100)}%`, hint: "\u0437\u0430 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 3 \u043C\u0435\u0441\u044F\u0446\u0430", tone: sr == null ? undefined : sr >= 0.15 ? "good" : sr >= 0 ? "warn" : "bad" })),
        React.createElement(SectionTitle, { sub: "\u0414\u043E\u0445\u043E\u0434\u044B \u0438 \u0440\u0430\u0441\u0445\u043E\u0434\u044B \u043F\u043E \u043C\u0435\u0441\u044F\u0446\u0430\u043C; \u043B\u0438\u043D\u0438\u044F \u2014 \u0447\u0438\u0441\u0442\u044B\u0439 \u0438\u0442\u043E\u0433 \u043C\u0435\u0441\u044F\u0446\u0430." }, "\u0414\u0435\u043D\u0435\u0436\u043D\u044B\u0439 \u043F\u043E\u0442\u043E\u043A"),
        React.createElement("div", { style: { ...S.card, paddingBottom: 8 } },
            React.createElement(ResponsiveContainer, { width: "100%", height: 260 },
                React.createElement(ComposedChart, { data: m, margin: { top: 8, right: 8, left: 0, bottom: 0 } },
                    React.createElement(CartesianGrid, { stroke: C.line, vertical: false }),
                    React.createElement(XAxis, { dataKey: "label", tick: { fontSize: 12, fill: C.muted }, axisLine: false, tickLine: false }),
                    React.createElement(YAxis, { tickFormatter: fmtShort, tick: { fontSize: 11, fill: C.muted }, axisLine: false, tickLine: false, width: 46 }),
                    React.createElement(Tooltip, { content: React.createElement(ChartTip, { cur: cur }) }),
                    React.createElement(Legend, { wrapperStyle: { fontSize: 12 } }),
                    React.createElement(Bar, { dataKey: "\u0414\u043E\u0445\u043E\u0434", fill: C.sage, radius: [6, 6, 0, 0], maxBarSize: 26 }),
                    React.createElement(Bar, { dataKey: "\u0420\u0430\u0441\u0445\u043E\u0434", fill: C.clay, fillOpacity: 0.75, radius: [6, 6, 0, 0], maxBarSize: 26 }),
                    React.createElement(Line, { dataKey: "\u0418\u0442\u043E\u0433", stroke: C.ink, strokeWidth: 2, dot: { r: 3 } })))),
        E.movers.length > 0 && (React.createElement(React.Fragment, null,
            React.createElement(SectionTitle, { sub: "\u041A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0438, \u0447\u0435\u0439 \u043F\u0440\u043E\u0433\u043D\u043E\u0437 \u043D\u0430 \u044D\u0442\u043E\u0442 \u043C\u0435\u0441\u044F\u0446 \u0437\u0430\u043C\u0435\u0442\u043D\u043E \u043E\u0442\u043B\u0438\u0447\u0430\u0435\u0442\u0441\u044F \u043E\u0442 \u0432\u0430\u0448\u0435\u0439 \u043E\u0431\u044B\u0447\u043D\u043E\u0439 \u043C\u0435\u0434\u0438\u0430\u043D\u044B." }, "\u0427\u0442\u043E \u0438\u0437\u043C\u0435\u043D\u0438\u043B\u043E\u0441\u044C"),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 } }, E.movers.map((c) => (React.createElement("div", { key: c.cat, style: { ...S.card, padding: "13px 16px" } },
                React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
                    React.createElement("span", { style: { width: 10, height: 10, borderRadius: 3, background: catColor(c.cat, E.customCategories) } }),
                    React.createElement("b", { style: { fontSize: 14 } }, catName(c.cat, E.customCategories)),
                    React.createElement("span", { style: {
                            marginLeft: "auto", fontSize: 12.5, fontWeight: 700, ...S.num,
                            color: c.deltaPct > 0 ? C.clay : C.sageDark,
                        } },
                        c.deltaPct > 0 ? "↑" : "↓",
                        " ",
                        Math.abs(Math.round(c.deltaPct * 100)),
                        "%")),
                React.createElement("div", { style: { ...S.sub, marginTop: 5 } },
                    "\u043E\u0431\u044B\u0447\u043D\u043E ~",
                    fmtShort(c.histMedian),
                    ", \u043F\u0440\u043E\u0433\u043D\u043E\u0437 ",
                    fmtShort(c.forecast),
                    " ",
                    cur))))))),
        E.anomalies.length > 0 && (React.createElement(React.Fragment, null,
            React.createElement(SectionTitle, { sub: "\u0421\u043F\u0438\u0441\u0430\u043D\u0438\u044F, \u043D\u0435\u0442\u0438\u043F\u0438\u0447\u043D\u043E \u043A\u0440\u0443\u043F\u043D\u044B\u0435 \u0434\u043B\u044F \u0441\u0432\u043E\u0435\u0439 \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0438 (\u0440\u043E\u0431\u0430\u0441\u0442\u043D\u044B\u0439 z-\u0441\u043A\u043E\u0440 > 3)." }, "\u041D\u0435\u043E\u0431\u044B\u0447\u043D\u044B\u0435 \u0442\u0440\u0430\u0442\u044B"),
            React.createElement("div", { style: { ...S.card, padding: 0 } }, E.anomalies.slice(0, 5).map((t, i) => (React.createElement("div", { key: t.id || i, style: {
                    display: "flex", alignItems: "center", gap: 10, padding: "11px 18px",
                    borderTop: i ? `1px solid ${C.line}` : "none", fontSize: 13.5,
                } },
                React.createElement("span", { style: { width: 9, height: 9, borderRadius: 3, background: catColor(t.category, E.customCategories) } }),
                React.createElement("span", null,
                    catName(t.category, E.customCategories),
                    t.note ? ` — ${t.note}` : ""),
                React.createElement("span", { style: { color: C.muted, fontSize: 12 } }, t.date),
                React.createElement("b", { style: { marginLeft: "auto", ...S.num, color: C.clay } }, fmtMoney(t.amount, cur)),
                React.createElement("span", { style: { fontSize: 11.5, color: C.muted } },
                    "\u043E\u0431\u044B\u0447\u043D\u043E ~",
                    fmtShort(t.catMedian))))))))));
}
/* -------------------------------- Категории ------------------------------- */
function Categories({ E, cur }) {
    const [mkSel, setMkSel] = useState(E.curMk);
    const opts = E.monthly.slice(-8).map((m) => m.mk).reverse();
    const mData = E.monthly.find((m) => m.mk === mkSel) || E.cur;
    const pie = Object.entries(mData.cats)
        .map(([cat, v]) => ({ cat, name: catName(cat, E.customCategories), value: Math.round(v), color: catColor(cat, E.customCategories) }))
        .sort((a, b) => b.value - a.value);
    const total = pie.reduce((s, p) => s + p.value, 0);
    const wk = WEEKDAYS_RU.map((d, i) => ({ d, k: Math.round(E.weekdayCoef[i] * 100) }));
    return (React.createElement(React.Fragment, null,
        React.createElement(SectionTitle, { sub: "\u0421\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u0430 \u0440\u0430\u0441\u0445\u043E\u0434\u043E\u0432 \u0437\u0430 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0439 \u043C\u0435\u0441\u044F\u0446." }, "\u0420\u0430\u0441\u0445\u043E\u0434\u044B \u043F\u043E \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044F\u043C"),
        React.createElement("div", { style: { marginBottom: 10 } },
            React.createElement("select", { value: mkSel, onChange: (e) => setMkSel(e.target.value), style: {
                    border: `1px solid ${C.line}`, borderRadius: 10, background: "#FFFDF7",
                    padding: "7px 12px", fontSize: 13.5, color: C.ink, fontWeight: 600,
                } }, opts.map((mk) => React.createElement("option", { key: mk, value: mk },
                mkLabel(mk),
                mk === E.curMk ? " (текущий)" : "")))),
        React.createElement("div", { style: { display: "flex", gap: 14, flexWrap: "wrap" } },
            React.createElement("div", { style: { ...S.card, flex: "0 1 320px", minWidth: 280 } },
                React.createElement(ResponsiveContainer, { width: "100%", height: 230 },
                    React.createElement(PieChart, null,
                        React.createElement(Pie, { data: pie, dataKey: "value", innerRadius: 62, outerRadius: 92, paddingAngle: 2, strokeWidth: 0 }, pie.map((p) => React.createElement(Cell, { key: p.cat, fill: p.color }))),
                        React.createElement(Tooltip, { content: React.createElement(ChartTip, { cur: cur }) }))),
                React.createElement("div", { style: { textAlign: "center", marginTop: -138, marginBottom: 96, pointerEvents: "none" } },
                    React.createElement("div", { style: { fontSize: 11, color: C.muted } }, "\u0432\u0441\u0435\u0433\u043E"),
                    React.createElement("div", { style: { ...S.num, fontWeight: 800, fontSize: 18 } },
                        fmtShort(total),
                        " ",
                        cur))),
            React.createElement("div", { style: { ...S.card, flex: "1 1 380px", padding: "8px 0" } },
                pie.length === 0 && React.createElement("p", { style: { ...S.sub, padding: 16 } }, "\u0417\u0430 \u044D\u0442\u043E\u0442 \u043C\u0435\u0441\u044F\u0446 \u0440\u0430\u0441\u0445\u043E\u0434\u043E\u0432 \u043D\u0435\u0442."),
                pie.map((p, i) => {
                    const limit = E.budgets[p.cat];
                    const share = total ? p.value / total : 0;
                    return (React.createElement("div", { key: p.cat, style: { padding: "10px 18px", borderTop: i ? `1px solid ${C.line}` : "none" } },
                        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, marginBottom: 6 } },
                            React.createElement("span", { style: { width: 10, height: 10, borderRadius: 3, background: p.color } }),
                            React.createElement("b", null, p.name),
                            React.createElement("span", { style: { color: C.muted, fontSize: 12 } },
                                Math.round(share * 100),
                                "%"),
                            React.createElement("span", { style: { marginLeft: "auto", ...S.num, fontWeight: 700 } }, fmtMoney(p.value, cur)),
                            limit ? React.createElement("span", { style: { fontSize: 11.5, color: C.muted } },
                                "/ ",
                                fmtShort(limit)) : null),
                        React.createElement(Progress, { value: limit ? p.value / limit : share, color: limit && p.value > limit ? C.clay : p.color })));
                }))),
        React.createElement(SectionTitle, { sub: "\u0421\u0440\u0435\u0434\u043D\u044F\u044F \u0438\u043D\u0442\u0435\u043D\u0441\u0438\u0432\u043D\u043E\u0441\u0442\u044C \u0442\u0440\u0430\u0442 \u043F\u043E \u0434\u043D\u044F\u043C \u043D\u0435\u0434\u0435\u043B\u0438 \u0437\u0430 8 \u043D\u0435\u0434\u0435\u043B\u044C; 100% \u2014 \u0432\u0430\u0448 \u0441\u0440\u0435\u0434\u043D\u0438\u0439 \u0434\u0435\u043D\u044C." }, "\u041F\u0440\u043E\u0444\u0438\u043B\u044C \u043D\u0435\u0434\u0435\u043B\u0438"),
        React.createElement("div", { style: { ...S.card, paddingBottom: 6 } },
            React.createElement(ResponsiveContainer, { width: "100%", height: 150 },
                React.createElement(ComposedChart, { data: wk, margin: { top: 6, right: 8, left: 0, bottom: 0 } },
                    React.createElement(CartesianGrid, { stroke: C.line, vertical: false }),
                    React.createElement(XAxis, { dataKey: "d", tick: { fontSize: 12, fill: C.muted }, axisLine: false, tickLine: false }),
                    React.createElement(YAxis, { tickFormatter: (v) => v + "%", tick: { fontSize: 11, fill: C.muted }, axisLine: false, tickLine: false, width: 40 }),
                    React.createElement(ReferenceLine, { y: 100, stroke: C.muted, strokeDasharray: "4 4" }),
                    React.createElement(Tooltip, { formatter: (v) => v + "%", contentStyle: { borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 12.5 } }),
                    React.createElement(Bar, { dataKey: "k", name: "\u0418\u043D\u0442\u0435\u043D\u0441\u0438\u0432\u043D\u043E\u0441\u0442\u044C", fill: C.blue, radius: [6, 6, 0, 0], maxBarSize: 34 })))),
        E.detectedRecurring.length > 0 && (React.createElement(React.Fragment, null,
            React.createElement(SectionTitle, { sub: "\u041F\u043B\u0430\u0442\u0435\u0436\u0438, \u043F\u043E\u0432\u0442\u043E\u0440\u044F\u044E\u0449\u0438\u0435\u0441\u044F \u0438\u0437 \u043C\u0435\u0441\u044F\u0446\u0430 \u0432 \u043C\u0435\u0441\u044F\u0446 \u0441 \u043F\u043E\u0445\u043E\u0436\u0435\u0439 \u0441\u0443\u043C\u043C\u043E\u0439 \u0438 \u0434\u0430\u0442\u043E\u0439 \u2014 \u0444\u0438\u043A\u0441\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u0430\u044F \u0447\u0430\u0441\u0442\u044C \u0431\u044E\u0434\u0436\u0435\u0442\u0430." },
                "\u0420\u0435\u0433\u0443\u043B\u044F\u0440\u043D\u044B\u0435 \u043F\u043B\u0430\u0442\u0435\u0436\u0438",
                " ",
                React.createElement("span", { style: { fontWeight: 600, color: C.muted, fontSize: 13 } },
                    "\u00B7 ~",
                    fmtMoney(E.recurringMonthly, cur),
                    " \u0432 \u043C\u0435\u0441\u044F\u0446")),
            React.createElement("div", { style: { ...S.card, padding: 0 } }, E.detectedRecurring.slice(0, 8).map((r, i) => (React.createElement("div", { key: i, style: {
                    display: "flex", alignItems: "center", gap: 10, padding: "11px 18px",
                    borderTop: i ? `1px solid ${C.line}` : "none", fontSize: 13.5,
                    opacity: r.activeNow ? 1 : 0.55,
                } },
                React.createElement("span", { style: { width: 9, height: 9, borderRadius: 3, background: catColor(r.cat, E.customCategories) } }),
                React.createElement("span", null, r.note || catName(r.cat, E.customCategories)),
                React.createElement("span", { style: { color: C.muted, fontSize: 12 } },
                    "~",
                    r.day,
                    "-\u0433\u043E \u0447\u0438\u0441\u043B\u0430 \u00B7 ",
                    r.monthsSeen,
                    " \u043C\u0435\u0441."),
                !r.activeNow && React.createElement("span", { style: { fontSize: 11, color: C.muted } }, "(\u043D\u0435\u0430\u043A\u0442\u0438\u0432\u0435\u043D)"),
                React.createElement("b", { style: { marginLeft: "auto", ...S.num } }, fmtMoney(r.amount, cur))))))))));
}
/* --------------------------------- Прогноз -------------------------------- */
function Forecast({ E, cur }) {
    const limitSum = Object.values(E.budgets).reduce((s, v) => s + v, 0);
    const balData = E.balanceCurve.map((p) => ({ ...p, label: mkLabel(p.mk) }));
    const minBal = Math.min(...balData.map((p) => Math.min(p.fact ?? Infinity, p.proj ?? Infinity)));
    return (React.createElement(React.Fragment, null,
        React.createElement(SectionTitle, { sub: `Сплошная линия — факт с начала месяца, пунктир — ожидаемая траектория, лента — коридор ~80% на основе разброса ваших дневных трат.` }, "\u0420\u0430\u0441\u0445\u043E\u0434\u044B \u0434\u043E \u043A\u043E\u043D\u0446\u0430 \u043C\u0435\u0441\u044F\u0446\u0430"),
        React.createElement("div", { style: { ...S.card, paddingBottom: 8 } },
            React.createElement("div", { style: { display: "flex", gap: 22, flexWrap: "wrap", marginBottom: 8, fontSize: 13 } },
                React.createElement("span", null,
                    "\u041F\u0440\u043E\u0433\u043D\u043E\u0437: ",
                    React.createElement("b", { style: S.num }, fmtMoney(E.eomForecast, cur))),
                React.createElement("span", { style: { color: C.muted } },
                    "\u043A\u043E\u0440\u0438\u0434\u043E\u0440 ",
                    fmtShort(E.eomLow),
                    " \u2013 ",
                    fmtShort(E.eomHigh),
                    " ",
                    cur),
                limitSum > 0 && (React.createElement("span", { style: { color: E.eomForecast > limitSum ? C.clay : C.sageDark, fontWeight: 700 } }, E.eomForecast > limitSum
                    ? `выше суммы лимитов на ${fmtShort(E.eomForecast - limitSum)}`
                    : `в пределах суммы лимитов (${fmtShort(limitSum)})`))),
            React.createElement(ResponsiveContainer, { width: "100%", height: 250 },
                React.createElement(ComposedChart, { data: E.cumCurve, margin: { top: 6, right: 8, left: 0, bottom: 0 } },
                    React.createElement(CartesianGrid, { stroke: C.line, vertical: false }),
                    React.createElement(XAxis, { dataKey: "day", tick: { fontSize: 11, fill: C.muted }, axisLine: false, tickLine: false, tickFormatter: (d) => (d % 5 === 0 || d === 1 ? d : ""), interval: 0 }),
                    React.createElement(YAxis, { tickFormatter: fmtShort, tick: { fontSize: 11, fill: C.muted }, axisLine: false, tickLine: false, width: 46 }),
                    React.createElement(Tooltip, { content: React.createElement(ChartTip, { cur: cur, labelFmt: (d) => `${d}-е число` }) }),
                    limitSum > 0 && React.createElement(ReferenceLine, { y: limitSum, stroke: C.amber, strokeDasharray: "5 4", label: { value: "лимиты", fontSize: 11, fill: "#B7801F", position: "insideTopRight" } }),
                    React.createElement(Area, { dataKey: "band", name: "\u041A\u043E\u0440\u0438\u0434\u043E\u0440", fill: C.sage, fillOpacity: 0.22, stroke: "none" }),
                    React.createElement(Line, { dataKey: "fact", name: "\u0424\u0430\u043A\u0442", stroke: C.sageDark, strokeWidth: 2.5, dot: false }),
                    React.createElement(Line, { dataKey: "proj", name: "\u041F\u0440\u043E\u0433\u043D\u043E\u0437", stroke: C.sageDark, strokeWidth: 2, strokeDasharray: "6 5", dot: false })))),
        E.budgetRisks.length > 0 && (React.createElement(React.Fragment, null,
            React.createElement(SectionTitle, { sub: "\u041F\u0440\u043E\u0433\u043D\u043E\u0437 \u043D\u0430 \u043C\u0435\u0441\u044F\u0446 \u043F\u0440\u043E\u0442\u0438\u0432 \u0432\u0430\u0448\u0438\u0445 \u043B\u0438\u043C\u0438\u0442\u043E\u0432 \u043F\u043E \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044F\u043C." }, "\u0420\u0438\u0441\u043A\u0438 \u043F\u043E \u0431\u044E\u0434\u0436\u0435\u0442\u0430\u043C"),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12 } }, E.budgetRisks.map((c) => {
                const st = c.status;
                const label = st === "over" ? "лимит уже превышен"
                    : st === "risk" ? "по прогнозу превысите"
                        : st === "warn" ? "впритык к лимиту" : "в пределах лимита";
                const color = st === "over" || st === "risk" ? C.clay : st === "warn" ? C.amber : C.sageDark;
                return (React.createElement("div", { key: c.cat, style: { ...S.card, padding: "13px 16px" } },
                    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 } },
                        React.createElement("span", { style: { width: 10, height: 10, borderRadius: 3, background: catColor(c.cat, E.customCategories) } }),
                        React.createElement("b", { style: { fontSize: 14 } }, catName(c.cat, E.customCategories)),
                        React.createElement("span", { style: { marginLeft: "auto", fontSize: 12, fontWeight: 700, color } }, label)),
                    React.createElement(Progress, { value: c.forecast / c.limit, color: color }),
                    React.createElement("div", { style: { ...S.sub, marginTop: 6, ...S.num } },
                        "\u043F\u043E\u0442\u0440\u0430\u0447\u0435\u043D\u043E ",
                        fmtShort(c.mtd),
                        " \u00B7 \u043F\u0440\u043E\u0433\u043D\u043E\u0437 ",
                        fmtShort(c.forecast),
                        " / \u043B\u0438\u043C\u0438\u0442 ",
                        fmtShort(c.limit),
                        " ",
                        cur)));
            })))),
        React.createElement(SectionTitle, { sub: "\u041E\u0446\u0435\u043D\u043A\u0430 \u043A\u0430\u0436\u0434\u043E\u0439 \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0438: \u0432\u0437\u0432\u0435\u0448\u0435\u043D\u043D\u043E\u0435 \u0441\u043E\u0447\u0435\u0442\u0430\u043D\u0438\u0435 \u0442\u0435\u043C\u043F\u0430 \u0442\u0435\u043A\u0443\u0449\u0435\u0433\u043E \u043C\u0435\u0441\u044F\u0446\u0430 \u0438 \u043C\u043E\u0434\u0435\u043B\u0438 \u0425\u043E\u043B\u044C\u0442\u0430 \u043F\u043E \u043F\u0440\u043E\u0448\u043B\u044B\u043C \u043C\u0435\u0441\u044F\u0446\u0430\u043C." }, "\u041F\u0440\u043E\u0433\u043D\u043E\u0437 \u043F\u043E \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044F\u043C"),
        React.createElement("div", { style: { ...S.card, padding: 0 } },
            React.createElement("div", { style: {
                    display: "grid", gridTemplateColumns: "1fr 90px 90px 90px", gap: 8,
                    padding: "10px 18px", fontSize: 11.5, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em",
                } },
                React.createElement("span", null, "\u041A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044F"),
                React.createElement("span", { style: { textAlign: "right" } }, "\u041F\u043E\u0442\u0440\u0430\u0447\u0435\u043D\u043E"),
                React.createElement("span", { style: { textAlign: "right" } }, "\u041F\u0440\u043E\u0433\u043D\u043E\u0437"),
                React.createElement("span", { style: { textAlign: "right" } }, "\u041E\u0431\u044B\u0447\u043D\u043E")),
            E.catForecasts.map((c, i) => (React.createElement("div", { key: c.cat, style: {
                    display: "grid", gridTemplateColumns: "1fr 90px 90px 90px", gap: 8,
                    padding: "10px 18px", borderTop: `1px solid ${C.line}`, fontSize: 13.5, alignItems: "center",
                } },
                React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 8 } },
                    React.createElement("span", { style: { width: 9, height: 9, borderRadius: 3, background: catColor(c.cat, E.customCategories) } }),
                    catName(c.cat, E.customCategories),
                    c.trend > 800 && React.createElement("span", { title: "\u0440\u0430\u0441\u0442\u0451\u0442", style: { color: C.clay, fontSize: 11 } }, "\u2197"),
                    c.trend < -800 && React.createElement("span", { title: "\u0441\u043D\u0438\u0436\u0430\u0435\u0442\u0441\u044F", style: { color: C.sageDark, fontSize: 11 } }, "\u2198")),
                React.createElement("span", { style: { textAlign: "right", ...S.num } }, fmtShort(c.mtd)),
                React.createElement("span", { style: { textAlign: "right", ...S.num, fontWeight: 700 } }, fmtShort(c.forecast)),
                React.createElement("span", { style: { textAlign: "right", ...S.num, color: C.muted } }, c.histMedian ? fmtShort(c.histMedian) : "—"))))),
        React.createElement(SectionTitle, { sub: "\u0422\u0440\u0430\u0435\u043A\u0442\u043E\u0440\u0438\u044F \u043E\u0431\u0449\u0435\u0433\u043E \u0431\u0430\u043B\u0430\u043D\u0441\u0430: \u0438\u0441\u0442\u043E\u0440\u0438\u044F \u0438 6 \u043C\u0435\u0441\u044F\u0446\u0435\u0432 \u0432\u043F\u0435\u0440\u0451\u0434 \u043F\u0440\u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0438 \u0442\u0435\u043A\u0443\u0449\u0438\u0445 \u0434\u043E\u0445\u043E\u0434\u043E\u0432 \u0438 \u0440\u0430\u0441\u0445\u043E\u0434\u043E\u0432 (\u043F\u0440\u043E\u0433\u043D\u043E\u0437 \u0425\u043E\u043B\u044C\u0442\u0430 \u0441 \u0437\u0430\u0442\u0443\u0445\u0430\u043D\u0438\u0435\u043C \u0442\u0440\u0435\u043D\u0434\u0430)." }, "\u0411\u0430\u043B\u0430\u043D\u0441 \u043D\u0430 \u043F\u043E\u043B\u0433\u043E\u0434\u0430 \u0432\u043F\u0435\u0440\u0451\u0434"),
        React.createElement("div", { style: { ...S.card, paddingBottom: 8 } },
            React.createElement("div", { style: { display: "flex", gap: 22, flexWrap: "wrap", marginBottom: 8, fontSize: 13 } },
                React.createElement("span", null,
                    "\u041E\u0436\u0438\u0434\u0430\u0435\u043C\u044B\u0439 \u0438\u0442\u043E\u0433 \u043C\u0435\u0441\u044F\u0446\u0430: ",
                    React.createElement("b", { style: { ...S.num, color: E.monthlyNetForecast >= 0 ? C.sageDark : C.clay } },
                        E.monthlyNetForecast >= 0 ? "+" : "",
                        fmtMoney(E.monthlyNetForecast, cur))),
                minBal < 0 && React.createElement("span", { style: { color: C.clay, fontWeight: 700 } }, "\u0432\u043D\u0438\u043C\u0430\u043D\u0438\u0435: \u0442\u0440\u0430\u0435\u043A\u0442\u043E\u0440\u0438\u044F \u0443\u0445\u043E\u0434\u0438\u0442 \u0432 \u043C\u0438\u043D\u0443\u0441")),
            React.createElement(ResponsiveContainer, { width: "100%", height: 240 },
                React.createElement(ComposedChart, { data: balData, margin: { top: 6, right: 8, left: 0, bottom: 0 } },
                    React.createElement(CartesianGrid, { stroke: C.line, vertical: false }),
                    React.createElement(XAxis, { dataKey: "label", tick: { fontSize: 11, fill: C.muted }, axisLine: false, tickLine: false }),
                    React.createElement(YAxis, { tickFormatter: fmtShort, tick: { fontSize: 11, fill: C.muted }, axisLine: false, tickLine: false, width: 52 }),
                    React.createElement(Tooltip, { content: React.createElement(ChartTip, { cur: cur }) }),
                    React.createElement(ReferenceLine, { y: 0, stroke: C.muted }),
                    React.createElement(Line, { dataKey: "fact", name: "\u0424\u0430\u043A\u0442", stroke: C.ink, strokeWidth: 2.5, dot: { r: 3 } }),
                    React.createElement(Line, { dataKey: "proj", name: "\u041F\u0440\u043E\u0433\u043D\u043E\u0437", stroke: C.sageDark, strokeWidth: 2, strokeDasharray: "6 5", dot: { r: 3 } })))),
        E.goalStats.length > 0 && (React.createElement(React.Fragment, null,
            React.createElement(SectionTitle, { sub: "\u041A\u043E\u0433\u0434\u0430 \u0431\u0443\u0434\u0435\u0442 \u0434\u043E\u0441\u0442\u0438\u0433\u043D\u0443\u0442\u0430 \u043A\u0430\u0436\u0434\u0430\u044F \u0446\u0435\u043B\u044C \u043F\u0440\u0438 \u0442\u0435\u043A\u0443\u0449\u0435\u043C \u0441\u0440\u0435\u0434\u043D\u0435\u043C \u0442\u0435\u043C\u043F\u0435 \u043F\u043E\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0439." }, "\u0426\u0435\u043B\u0438"),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 } }, E.goalStats.map((g, i) => (React.createElement("div", { key: i, style: { ...S.card, padding: "14px 18px" } },
                React.createElement("div", { style: { display: "flex", alignItems: "baseline", gap: 8 } },
                    React.createElement("b", { style: { fontSize: 15 } }, g.name),
                    React.createElement("span", { style: { marginLeft: "auto", ...S.num, fontSize: 13, color: C.muted } },
                        fmtShort(g.saved),
                        " / ",
                        fmtShort(g.target),
                        " ",
                        cur)),
                React.createElement("div", { style: { margin: "10px 0 8px" } },
                    React.createElement(Progress, { value: g.saved / g.target, color: C.sage })),
                React.createElement("div", { style: { ...S.sub } }, g.saved >= g.target ? "Цель достигнута 🎉"
                    : g.etaDate
                        ? React.createElement(React.Fragment, null,
                            "\u2248 ",
                            React.createElement("b", { style: { color: C.ink } }, g.etaDate),
                            " \u043F\u0440\u0438 \u0432\u0437\u043D\u043E\u0441\u0430\u0445 ~",
                            fmtShort(g.monthlyContrib),
                            " ",
                            cur,
                            "/\u043C\u0435\u0441")
                        : "Недостаточно пополнений, чтобы оценить срок"))))))),
        React.createElement(SectionTitle, null, "\u041A\u0430\u043A \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044F \u043F\u0440\u043E\u0433\u043D\u043E\u0437"),
        React.createElement("div", { style: { ...S.card } },
            React.createElement("p", { style: { ...S.sub, fontSize: 13, lineHeight: 1.65, margin: 0 } }, "\u041F\u0435\u0440\u0435\u0432\u043E\u0434\u044B \u043C\u0435\u0436\u0434\u0443 \u0441\u0447\u0435\u0442\u0430\u043C\u0438 \u0438 \u0441\u043B\u0443\u0436\u0435\u0431\u043D\u044B\u0435 \u0437\u0430\u043F\u0438\u0441\u0438 \u0438\u0441\u043A\u043B\u044E\u0447\u0430\u044E\u0442\u0441\u044F, \u0447\u0442\u043E\u0431\u044B \u043D\u0435 \u0437\u0430\u0434\u0432\u0430\u0438\u0432\u0430\u0442\u044C \u043E\u0431\u043E\u0440\u043E\u0442\u044B. \u0414\u043D\u0435\u0432\u043D\u043E\u0439 \u0442\u0435\u043C\u043F \u2014 \u0441\u0440\u0435\u0434\u043D\u0435\u0435 \u0437\u0430 56 \u0434\u043D\u0435\u0439 \u0441 \u043F\u043E\u043F\u0440\u0430\u0432\u043A\u043E\u0439 \u043D\u0430 \u0434\u0435\u043D\u044C \u043D\u0435\u0434\u0435\u043B\u0438 (\u0432\u044B\u0445\u043E\u0434\u043D\u044B\u0435 \u0438 \u0431\u0443\u0434\u043D\u0438 \u0442\u0440\u0430\u0442\u044F\u0442\u0441\u044F \u043F\u043E-\u0440\u0430\u0437\u043D\u043E\u043C\u0443), \u043A\u043E\u0440\u0438\u0434\u043E\u0440 \u2014 \u00B11,28\u03C3\u00B7\u221A(\u043E\u0441\u0442\u0430\u0432\u0448\u0438\u0435\u0441\u044F \u0434\u043D\u0438), \u0447\u0442\u043E \u043F\u0440\u0438\u043C\u0435\u0440\u043D\u043E \u0441\u043E\u043E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0443\u0435\u0442 80-\u043F\u0440\u043E\u0446\u0435\u043D\u0442\u043D\u043E\u043C\u0443 \u0438\u043D\u0442\u0435\u0440\u0432\u0430\u043B\u0443. \u041C\u0435\u0441\u044F\u0447\u043D\u044B\u0435 \u0440\u044F\u0434\u044B \u0434\u043E\u0445\u043E\u0434\u043E\u0432, \u0440\u0430\u0441\u0445\u043E\u0434\u043E\u0432 \u0438 \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0439 \u043F\u0440\u043E\u0433\u043D\u043E\u0437\u0438\u0440\u0443\u044E\u0442\u0441\u044F \u043C\u0435\u0442\u043E\u0434\u043E\u043C \u0425\u043E\u043B\u044C\u0442\u0430 \u0441 \u0437\u0430\u0442\u0443\u0445\u0430\u044E\u0449\u0438\u043C \u0442\u0440\u0435\u043D\u0434\u043E\u043C (\u03B1=0,5, \u03B2=0,3, \u03C6=0,85): \u043E\u043D \u043B\u043E\u0432\u0438\u0442 \u0440\u043E\u0441\u0442 \u0438\u043B\u0438 \u0441\u043D\u0438\u0436\u0435\u043D\u0438\u0435, \u043D\u043E \u043D\u0435 \u044D\u043A\u0441\u0442\u0440\u0430\u043F\u043E\u043B\u0438\u0440\u0443\u0435\u0442 \u0435\u0433\u043E \u0431\u0435\u0441\u043A\u043E\u043D\u0435\u0447\u043D\u043E. \u0412\u043D\u0443\u0442\u0440\u0438 \u043C\u0435\u0441\u044F\u0446\u0430 \u043F\u0440\u043E\u0433\u043D\u043E\u0437 \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0438 \u2014 \u0441\u043C\u0435\u0441\u044C \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u043E\u0433\u043E \u0442\u0435\u043C\u043F\u0430 \u0438 \u043C\u043E\u0434\u0435\u043B\u0438: \u0432 \u043D\u0430\u0447\u0430\u043B\u0435 \u043C\u0435\u0441\u044F\u0446\u0430 \u0431\u043E\u043B\u044C\u0448\u0435 \u0432\u0435\u0441\u0430 \u0443 \u0438\u0441\u0442\u043E\u0440\u0438\u0438, \u043A \u043A\u043E\u043D\u0446\u0443 \u2014 \u0443 \u0444\u0430\u043A\u0442\u0430. \u0410\u043D\u043E\u043C\u0430\u043B\u0438\u0438 \u0438\u0449\u0443\u0442\u0441\u044F \u043F\u043E \u0440\u043E\u0431\u0430\u0441\u0442\u043D\u043E\u043C\u0443 z-\u0441\u043A\u043E\u0440\u0443 \u043D\u0430 \u043E\u0441\u043D\u043E\u0432\u0435 \u043C\u0435\u0434\u0438\u0430\u043D\u044B \u0438 MAD, \u043F\u043E\u044D\u0442\u043E\u043C\u0443 \u0440\u0435\u0434\u043A\u0438\u0435 \u043A\u0440\u0443\u043F\u043D\u044B\u0435 \u043F\u043E\u043A\u0443\u043F\u043A\u0438 \u043D\u0435 \u0438\u0441\u043A\u0430\u0436\u0430\u044E\u0442 \u00AB\u043D\u043E\u0440\u043C\u0443\u00BB. \u0420\u0435\u0433\u0443\u043B\u044F\u0440\u043D\u044B\u0435 \u043F\u043B\u0430\u0442\u0435\u0436\u0438 \u0440\u0430\u0441\u043F\u043E\u0437\u043D\u0430\u044E\u0442\u0441\u044F \u043F\u043E \u043F\u043E\u0432\u0442\u043E\u0440\u0435\u043D\u0438\u044E \u0441\u0443\u043C\u043C\u044B (\u00B112%) \u0438 \u0434\u0430\u0442\u044B (\u00B14 \u0434\u043D\u044F) \u043C\u0438\u043D\u0438\u043C\u0443\u043C \u0432 \u0442\u0440\u0451\u0445 \u043C\u0435\u0441\u044F\u0446\u0430\u0445. \u042D\u0442\u043E \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u043E\u0446\u0435\u043D\u043A\u0438, \u0430 \u043D\u0435 \u0444\u0438\u043D\u0430\u043D\u0441\u043E\u0432\u0430\u044F \u0440\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u0430\u0446\u0438\u044F."))));
}
/* ================================== App =================================== */
const STORAGE_KEY = "finance:state";
const PROFILE_KEY = "finance:profile";
const CUR_SYMBOL = { RUB: "\u20BD", USD: "$" };
export default function App({ onClose } = {}) {
    const [dataset, setDataset] = useState(null);
    const [error, setError] = useState("");
    const [tab, setTab] = useState("overview");
    const [booted, setBooted] = useState(false);
    const [currency, setCurrency] = useState("\u20BD");
    const now = useMemo(() => new Date(), []);
    // Автозагрузка данных пользователя из window.storage (storage-sync.js),
    // как это делает само приложение Kopiqo.
    useEffect(() => {
        (async () => {
            try {
                if (window.storage && window.storage.get) {
                    const res = await window.storage.get(STORAGE_KEY, false).catch(() => null);
                    if (res && res.value) {
                        const ds = normalizeDataset(JSON.parse(res.value));
                        if (ds.transactions.length)
                            setDataset(ds);
                    }
                    const prof = await window.storage.get(PROFILE_KEY, false).catch(() => null);
                    if (prof && prof.value) {
                        const parsed = JSON.parse(prof.value);
                        if (parsed && parsed.currency && CUR_SYMBOL[parsed.currency]) {
                            setCurrency(CUR_SYMBOL[parsed.currency]);
                        }
                    }
                }
            }
            catch (e) { /* нет данных — покажем экран импорта */ }
            setBooted(true);
        })();
    }, []);
    const handleLoad = (text) => {
        setError("");
        if (text == null) {
            setDataset({ demo: true, ...makeDemo(now) });
            return;
        }
        try {
            const raw = JSON.parse(text);
            const ds = normalizeDataset(raw);
            if (!ds.transactions.length) {
                setError("В данных не нашлось ни одной операции. Проверьте, что вставлен JSON finance:state целиком.");
                return;
            }
            setDataset(ds);
        }
        catch (e) {
            setError("Не удалось разобрать JSON: " + e.message);
        }
    };
    const E = useMemo(() => (dataset ? buildEngine(dataset, now) : null), [dataset, now]);
    const cur = currency;
    if (!booted) {
        return (React.createElement("div", { style: { ...S.page, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted } }, "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u043C \u0432\u0430\u0448\u0438 \u0434\u0430\u043D\u043D\u044B\u0435…"));
    }
    if (!dataset)
        return React.createElement("div", { style: S.page },
            React.createElement(ImportScreen, { onLoad: handleLoad, error: error }));
    const tabs = [
        ["overview", "Обзор"],
        ["categories", "Категории"],
        ["forecast", "Прогноз"],
    ];
    return (React.createElement("div", { style: S.page },
        React.createElement("header", { style: {
                position: "sticky", top: 0, zIndex: 5, background: "rgba(243,238,227,0.92)",
                backdropFilter: "blur(6px)", borderBottom: `1px solid ${C.line}`,
            } },
            React.createElement("div", { style: { ...S.wrap, display: "flex", alignItems: "center", gap: 14, padding: "14px 20px" } },
                React.createElement("div", { style: {
                        width: 34, height: 34, borderRadius: 10, background: C.sage,
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17,
                    } }, "\u25D4"),
                React.createElement("div", null,
                    React.createElement("div", { style: { fontWeight: 800, fontSize: 16, letterSpacing: "-0.01em" } }, "Kopiqo \u0410\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0430"),
                    React.createElement("div", { style: { fontSize: 11.5, color: C.muted } },
                        dataset.demo ? "демо-данные · " : "",
                        E.clean.length,
                        " \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0439 \u00B7 ",
                        E.closedMonths.length + 1,
                        " \u043C\u0435\u0441.")),
                React.createElement("nav", { style: { marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" } },
                    onClose ? (React.createElement("button", { onClick: onClose, style: {
                            border: "none", background: "transparent", cursor: "pointer",
                            color: C.muted, fontSize: 13, fontWeight: 700, padding: "8px 10px", borderRadius: 10,
                        } }, "← в Kopiqo")) : (React.createElement("a", { href: "./index.html", style: {
                            textDecoration: "none", color: C.muted, fontSize: 13, fontWeight: 700,
                            padding: "8px 10px", borderRadius: 10,
                        } }, "← в Kopiqo")),
                    tabs.map(([id, label]) => (React.createElement("button", { key: id, onClick: () => setTab(id), style: {
                            border: "none", cursor: "pointer", borderRadius: 10, padding: "8px 14px",
                            fontSize: 13.5, fontWeight: 700,
                            background: tab === id ? C.ink : "transparent",
                            color: tab === id ? C.card : C.muted,
                        } }, label))),
                    React.createElement("button", { onClick: () => { setDataset(null); setTab("overview"); }, style: {
                            border: `1px solid ${C.line}`, cursor: "pointer", borderRadius: 10,
                            padding: "8px 12px", fontSize: 13, background: "#FFFDF7", color: C.muted,
                        } }, "\u0414\u0440\u0443\u0433\u0438\u0435 \u0434\u0430\u043D\u043D\u044B\u0435")))),
        React.createElement("main", { style: S.wrap },
            tab === "overview" && React.createElement(Overview, { E: E, cur: cur }),
            tab === "categories" && React.createElement(Categories, { E: E, cur: cur }),
            tab === "forecast" && React.createElement(Forecast, { E: E, cur: cur }))));
}
