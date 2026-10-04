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
