const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createApp } = require('../server');
const { Store } = require('../lib/store');
const { parseShoe, predictShoes } = require('../modules/clothes/shoes');

test('shoe sizes: kids and adult scales', () => {
  assert.deepStrictEqual(parseShoe('11', 4), { linear: 11, adult: false });
  assert.deepStrictEqual(parseShoe('2', 8), { linear: 15, adult: true });
  assert.deepStrictEqual(parseShoe('2 adult', null), { linear: 15, adult: true });
  assert.strictEqual(parseShoe('big', 4), null);
  const f = predictShoes({ shoeSize: '13.5', birthDate: '2020-01-01', shoeSizeRecordedAt: '2026-10-04' }, new Date('2026-10-04'));
  assert.strictEqual(f.nextSize, '1 adult');
  assert.ok(f.daysLeft > 120 && f.daysLeft < 170, `6 year olds go up a half size about every 5 months, got ${f.daysLeft} days`);
});

test('API: shopping list suggests, and bought items land in pantry and wardrobe', async (t) => {
  const server = http.createServer(createApp(new Store(null))).listen(0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}/api/v1`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  await call('POST', '/food/items', { name: 'Bread', quantity: 10 });
  const kid = (await call('POST', '/family/children', { name: 'Ben', birthDate: '2022-01-01', clothingSize: '4-5Y', shoeSize: '10' })).body;
  assert.ok(kid.shoeSizeRecordedAt);

  const { suggestions } = (await call('GET', '/shopping')).body;
  assert.ok(suggestions.some((s) => s.kind === 'food' && s.name === 'baked beans'), 'beans unlock beans on toast');
  assert.ok(suggestions.some((s) => s.kind === 'clothes' && s.type === 'top' && s.childId === kid.id && s.quantity === 7));

  const food = (await call('POST', '/shopping/items', { name: 'baked beans', kind: 'food' })).body;
  await call('POST', `/shopping/items/${food.id}/bought`, { quantity: 4, unit: 'tin' });
  const pantry = (await call('GET', '/food/items')).body;
  assert.ok(pantry.some((p) => p.name === 'baked beans' && p.quantity === 4));
  const meals = (await call('GET', '/food/meals')).body.meals;
  assert.strictEqual(meals.find((m) => m.id === 'beans-toast').status, 'ready');

  const tops = (await call('POST', '/shopping/items', { name: 'top', kind: 'clothes', childId: kid.id, type: 'top', size: '4-5Y', quantity: 3 })).body;
  await call('POST', `/shopping/items/${tops.id}/bought`, { colour: 'blue' });
  const clothes = (await call('GET', '/clothes/items?childId=' + kid.id)).body;
  assert.strictEqual(clothes.filter((c) => c.type === 'top' && c.size === '4-5Y').length, 3);
  assert.strictEqual((await call('GET', '/shopping')).body.items.length, 0);

  const recipe = await call('POST', '/food/recipes', { name: 'Toast', servings: 2, ingredients: [{ name: 'bread', qty: 2, unit: 'pcs' }] });
  assert.strictEqual(recipe.status, 200);
  assert.ok((await call('GET', '/food/meals')).body.meals.some((m) => m.name === 'Toast' && m.status === 'ready'));
});
