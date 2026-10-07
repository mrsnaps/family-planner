// AI versions of the app's suggestions. Without an AI, every suggestion comes from plain
// rules (shopping/habits.js, the food engine, the clothes engine). When the household has
// an AI set up and "Use AI for suggestions" on, the same places ask the AI instead, giving
// it the household's data and the rules' answer as a starting point. Answers are checked
// against the real data (only known recipes and clothes, nothing already on the list) and
// come back in the same shape the pages already show. If the AI fails, pages keep the rules.
const { TYPES } = require('../clothes/engine');
const { canDo } = require('../chores/engine');
const { dislikes: dislikesFood, suits: suitsLunchbox } = require('../food/lunchbox');
const { notKeenText } = require('../food/ratings');

const str = { type: 'string' };
const lunchSlot = { type: 'object', properties: { name: str, itemIds: { type: 'array', items: str } }, required: ['name', 'itemIds'], additionalProperties: false };
const SCHEMAS = {
  'suggest-shopping': {
    type: 'object',
    properties: {
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['food', 'clothes', 'other'] },
            name: str,
            quantity: { type: 'number' },
            childName: str,
            size: str,
            reason: str,
          },
          required: ['kind', 'name', 'quantity', 'childName', 'size', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['suggestions'],
    additionalProperties: false,
  },
  'suggest-meals': {
    type: 'object',
    properties: {
      picks: {
        type: 'array',
        items: { type: 'object', properties: { recipeId: str, why: str }, required: ['recipeId', 'why'], additionalProperties: false },
      },
      week: { type: 'array', items: { type: 'object', properties: { day: { type: 'integer' }, recipeId: str }, required: ['day', 'recipeId'], additionalProperties: false } },
    },
    required: ['picks', 'week'],
    additionalProperties: false,
  },
  'suggest-chores': {
    type: 'object',
    properties: {
      assignments: {
        type: 'array',
        items: { type: 'object', properties: { day: { type: 'integer' }, choreId: str, personId: str }, required: ['day', 'choreId', 'personId'], additionalProperties: false },
      },
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          properties: { kind: { type: 'string', enum: ['add', 'every'] }, name: str, choreId: str, every: { type: 'integer' }, reason: str },
          required: ['kind', 'name', 'choreId', 'every', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['assignments', 'suggestions'],
    additionalProperties: false,
  },
  'suggest-packing': {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: { group: str, name: str, qty: { type: 'integer' }, detail: str },
          required: ['group', 'name', 'qty', 'detail'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
  'suggest-lunchbox': {
    type: 'object',
    properties: {
      boxes: {
        type: 'array',
        items: {
          type: 'object',
          properties: { childId: str, day: { type: 'integer' }, main: lunchSlot, snack: lunchSlot, fruit: lunchSlot, drink: lunchSlot },
          required: ['childId', 'day', 'main', 'snack', 'fruit', 'drink'],
          additionalProperties: false,
        },
      },
      toBuy: { type: 'array', items: str },
    },
    required: ['boxes', 'toBuy'],
    additionalProperties: false,
  },
  'suggest-bills': {
    type: 'object',
    properties: {
      tips: {
        type: 'array',
        items: { type: 'object', properties: { billId: str, text: str }, required: ['billId', 'text'], additionalProperties: false },
      },
    },
    required: ['tips'],
    additionalProperties: false,
  },
  'suggest-outfits': {
    type: 'object',
    properties: {
      outfits: {
        type: 'array',
        items: { type: 'object', properties: { itemIds: { type: 'array', items: str }, why: str }, required: ['itemIds', 'why'], additionalProperties: false },
      },
    },
    required: ['outfits'],
    additionalProperties: false,
  },
};

const SYSTEM = {
  'suggest-shopping':
    'You keep a UK family\'s shopping list right. Suggest what they will need to buy soon, judging from what has run out or is low, ' +
    'what they buy regularly and how often, the meals they cook most and their favourites, and what the children are short of in clothes. ' +
    'Use the rule-based suggestions as a starting point: keep the good ones, drop weak ones, add anything they missed. ' +
    'Never suggest anything already on the list or anything they said "not now" to. Food names should be short everyday names. ' +
    'For clothes give the child\'s name, the size, and the garment as one of: ' + TYPES.join(', ') + '. Use quantity 0 when it doesn\'t matter. ' +
    'Each reason is one short plain sentence a parent would find useful. At most 15 suggestions, most useful first.',
  'suggest-meals':
    'You plan dinners for a UK family using only the recipes they already have, chosen by id from the list given. ' +
    'Prefer meals they can cook with what is in, use food that goes off soon first, keep variety (avoid what they had in the last few days), ' +
    'favour their favourites and the meals the family rated well, avoid meals someone isn\'t keen on, and follow dietary needs strictly. ' +
    '"picks": up to 5 recipes to cook next, best first, each with one short reason. ' +
    '"week": a dinner for each day from 0 (today) to 6, skipping days where nothing they have would work. ' +
    'Leftovers are already cooked: put them on the first days (one night per meal\'s worth), by their "leftover:" id.',
  'suggest-lunchbox':
    'You plan school lunchboxes for a UK family\'s children, Monday to Friday (days 0 to 4), from the food they already have, ' +
    'choosing by item id from the list given. Each lunchbox has a main (such as a sandwich, wrap or pasta salad), a snack, ' +
    'a piece of fruit or some veg, and a drink (water is always fine: name "Water" with no item ids). ' +
    'Vary things through the week, use food that goes off soonest first, don\'t plan more of anything than they have, ' +
    'follow dietary needs strictly and never include anything a child won\'t eat. Keep names short, like "Ham sandwich" or "Apple". ' +
    '"toBuy": up to 8 things worth buying to fill any gaps, as short everyday names.',
  'suggest-chores':
    'You share out a UK family\'s household chores for the coming week, fairly and sensibly. ' +
    'Each chore listed is due on the days given: say who does each one, by person id, for each day. ' +
    'Only give a chore to someone old enough (its minimum age; grown-ups can do anything). Keep a chore with its fixed person if it has one. ' +
    'Balance effort points across the week, counting what each person did lately; give children age-appropriate jobs and some variety, ' +
    'and avoid the same person doing the same chore every time. ' +
    '"suggestions": up to 5 useful changes: chores worth adding for this family ("add", choreId empty), or a better repeat in days ' +
    'for an existing chore judging by how often they really do it ("every"). One short plain reason each.',
  'suggest-outfits':
    'You choose a child\'s clothes for today from their own wardrobe, by item id from the list given. ' +
    'Each outfit needs a top and a bottom, or a dress, plus shoes, and a coat or jumper when it is cold or wet. ' +
    'Only use clean items that fit. Pick colours and patterns that go together and suit the weather. ' +
    'Give up to 3 different outfits, best first, each with one short reason.',
};

SYSTEM['suggest-packing'] =
  'You write a packing list for a UK family\'s trip. Group items by person (use each child\'s name, each grown-up\'s name, ' +
  'or "Everyone" for shared things). Scale clothes to the nights away (assume washing for trips over a week), suit the weather ' +
  'and the destination, and add what children of each age need (nappies and wipes for babies, a comforter for little ones, ' +
  'something to do on the journey). For children, name real clothes from their wardrobe in "detail" when it helps; otherwise ' +
  'leave detail empty. Use the rule-based list as a starting point: keep what is right, fix quantities, add what it missed. ' +
  'qty is how many (1 when it doesn\'t matter). At most 80 items.';

SYSTEM['suggest-bills'] =
  'You help a UK family keep on top of their household bills. From the bills listed, give a few practical tips: ' +
  'deals ending or renewing soon that are worth comparing, prices that went up, subscriptions that add up, ' +
  'bills that could be cheaper paid another way (yearly instead of monthly, or by direct debit), and busy weeks to plan for. ' +
  'Use the rule-based tips as a starting point: keep the good ones, drop weak ones, add anything they missed. ' +
  'Never invent prices or companies, and don\'t give regulated financial advice. ' +
  'Each tip is one or two short plain sentences. Give the bill\'s id when a tip is about one bill, otherwise an empty string. At most 6 tips, most useful first.';

const DAY = 86400000;
const line = (p) => `- ${p.name}${p.quantity != null ? `: ${p.quantity} ${p.unit || ''}`.trimEnd() : ''}${p.expiry ? ` (use by ${p.expiry})` : ''}`;
const familyLine = (f) => {
  const kids = f.children.map((c) => `${c.name} (${c.age != null ? Math.floor(c.age) : '?'})`).join(', ');
  return `Family: ${f.adults} adult${f.adults === 1 ? '' : 's'}${kids ? ` and children ${kids}` : ''}. ` +
    (f.dietary.length ? `Dietary needs: ${f.dietary.join(', ')}.` : 'No dietary restrictions.');
};

// Recent purchases and cooking, summed up so the prompt stays small.
function habitsText(history, recipesById, now) {
  const bought = new Map();
  for (const e of history.added || []) {
    if (now - new Date(e.at) > 180 * DAY) continue;
    const g = bought.get(e.name) || { n: 0, last: e.at };
    g.n++;
    if (e.at > g.last) g.last = e.at;
    bought.set(e.name, g);
  }
  const cooked = new Map();
  for (const c of history.cooked || []) {
    if (now - new Date(c.at) > 60 * DAY) continue;
    const g = cooked.get(c.recipeId) || { n: 0, last: c.at, name: c.name || recipesById.get(c.recipeId)?.name };
    g.n++;
    if (c.at > g.last) g.last = c.at;
    cooked.set(c.recipeId, g);
  }
  const b = [...bought].sort((x, y) => y[1].n - x[1].n).slice(0, 40).map(([n, g]) => `- ${n}: ${g.n} time${g.n === 1 ? '' : 's'}, last ${g.last.slice(0, 10)}`);
  const c = [...cooked.values()].sort((x, y) => y.n - x.n).slice(0, 20).map((g) => `- ${g.name}: ${g.n} time${g.n === 1 ? '' : 's'}, last ${g.last.slice(0, 10)}`);
  return { bought: b.join('\n') || '- (nothing recorded yet)', cooked: c.join('\n') || '- (nothing recorded yet)' };
}

function createSuggesters({ familySummary, food, clothes, shopping, chores, packing = null, bills = null }) {
  const today = () => new Date().toISOString().slice(0, 10);

  const shoppingArea = {
    task: 'suggest-shopping',
    prompt() {
      const now = new Date();
      const recipesById = new Map(food.recipes().map((r) => [r.id, r]));
      const h = habitsText(food.history(), recipesById, now);
      const favs = food.favourites().map((id) => recipesById.get(id)?.name).filter(Boolean);
      const dismissed = Object.entries(shopping.dismissed()).filter(([, until]) => new Date(until) > now).map(([k]) => k.split('|')[1]);
      const list = shopping.items().filter((i) => !i.done).map((i) => `- ${i.name}${i.size ? ` (${i.size})` : ''}`);
      const kids = clothes.stats().map((s) => `- ${s.name}: wears ${s.clothingSize || '?'}, shoes ${s.shoeForecast?.currentSize || '?'}; short of ${Object.entries(s.shortfall || {}).map(([t, n]) => `${n} ${t}`).join(', ') || 'nothing'}${s.forecast ? `; moves up to ${s.forecast.nextSize} around ${s.forecast.date}` : ''}`);
      const rules = shopping.ruleSuggestions().map((s) => `- ${s.name}${s.childName ? ` for ${s.childName}` : ''}${s.size ? ` (${s.size})` : ''}: ${s.reason}`);
      return [
        `Today is ${today()}.`, familyLine(familySummary()),
        `In the kitchen now (quantity 0 means run out):\n${food.pantry().map(line).join('\n') || '- (nothing listed)'}`,
        `Added to the kitchen in the last 6 months:\n${h.bought}`,
        `Cooked in the last 2 months:\n${h.cooked}`,
        `Favourite meals: ${favs.join(', ') || 'none yet'}.`,
        `Children's clothes:\n${kids.join('\n') || '- (no children added)'}`,
        `Already on the shopping list:\n${list.join('\n') || '- (empty)'}`,
        `They said "not now" to: ${dismissed.join(', ') || 'nothing'}.`,
        `Rule-based suggestions:\n${rules.join('\n') || '- (none)'}`,
        'What should they add to the shopping list?',
      ].join('\n\n');
    },
    normalize(r) {
      const kids = familySummary().children;
      const have = new Set(shopping.items().filter((i) => !i.done).map(shopping.keyOf));
      const now = new Date();
      const dismissed = shopping.dismissed();
      const out = [];
      for (const s of Array.isArray(r.suggestions) ? r.suggestions : []) {
        const name = String(s.name || '').trim();
        if (!name) continue;
        const kind = ['food', 'clothes', 'other'].includes(s.kind) ? s.kind : 'other';
        const it = { kind, name, reason: String(s.reason || '').trim() || 'Suggested by AI', source: 'ai' };
        if (s.quantity > 0) it.quantity = s.quantity;
        if (kind === 'clothes') {
          const child = kids.find((c) => c.name.toLowerCase() === String(s.childName || '').trim().toLowerCase());
          if (child) Object.assign(it, { childId: child.id, childName: child.name });
          const type = TYPES.find((t) => name.toLowerCase().includes(t)) || null;
          if (type) it.type = type;
          if (s.size) it.size = String(s.size);
        }
        const key = shopping.keyOf(it);
        if (have.has(key) || (dismissed[key] && new Date(dismissed[key]) > now)) continue;
        have.add(key);
        out.push({ ...it, key });
      }
      return { suggestions: out.slice(0, 15) };
    },
  };

  const mealsArea = {
    task: 'suggest-meals',
    prompt() {
      const now = new Date();
      const all = food.recipes();
      const byId = new Map(all.map((r) => [r.id, r]));
      const meals = food.mealsFor(food.familyRecipes().map((r) => r.id));
      const h = habitsText(food.history(), byId, now);
      const favs = new Set(food.favourites());
      const rated = (m) => {
        const r = m.rating;
        if (!r) return '';
        const bits = [r.likedBy.length ? `liked by ${r.likedBy.join(', ')}` : '', notKeenText(r.notKeen), `rated ${r.up} up, ${r.meh} meh, ${r.down} down`].filter(Boolean);
        return ` | ${bits.join('; ')}`;
      };
      const list = meals.slice(0, 80).map((m) =>
        `- ${m.id} | ${m.name}${favs.has(m.id) ? ' (favourite)' : ''} | ${m.status === 'ready' ? 'can cook now' : `needs ${[...m.missing, ...m.short.map((s) => s.name)].join(', ')}`}${m.usesExpiring ? ' | uses food going off soon' : ''}${rated(m)}`);
      const stats = food.stats();
      const leftovers = stats.leftovers.map((l) => `- leftover:${l.id} | ${l.name} | ${l.portions ?? '?'} portions | ${l.frozen ? `in the freezer since ${l.frozen}` : `eat by ${l.expiry}`}`);
      return [
        `Today is ${today()}.`, familyLine(familySummary()) + ` About ${stats.portions} portions a meal.`,
        `In the kitchen now:\n${food.pantry().filter((p) => p.quantity !== 0 && !p.leftover).map(line).join('\n') || '- (nothing listed)'}`,
        `Leftovers to eat first (id | meal | portions | when):\n${leftovers.join('\n') || '- (none)'}`,
        `Cooked in the last 2 months:\n${h.cooked}`,
        `Their recipes (id | name | status | what the family thought):\n${list.join('\n') || '- (none)'}`,
        'Pick what they should cook next, and plan dinners for the week.',
      ].join('\n\n');
    },
    normalize(r) {
      const ok = new Map(food.familyRecipes().map((x) => [x.id, x]));
      for (const l of food.stats().leftovers) ok.set(`leftover:${l.id}`, { id: `leftover:${l.id}`, name: l.name, leftover: true });
      const seen = new Set();
      const picks = [];
      for (const p of Array.isArray(r.picks) ? r.picks : []) {
        if (!ok.has(p.recipeId) || ok.get(p.recipeId).leftover || seen.has(p.recipeId)) continue;
        seen.add(p.recipeId);
        picks.push({ id: p.recipeId, name: ok.get(p.recipeId).name, why: String(p.why || '').trim() });
      }
      const week = Array(7).fill(null);
      for (const d of Array.isArray(r.week) ? r.week : []) {
        if (Number.isInteger(d.day) && d.day >= 0 && d.day < 7 && ok.has(d.recipeId) && !week[d.day]) {
          week[d.day] = { id: d.recipeId, name: ok.get(d.recipeId).name, ...(ok.get(d.recipeId).leftover ? { leftover: true } : {}) };
        }
      }
      return { picks: picks.slice(0, 5), week };
    },
  };

  // Lunchboxes: the AI chooses from the same food the rules can use; anything it names that
  // isn't in the kitchen, doesn't suit the diet or a child won't eat is dropped.
  const lunchboxArea = food.lunchbox && {
    task: 'suggest-lunchbox',
    prompt() {
      const plan = food.lunchbox();
      const avoid = food.lunchDislikes();
      const kids = familySummary().children.filter((c) => plan.children.some((p) => p.childId === c.id))
        .map((c) => `- ${c.id} | ${c.name} | age ${c.age != null ? Math.floor(c.age) : '?'} | won't eat: ${(avoid[c.id] || []).join(', ') || 'nothing listed'}`);
      const items = food.lunchboxFood().filter((f) => suitsLunchbox(f.name, familySummary().dietary)).map((f) => `- ${f.id} | ${f.name} | ${f.kind} | enough for about ${f.left} lunchbox${f.left === 1 ? '' : 'es'}${f.expiry ? ` | use by ${f.expiry}` : ''}`);
      const slot = (s) => (s ? s.name : '(gap)');
      const rules = plan.children.flatMap((c) => c.days.map((d, i) => `- ${c.name}, day ${i}: ${slot(d.main)}; ${slot(d.snack)}; ${slot(d.fruit)}; ${slot(d.drink)}`));
      return [
        `Today is ${today()}.`, familyLine(familySummary()),
        `School days: ${plan.days.map((d, i) => `day ${i} = ${d.day} ${d.date}`).join(', ')}.`,
        `Children with a lunchbox (id | name | age | won't eat):\n${kids.join('\n') || '- (none)'}`,
        `Lunchbox food in the kitchen (id | name | kind | amount | use by):\n${items.join('\n') || '- (nothing suitable)'}`,
        `The app's own plan:\n${rules.join('\n') || '- (none)'}`,
        'Plan the lunchboxes for the week.',
      ].join('\n\n');
    },
    normalize(r) {
      const plan = food.lunchbox();
      const dietary = familySummary().dietary;
      const avoid = food.lunchDislikes();
      const items = new Map(food.lunchboxFood().filter((f) => suitsLunchbox(f.name, dietary)).map((f) => [f.id, f]));
      const kids = new Map(plan.children.map((c) => [c.childId, { childId: c.childId, name: c.name, days: plan.days.map((d) => ({ date: d.date, day: d.day, main: null, snack: null, fruit: null, drink: null })) }]));
      const clean = (s, childId, kind) => {
        if (!s || typeof s !== 'object') return null;
        const name = String(s.name || '').trim().slice(0, 60);
        const ids = [...new Set(Array.isArray(s.itemIds) ? s.itemIds : [])];
        if (!ids.length) return kind === 'drink' && /water/i.test(name) ? { name: 'Water', uses: [] } : null;
        const used = ids.map((id) => items.get(id));
        if (used.some((f) => !f || dislikesFood(f.name, avoid[childId]))) return null;
        return { name: name || used.map((f) => f.name).join(' and '), uses: used.map((f) => f.name) };
      };
      for (const b of Array.isArray(r.boxes) ? r.boxes : []) {
        const kid = kids.get(b && b.childId);
        if (!kid || !Number.isInteger(b.day) || b.day < 0 || b.day >= kid.days.length) continue;
        const box = kid.days[b.day];
        for (const kind of ['main', 'snack', 'fruit', 'drink']) if (!box[kind]) box[kind] = clean(b[kind], kid.childId, kind);
      }
      const have = new Set(food.pantry().filter((p) => p.quantity !== 0).map((p) => p.name.toLowerCase()));
      const toBuy = [...new Set((Array.isArray(r.toBuy) ? r.toBuy : []).map((x) => String(x || '').trim().slice(0, 40)).filter((x) => x && !have.has(x.toLowerCase())))].slice(0, 8);
      return { days: plan.days, children: [...kids.values()], toBuy };
    },
  };

  const usable = (childId) => clothes.items().filter((i) => i.childId === childId && !i.inWash && !i.wornOut);
  const outfitsArea = {
    task: 'suggest-outfits',
    needs: ['childId'],
    prompt({ childId, tempC, rain }) {
      const child = familySummary().children.find((c) => c.id === childId);
      if (!child) throw Object.assign(new Error('No such child'), { status: 404 });
      const items = usable(childId).map((i) => `- ${i.id} | ${i.type} | ${i.name} | ${i.colour || '?'} | ${i.pattern || 'plain'} | ${i.season || 'all'} | size ${i.size || '?'}${i.uniform ? ' | school uniform' : ''}`);
      const weather = tempC === null || tempC === undefined || tempC === '' ? 'Weather unknown.' : `Weather today: about ${tempC}°C${rain ? ', rain likely' : ', dry'}.`;
      return [
        `Today is ${today()}.`,
        `${child.name}, age ${child.age != null ? Math.floor(child.age) : '?'}, wears size ${child.clothingSize || '?'} and shoe size ${child.shoeSize || '?'}.`,
        weather,
        `Clean clothes (id | type | name | colour | pattern | season | size):\n${items.join('\n') || '- (none)'}`,
        'Choose outfits for today. Leave out school uniform unless nothing else works.',
      ].join('\n\n');
    },
    normalize(r, { childId }) {
      const items = new Map(usable(childId).map((i) => [i.id, i]));
      const outfits = [];
      for (const o of Array.isArray(r.outfits) ? r.outfits : []) {
        const picked = [...new Set(o.itemIds || [])].map((id) => items.get(id)).filter(Boolean);
        const types = new Set(picked.map((i) => i.type));
        if (!(types.has('dress') || (types.has('top') && types.has('bottom')))) continue;
        outfits.push({ items: picked.map(({ id, name, type, colour }) => ({ id, name, type, colour })), notes: o.why ? [String(o.why)] : [] });
      }
      return { childId, outfits: outfits.slice(0, 3) };
    },
  };

  // Chores: the days things are due come from the rules; the AI decides who does what.
  const choresArea = chores && {
    task: 'suggest-chores',
    prompt() {
      const v = chores.view();
      const pts = new Map(v.totals.map((t) => [t.id, t]));
      const people = v.people.map((p) => `- ${p.id} | ${p.name} | ${p.adult ? 'grown-up' : `age ${p.age != null ? Math.floor(p.age) : '?'}`} | ${pts.get(p.id)?.points || 0} points in the last week`);
      const list = v.chores.filter((c) => !c.paused).map((c) => `- ${c.id} | ${c.name} | every ${c.every} day${c.every === 1 ? '' : 's'} | effort ${c.effort} | min age ${c.minAge}${c.whoName ? ` | always ${c.whoName}` : ''}`);
      const days = v.rota.map((d, i) => `- day ${i} (${d.date}): ${d.items.map((it) => it.choreId).join(', ') || 'nothing due'}`);
      const recent = v.recent.slice(0, 30).map((e) => `- ${e.at.slice(0, 10)}: ${e.name} by ${v.people.find((p) => p.id === e.by)?.name || 'someone'}`);
      const rules = v.suggestions.map((x) => `- ${x.kind}: ${x.name}${x.every ? ` every ${x.every} days` : ''} (${x.reason})`);
      return [
        `Today is ${v.today}.`, familyLine(familySummary()),
        `People (id | name | who | effort lately):\n${people.join('\n') || '- (nobody)'}`,
        `Chores (id | name | repeat | effort 1-3 | minimum age | fixed person):\n${list.join('\n') || '- (none yet)'}`,
        `Due in the coming week (chore ids):\n${days.join('\n')}`,
        `Done lately:\n${recent.join('\n') || '- (nothing recorded yet)'}`,
        `Rule-based suggestions:\n${rules.join('\n') || '- (none)'}`,
        'Share out the week\'s chores and suggest any changes.',
      ].join('\n\n');
    },
    normalize(r) {
      const v = chores.view();
      const people = new Map(v.people.map((p) => [p.id, p]));
      const byId = new Map(v.chores.map((c) => [c.id, c]));
      const rota = v.rota.map((d) => ({ ...d, items: d.items.map((it) => ({ ...it })) }));
      for (const a of Array.isArray(r.assignments) ? r.assignments : []) {
        const day = rota[a.day];
        const p = people.get(a.personId);
        const c = byId.get(a.choreId);
        if (!day || !p || !c || c.who || !canDo(p, c)) continue;
        const it = day.items.find((x) => x.choreId === a.choreId && !x.ai);
        if (it) Object.assign(it, { who: p.id, whoName: p.name, ai: true });
      }
      for (const d of rota) for (const it of d.items) delete it.ai;
      const suggestions = [];
      for (const s of Array.isArray(r.suggestions) ? r.suggestions : []) {
        const every = Number.isInteger(s.every) && s.every >= 1 && s.every <= 365 ? s.every : null;
        const reason = String(s.reason || '').trim() || 'Suggested by AI';
        if (s.kind === 'every' && byId.has(s.choreId) && every && every !== byId.get(s.choreId).every) {
          suggestions.push({ kind: 'every', choreId: s.choreId, name: byId.get(s.choreId).name, every, reason, source: 'ai' });
        } else if (s.kind === 'add' && String(s.name || '').trim() && ![...byId.values()].some((c) => c.name.toLowerCase() === String(s.name).trim().toLowerCase())) {
          suggestions.push({ kind: 'add', name: String(s.name).trim(), every: every || 7, reason, source: 'ai' });
        }
      }
      return { rota, suggestions: suggestions.slice(0, 5) };
    },
  };

  // Packing: the AI writes the whole list for a trip; the app keeps what's already ticked.
  const packingArea = packing && {
    task: 'suggest-packing',
    needs: ['tripId'],
    prompt({ tripId }) {
      let trip;
      try {
        trip = packing.trip(tripId);
      } catch {
        throw Object.assign(new Error('No such trip'), { status: 404 });
      }
      const f = familySummary();
      const rules = packing.rules(trip);
      const going = f.children.filter((c) => !trip.who.length || trip.who.includes(c.id));
      const w = rules.weather;
      const wardrobe = going.map((c) => {
        const mine = clothes.items().filter((i) => i.childId === c.id && !i.wornOut && !i.inWash && !i.stored);
        return `- ${c.name}, age ${c.age != null ? Math.floor(c.age) : '?'}, size ${c.clothingSize || '?'}: ${mine.slice(0, 40).map((i) => `${i.name} (${i.type}${i.season && i.season !== 'all' ? `, ${i.season}` : ''})`).join('; ') || 'no clothes listed'}`;
      });
      const adults = (chores ? chores.people().filter((p) => p.adult).map((p) => p.name) : []).slice(0, f.adults);
      return [
        `Today is ${today()}.`, familyLine(f),
        `Trip: ${trip.name}${trip.destination ? ` to ${trip.destination}` : ''}, ${trip.start} to ${trip.end} (${rules.nights} night${rules.nights === 1 ? '' : 's'})${trip.abroad ? ', abroad' : ''}.`,
        `Weather: ${w.feel}${w.tempC != null ? `, about ${w.tempC}°C` : ''}${w.rain ? ', rain likely' : ''}${w.guessed ? ' (a guess from the time of year)' : ''}.`,
        `Going: ${[...(adults.length ? adults : [`${f.adults} grown-up${f.adults === 1 ? '' : 's'}`]), ...going.map((c) => c.name)].join(', ')}.`,
        `Children's wardrobes:\n${wardrobe.join('\n') || '- (no children going)'}`,
        `Rule-based list (group: item x qty):\n${rules.items.map((i) => `- ${i.group}: ${i.name} x${i.qty}`).join('\n')}`,
        'Write the packing list.',
      ].join('\n\n');
    },
    normalize(r) {
      const items = [];
      const seen = new Set();
      for (const i of Array.isArray(r.items) ? r.items : []) {
        const name = String(i.name || '').trim().slice(0, 80);
        const group = String(i.group || '').trim().slice(0, 40) || 'Everyone';
        const k = `${group}|${name}`.toLowerCase();
        if (!name || seen.has(k)) continue;
        seen.add(k);
        const qty = Number.isInteger(i.qty) && i.qty > 0 && i.qty < 1000 ? i.qty : 1;
        const kid = familySummary().children.find((c) => c.name.toLowerCase() === group.toLowerCase());
        items.push({ group, name, qty, ...(i.detail ? { detail: String(i.detail).slice(0, 200) } : {}), ...(kid ? { childId: kid.id } : {}) });
      }
      return { items: items.slice(0, 80) };
    },
  };

  // Bills: tips about the bills this person can see (the family's, and their own personal
  // ones). The answer is remembered per person (private), so nobody sees another's tips.
  const billsArea = bills && {
    task: 'suggest-bills',
    private: true,
    prompt({ member }) {
      const v = bills.view(member);
      const list = v.bills.filter((b) => !b.done).map((b) => `- ${b.id} | ${b.name} | ${b.label} | £${b.amount} ${b.every === 'once' ? 'once' : `per ${b.every}`} | next due ${b.next}${b.auto ? ' | pays itself' : ' | paid by hand'}${b.ends ? ` | deal ends ${b.ends}` : ''}${(b.changes || []).length ? ` | price changes: ${b.changes.map((c) => `${c.date} £${c.from} to £${c.to}`).join(', ')}` : ''}${b.personal ? ' | personal' : ''}`);
      return [
        `Today is ${today()}.`, familyLine(familySummary()),
        `Bills (id | name | kind | amount | next due | how it's paid | deal end | price changes):\n${list.join('\n') || '- (none yet)'}`,
        `About £${v.totals.all} a month in all; £${v.totals.leftThisMonth} still to go out this month.`,
        `Rule-based tips:\n${v.tips.map((t) => `- ${t.text}`).join('\n') || '- (none)'}`,
        'What tips would help them with their bills?',
      ].join('\n\n');
    },
    normalize(r, { member }) {
      const ids = new Set(bills.visible(member).map((b) => b.id));
      const tips = [];
      for (const t of Array.isArray(r.tips) ? r.tips : []) {
        const text = String(t.text || '').trim().slice(0, 300);
        if (!text) continue;
        // The key holds a number made from the words, not the words, as it may be kept in shared data.
        const hash = [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);
        tips.push({ key: `ai|${ids.has(t.billId) ? t.billId : ''}|${hash}`, ...(ids.has(t.billId) ? { billId: t.billId } : {}), kind: 'ai', text, source: 'ai' });
      }
      return { tips: tips.slice(0, 6) };
    },
  };

  return { shopping: shoppingArea, meals: mealsArea, ...(billsArea ? { bills: billsArea } : {}), outfits: outfitsArea, ...(choresArea ? { chores: choresArea } : {}), ...(packingArea ? { packing: packingArea } : {}), ...(lunchboxArea ? { lunchbox: lunchboxArea } : {}) };
}

module.exports = { createSuggesters, SCHEMAS, SYSTEM };
