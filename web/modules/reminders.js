// Reminders gathered from every tool, newest-urgent first. The web app shows them on
// Home; the phone app can turn them into notifications. Each has a stable id so a
// client can tell which ones it has already shown.
function reminders({ food, clothes, shopping }) {
  const out = [];
  for (const e of food.expiringSoon) {
    out.push({
      id: `food-expiry-${e.id}-${e.expiry}`, kind: 'food', level: e.days <= 0 ? 'urgent' : 'warn', date: e.expiry,
      title: e.days < 0 ? `${e.name} is out of date` : e.days === 0 ? `Use the ${e.name} today` : `${e.name} goes off in ${e.days} day${e.days === 1 ? '' : 's'}`,
    });
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
  if (shopping > 0) out.push({ id: `shopping-${shopping}`, kind: 'shopping', level: 'info', title: `${shopping} thing${shopping === 1 ? '' : 's'} on the shopping list`, date: null });
  const rank = { urgent: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

module.exports = { reminders };
