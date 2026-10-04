// Shopping suggestions from the household's own habits, worked out with plain rules (no AI):
// food that has run out, things bought regularly that are due again, and what's missing for
// the meals the family cooks most or has marked as favourites.
const DAY = 86400000;
const RECENT_DAYS = 180; // purchases older than this don't count towards a habit
const OFTEN_DAYS = 60; // "cooked lately" window
const MAX_GAP = 45; // only things bought at least this often count as regulars

// "Tins of tomatoes" and "tin of tomato" are the same thing for matching.
const norm = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/(es|s)$/, '');
const days = (ms) => Math.round(ms / DAY);
const amount = (e) => (e.quantity ? ` ${e.quantity}${e.unit && e.unit !== 'pcs' ? ' ' + e.unit : ''}` : '');

function habitSuggestions({ history = {}, pantry = [], favourites = [], mealsFor = () => [], now = new Date() }) {
  const out = [];
  const seen = new Set();
  const add = (s) => {
    const k = norm(s.name);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ kind: 'food', ...s });
  };
  const inStock = new Set(pantry.filter((p) => p.quantity === null || p.quantity === undefined || p.quantity > 0).map((p) => norm(p.name)));

  // 1. Run out: still listed in the cupboard, but none left.
  for (const p of pantry) {
    if (p.quantity === 0 && !inStock.has(norm(p.name))) add({ name: p.name, reason: 'Ran out', source: 'ran-out' });
  }

  // 2. Regulars: bought on 2 or more different days, and due again going by the usual gap.
  const byItem = new Map();
  for (const e of history.added || []) {
    const at = new Date(e.at);
    if (now - at > RECENT_DAYS * DAY) continue;
    const k = norm(e.name);
    if (!byItem.has(k)) byItem.set(k, { name: e.name, last: e, days: new Set() });
    const g = byItem.get(k);
    g.days.add(e.at.slice(0, 10));
    if (e.at >= g.last.at) g.last = e;
  }
  const regulars = [];
  for (const [k, g] of byItem) {
    if (g.days.size < 2 || inStock.has(k)) continue;
    const dates = [...g.days].sort().map((d) => new Date(d));
    const gap = Math.max(1, (dates[dates.length - 1] - dates[0]) / DAY / (dates.length - 1));
    const since = (now - new Date(g.last.at)) / DAY;
    if (gap > MAX_GAP || since < gap * 0.8) continue;
    regulars.push({
      name: g.last.name,
      reason: `You buy this about every ${days(gap * DAY) === 7 ? 'week' : plural(days(gap * DAY), 'day')}${amount(g.last) ? `, usually${amount(g.last)}` : ''}`,
      source: 'regular',
      overdue: since / gap,
    });
  }
  regulars.sort((a, b) => b.overdue - a.overdue).forEach(({ overdue, ...s }) => add(s));

  // 3. Meals the family cooks often, or has starred: what's missing or running short for them.
  const counts = new Map();
  for (const c of history.cooked || []) {
    if (now - new Date(c.at) > OFTEN_DAYS * DAY) continue;
    counts.set(c.recipeId, (counts.get(c.recipeId) || 0) + 1);
  }
  const often = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const ids = [...new Set([...often, ...favourites])].slice(0, 10);
  if (ids.length) {
    const meals = mealsFor(ids).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    for (const m of meals) {
      const n = counts.get(m.id) || 0;
      const why = n >= 2 ? `cooked ${n} times lately` : 'a favourite';
      for (const name of [...m.missing, ...m.short.map((x) => x.name)]) add({ name, reason: `For ${m.name}, ${why}`, source: 'usual-meal' });
    }
  }
  return out;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

module.exports = { habitSuggestions, norm };
