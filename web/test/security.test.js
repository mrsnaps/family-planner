// Checks for the holes found in the security review: where the AI key can go, what a
// backup file can change, which pages can use the API, and bad input.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createApp } = require('../server');
const { Store } = require('../lib/store');

async function start(t, store = new Store(null)) {
  const server = http.createServer(createApp(store)).listen(0);
  t.after(() => server.close());
  const root = `http://localhost:${server.address().port}`;
  const call = async (method, p, body, headers = {}) => {
    const res = await fetch(root + '/api/v1' + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
  };
  return { call, root, store };
}

// An AI server that records the keys it was sent.
function fakeAi(t) {
  const keys = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      keys.push(req.headers['x-api-key'] || req.headers.authorization || null);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ content: [{ type: 'text', text: '{"items":[]}' }], choices: [{ message: { content: '{"items":[]}' } }] }));
    });
  }).listen(0);
  t.after(() => server.close());
  return { url: `http://localhost:${server.address().port}`, keys };
}

test('a saved AI key is only sent to the server it was typed in for', async (t) => {
  const { call } = await start(t);
  const good = fakeAi(t);
  const evil = fakeAi(t);
  await call('PUT', '/ai/settings', { provider: 'anthropic', baseUrl: good.url, apiKey: 'sk-secret', model: 'claude-opus-5-5' });
  assert.strictEqual((await call('POST', '/ai/test')).status, 200);
  assert.deepStrictEqual(good.keys, ['sk-secret']);

  // Pointing the AI somewhere else keeps the key back until it's typed in again.
  await call('PUT', '/ai/settings', { baseUrl: evil.url });
  const r = await call('POST', '/ai/test');
  assert.strictEqual(r.status, 409);
  assert.match(r.body.error, /type the key in again/);
  assert.deepStrictEqual(evil.keys, []);
  assert.strictEqual((await call('GET', '/ai/settings')).body.hasKey, false);

  // Going back to the first server, the key works again.
  await call('PUT', '/ai/settings', { baseUrl: good.url });
  assert.strictEqual((await call('POST', '/ai/test')).status, 200);
  assert.strictEqual((await call('GET', '/ai/settings')).body.hasKey, true);
});

test('a backup file cannot redirect the AI key or set the usage count', async (t) => {
  const { call } = await start(t);
  const good = fakeAi(t);
  const evil = fakeAi(t);
  await call('PUT', '/ai/settings', { provider: 'anthropic', baseUrl: good.url, apiKey: 'sk-secret', model: 'claude-opus-5-5' });
  const backup = (await call('GET', '/export')).body;
  assert.strictEqual(JSON.stringify(backup).includes('sk-secret'), false);
  assert.strictEqual(backup.data.ai.keyFor, undefined);
  backup.data.ai = { ...backup.data.ai, baseUrl: evil.url, keyFor: `anthropic ${evil.url}`, apiKey: 'theirs', usage: { month: 'x', count: '<b>' } };
  assert.strictEqual((await call('POST', '/import', backup)).status, 200);
  assert.strictEqual((await call('POST', '/ai/test')).status, 409);
  assert.deepStrictEqual(evil.keys, []);
});

test('a damaged backup is turned away instead of breaking the pages', async (t) => {
  const { call } = await start(t);
  const bad = (data) => call('POST', '/import', { app: 'family-planner', data });
  assert.strictEqual((await bad({ family: { adults: 2, children: 'lots' } })).status, 400);
  assert.strictEqual((await bad({ shopping: { items: [null] } })).status, 400);
  assert.strictEqual((await bad({ ai: 'x' })).status, 400);
  assert.strictEqual((await bad({ chores: { list: [], log: [] } })).status, 200);
});

test('other web pages cannot use the API', async (t) => {
  const { call } = await start(t);
  const r = await call('GET', '/family', undefined, { Origin: 'https://evil.example' });
  assert.strictEqual(r.headers.get('access-control-allow-origin'), null);
  // A plain form post (not JSON) is refused, so another site can't change data blind.
  const { root } = await start(t);
  const form = await fetch(root + '/api/v1/family/children', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"name":"Eve"}' });
  assert.strictEqual(form.status, 415);
});

test('odd requests get a clear error, not a crash', async (t) => {
  const { call } = await start(t);
  assert.strictEqual((await call('PUT', '/family', null)).status, 200);
  assert.strictEqual((await call('PUT', '/family', [])).status, 200);
  assert.strictEqual((await call('DELETE', '/family/children/%E0%A4%A')).status, 400);
  const long = 'x'.repeat(5000);
  const kid = (await call('POST', '/family/children', { name: long, sizeRecordedAt: '<script>' })).body;
  assert.strictEqual(kid.name.length, 40);
  assert.strictEqual(kid.sizeRecordedAt, undefined);
  const item = (await call('POST', '/shopping/items', { name: long, note: long })).body;
  assert.strictEqual(item.name.length, 80);
  assert.strictEqual(item.note.length, 200);
  const recipe = (await call('POST', '/food/recipes', { name: 'Toast', servings: -5, minutes: 1e9, ingredients: [{ name: 'bread', qty: 2 }] })).body;
  assert.deepStrictEqual([recipe.servings, recipe.minutes], [1, 1440]);
});

test('the page only runs its own scripts', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /script-src 'self' 'sha256-/);
  assert.doesNotMatch(csp, /unsafe-inline'[^;]*;?\s*$|script-src[^;]*unsafe/);
  // The one inline script must match its hash, or it would be blocked.
  const inline = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const hash = crypto.createHash('sha256').update(inline).digest('base64');
  assert.ok(csp.includes(`'sha256-${hash}'`), 'update the hash in index.html after changing the inline script');
});
