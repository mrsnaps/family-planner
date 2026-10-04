// Clothes module: HTTP routes over the engine. Owns the "clothes" key in the store.
const { newId } = require('../../lib/store');
const { HttpError, text } = require('../../lib/http');
const { TYPES, DEFAULT_TARGETS, DEFAULT_PRICES, outfitsFor, outfitOfTheDay, childStats, handMeDowns } = require('./engine');
const { normalise, BANDS } = require('./sizes');

const DEFAULT = { items: [], targets: DEFAULT_TARGETS, prices: DEFAULT_PRICES };

function cleanItem(input, existing = {}, children) {
  const it = { ...existing };
  for (const k of ['name', 'colour', 'size', 'childId', 'type', 'pattern', 'season']) {
    if (input[k] !== undefined) it[k] = input[k] === null ? null : text(input[k], k === 'name' ? 80 : 40);
  }
  if (input.wornOut !== undefined) it.wornOut = Boolean(input.wornOut);
  if (input.inWash !== undefined) it.inWash = Boolean(input.inWash);
  if (input.uniform !== undefined) it.uniform = Boolean(input.uniform);
  if (!it.name) throw new HttpError(400, 'Item needs a name');
  if (!TYPES.includes(it.type)) throw new HttpError(400, `type must be one of ${TYPES.join(', ')}`);
  if (!children.some((c) => c.id === it.childId)) throw new HttpError(400, 'Unknown childId');
  if (it.pattern && !['plain', 'patterned'].includes(it.pattern)) throw new HttpError(400, 'pattern: plain|patterned');
  if (it.season && !['all', 'summer', 'winter'].includes(it.season)) throw new HttpError(400, 'season: all|summer|winter');
  if (it.type !== 'shoes' && it.size) it.size = normalise(it.size);
  it.pattern = it.pattern || 'plain';
  it.season = it.season || 'all';
  it.wornOut = Boolean(it.wornOut);
  it.inWash = Boolean(it.inWash);
  it.uniform = Boolean(it.uniform);
  return it;
}

function register(router, store, family) {
  const data = () => store.get('clothes', DEFAULT);
  const childOr404 = (id) => {
    const c = family().children.find((x) => x.id === id);
    if (!c) throw new HttpError(404, 'No such child');
    return c;
  };

  router.get('/api/v1/clothes/meta', () => ({ types: TYPES, sizes: BANDS }));

  router.get('/api/v1/clothes/items', (req) => {
    const childId = req.query.get('childId');
    const items = data().items;
    return childId ? items.filter((i) => i.childId === childId) : items;
  });

  const addItem = (body) => {
    const item = { id: newId(), ...cleanItem(body, {}, family().children) };
    data().items.push(item);
    store.save();
    return item;
  };
  router.post('/api/v1/clothes/items', (req, body) => addItem(body));

  // Add many at once (AI photo scans, the phone app). All or nothing.
  router.post('/api/v1/clothes/items/bulk', (req, body) => {
    if (!Array.isArray(body.items) || !body.items.length) throw new HttpError(400, 'items must be a non-empty array');
    if (body.items.length > 200) throw new HttpError(400, 'At most 200 items at once');
    const items = body.items.map((b) => ({ id: newId(), ...cleanItem(b, {}, family().children) }));
    data().items.push(...items);
    store.save();
    return items;
  });

  // Laundry day: everything (or one child's things) back out of the wash.
  router.post('/api/v1/clothes/laundry/done', (req, body) => {
    let n = 0;
    for (const it of data().items) {
      if (it.inWash && (!body.childId || it.childId === body.childId)) { it.inWash = false; n++; }
    }
    store.save();
    return { ok: true, cleaned: n };
  });

  router.get('/api/v1/clothes/hand-me-downs', () => handMeDowns(family().children, data().items));

  router.post('/api/v1/clothes/items/:id/hand-down', (req, body, { id }) => {
    const it = data().items.find((x) => x.id === id);
    if (!it) throw new HttpError(404, 'No such item');
    childOr404(body.childId);
    it.childId = body.childId;
    store.save();
    return it;
  });

  // Pass every outgrown thing that fits a sibling to them in one go (optionally from one child).
  router.post('/api/v1/clothes/hand-down-all', (req, body) => {
    const list = handMeDowns(family().children, data().items)
      .filter((h) => (!body.toChildId || h.toChildId === body.toChildId) && (!body.fromChildId || h.fromChildId === body.fromChildId));
    for (const h of list) data().items.find((x) => x.id === h.itemId).childId = h.toChildId;
    store.save();
    return { moved: list.length };
  });

  router.put('/api/v1/clothes/items/:id', (req, body, { id }) => {
    const items = data().items;
    const i = items.findIndex((x) => x.id === id);
    if (i < 0) throw new HttpError(404, 'No such item');
    items[i] = cleanItem(body, items[i], family().children);
    store.save();
    return items[i];
  });

  router.delete('/api/v1/clothes/items/:id', (req, body, { id }) => {
    const d = data();
    const before = d.items.length;
    d.items = d.items.filter((x) => x.id !== id);
    if (d.items.length === before) throw new HttpError(404, 'No such item');
    store.save();
    return { ok: true };
  });

  router.get('/api/v1/clothes/targets', () => data().targets);
  router.put('/api/v1/clothes/targets', (req, body) => {
    const t = {};
    for (const [k, v] of Object.entries(body)) {
      const n = Number(v);
      if (!TYPES.includes(k) || !Number.isInteger(n) || n < 0) throw new HttpError(400, `Bad target ${k}`);
      t[k] = n;
    }
    data().targets = t;
    store.save();
    return t;
  });

  // Shared query options: season, uniform (exclude|only|any), and optional weather.
  const outfitOpts = (q) => {
    const t = q.get('tempC');
    return {
      season: q.get('season') || 'any',
      uniform: ['only', 'any'].includes(q.get('uniform')) ? q.get('uniform') : 'exclude',
      tempC: t === null || t === '' || !Number.isFinite(Number(t)) ? null : Number(t),
      rain: q.get('rain') === '1' || q.get('rain') === 'true',
    };
  };

  router.get('/api/v1/clothes/outfits/:childId', (req, body, { childId }) => {
    const child = childOr404(childId);
    const limit = Math.min(Number(req.query.get('limit')) || 50, 500);
    return outfitsFor(child, data().items, { ...outfitOpts(req.query), limit });
  });

  router.get('/api/v1/clothes/outfit-of-the-day/:childId', (req, body, { childId }) => {
    const child = childOr404(childId);
    const opts = outfitOpts(req.query);
    const r = outfitOfTheDay(child, data().items, {
      ...opts,
      date: req.query.get('date') || undefined,
      shuffle: Number(req.query.get('shuffle')) || 0,
    });
    let weather = null;
    if (opts.tempC !== null) {
      weather = opts.tempC < 12 ? 'Cold today: coat on.' : opts.tempC >= 20 ? 'Warm today: light clothes.' : 'Mild today.';
      if (opts.rain) weather += ' Rain is likely.';
    }
    return { childId, ...r, weather };
  });

  router.get('/api/v1/clothes/prices', () => data().prices || DEFAULT_PRICES);
  router.put('/api/v1/clothes/prices', (req, body) => {
    const p = { ...(data().prices || DEFAULT_PRICES) };
    for (const [k, v] of Object.entries(body)) {
      const n = Number(v);
      if (!TYPES.includes(k) || !Number.isFinite(n) || n < 0) throw new HttpError(400, `Bad price ${k}`);
      p[k] = n;
    }
    data().prices = p;
    store.save();
    return p;
  });

  const stats = () => {
    const passing = handMeDowns(family().children, data().items);
    return family().children.map((c) => childStats(c, data().items, data().targets, new Date(), {
      prices: data().prices || DEFAULT_PRICES,
      waiting: passing.filter((h) => h.toChildId === c.id),
    }));
  };
  router.get('/api/v1/clothes/stats', () => stats());

  return { stats, addItem, items: () => data().items, handMeDowns: () => handMeDowns(family().children, data().items) };
}

module.exports = { register };
