// Reminders gathered from every tool, newest-urgent first. The web app shows them on
// Home; the phone app can turn them into notifications. Each has a stable id so a
// client can tell which ones it has already shown.
function reminders({ food, clothes, shopping, chores = null }) {
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
  if (shopping > 0) out.push({ id: `shopping-${shopping}`, kind: 'shopping', level: 'info', title: `${shopping} thing${shopping === 1 ? '' : 's'} on the shopping list`, date: null });
  const rank = { urgent: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

module.exports = { reminders };
