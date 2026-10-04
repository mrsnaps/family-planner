// Packing lists module: HTTP routes over the engine. Owns the "packing" key in the store.
const { newId } = require('../../lib/store');
const { HttpError, text } = require('../../lib/http');
const { generate, nightsOf } = require('./engine');

const DEFAULT = { trips: [] };
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !isNaN(new Date(v));
const MAX_ITEMS = 200;

function cleanTrip(input, existing = {}, children) {
  const t = { ...existing };
  if (input.name !== undefined) t.name = text(input.name, 60);
  if (!t.name) throw new HttpError(400, 'Trip needs a name');
  if (input.destination !== undefined) t.destination = text(input.destination, 60) || null;
  for (const k of ['start', 'end']) {
    if (input[k] !== undefined) {
      if (!isDay(input[k])) throw new HttpError(400, `${k} must look like 2026-10-04`);
      t[k] = String(input[k]);
    }
  }
  if (!t.start || !t.end) throw new HttpError(400, 'When are you going and coming back?');
  if (t.end < t.start) throw new HttpError(400, 'Coming back is before going');
  if (nightsOf(t.start, t.end) > 60) throw new HttpError(400, 'Trips up to 60 nights');
  if (input.who !== undefined) {
    const who = Array.isArray(input.who) ? [...new Set(input.who.map(String))] : [];
    if (who.some((id) => !children.some((c) => c.id === id))) throw new HttpError(400, 'Unknown child');
    t.who = who;
  }
  t.who = t.who || [];
  if (input.abroad !== undefined) t.abroad = Boolean(input.abroad);
  if (input.weather !== undefined) {
    const w = input.weather || {};
    if (w.feel && !['hot', 'mild', 'cold'].includes(w.feel)) throw new HttpError(400, 'weather.feel: hot|mild|cold');
    t.weather = w.feel || w.rain ? { feel: w.feel || null, rain: Boolean(w.rain), ...(Number.isFinite(Number(w.tempC)) && w.tempC !== null && w.tempC !== '' ? { tempC: Math.round(Number(w.tempC)) } : {}) } : null;
  }
  return t;
}

function cleanItem(input, existing = {}) {
  const it = { ...existing };
  if (input.name !== undefined) it.name = text(input.name, 80);
  if (!it.name) throw new HttpError(400, 'Item needs a name');
  if (input.group !== undefined) it.group = text(input.group, 40) || 'Everyone';
  it.group = it.group || 'Everyone';
  if (input.detail !== undefined) it.detail = text(input.detail, 200) || null;
  if (input.qty !== undefined) {
    const q = Number(input.qty);
    it.qty = Number.isInteger(q) && q > 0 && q < 1000 ? q : 1;
  }
  it.qty = it.qty || 1;
  if (input.childId !== undefined) it.childId = input.childId ? String(input.childId) : null;
  if (input.packed !== undefined) it.packed = Boolean(input.packed);
  it.packed = Boolean(it.packed);
  return it;
}

function register(router, store, { family, adultNames, clothesItems }) {
  const data = () => {
    const d = store.get('packing', DEFAULT);
    if (!Array.isArray(d.trips)) d.trips = [];
    return d;
  };
  const kids = () => family().children;
  const tripOr404 = (id) => {
    const t = data().trips.find((x) => x.id === id);
    if (!t) throw new HttpError(404, 'No such trip');
    return t;
  };
  const rules = (trip) => {
    const f = family();
    return generate(trip, { adults: f.adults, adultNames: adultNames(), children: f.children, clothes: clothesItems() });
  };
  const withMeta = (t) => {
    const g = rules(t);
    return { ...t, nights: g.nights, weatherUsed: g.weather, packedCount: t.items.filter((i) => i.packed).length };
  };

  router.get('/api/v1/packing', () => ({
    trips: [...data().trips].sort((a, b) => (a.start < b.start ? -1 : 1)).map(withMeta),
  }));

  // A new trip starts with the rules' list. The app swaps in the AI's list when one is set up.
  router.post('/api/v1/packing/trips', (req, body) => {
    const t = { id: newId(), createdAt: new Date().toISOString(), ...cleanTrip(body || {}, {}, kids()) };
    t.items = rules(t).items.map((i) => ({ id: newId(), ...cleanItem(i) }));
    data().trips.push(t);
    store.save();
    return withMeta(t);
  });

  router.get('/api/v1/packing/trips/:id', (req, body, { id }) => withMeta(tripOr404(id)));

  router.put('/api/v1/packing/trips/:id', (req, body, { id }) => {
    const t = tripOr404(id);
    Object.assign(t, cleanTrip(body || {}, t, kids()));
    store.save();
    return withMeta(t);
  });

  router.delete('/api/v1/packing/trips/:id', (req, body, { id }) => {
    const d = data();
    tripOr404(id);
    d.trips = d.trips.filter((t) => t.id !== id);
    store.save();
    return { ok: true };
  });

  // Start the list again: from the rules, or from a list given (the AI's), keeping what's ticked.
  router.post('/api/v1/packing/trips/:id/rebuild', (req, body, { id }) => {
    const t = tripOr404(id);
    const given = Array.isArray(body && body.items) ? body.items : null;
    if (given && (!given.length || given.length > MAX_ITEMS)) throw new HttpError(400, `Between 1 and ${MAX_ITEMS} items`);
    const fresh = (given || rules(t).items).map((i) => cleanItem(i));
    const packed = new Set(t.items.filter((i) => i.packed).map((i) => `${i.group}|${i.name}`.toLowerCase()));
    const kept = t.items.filter((i) => i.custom);
    t.items = [...fresh.map((i) => ({ id: newId(), ...i, packed: packed.has(`${i.group}|${i.name}`.toLowerCase()) })), ...kept];
    if (body && body.by) t.by = text(body.by, 60);
    else delete t.by;
    store.save();
    return withMeta(t);
  });

  router.post('/api/v1/packing/trips/:id/items', (req, body, { id }) => {
    const t = tripOr404(id);
    if (t.items.length >= MAX_ITEMS) throw new HttpError(400, 'That list is full');
    const it = { id: newId(), ...cleanItem(body || {}), custom: true };
    t.items.push(it);
    store.save();
    return withMeta(t);
  });

  router.put('/api/v1/packing/trips/:id/items/:itemId', (req, body, { id, itemId }) => {
    const t = tripOr404(id);
    const i = t.items.findIndex((x) => x.id === itemId);
    if (i < 0) throw new HttpError(404, 'No such item');
    t.items[i] = cleanItem(body || {}, t.items[i]);
    store.save();
    return withMeta(t);
  });

  router.delete('/api/v1/packing/trips/:id/items/:itemId', (req, body, { id, itemId }) => {
    const t = tripOr404(id);
    const before = t.items.length;
    t.items = t.items.filter((x) => x.id !== itemId);
    if (t.items.length === before) throw new HttpError(404, 'No such item');
    store.save();
    return withMeta(t);
  });

  // Untick everything (for the trip home).
  router.post('/api/v1/packing/trips/:id/reset', (req, body, { id }) => {
    const t = tripOr404(id);
    for (const i of t.items) i.packed = false;
    store.save();
    return withMeta(t);
  });

  const upcoming = () => {
    const today = new Date().toISOString().slice(0, 10);
    return data().trips.filter((t) => t.end >= today).sort((a, b) => (a.start < b.start ? -1 : 1))
      .map((t) => ({ id: t.id, name: t.name, start: t.start, end: t.end, items: t.items.length, packed: t.items.filter((i) => i.packed).length }));
  };

  return { trip: tripOr404, rules, upcoming, trips: () => data().trips };
}

module.exports = { register };
