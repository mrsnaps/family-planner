// AI versions of the app's suggestions. Without an AI, every suggestion comes from plain
// rules (shopping/habits.js, the food engine, the clothes engine). When the household has
// an AI set up and "Use AI for suggestions" on, the same places ask the AI instead, giving
// it the household's data and the rules' answer as a starting point. Answers are checked
// against the real data (only known recipes and clothes, nothing already on the list) and
// come back in the same shape the pages already show. If the AI fails, pages keep the rules.
const { TYPES } = require('../clothes/engine');

const str = { type: 'string' };
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
    'favour their favourites, and follow dietary needs strictly. "picks": up to 5 recipes to cook next, best first, each with one short reason. ' +
    '"week": a dinner for each day from 0 (today) to 6, skipping days where nothing they have would work.',
  'suggest-outfits':
    'You choose a child\'s clothes for today from their own wardrobe, by item id from the list given. ' +
    'Each outfit needs a top and a bottom, or a dress, plus shoes, and a coat or jumper when it is cold or wet. ' +
    'Only use clean items that fit. Pick colours and patterns that go together and suit the weather. ' +
    'Give up to 3 different outfits, best first, each with one short reason.',
};

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

function createSuggesters({ familySummary, food, clothes, shopping }) {
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
      const list = meals.slice(0, 80).map((m) =>
        `- ${m.id} | ${m.name}${favs.has(m.id) ? ' (favourite)' : ''} | ${m.status === 'ready' ? 'can cook now' : `needs ${[...m.missing, ...m.short.map((s) => s.name)].join(', ')}`}${m.usesExpiring ? ' | uses food going off soon' : ''}`);
      return [
        `Today is ${today()}.`, familyLine(familySummary()),
        `In the kitchen now:\n${food.pantry().filter((p) => p.quantity !== 0).map(line).join('\n') || '- (nothing listed)'}`,
        `Cooked in the last 2 months:\n${h.cooked}`,
        `Their recipes (id | name | status):\n${list.join('\n') || '- (none)'}`,
        'Pick what they should cook next, and plan dinners for the week.',
      ].join('\n\n');
    },
    normalize(r) {
      const ok = new Map(food.familyRecipes().map((x) => [x.id, x]));
      const seen = new Set();
      const picks = [];
      for (const p of Array.isArray(r.picks) ? r.picks : []) {
        if (!ok.has(p.recipeId) || seen.has(p.recipeId)) continue;
        seen.add(p.recipeId);
        picks.push({ id: p.recipeId, name: ok.get(p.recipeId).name, why: String(p.why || '').trim() });
      }
      const week = Array(7).fill(null);
      for (const d of Array.isArray(r.week) ? r.week : []) {
        if (Number.isInteger(d.day) && d.day >= 0 && d.day < 7 && ok.has(d.recipeId) && !week[d.day]) week[d.day] = { id: d.recipeId, name: ok.get(d.recipeId).name };
      }
      return { picks: picks.slice(0, 5), week };
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

  return { shopping: shoppingArea, meals: mealsArea, outfits: outfitsArea };
}

module.exports = { createSuggesters, SCHEMAS, SYSTEM };
