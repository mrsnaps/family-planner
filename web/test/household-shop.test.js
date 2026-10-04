// Shopping for the week, who added what, food spending and hand-me-downs. Plain rules.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createApp } = require('../server');
const { Store } = require('../lib/store');
const { spendingSummary } = require('../modules/shopping');

function start(t) {
  const server = http.createServer(createApp(new Store(null))).listen(0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}/api/v1`;
  return async (method, path, body, who) => {
    const headers = { 'Content-Type': 'application/json', ...(who ? { 'X-Family-Member': who } : {}) };
    const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
}

test('shop for the week: keeps the plan, fills the gaps, adds up what to buy', async (t) => {
  const call = start(t);
  await call('POST', '/food/items/bulk', { items: [
    { name: 'pasta', quantity: 500, unit: 'g' }, { name: 'tinned tomatoes', quantity: 2, unit: 'tin' },
    { name: 'onion', quantity: 3, unit: 'pcs' }, { name: 'minced beef', quantity: 500, unit: 'g' },
  ] });
  const plan = (await call('GET', '/dashboard')).body.food.plan;
  assert.ok(plan.length >= 1 && plan.length < 7, 'some dinners are ready, the rest need a shop');
  const r = (await call('POST', '/food/week-shop', { week: plan.map((p) => p.id) })).body;
  assert.strictEqual(r.days.length, 7);
  plan.forEach((p, i) => assert.deepStrictEqual([r.days[i].id, r.days[i].planned, r.days[i].buy], [p.id, true, []]));
  const filled = r.days.slice(plan.length);
  assert.ok(filled.every((d) => d && !d.planned && d.buy.length > 0));
  assert.strictEqual(new Set(r.days.map((d) => d.id)).size, 7, 'no meal twice');
  assert.ok(r.list.length > 0 && r.list.every((i) => i.name && i.for.length));
  const names = new Set(r.list.map((i) => i.name));
  assert.strictEqual(names.size, r.list.length, 'each thing listed once');

  // Adding them all skips what's already on the list, and remembers who added them.
  await call('POST', '/shopping/items', { kind: 'food', name: r.list[0].name });
  const bulk = (await call('POST', '/shopping/items/bulk', { items: r.list }, 'sam@example.com')).body;
  assert.deepStrictEqual([bulk.added, bulk.skipped], [r.list.length - 1, 1]);
  const items = (await call('GET', '/shopping')).body.items;
  assert.strictEqual(items.length, r.list.length);
  assert.strictEqual(items[0].addedBy, undefined, 'not signed in: nobody recorded');
  assert.ok(items.slice(1).every((i) => i.addedBy === 'sam@example.com' && i.kind === 'food'));
  assert.strictEqual((await call('POST', '/shopping/items/bulk', {})).status, 400);
});

test('who added what, and the name each person goes by', async (t) => {
  const call = start(t);
  const it = (await call('POST', '/shopping/items', { kind: 'food', name: 'Milk', addedBy: 'spoof@example.com' }, 'jo@example.com')).body;
  assert.strictEqual(it.addedBy, 'jo@example.com');
  assert.strictEqual((await call('PUT', '/shopping/people/me', { name: 'Jo' })).status, 400, 'needs a signed-in person');
  await call('PUT', '/shopping/people/me', { name: ' Jo ' }, 'jo@example.com');
  assert.deepStrictEqual((await call('GET', '/shopping')).body.people, { 'jo@example.com': 'Jo' });
  await call('PUT', '/shopping/people/me', { name: '' }, 'jo@example.com');
  assert.deepStrictEqual((await call('GET', '/shopping')).body.people, {});
});

test('food spending: this month, last month, per week and per dinner', async (t) => {
  const now = new Date('2026-10-20T12:00:00Z');
  const e = (date, amount) => ({ date, amount });
  const s = spendingSummary([e('2026-10-02', 60), e('2026-10-09', 55.5), e('2026-10-16', 70), e('2026-09-25', 80), e('2026-08-01', 99)],
    Array.from({ length: 10 }, (_, i) => ({ at: `2026-10-${String(i + 1).padStart(2, '0')}T18:00:00Z` })), now);
  assert.strictEqual(s.thisMonth, 185.5);
  assert.strictEqual(s.lastMonth, 80);
  assert.strictEqual(s.dinnersCooked, 10);
  assert.strictEqual(s.perDinner, 18.55);
  assert.ok(s.perWeek > 60 && s.perWeek < 75, String(s.perWeek));
  assert.deepStrictEqual(spendingSummary([], [], now), { thisMonth: 0, lastMonth: 0, perWeek: null, dinnersCooked: 0, perDinner: null });

  const call = start(t);
  assert.strictEqual((await call('POST', '/spending', { amount: 'lots' })).status, 400);
  const r = (await call('POST', '/spending', { amount: '£64.20', shop: 'Tesco' }, 'jo@example.com')).body;
  assert.deepStrictEqual([r.entry.amount, r.entry.shop, r.entry.addedBy], [64.2, 'Tesco', 'jo@example.com']);
  assert.strictEqual(r.thisMonth, 64.2);
  await call('POST', '/spending', { amount: 10, date: '2026-01-05' });
  const all = (await call('GET', '/spending')).body;
  assert.deepStrictEqual(all.entries.map((x) => x.amount), [64.2, 10], 'newest first');
  assert.strictEqual((await call('DELETE', `/spending/${r.entry.id}`)).body.entries.length, 1);
  assert.strictEqual((await call('DELETE', `/spending/${r.entry.id}`)).status, 404);
});

test("hand-me-downs count towards a sibling's clothes, and pass all at once", async (t) => {
  const call = start(t);
  const amy = (await call('POST', '/family/children', { name: 'Amy', birthDate: '2018-01-01', clothingSize: '8-9Y', shoeSize: '1' })).body;
  const ben = (await call('POST', '/family/children', { name: 'Ben', birthDate: '2020-06-01', clothingSize: '6-7Y', shoeSize: '12' })).body;
  const before = (await call('GET', '/clothes/stats')).body.find((x) => x.childId === ben.id);
  for (let i = 0; i < 3; i++) await call('POST', '/clothes/items', { childId: amy.id, name: `Old top ${i}`, type: 'top', size: '6-7Y', colour: 'blue' });
  const after = (await call('GET', '/clothes/stats')).body.find((x) => x.childId === ben.id);
  assert.strictEqual((before.shortfall.top || 0) - (after.shortfall.top || 0), Math.min(3, before.shortfall.top || 0));
  assert.deepStrictEqual(after.handMeDowns, { count: 3, fitNow: 3, from: ['Amy'] });
  const shop = (await call('GET', '/shopping')).body.suggestions.filter((s) => s.childId === ben.id && s.type === 'top' && s.size === '6-7Y');
  assert.ok(shop.every((s) => s.quantity === after.shortfall.top), 'shopping suggestions allow for them');

  assert.deepStrictEqual((await call('POST', '/clothes/hand-down-all', { toChildId: ben.id })).body, { moved: 3 });
  assert.strictEqual((await call('GET', `/clothes/items?childId=${ben.id}`)).body.length, 3);
  assert.deepStrictEqual((await call('GET', '/clothes/hand-me-downs')).body, []);
});
