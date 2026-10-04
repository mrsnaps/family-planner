// Quicker adding: one-tap usuals, "Same as last shop" and "Bought all ticked". Plain rules.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createApp } = require('../server');
const { Store } = require('../lib/store');
const { usuals, lastShop } = require('../modules/shopping/habits');

const NOW = new Date('2026-10-04T12:00:00Z');
const ago = (d) => new Date(NOW - d * 86400000).toISOString();

test('usuals: bought on 2+ days, most often first, with the last amount', () => {
  const history = {
    added: [
      { name: 'milk', quantity: 2, unit: 'l', at: ago(21) }, { name: 'milk', quantity: 2, unit: 'l', at: ago(14) }, { name: 'milk', quantity: 4, unit: 'pints', at: ago(7) },
      { name: 'bread', at: ago(10) }, { name: 'bread', at: ago(3) },
      { name: 'cake', at: ago(5) }, { name: 'cake', at: ago(5) }, // one day only
      { name: 'flour', at: ago(300) }, { name: 'flour', at: ago(250) }, // too long ago
    ],
  };
  assert.deepStrictEqual(usuals({ history, now: NOW }), [
    { name: 'milk', quantity: 4, unit: 'pints', times: 3 },
    { name: 'bread', quantity: null, unit: null, times: 2 },
  ]);
  assert.deepStrictEqual(usuals({ now: NOW }), []);
});

test('last shop: most recent earlier day with 3 or more things', () => {
  const history = {
    added: [
      { name: 'a', at: ago(9) }, { name: 'b', at: ago(9) }, { name: 'c', at: ago(9) },
      { name: 'milk', quantity: 2, unit: 'l', at: ago(2) }, { name: 'eggs', quantity: 6, at: ago(2) }, { name: 'Milk', quantity: 1, unit: 'l', at: ago(2) }, { name: 'tea', at: ago(2) },
      { name: 'x', at: ago(1) }, // a top-up, not a shop
      { name: 'y', at: ago(0) }, { name: 'z', at: ago(0) }, { name: 'w', at: ago(0) }, // today doesn't count
    ],
  };
  assert.deepStrictEqual(lastShop({ history, now: NOW }), {
    date: ago(2).slice(0, 10),
    items: [{ name: 'Milk', quantity: 1, unit: 'l' }, { name: 'eggs', quantity: 6, unit: null }, { name: 'tea', quantity: null, unit: null }],
  });
  assert.strictEqual(lastShop({ history: { added: [{ name: 'a', at: ago(3) }] }, now: NOW }), null);
});

test('API: usual chips, same as last shop, and bought all ticked', async (t) => {
  const store = new Store(null);
  const server = http.createServer(createApp(store)).listen(0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}/api/v1`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  assert.strictEqual((await call('POST', '/shopping/repeat-last-shop')).status, 404, 'nothing to copy yet');
  let shop = (await call('GET', '/shopping')).body;
  assert.deepStrictEqual([shop.usuals, shop.lastShop], [[], null]);

  // A history of shops in the past.
  await call('GET', '/food/items');
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
  (store.data.food.history ||= {}).added = [
    { name: 'milk', quantity: 2, unit: 'l', at: day(8) }, { name: 'bread', quantity: 1, unit: 'loaf', at: day(8) }, { name: 'apples', quantity: 6, unit: 'pcs', at: day(8) },
    { name: 'milk', quantity: 2, unit: 'l', at: day(1) }, { name: 'bread', quantity: 1, unit: 'loaf', at: day(1) }, { name: 'pasta', quantity: 500, unit: 'g', at: day(1) },
  ];
  await call('POST', '/shopping/items', { kind: 'food', name: 'Bread' });
  shop = (await call('GET', '/shopping')).body;
  assert.deepStrictEqual(shop.usuals.map((u) => u.name), ['milk'], 'bread is already on the list');
  assert.deepStrictEqual(shop.lastShop, { date: day(1).slice(0, 10), count: 3, missing: 2 });

  const r = (await call('POST', '/shopping/repeat-last-shop')).body;
  assert.deepStrictEqual([r.added, r.skipped], [2, 1]);
  shop = (await call('GET', '/shopping')).body;
  assert.deepStrictEqual(shop.items.map((i) => [i.name, i.quantity, i.unit]), [['Bread', undefined, undefined], ['milk', 2, 'l'], ['pasta', 500, 'g']]);
  assert.strictEqual(shop.lastShop.missing, 0);

  // Tick a few (food and clothes), then put them all away at once.
  const kid = (await call('POST', '/family/children', { name: 'Sam', birthDate: '2021-03-01', clothingSize: '4-5Y', shoeSize: '10' })).body;
  const tops = (await call('POST', '/shopping/items', { kind: 'clothes', name: 'tops', type: 'top', childId: kid.id, size: '4-5Y', quantity: 2 })).body;
  for (const it of [...shop.items.filter((i) => i.name !== 'Bread'), tops]) await call('PUT', `/shopping/items/${it.id}`, { done: true });
  const done = (await call('POST', '/shopping/bought-ticked')).body;
  assert.deepStrictEqual(done, { ok: true, items: 3, food: 2, clothes: 2 });
  assert.deepStrictEqual((await call('GET', '/shopping')).body.items.map((i) => i.name), ['Bread']);
  const pantry = (await call('GET', '/food/items')).body;
  assert.deepStrictEqual(pantry.map((p) => [p.name, p.quantity, p.unit]).sort(), [['milk', 2, 'l'], ['pasta', 500, 'g']]);
  const clothes = (await call('GET', `/clothes/items?childId=${kid.id}`)).body;
  assert.strictEqual(clothes.filter((c) => c.type === 'top' && c.size === '4-5Y').length, 2);
  assert.deepStrictEqual((await call('POST', '/shopping/bought-ticked')).body, { ok: true, items: 0, food: 0, clothes: 0 });
});
