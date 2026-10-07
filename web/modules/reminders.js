// Reminders gathered from every tool, newest-urgent first. The web app shows them on
// Home; the phone app can turn them into notifications. Each has a stable id so a
// client can tell which ones it has already shown.
function reminders({ food, clothes, shopping, chores = null, calendar = null, swaps = [], money = null, trips = [], bills = null }) {
  const out = [];
  for (const e of food.expiringSoon) {
    out.push({
      id: `food-expiry-${e.id}-${e.expiry}`, kind: 'food', level: e.days <= 0 ? 'urgent' : 'warn', date: e.expiry,
      title: e.days < 0 ? `${e.name} is out of date` : e.days === 0 ? `Use the ${e.name} today` : `${e.name} goes off in ${e.days} day${e.days === 1 ? '' : 's'}`,
    });
  }
  // Leftovers in the fridge keep about 2 days: eat them or freeze them.
  for (const l of food.leftovers || []) {
    if (l.frozen || l.days === null || l.days > 1) continue;
    out.push({
      id: `food-leftover-${l.id}-${l.expiry}`, kind: 'food', level: l.days <= 0 ? 'urgent' : 'warn', date: l.expiry,
      title: l.days < 0 ? `The ${l.name.toLowerCase()} is past its use-by` : l.days === 0 ? `Eat the ${l.name.toLowerCase()} today, or freeze it` : `Eat the ${l.name.toLowerCase()} by tomorrow, or freeze it`,
    });
  }
  // Food that's been in the freezer about 3 months or more: time to use it up.
  const old = food.freezerOld || [];
  if (old.length > 3) {
    out.push({ id: `food-freezer-${old.length}-${old[0].id}`, kind: 'food', level: 'info', date: null, title: `${old.length} things in the freezer to use up`, detail: old.slice(0, 4).map((f) => f.name).join(', ') });
  } else {
    for (const f of old) {
      const months = Math.floor(f.days / 30);
      out.push({ id: `food-freezer-${f.id}`, kind: 'food', level: 'info', date: null, title: `Use up the ${f.name.toLowerCase()} from the freezer`, detail: `Frozen ${months} month${months === 1 ? '' : 's'} ago.` });
    }
  }
  if (food.mealsLeft <= 2) {
    out.push({ id: `food-low-${food.mealsLeft}`, kind: 'food', level: food.mealsLeft === 0 ? 'urgent' : 'warn', title: food.mealsLeft === 0 ? 'No full meals left in the cupboard' : `Only ${food.mealsLeft} meal${food.mealsLeft === 1 ? '' : 's'} left in the cupboard`, date: null });
  }
  for (const s of clothes) {
    if (s.status === 'buy-now') out.push({ id: `clothes-short-${s.childId}`, kind: 'clothes', level: 'warn', title: `${s.name} needs clothes`, detail: s.advice, date: null });
    if (s.forecast && s.forecast.nextSize && s.forecast.daysLeft <= 42) {
      out.push({ id: `clothes-size-${s.childId}-${s.forecast.nextSize}`, kind: 'clothes', level: 'info', date: s.forecast.date, title: `${s.name} will need ${s.forecast.nextSize} soon`, detail: `Expected around ${s.forecast.date}.` });
    }
    if (s.shoeForecast && s.shoeForecast.daysLeft <= 14) {
      out.push({ id: `shoes-${s.childId}-${s.shoeForecast.nextSize}`, kind: 'clothes', level: 'info', date: s.shoeForecast.date, title: `Check ${s.name}'s shoe size`, detail: `They may be ready for ${s.shoeForecast.nextSize}.` });
    }
    if (s.laundry && s.laundry.warning) out.push({ id: `laundry-${s.childId}-${s.laundry.cleanDays}`, kind: 'laundry', level: 'warn', title: `${s.name}: ${s.laundry.warning}`, date: null });
    if (s.uniform && s.uniform.buyBeforeTerm && s.uniform.daysToTerm <= 60) {
      out.push({ id: `uniform-${s.childId}-${s.uniform.termStart}`, kind: 'clothes', level: 'warn', date: s.uniform.termStart, title: `Buy ${s.name}'s uniform in ${s.uniform.buySize} before term`, detail: Object.entries(s.uniform.short).map(([t, n]) => `${n} ${t}`).join(', ') });
    }
  }
  if (chores && chores.overdue > 0) {
    const names = chores.overdueNames;
    out.push({ id: `chores-overdue-${chores.today || ''}-${chores.overdue}`, kind: 'chores', level: 'warn', date: null,
      title: chores.overdue === 1 ? `${names[0]} is overdue` : `${chores.overdue} chores are overdue`, detail: names.slice(0, 4).join(', ') });
  }
  if (chores && chores.dueToday > chores.overdue) {
    const n = chores.dueToday - chores.overdue;
    out.push({ id: `chores-today-${n}`, kind: 'chores', level: 'info', date: null, title: `${n} chore${n === 1 ? '' : 's'} to do today` });
  }
  if (calendar) {
    const list = (g) => g.items.join(', ');
    for (const g of calendar.kitToday) {
      out.push({ id: `kit-today-${calendar.today}-${g.name}`, kind: 'calendar', level: 'warn', date: calendar.today,
        title: g.name === 'Everyone' ? `Today: ${g.events.join(', ')}` : `${g.name} has ${g.events.join(' and ')} today`, detail: `Take: ${list(g)}` });
    }
    for (const g of calendar.kitTomorrow) {
      out.push({ id: `kit-tomorrow-${calendar.today}-${g.name}`, kind: 'calendar', level: 'info', date: null,
        title: g.name === 'Everyone' ? `Pack for tomorrow: ${g.events.join(', ')}` : `Pack ${g.name}'s things for ${g.events.join(' and ')} tomorrow`, detail: list(g) });
    }
    for (const e of calendar.todayList.filter((o) => !o.kit.length && o.kind !== 'birthday')) {
      out.push({ id: `event-${e.id}`, kind: 'calendar', level: 'info', date: e.date, title: `${e.title}${e.time ? ` at ${e.time}` : ''} today`, detail: e.whoNames.join(', ') || null });
    }
    for (const b of calendar.birthdays) {
      const days = Math.round((new Date(b.date + 'T12:00:00Z') - new Date(calendar.today + 'T12:00:00Z')) / 86400000);
      if (days > 14) continue;
      out.push({ id: `birthday-${b.id}-${days === 0 ? 'today' : 'soon'}`, kind: 'birthday', level: days === 0 ? 'warn' : 'info', date: b.date,
        title: days === 0 ? `Happy birthday, ${b.whoNames[0]}!` : `${b.title} is in ${days} day${days === 1 ? '' : 's'}` });
    }
  }
  for (const s of swaps) {
    if (!s.due) continue;
    const away = s.season === 'summer' ? 'winter' : 'summer';
    out.push({ id: `swap-${s.childId}-${s.season}`, kind: 'clothes', level: 'info', date: null,
      title: `Time to swap ${s.name}'s ${away} clothes for ${s.season} ones`,
      detail: [s.packAway.length ? `${s.packAway.length} to pack away` : '', s.getOut.length ? `${s.getOut.length} to get out` : '', s.outgrown.length ? `${s.outgrown.length} packed away now too small` : ''].filter(Boolean).join(', ') });
  }
  for (const t of trips) {
    const days = Math.round((new Date(t.start + 'T12:00:00Z') - Date.now()) / 86400000);
    if (days >= 0 && days <= 3 && t.packed < t.items) {
      out.push({ id: `trip-${t.id}-${days}`, kind: 'packing', level: days <= 1 ? 'warn' : 'info', date: t.start,
        title: `${t.name} ${days === 0 ? 'is today' : days === 1 ? 'is tomorrow' : `in ${days} days`}`, detail: `${t.items - t.packed} thing${t.items - t.packed === 1 ? '' : 's'} still to pack` });
    }
  }
  if (money && money.budget && ['over', 'heading-over', 'close'].includes(money.status)) {
    out.push({ id: `money-${money.month}-${money.status}`, kind: 'money', level: money.status === 'close' ? 'info' : 'warn', date: null,
      title: money.status === 'over' ? `Over this month's budget by £${Math.abs(money.left).toFixed(0)}` : money.status === 'heading-over' ? `On course to go over the budget this month` : `£${money.left.toFixed(0)} left in this month's budget`,
      detail: `£${money.spent.toFixed(0)} spent of £${money.budget}${money.status === 'heading-over' ? `, heading for about £${money.projected.toFixed(0)}` : ''}` });
  }
  // Bills: ones paid by hand when they're due (and until they're marked paid), ones that pay
  // themselves the day before they go out, and deals ending soon. Personal ones are marked, so
  // a shared screen (the kitchen) can leave them out.
  if (bills) {
    const gbp = (n) => `£${Number(n).toFixed(Number(n) % 1 ? 2 : 0)}`;
    for (const b of bills.bills) {
      if (b.done || b.days === null) continue;
      const base = { kind: 'bills', date: b.next, ...(b.personal ? { personal: true } : {}) };
      if (!b.auto && b.days <= 3) {
        out.push({ ...base, id: `bill-${b.id}-${b.next}-${b.days < 0 ? 'late' : b.days === 0 ? 'today' : 'soon'}`, level: b.days < 0 ? 'urgent' : b.days === 0 ? 'warn' : 'info',
          title: b.days < 0 ? `${b.name} was due ${-b.days === 1 ? 'yesterday' : `${-b.days} days ago`}` : b.days === 0 ? `Pay ${b.name} today` : `${b.name} is due in ${b.days} day${b.days === 1 ? '' : 's'}`,
          detail: `${gbp(b.amount)}. Mark it paid on the Bills page.` });
      } else if (b.auto && b.days === 1) {
        out.push({ ...base, id: `bill-${b.id}-${b.next}-auto`, level: 'info', title: `${gbp(b.amount)} for ${b.name} goes out tomorrow` });
      }
    }
    for (const t of bills.tips.filter((x) => x.kind === 'renewal')) {
      const b = bills.bills.find((x) => x.id === t.billId);
      out.push({ id: `bill-tip-${t.key}`, kind: 'bills', level: 'info', date: null, title: t.text, ...(b && b.personal ? { personal: true } : {}) });
    }
  }
  if (shopping > 0) out.push({ id: `shopping-${shopping}`, kind: 'shopping', level: 'info', title: `${shopping} thing${shopping === 1 ? '' : 's'} on the shopping list`, date: null });
  const rank = { urgent: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

module.exports = { reminders };
