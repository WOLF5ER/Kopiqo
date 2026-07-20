// ============================================================================
// core/text-engine/templates.ru.js — wording pools, one entry per Verdict
// type from rules/*.rules.js. Each entry is a list of complete
// {title, description, recommendation} triples (kept together rather than
// mixed-and-matched independently, so a title and its description always
// read as one coherent thought) plus a fixed `icon` (a lucide-react export
// name — this module never imports React or lucide-react itself; the UI
// layer resolves the name to a component).
//
// Placeholders use {name} syntax; text-engine.js's fill() replaces them
// from the context it builds per verdict (see buildContext there for
// exactly which keys each type gets).
//
// Only Russian is filled in for this pass — the app's changelog entries
// already carry ru/en/zh, and Insight cards should eventually match, but
// translating 20 types × 2 variants accurately deserves its own pass rather
// than a rushed machine-feeling translation bolted on here. The shape
// (TEMPLATES_RU keyed by type) is what a future templates.en.js/
// templates.zh.js would mirror — text-engine.js already takes a `locale`
// argument and does nothing locale-specific beyond picking which pool to
// read from, so adding them later doesn't touch the engine logic.
// ============================================================================

export const TEMPLATES_RU = {
  income_drop: {
    icon: "TrendingDown",
    variants: [
      {
        title: "Доход в {month} заметно ниже обычного",
        description: "В {month} пришло {income} — это {ratioPct}% от вашего обычного дохода ({median}).",
        recommendation: "Стоит свериться, не задержалось ли какое-то поступление, и пересмотреть траты на ближайшее время.",
      },
      {
        title: "Просадка по доходу",
        description: "Доход за {month} составил {income}, тогда как обычно вы получаете около {median}.",
        recommendation: "Если это разовая ситуация — не страшно, но стоит присмотреться к бюджету следующего месяца.",
      },
    ],
  },
  income_growth: {
    icon: "TrendingUp",
    variants: [
      {
        title: "Доход в {month} выше обычного",
        description: "В {month} пришло {income} — заметно больше вашего обычного дохода ({median}).",
        recommendation: "Хороший момент отложить часть излишка в накопления или на цель.",
      },
      {
        title: "Приятный рост дохода",
        description: "За {month} вы получили {income}, что превышает типичный уровень {median}.",
        recommendation: "Можно направить часть этой суммы на финансовую цель, пока она под рукой.",
      },
    ],
  },
  income_unstable: {
    icon: "Activity",
    variants: [
      {
        title: "Доход в последнее время нестабилен",
        description: "За последние {monthsConsidered} мес. доход колебался заметно сильнее обычного.",
        recommendation: "Иметь небольшую подушку безопасности особенно полезно при таком разбросе доходов.",
      },
      {
        title: "Разброс в поступлениях",
        description: "Сумма месячного дохода за последние {monthsConsidered} мес. менялась сильнее, чем обычно.",
        recommendation: "Стоит закладывать в план не средний, а осторожный сценарий по доходу.",
      },
    ],
  },
  expenses_exceed_income: {
    icon: "AlertTriangle",
    variants: [
      {
        title: "{month}: расходы превысили доходы",
        description: "В {month} доход составил {income}, а расходы — {expense}. Разница: {deficit}.",
        recommendation: "Посмотрите, какие траты в этом месяце были необязательными — оттуда обычно и берётся перерасход.",
      },
      {
        title: "Месяц закрылся в минус",
        description: "За {month} расходы ({expense}) превысили доходы ({income}) на {deficit}.",
        recommendation: "Стоит разобрать месяц по категориям и понять, что вышло за рамки обычного.",
      },
    ],
  },
  forecast_may_exceed_income: {
    icon: "AlertCircle",
    variants: [
      {
        title: "Этот месяц идёт к перерасходу",
        description: "По текущему темпу расходы к концу месяца составят около {forecast} — больше вашего обычного дохода ({typicalIncome}).",
        recommendation: "Ещё есть время скорректировать траты до конца месяца.",
      },
      {
        title: "Прогноз месяца выше обычного дохода",
        description: "Уже потрачено {currentExpense}, а прогноз на весь месяц — {forecast}, при обычном доходе {typicalIncome}.",
        recommendation: "Стоит притормозить необязательные траты в оставшиеся дни месяца.",
      },
    ],
  },
  next_month_net_negative: {
    icon: "TrendingDown",
    variants: [
      {
        title: "Следующий месяц прогнозируется в минус",
        description: "По текущим трендам следующий месяц может закрыться с дефицитом около {deficit}.",
        recommendation: "Стоит заранее заложить это в план и присмотреть, где можно сократить траты.",
      },
      {
        title: "Прогноз на следующий месяц настораживает",
        description: "Расчёт показывает вероятный дефицит около {deficit} в следующем месяце.",
        recommendation: "Хороший момент пересмотреть регулярные платежи заранее.",
      },
    ],
  },
  category_growth: {
    icon: "TrendingUp",
    variants: [
      {
        title: "Категория «{categoryName}» выросла",
        description: "Расходы на «{categoryName}» идут к {forecast} в этом месяце — на {percentChange}% больше обычного ({histMedian}).",
        recommendation: "Стоит посмотреть, что именно потянуло категорию вверх — разовая покупка или новая привычка.",
      },
      {
        title: "Рост трат по категории «{categoryName}»",
        description: "Прогноз по «{categoryName}» — {forecast}, это на {percentChange}% выше обычного уровня.",
        recommendation: "Если рост разовый — можно не переживать, но стоит взять на заметку.",
      },
    ],
  },
  category_decline: {
    icon: "TrendingDown",
    variants: [
      {
        title: "Меньше трат на «{categoryName}»",
        description: "Расходы на «{categoryName}» идут к {forecast} — на {percentChange}% меньше обычного ({histMedian}).",
        recommendation: "Хороший результат — если это осознанное решение, стоит закрепить привычку.",
      },
      {
        title: "«{categoryName}»: расходы снизились",
        description: "В этом месяце по «{categoryName}» прогноз {forecast}, заметно ниже обычного уровня.",
        recommendation: "Если экономия далась легко — можно попробовать применить это и к соседним категориям.",
      },
    ],
  },
  budget_over: {
    icon: "AlertTriangle",
    variants: [
      {
        title: "Лимит по «{categoryName}» превышен",
        description: "Потрачено {spent} при лимите {limit} — это {ratioPct}% от бюджета.",
        recommendation: "Стоит либо скорректировать лимит, либо притормозить траты в этой категории до конца месяца.",
      },
      {
        title: "Бюджет «{categoryName}» уже превышен",
        description: "Расходы в категории «{categoryName}» составили {spent} при установленном лимите {limit}.",
        recommendation: "Посмотрите, что случилось в этой категории в этом месяце — возможно, лимит пора пересмотреть.",
      },
    ],
  },
  budget_risk: {
    icon: "AlertCircle",
    variants: [
      {
        title: "«{categoryName}» рискует выйти за лимит",
        description: "Прогноз по категории — {forecast} при лимите {limit} ({ratioPct}% бюджета).",
        recommendation: "Ещё есть шанс уложиться, если притормозить траты в этой категории.",
      },
      {
        title: "Бюджет «{categoryName}» под угрозой",
        description: "По текущему темпу прогноз — {forecast}, лимит на месяц — {limit}.",
        recommendation: "Стоит последить за этой категорией до конца месяца.",
      },
    ],
  },
  budget_warn: {
    icon: "Info",
    variants: [
      {
        title: "«{categoryName}» приближается к лимиту",
        description: "Прогноз — {forecast} при лимите {limit} ({ratioPct}% бюджета).",
        recommendation: "Пока всё в порядке, но стоит иметь это в виду до конца месяца.",
      },
      {
        title: "Почти на пределе: «{categoryName}»",
        description: "Категория подходит к {ratioPct}% от установленного лимита {limit}.",
        recommendation: "Небольшой запас ещё есть — но лучше присматривать за тратами здесь.",
      },
    ],
  },
  new_recurring_payment_detected: {
    icon: "Repeat",
    variants: [
      {
        title: "Похоже на регулярный платёж",
        description: "Уже {monthsSeen} мес. подряд встречается платёж на {amount} (обычно {dayOfMonth} числа) в категории «{categoryName}».",
        recommendation: "Если это ожидаемый регулярный платёж — можно добавить его в шаблоны, чтобы Kopiqo учитывал его в прогнозах.",
      },
      {
        title: "Обнаружен повторяющийся платёж",
        description: "За последние {monthsSeen} мес. в «{categoryName}» стабильно повторяется платёж около {amount}.",
        recommendation: "Стоит проверить, что это за платёж — и при необходимости добавить его как регулярный.",
      },
    ],
  },
  forecast_over_total_budget: {
    icon: "PiggyBank",
    variants: [
      {
        title: "Общий бюджет месяца под угрозой",
        description: "Прогноз расходов на месяц — {forecast}, при общем лимите по всем категориям {totalBudget} (больше на {overBy}).",
        recommendation: "Стоит посмотреть, в каких категориях можно притормозить траты до конца месяца.",
      },
      {
        title: "Расходы идут выше общего лимита",
        description: "Суммарный прогноз месяца ({forecast}) превышает общий бюджет ({totalBudget}) на {overBy}.",
        recommendation: "Хороший момент свериться с категориями, где траты растут быстрее плана.",
      },
    ],
  },
  balance_negative_forecast: {
    icon: "AlertTriangle",
    variants: [
      {
        title: "Прогноз баланса уходит в минус",
        description: "По текущим трендам баланс может стать отрицательным к {month} (≈{projectedBalance}).",
        recommendation: "Есть время скорректировать траты или доход заранее — прогноз на несколько месяцев вперёд, не факт.",
      },
      {
        title: "Баланс может уйти в минус к {month}",
        description: "Расчёт на несколько месяцев вперёд показывает баланс около {projectedBalance} к {month}.",
        recommendation: "Стоит пересмотреть регулярные траты, пока до этого момента есть время.",
      },
    ],
  },
  goal_completed: {
    icon: "Trophy",
    variants: [
      {
        title: "Цель «{name}» достигнута!",
        description: "Накоплено {saved} — это покрывает цель в {target} полностью.",
        recommendation: "Можно оформить достижение и поставить следующую цель.",
      },
      {
        title: "Готово: «{name}»",
        description: "Сумма {saved} достигла или превысила цель {target}.",
        recommendation: "Отличный результат — самое время задумать следующую цель.",
      },
    ],
  },
  goal_almost_done: {
    icon: "Target",
    variants: [
      {
        title: "«{name}» почти у цели",
        description: "Накоплено {saved} из {target}, при нынешнем темпе — цель будет достигнута к {etaDate}.",
        recommendation: "Осталось совсем немного — не сбавляйте темп.",
      },
      {
        title: "Почти готово: «{name}»",
        description: "При текущем темпе накоплений цель «{name}» ({target}) будет закрыта к {etaDate}.",
        recommendation: "Хороший момент, чтобы держать курс до конца.",
      },
    ],
  },
  goal_stalled: {
    icon: "Target",
    variants: [
      {
        title: "«{name}» давно не пополнялась",
        description: "Накоплено {saved} из {target}, но заметных пополнений в последнее время не было.",
        recommendation: "Стоит выделить регулярную сумму на эту цель, даже небольшую — так прогресс не остановится.",
      },
      {
        title: "Цель «{name}» приостановилась",
        description: "Из {target} накоплено {saved}, и в последнее время цель не пополнялась.",
        recommendation: "Небольшой регулярный взнос поможет сдвинуть цель с места.",
      },
    ],
  },
  unusual_transaction: {
    icon: "Eye",
    variants: [
      {
        title: "Необычная покупка в «{categoryName}»",
        description: "Операция на {amount} заметно выше обычной суммы в этой категории (обычно около {categoryMedian}).",
        recommendation: "Если это ожидаемая крупная покупка — всё в порядке, просто обратите внимание.",
      },
      {
        title: "Заметно крупнее обычного",
        description: "В категории «{categoryName}» прошла операция на {amount} — заметно выше типичной суммы ({categoryMedian}).",
        recommendation: "Стоит на всякий случай свериться, что это была именно та операция, которую вы планировали.",
      },
    ],
  },
  negative_savings_rate: {
    icon: "AlertTriangle",
    variants: [
      {
        title: "Накопления последние месяцы уходят в минус",
        description: "За последние 3 закрытых месяца расходы превышали доходы — норма сбережений: {savingsRatePct}%.",
        recommendation: "Стоит присмотреться к постоянным тратам — небольшое сокращение здесь ощущается сильнее всего.",
      },
      {
        title: "Норма сбережений отрицательная",
        description: "В среднем за последние 3 месяца вы тратите больше, чем зарабатываете ({savingsRatePct}%).",
        recommendation: "Хороший момент пересмотреть регулярные платежи и подписки.",
      },
    ],
  },
  healthy_savings_rate: {
    icon: "PiggyBank",
    variants: [
      {
        title: "Хорошая норма сбережений",
        description: "За последние 3 месяца вы откладываете около {savingsRatePct}% дохода — солидный результат.",
        recommendation: "Если ещё нет финансовой цели под эти накопления — самое время её поставить.",
      },
      {
        title: "Сбережения на хорошем уровне",
        description: "Норма сбережений за последние 3 месяца — около {savingsRatePct}% дохода.",
        recommendation: "Можно подумать, куда направить часть этих накоплений — например, в конкретную цель.",
      },
    ],
  },
};
