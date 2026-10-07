// Demo mode: a sample family to show the app off, with the household's own data put
// aside and brought back untouched.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createApp } = require('../server');
const { Store } = require('../lib/store');

async function start(t) {
  const server = http.createServer(createApp(new Store(null))).listen(0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}/api/v1`;
  return async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
}

test('the demo shows a lived-in family, then puts the real one back exactly', async (t) => {
  const call = await start(t);
  await call('POST', '/family/children', { name: 'Real kid', birthDate: '2019-01-01' });
  await call('POST', '/shopping/items', { name: 'Real milk', kind: 'food' });
  await call('PUT', '/ai/settings', { provider: 'anthropic', apiKey: 'sk-keep' });
  const before = (await call('GET', '/export')).body.data;

  assert.deepStrictEqual((await call('GET', '/demo')).body.on, false);
  assert.strictEqual((await call('POST', '/demo/start')).body.on, true);

  const dash = (await call('GET', '/dashboard')).body;
  assert.deepStrictEqual(dash.family.children.map((c) => c.name), ['Mia', 'Leo', 'Ruby']);
  const shop = (await call('GET', '/shopping')).body;
  assert.ok(shop.items.length >= 5);
  assert.ok(shop.usuals.length >= 3, 'weekly shops give one-tap usuals');
  assert.ok(shop.items.some((i) => i.addedBy));
  assert.ok((await call('GET', '/spending')).body.entries.length >= 5);
  const chores = (await call('GET', '/chores')).body;
  assert.ok(chores.chores.length >= 8);
  assert.ok(chores.totals.some((p) => p.points > 0 && p.money > 0), 'children have earned pocket money');
  assert.ok((await call('GET', '/food/meals')).body.meals.some((m) => m.status === 'ready'), 'something can be cooked tonight');
  assert.ok((await call('GET', '/clothes/items')).body.length > 20);
  const cal = (await call('GET', '/calendar')).body;
  assert.ok(cal.events.length >= 5 && cal.upcoming.some((o) => o.kind === 'birthday' || o.kit.length), 'school days, clubs and plans');
  assert.ok(cal.kitTomorrow.length >= 1, 'something to pack for tomorrow');
  const trips = (await call('GET', '/packing')).body.trips;
  assert.ok(trips.length === 1 && trips[0].packedCount > 0, 'a trip, part packed');
  const month = (await call('GET', '/money')).body;
  assert.ok(month.budget && month.categories.filter((c) => c.total).length >= 2, 'spending by category with a budget');
  const bills = (await call('GET', '/bills')).body;
  assert.ok(bills.bills.length >= 10 && bills.totals.family > 1000 && bills.totals.personal > 0, 'family bills and a personal one');
  assert.deepStrictEqual(bills.tips.map((x) => x.kind).sort(), ['price', 'renewal', 'renewal', 'subscriptions']);
  assert.ok(dash.reminders.some((r) => r.kind === 'bills'));

  // Leftovers in the fridge (eaten first), food in the freezer, ratings and lunchboxes.
  const food = (await call('GET', '/food/stats')).body;
  assert.ok(food.leftovers.some((l) => !l.frozen && l.days === 1), 'leftovers from last night');
  assert.ok(food.plan[0].leftover, 'the week starts with the leftovers');
  assert.ok(food.freezer.length >= 3 && food.freezerOld.length >= 1, 'a freezer with something to use up');
  assert.ok(dash.reminders.some((r) => r.id.startsWith('food-leftover-')));
  assert.ok(dash.reminders.some((r) => r.id.startsWith('food-freezer-')));
  const ratings = (await call('GET', '/food/ratings')).body.recipes;
  assert.ok(Object.keys(ratings).length >= 3);
  assert.deepStrictEqual(ratings['mac-cheese'].notKeen, ['Leo']);
  const lunch = (await call('GET', '/food/lunchbox')).body;
  assert.deepStrictEqual(lunch.children.map((c) => c.name), ['Mia', 'Leo']);
  assert.deepStrictEqual(lunch.notAtSchool, ['Ruby']);
  assert.ok(lunch.children.every((c) => c.days.every((d) => d.main && d.fruit)), 'every school day has a lunchbox');
  assert.deepStrictEqual(lunch.children[1].wontEat, ['tuna', 'crisps']);

  // Backups during the demo are still the family's own, and restoring waits.
  assert.deepStrictEqual((await call('GET', '/export')).body.data, before);
  assert.strictEqual((await call('POST', '/import', { app: 'family-planner', version: 1, data: before })).status, 409);

  // Starting again gives a fresh sample and still remembers the real data.
  await call('POST', '/family/children', { name: 'Demo extra' });
  await call('POST', '/demo/start');
  assert.strictEqual((await call('GET', '/family')).body.children.length, 3);

  assert.strictEqual((await call('POST', '/demo/stop')).body.on, false);
  assert.deepStrictEqual((await call('GET', '/export')).body.data, before);
  assert.strictEqual((await call('GET', '/ai/settings')).body.apiKeyHint, '…keep');
  assert.strictEqual((await call('POST', '/demo/stop')).body.on, false, 'stopping twice is harmless');
});
