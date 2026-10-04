// Unit checks for the phone layer's pure parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../mobile/notifications.js';
import { extractJson } from '../mobile/json.js';
import { localFetcher } from '../mobile/local-api.js';

test('reminders become notifications at 5pm the day before', () => {
  const now = new Date('2026-10-04T09:00:00');
  const list = plan([
    { id: 'food-expiry-a-2026-10-06', kind: 'food', level: 'warn', date: '2026-10-06', title: 'Milk goes off in 2 days' },
    { id: 'food-low-1', kind: 'food', level: 'warn', date: null, title: 'Only 1 meal left' },
    { id: 'shopping-3', kind: 'shopping', level: 'info', date: null, title: '3 things on the list' },
    { id: 'clothes-size-x', kind: 'clothes', level: 'info', date: '2026-09-01', title: 'Old forecast' },
  ], now);
  assert.equal(list.length, 2);
  assert.equal(list[0].schedule.at.getTime(), new Date('2026-10-05T17:00:00').getTime());
  assert.equal(list[1].schedule.at.getTime(), new Date('2026-10-04T17:00:00').getTime());
  assert.notEqual(list[0].id, list[1].id);
  assert.equal(plan([{ id: 'food-low-1', level: 'warn', title: 'x' }], now)[0].id, list[1].id); // stable ids
});

test('extractJson copes with fences and chatter', () => {
  assert.deepEqual(extractJson('Here:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('ok {"items":[{"n":"x"}]} done.'), { items: [{ n: 'x' }] });
  assert.throws(() => extractJson('no json here'));
});

test('local API passes method, query and body to the handler', async () => {
  const seen = {};
  const handler = async (req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    await new Promise((r) => req.on('end', r));
    Object.assign(seen, { method: req.method, url: req.url, body });
    res.writeHead(201, { 'Content-Type': 'application/json' }).end('{"ok":true}');
  };
  const res = await localFetcher(handler)('/api/v1/x?y=1', { method: 'post', body: '{"a":1}' });
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { ok: true });
  assert.deepEqual(seen, { method: 'POST', url: '/api/v1/x?y=1', body: '{"a":1}' });
});

test('account sync never uploads the AI key and keeps each device its own', async () => {
  const { shareable, merged, hasContent } = await import('../mobile/cloud.js');
  const local = { family: { children: [] }, ai: { provider: 'anthropic', apiKey: 'sk-1', usage: { month: '2026-10', count: 3 } } };
  assert.deepEqual(shareable(local).ai, { provider: 'anthropic' });
  assert.equal(local.ai.apiKey, 'sk-1', 'the original is untouched');
  const remote = { family: { children: [{ name: 'Sam' }] }, ai: { provider: 'openai', model: 'x' } };
  assert.deepEqual(merged(remote, local).ai, { provider: 'openai', model: 'x', apiKey: 'sk-1', usage: { month: '2026-10', count: 3 } });
  assert.deepEqual(merged({ food: {} }, {}), { food: {} });
  assert.equal(hasContent(local), false);
  assert.equal(hasContent(remote), true);
});

test('two people saving at once: both sets of changes are kept', async () => {
  const { merge3 } = await import('../mobile/merge.js');
  const base = {
    shopping: { items: [{ id: 'a', name: 'milk', done: false }, { id: 'b', name: 'bread', done: false }, { id: 'c', name: 'eggs', done: false }] },
    food: { pantry: [{ id: 'p', name: 'rice', quantity: 1 }], history: { added: [{ name: 'rice', at: '1' }] } },
    family: { adults: 2 },
  };
  const mine = structuredClone(base);
  mine.shopping.items[0].done = true; // ticked milk
  mine.shopping.items.push({ id: 'd', name: 'tea', done: false }); // added tea
  mine.food.history.added.push({ name: 'tea', at: '2' });
  const theirs = structuredClone(base);
  theirs.shopping.items[1].done = true; // ticked bread
  theirs.shopping.items = theirs.shopping.items.filter((i) => i.id !== 'c'); // removed eggs
  theirs.shopping.items.push({ id: 'e', name: 'jam', done: false });
  theirs.food.history.added.push({ name: 'jam', at: '3' });
  theirs.family.adults = 3;
  const out = merge3(base, mine, theirs);
  assert.deepEqual(out.shopping.items.map((i) => [i.name, i.done]), [['milk', true], ['bread', true], ['jam', false], ['tea', false]]);
  assert.deepEqual(out.food.history.added.map((e) => e.name), ['rice', 'jam', 'tea']);
  assert.equal(out.family.adults, 3);
  assert.deepEqual(out.food.pantry, base.food.pantry);

  // Same thing changed both ways: the first save wins. Removed here but changed there: kept.
  const m2 = structuredClone(base);
  m2.shopping.items[0].name = 'oat milk';
  m2.shopping.items = m2.shopping.items.filter((i) => i.id !== 'b');
  const t2 = structuredClone(base);
  t2.shopping.items[0].name = 'semi-skimmed milk';
  t2.shopping.items[1].done = true;
  assert.deepEqual(merge3(base, m2, t2).shopping.items.map((i) => i.name), ['semi-skimmed milk', 'bread', 'eggs']);
  // Nothing changed on one side: just take the other.
  assert.equal(merge3(base, base, theirs), theirs);
  assert.equal(merge3(base, mine, base), mine);
});
