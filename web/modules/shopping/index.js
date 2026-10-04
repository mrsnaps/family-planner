// Shopping list: shared by both tools. Holds items you add yourself, and suggests
// items from the household's habits (habits.js: run out, regulars, usual meals), the
// food planner (what's missing for nearly-ready meals) and the clothes matcher (what
// each child is short of, now or in their next size). All rules, no AI.
// Ticking an item as bought puts it in the pantry or the child's wardrobe.
const { newId } = require('../../lib/store');
const { habitSuggestions, usuals, lastShop, norm } = require('./habits');
const { HttpError, text } = require('../../lib/http');

const DEFAULT = { items: [] };
const SNOOZE_DAYS = 14; // "Not now" hides a suggestion for this long
const KINDS = ['food', 'clothes', 'other'];
const SPEND_CATEGORIES = ['food', 'clothes', 'household', 'activities', 'other'];

function suggest({ meals, clothesStats, existing, habits = [], dismissed = {}, now = new Date() }) {
  const have = new Set(existing.filter((i) => !i.done).map((i) => keyOf(i)));
  const out = [];
  const add = (s) => {
    const key = keyOf(s);
    if (have.has(key) || (dismissed[key] && new Date(dismissed[key]) > now)) return;
    have.add(key);
    out.push({ ...s, key });
  };

  // Food from the household's own habits first: run out, regulars due, usual meals.
  habits.forEach(add);

  // Food: ingredients that would unlock a meal, counted by how many meals they unlock.
  const unlocks = new Map();
  for (const m of meals) {
    const need = [...m.missing, ...m.short.map((x) => x.name)];
    if (!need.length || need.length > 2) continue;
    for (const n of need) {
      if (!unlocks.has(n)) unlocks.set(n, []);
      unlocks.get(n).push(m.name);
    }
  }
  [...unlocks.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 12)
    .forEach(([name, forMeals]) =>
      add({ kind: 'food', name, reason: `For ${forMeals.slice(0, 3).join(', ')}${forMeals.length > 3 ? ` +${forMeals.length - 3} more` : ''}` })
    );

  // Clothes: shortfall in the current size, then the next size when it's close.
  for (const s of clothesStats) {
    for (const [type, n] of Object.entries(s.shortfall)) {
      const size = type === 'shoes' ? s.shoeForecast?.currentSize : s.clothingSize;
      add({ kind: 'clothes', name: type, quantity: n, childId: s.childId, childName: s.name, size: size || null, type, reason: `${s.name} is short` });
    }
    if (s.forecast && s.forecast.daysLeft <= 90 && s.nextSizeNeeds) {
      for (const [type, n] of Object.entries(s.nextSizeNeeds)) {
        add({ kind: 'clothes', name: type, quantity: n, childId: s.childId, childName: s.name, size: s.forecast.nextSize, type, reason: `${s.name} moves up around ${s.forecast.date}` });
      }
    }
    if (s.shoeForecast && s.shoeForecast.daysLeft <= 30) {
      add({ kind: 'clothes', name: 'shoes', quantity: 1, childId: s.childId, childName: s.name, size: s.shoeForecast.nextSize, type: 'shoes', reason: `Feet growing, check fit around ${s.shoeForecast.date}` });
    }
  }
  return out;
}

const keyOf = (i) => [i.kind, i.kind === 'food' ? norm(i.name) : String(i.name).toLowerCase(), i.childId || '', i.size || ''].join('|');

function clean(input, existing = {}) {
  const it = { ...existing };
  for (const k of ['name', 'unit', 'childId', 'size', 'type', 'kind', 'note']) {
    if (input[k] !== undefined) it[k] = input[k] === null || input[k] === '' ? null : text(input[k], k === 'note' ? 200 : k === 'name' ? 80 : 40);
  }
  if (input.quantity !== undefined) {
    const q = input.quantity === '' || input.quantity === null ? null : Number(input.quantity);
    if (q !== null && (!Number.isFinite(q) || q < 0)) throw new HttpError(400, 'quantity must be a number');
    it.quantity = q;
  }
  if (input.done !== undefined) it.done = Boolean(input.done);
  if (!it.name) throw new HttpError(400, 'Item needs a name');
  it.kind = it.kind || 'other';
  if (!KINDS.includes(it.kind)) throw new HttpError(400, `kind must be one of ${KINDS.join(', ')}`);
  it.done = Boolean(it.done);
  return it;
}

// Food spending: totals from receipts, added by hand. Shows this month against last, a
// typical week, and roughly what each dinner cooked costs.
function spendingSummary(entries, cooked = [], now = new Date()) {
  const month = (d) => d.slice(0, 7);
  const thisMonth = now.toISOString().slice(0, 7);
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const sum = (list) => Math.round(list.reduce((t, e) => t + e.amount, 0) * 100) / 100;
  const mine = entries.filter((e) => month(e.date) === thisMonth);
  const since = new Date(now - 56 * 86400000).toISOString().slice(0, 10);
  const recent = entries.filter((e) => e.date >= since);
  const first = recent.reduce((m, e) => (e.date < m ? e.date : m), now.toISOString().slice(0, 10));
  const weeks = Math.max(1, Math.min(8, (now - new Date(first)) / (7 * 86400000)));
  const dinners = cooked.filter((c) => c.at.slice(0, 7) === thisMonth).length;
  return {
    thisMonth: sum(mine),
    lastMonth: sum(entries.filter((e) => month(e.date) === prev)),
    perWeek: recent.length ? Math.round((sum(recent) / weeks) * 100) / 100 : null,
    dinnersCooked: dinners,
    perDinner: dinners >= 3 && mine.length ? Math.round((sum(mine) / dinners) * 100) / 100 : null,
  };
}

function register(router, store, { meals, mealsFor, foodHistory, favourites, pantry, clothesStats, addPantryItem, addClothesItem }) {
  const data = () => store.get('shopping', DEFAULT);
  const dismissed = () => (data().dismissed ||= {});

  const ruleSuggestions = () => suggest({
    meals: meals(),
    clothesStats: clothesStats(),
    existing: data().items,
    habits: habitSuggestions({ history: foodHistory(), pantry: pantry(), favourites: favourites(), mealsFor }),
    dismissed: dismissed(),
  });
  // Who added something (the signed-in person's email, sent by the app), and the names they go by.
  const who = (req) => (req && req.headers && req.headers['x-family-member']) || null;
  const people = () => (data().people ||= {});
  const newItem = (req, input) => ({ id: newId(), addedAt: new Date().toISOString(), ...clean(input), ...(who(req) ? { addedBy: who(req) } : {}) });

  const onList = () => new Set(data().items.filter((i) => !i.done).map(keyOf));
  // One-tap regulars (leaving out what's already on the list) and the last big shop.
  const quick = () => {
    const have = onList();
    const shop = lastShop({ history: foodHistory() });
    return {
      usuals: usuals({ history: foodHistory() }).filter((u) => !have.has(keyOf({ kind: 'food', ...u }))),
      lastShop: shop && { date: shop.date, count: shop.items.length, missing: shop.items.filter((i) => !have.has(keyOf({ kind: 'food', ...i }))).length },
    };
  };
  router.get('/api/v1/shopping', () => ({ items: data().items, suggestions: ruleSuggestions(), people: people(), ...quick() }));

  router.put('/api/v1/shopping/people/me', (req, body) => {
    const email = who(req);
    if (!email) throw new HttpError(400, 'Sign in to set your name');
    const name = String((body && body.name) || '').trim().slice(0, 30);
    if (name) people()[email] = name;
    else delete people()[email];
    store.save();
    return { email, name: name || null };
  });

  // Several things at once (a week's shop, a meal's missing ingredients). Skips what's already on the list.
  router.post('/api/v1/shopping/items/bulk', (req, body) => {
    if (!body || !Array.isArray(body.items)) throw new HttpError(400, 'Send a list of items');
    const have = onList();
    const added = [];
    for (const input of body.items.slice(0, 100)) {
      const item = newItem(req, { kind: 'food', ...input });
      if (have.has(keyOf(item))) continue;
      have.add(keyOf(item));
      added.push(item);
    }
    data().items.push(...added);
    store.save();
    return { added: added.length, skipped: Math.min(body.items.length, 100) - added.length, items: added };
  });

  // "Same as last shop": put everything from the last big shop back on the list.
  router.post('/api/v1/shopping/repeat-last-shop', (req) => {
    const shop = lastShop({ history: foodHistory() });
    if (!shop) throw new HttpError(404, 'No earlier shop to copy yet. Add a few things to the cupboard on the day you shop.');
    const have = onList();
    const added = [];
    for (const i of shop.items) {
      const item = { kind: 'food', name: i.name, quantity: i.quantity, unit: i.unit };
      if (have.has(keyOf(item))) continue;
      have.add(keyOf(item));
      added.push(newItem(req, item));
    }
    data().items.push(...added);
    store.save();
    return { date: shop.date, added: added.length, skipped: shop.items.length - added.length };
  });

  // "Not now": hide a suggestion for a while. It comes back if it's still true later.
  router.post('/api/v1/shopping/suggestions/dismiss', (req, body) => {
    if (!body || typeof body.key !== 'string' || !body.key || body.key.length > 200) throw new HttpError(400, 'Which suggestion? (key)');
    const d = dismissed();
    const now = Date.now();
    for (const [k, until] of Object.entries(d)) if (new Date(until) < now) delete d[k];
    d[body.key] = new Date(now + SNOOZE_DAYS * 86400000).toISOString();
    store.save();
    return { ok: true, until: d[body.key] };
  });

  router.post('/api/v1/shopping/items', (req, body) => {
    const item = newItem(req, body);
    data().items.push(item);
    store.save();
    return item;
  });

  router.put('/api/v1/shopping/items/:id', (req, body, { id }) => {
    const items = data().items;
    const i = items.findIndex((x) => x.id === id);
    if (i < 0) throw new HttpError(404, 'No such item');
    items[i] = clean(body, items[i]);
    store.save();
    return items[i];
  });

  router.delete('/api/v1/shopping/items/:id', (req, body, { id }) => {
    const d = data();
    const before = d.items.length;
    d.items = d.items.filter((x) => x.id !== id);
    if (d.items.length === before) throw new HttpError(404, 'No such item');
    store.save();
    return { ok: true };
  });

  // Bought it: food goes into the pantry, clothes into the child's wardrobe,
  // and the item leaves the list. Body can add details (quantity, unit, colour...).
  function bought(item, body = {}) {
    let added = null;
    if (item.kind === 'food') {
      added = addPantryItem({
        name: body.name || item.name,
        quantity: body.quantity ?? item.quantity,
        unit: body.unit || item.unit || 'pcs',
        expiry: body.expiry || null,
      });
    } else if (item.kind === 'clothes' && item.childId) {
      const count = Math.max(1, Math.min(20, Number(body.count ?? item.quantity ?? 1) || 1));
      added = [];
      for (let n = 0; n < count; n++) {
        added.push(addClothesItem({
          childId: item.childId,
          name: body.name || `New ${item.type || item.name}`,
          type: item.type || 'other',
          size: item.size,
          colour: body.colour || '',
        }));
      }
    }
    return added;
  }

  router.post('/api/v1/shopping/items/:id/bought', (req, body, { id }) => {
    const d = data();
    const item = d.items.find((x) => x.id === id);
    if (!item) throw new HttpError(404, 'No such item');
    const added = bought(item, body || {});
    d.items = d.items.filter((x) => x.id !== id);
    store.save();
    return { ok: true, added };
  });

  // Back from the shops: everything ticked goes into the cupboard or wardrobe in one go.
  router.post('/api/v1/shopping/bought-ticked', () => {
    const d = data();
    const ticked = d.items.filter((x) => x.done);
    const left = new Set(); // anything that can't be put away stays on the list
    let food = 0;
    let clothes = 0;
    for (const item of ticked) {
      try {
        const added = bought(item);
        if (item.kind === 'food') food += 1;
        else if (added) clothes += added.length;
      } catch {
        left.add(item.id);
      }
    }
    d.items = d.items.filter((x) => !x.done || left.has(x.id));
    store.save();
    return { ok: true, items: ticked.length - left.size, food, clothes, ...(left.size ? { notDone: left.size } : {}) };
  });

  const spending = () => (data().spending ||= []);
  const spendingView = () => ({
    entries: [...spending()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 30),
    ...spendingSummary(spending().filter((e) => !e.category || e.category === 'food'), foodHistory().cooked || []),
  });
  router.get('/api/v1/spending', () => spendingView());
  router.post('/api/v1/spending', (req, body) => {
    const amount = Number(String((body && body.amount) ?? '').replace(/[£,\s]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 5000) throw new HttpError(400, 'Enter how much it came to, like 64.20');
    const date = body.date && !isNaN(new Date(body.date)) ? new Date(body.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    const category = SPEND_CATEGORIES.includes(body.category) ? body.category : 'food';
    const entry = { id: newId(), amount: Math.round(amount * 100) / 100, date, shop: String(body.shop || '').trim().slice(0, 40) || null, ...(category !== 'food' ? { category } : {}), ...(who(req) ? { addedBy: who(req) } : {}) };
    spending().push(entry);
    store.save();
    return { entry, ...spendingView() };
  });
  router.delete('/api/v1/spending/:id', (req, body, { id }) => {
    const d = data();
    const before = spending().length;
    d.spending = d.spending.filter((e) => e.id !== id);
    if (d.spending.length === before) throw new HttpError(404, 'No such entry');
    store.save();
    return spendingView();
  });

  router.post('/api/v1/shopping/clear-done', () => {
    const d = data();
    d.items = d.items.filter((x) => !x.done);
    store.save();
    return { ok: true };
  });

  return { spending, count: () => data().items.filter((i) => !i.done).length, items: () => data().items, dismissed, ruleSuggestions, keyOf };
}

module.exports = { register, suggest, spendingSummary };
