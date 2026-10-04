// Shopping list: shared by both tools. Holds items you add yourself, and suggests
// items from the food planner (what's missing for nearly-ready meals) and the
// clothes matcher (what each child is short of, now or in their next size).
// Ticking an item as bought puts it in the pantry or the child's wardrobe.
const { newId } = require('../../lib/store');
const { HttpError } = require('../../lib/http');

const DEFAULT = { items: [] };
const KINDS = ['food', 'clothes', 'other'];

function suggest({ meals, clothesStats, existing }) {
  const have = new Set(existing.filter((i) => !i.done).map((i) => keyOf(i)));
  const out = [];
  const add = (s) => {
    if (have.has(keyOf(s))) return;
    have.add(keyOf(s));
    out.push(s);
  };

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

const keyOf = (i) => [i.kind, String(i.name).toLowerCase(), i.childId || '', i.size || ''].join('|');

function clean(input, existing = {}) {
  const it = { ...existing };
  for (const k of ['name', 'unit', 'childId', 'size', 'type', 'kind', 'note']) {
    if (input[k] !== undefined) it[k] = input[k] === null || input[k] === '' ? null : String(input[k]).trim();
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

function register(router, store, { meals, clothesStats, addPantryItem, addClothesItem }) {
  const data = () => store.get('shopping', DEFAULT);

  router.get('/api/v1/shopping', () => ({
    items: data().items,
    suggestions: suggest({ meals: meals(), clothesStats: clothesStats(), existing: data().items }),
  }));

  router.post('/api/v1/shopping/items', (req, body) => {
    const item = { id: newId(), addedAt: new Date().toISOString(), ...clean(body) };
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
  router.post('/api/v1/shopping/items/:id/bought', (req, body, { id }) => {
    const d = data();
    const item = d.items.find((x) => x.id === id);
    if (!item) throw new HttpError(404, 'No such item');
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
    d.items = d.items.filter((x) => x.id !== id);
    store.save();
    return { ok: true, added };
  });

  router.post('/api/v1/shopping/clear-done', () => {
    const d = data();
    d.items = d.items.filter((x) => !x.done);
    store.save();
    return { ok: true };
  });

  return { count: () => data().items.filter((i) => !i.done).length };
}

module.exports = { register, suggest };
