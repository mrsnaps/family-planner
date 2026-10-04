// Shopping suggestions from habits: plain rules, no AI.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createApp } = require('../server');
const { Store } = require('../lib/store');
const { habitSuggestions } = require('../modules/shopping/habits');

const NOW = new Date('2026-10-04T12:00:00Z');
const ago = (d) => new Date(NOW - d * 86400000).toISOString();

test('habits: run out, regulars that are due, and usual meals', () => {
  const history = {
    added: [
      // Milk every ~7 days, last 8 days ago: due.
      { name: 'Milk', quantity: 2, unit: 'l', at: ago(22) }, { name: 'milk', quantity: 2, unit: 'l', at: ago(15) }, { name: 'Milk', quantity: 2, unit: 'l', at: ago(8) },
      // Bread every ~7 days but bought 2 days ago: not due.
      { name: 'Bread', at: ago(16) }, { name: 'Bread', at: ago(9) }, { name: 'Bread', at: ago(2) },
      // Rice twice, but still in the cupboard: skip.
      { name: 'Rice', at: ago(40) }, { name: 'Rice', at: ago(20) },
      // Bought once only: not a habit. Twice on one day: not a habit either.
      { name: 'Saffron', at: ago(30) }, { name: 'Cake', at: ago(30) }, { name: 'Cake', at: ago(30) },
      // Every 3 months: too rare to count.
      { name: 'Flour', at: ago(170) }, { name: 'Flour', at: ago(80) },
    ],
    cooked: [
      { recipeId: 'bolognese', at: ago(3) }, { recipeId: 'bolognese', at: ago(10) }, { recipeId: 'bolognese', at: ago(17) },
      { recipeId: 'curry', at: ago(5) }, // once: not "often"
      { recipeId: 'stew', at: ago(90) }, { recipeId: 'stew', at: ago(100) }, // too long ago
    ],
  };
  const pantry = [{ name: 'Rice', quantity: 1 }, { name: 'Eggs', quantity: 0 }, { name: 'Bread', quantity: 0 }];
  let asked = null;
  const mealsFor = (ids) => {
    asked = ids;
    return [
      { id: 'pie', name: 'Fish pie', missing: ['fish'], short: [] },
      { id: 'bolognese', name: 'Spaghetti bolognese', missing: ['minced beef'], short: [{ name: 'milk' }] },
    ];
  };
  const out = habitSuggestions({ history, pantry, favourites: ['pie'], mealsFor, now: NOW });
  assert.deepStrictEqual(asked, ['bolognese', 'pie'], 'often-cooked meals first, then favourites');
  assert.deepStrictEqual(out.map((s) => [s.name, s.source]), [
    ['Eggs', 'ran-out'],
    ['Bread', 'ran-out'],
    ['Milk', 'regular'],
    ['minced beef', 'usual-meal'],
    ['fish', 'usual-meal'],
  ]);
  assert.strictEqual(out[2].reason, 'You buy this about every week, usually 2 l');
  assert.strictEqual(out[3].reason, 'For Spaghetti bolognese, cooked 3 times lately');
  assert.strictEqual(out[4].reason, 'For Fish pie, a favourite');
  assert.ok(out.every((s) => s.kind === 'food'));
});

test('habits: nothing to go on means no suggestions, and no AI is needed', () => {
  assert.deepStrictEqual(habitSuggestions({ now: NOW }), []);
});

test('API: cooking and buying build habits; "Not now" hides a suggestion', async (t) => {
  const server = http.createServer(createApp(new Store(null))).listen(0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}/api/v1`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  // Buying through the list and adding to the cupboard both count as purchases.
  const item = (await call('POST', '/food/items', { name: 'Yoghurt', quantity: 1 })).body;
  await call('PUT', `/food/items/${item.id}`, { quantity: 0 });
  let { suggestions } = (await call('GET', '/shopping')).body;
  const yog = suggestions.find((s) => s.name === 'Yoghurt');
  assert.ok(yog, 'run-out yoghurt is suggested');
  assert.strictEqual(yog.reason, 'Ran out');
  assert.ok(yog.key);

  assert.strictEqual((await call('POST', '/shopping/suggestions/dismiss', { key: yog.key })).status, 200);
  ({ suggestions } = (await call('GET', '/shopping')).body);
  assert.ok(!suggestions.some((s) => s.name === 'Yoghurt'), 'hidden after Not now');
  assert.strictEqual((await call('POST', '/shopping/suggestions/dismiss', {})).status, 400);

  // Favourite a meal: its missing ingredients are suggested, whatever is in the cupboard.
  const meals = (await call('GET', '/food/recipes')).body;
  const fav = meals[0];
  await call('PUT', `/food/recipes/${fav.id}/favourite`, { favourite: true });
  ({ suggestions } = (await call('GET', '/shopping')).body);
  const forFav = suggestions.filter((s) => s.source === 'usual-meal');
  assert.ok(forFav.length >= 1, 'ingredients for the favourite are suggested');
  assert.ok(forFav.every((s) => s.reason === `For ${fav.name}, a favourite`));

  // Cooking is remembered.
  const rice = (await call('POST', '/food/items/bulk', { items: [{ name: 'Rice', quantity: 2, unit: 'kg' }] })).body;
  assert.strictEqual(rice.length, 1);
  const res = await call('GET', '/export');
  assert.ok(res.body.data.food.history.added.some((e) => e.name === 'rice'));
});
