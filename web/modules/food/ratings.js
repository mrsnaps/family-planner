// What the family thought of a dinner: each person gives a thumbs up (1), meh (0) or
// thumbs down (-1), dated. The meal rules use the summary to boost well-liked recipes and
// push down ones somebody keeps turning their nose up at.
const SCORES = { up: 1, meh: 0, down: -1 };
const LIMIT = 2000;
// Two thumbs down from the same person (and no thumbs up since) means they aren't keen.
const NOT_KEEN_AFTER = 2;

function scoreOf(v) {
  if (v === 1 || v === 0 || v === -1) return v;
  if (typeof v === 'string' && v in SCORES) return SCORES[v];
  return null;
}

// recipeId -> { up, meh, down, score, likedBy, notKeen, byPerson }
// `people` gives names (children and grown-ups); ratings from people no longer in the family still count.
function summarise(ratings, people = []) {
  const names = new Map(people.map((p) => [p.id, p.name]));
  const out = {};
  const sorted = [...(ratings || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const r of sorted) {
    const s = (out[r.recipeId] ||= { up: 0, meh: 0, down: 0, score: 0, likedBy: [], notKeen: [], byPerson: {}, downs: {} });
    if (r.score === 1) s.up++;
    else if (r.score === -1) s.down++;
    else s.meh++;
    s.byPerson[r.personId] = r.score;
    if (r.score === -1) s.downs[r.personId] = (s.downs[r.personId] || 0) + 1;
    if (r.score === 1) s.downs[r.personId] = 0; // they've come round to it
  }
  for (const s of Object.values(out)) {
    s.score = s.up - s.down;
    for (const [pid, n] of Object.entries(s.downs)) if (n >= NOT_KEEN_AFTER && names.has(pid)) s.notKeen.push(names.get(pid));
    for (const [pid, v] of Object.entries(s.byPerson)) if (v === 1 && names.has(pid)) s.likedBy.push(names.get(pid));
    delete s.downs;
  }
  return out;
}

// "Ava isn't keen", "Ava and Leo aren't keen"
function notKeenText(list) {
  if (!list || !list.length) return '';
  const who = list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  return `${who} ${list.length === 1 ? "isn't" : "aren't"} keen`;
}

// Foods a child seems not to like, from the dinners they aren't keen on: the ingredients of
// those recipes that don't also turn up in a dinner they liked.
function dislikedFoods(personId, ratings, recipes, people = []) {
  const sum = summarise(ratings, people);
  const name = (people.find((p) => p.id === personId) || {}).name;
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const bad = new Set();
  const good = new Set();
  // Cheddar in one recipe and "cheese" in another are the same thing to a child.
  const same = (n) => (/cheddar|mozzarella|parmesan/.test(n) ? 'cheese' : /mince/.test(n) ? 'mince' : n);
  for (const [id, s] of Object.entries(sum)) {
    const r = byId.get(id);
    if (!r) continue;
    const ings = r.ingredients.filter((i) => !i.optional).map((i) => same(i.name.toLowerCase()));
    if (name && s.notKeen.includes(name)) ings.forEach((n) => bad.add(n));
    if (s.byPerson[personId] === 1) ings.forEach((n) => good.add(n));
  }
  return [...bad].filter((n) => !good.has(n));
}

module.exports = { summarise, scoreOf, notKeenText, dislikedFoods, SCORES, LIMIT, NOT_KEEN_AFTER };
