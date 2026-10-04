// Money: the month's spending in one place. Spending is recorded on the Shopping page
// (food by default, or clothes, household, activities and other). Pocket money comes from
// chores points. With a monthly budget set, it says how the month is going.
const { HttpError } = require('../../lib/http');

const CATEGORIES = [
  ['food', 'Food shopping', '🛒'],
  ['clothes', 'Clothes and shoes', '👕'],
  ['household', 'Household', '🧽'],
  ['activities', 'Clubs and days out', '⚽'],
  ['other', 'Other', '💷'],
];
const DEFAULT = { budget: 0 };
const round = (n) => Math.round(n * 100) / 100;
const monthOf = (d) => String(d).slice(0, 7);
const shiftMonth = (m, n) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
const daysIn = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();

function overview({ entries, chores = null, clothesAhead = 0, budget = 0, month, now = new Date() }) {
  const current = now.toISOString().slice(0, 7);
  month = month || current;
  const mine = entries.filter((e) => monthOf(e.date) === month);
  const byCat = Object.fromEntries(CATEGORIES.map(([k]) => [k, 0]));
  for (const e of mine) byCat[CATEGORIES.some(([k]) => k === e.category) ? e.category : 'food'] += e.amount;

  // Pocket money earned this month (pence per point), for children only.
  let pocket = 0;
  if (chores && chores.perPoint > 0) {
    const kids = new Set(chores.people.filter((p) => !p.adult).map((p) => p.id));
    const pts = chores.log.filter((e) => monthOf(e.at) === month && kids.has(e.by)).reduce((n, e) => n + (e.effort || 1), 0);
    pocket = round((pts * chores.perPoint) / 100);
  }
  const spent = round(Object.values(byCat).reduce((a, b) => a + b, 0) + pocket);
  const isNow = month === current;
  const day = isNow ? now.getUTCDate() : daysIn(month);
  const projected = isNow && day >= 5 ? round((spent / day) * daysIn(month)) : spent;
  const history = Array.from({ length: 6 }, (_, i) => {
    const m = shiftMonth(month, i - 5);
    return { month: m, total: round(entries.filter((e) => monthOf(e.date) === m).reduce((t, e) => t + e.amount, 0)) };
  });
  const shops = new Map();
  for (const e of mine) if (e.shop) shops.set(e.shop, round((shops.get(e.shop) || 0) + e.amount));
  const prevTotal = history[4].total;
  const status = !budget ? null : spent >= budget ? 'over' : projected > budget ? 'heading-over' : spent >= budget * 0.8 ? 'close' : 'ok';
  return {
    month,
    isCurrent: isNow,
    categories: CATEGORIES.map(([key, label, emoji]) => ({ key, label, emoji, total: round(byCat[key]) })),
    pocketMoney: pocket,
    spent,
    projected,
    budget: budget || null,
    left: budget ? round(budget - spent) : null,
    status,
    lastMonth: prevTotal,
    history,
    shops: [...shops].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, total]) => ({ name, total })),
    clothesAhead: round(clothesAhead),
    entries: mine.length,
  };
}

function register(router, store, { spending, chores, clothesStats }) {
  const data = () => store.get('money', DEFAULT);
  const build = (month) => overview({
    entries: spending(),
    chores: chores && { perPoint: chores.view().perPoint, people: chores.people(), log: chores.log() },
    clothesAhead: clothesStats().reduce((n, s) => n + (s.budget ? s.budget.now : 0), 0),
    budget: data().budget || 0,
    month,
  });

  router.get('/api/v1/money', (req) => {
    const m = req.query && req.query.get('month');
    if (m && !/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new HttpError(400, 'month must look like 2026-10');
    return build(m || undefined);
  });
  router.put('/api/v1/money/budget', (req, body) => {
    const n = Number(String((body && body.budget) ?? '').replace(/[£,\s]/g, '') || 0);
    if (!Number.isFinite(n) || n < 0 || n > 50000) throw new HttpError(400, 'Monthly budget in pounds, like 600');
    data().budget = Math.round(n);
    store.save();
    return build();
  });

  return { summary: () => build(), CATEGORIES };
}

module.exports = { register, overview, CATEGORIES };
