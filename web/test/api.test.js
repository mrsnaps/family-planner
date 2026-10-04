const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createApp } = require('../server');
const { Store } = require('../lib/store');

test('API: family size changes the meal estimate', async (t) => {
  const server = http.createServer(createApp(new Store(null))).listen(0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}/api/v1`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

  await call('PUT', '/family', { adults: 1 });
  for (const item of [
    { name: 'Pasta', quantity: 2, unit: 'kg' },
    { name: 'Tinned tomatoes', quantity: 6, unit: 'tin' },
    { name: 'Onion', quantity: 6 },
  ]) {
    assert.strictEqual((await call('POST', '/food/items', item)).status, 200);
  }
  const one = (await call('GET', '/dashboard')).body.food.mealsLeft;

  await call('PUT', '/family', { adults: 4 });
  const four = (await call('GET', '/dashboard')).body.food.mealsLeft;
  assert.ok(one > four, `${one} meals for 1 should beat ${four} for 4`);

  const kid = (await call('POST', '/family/children', { name: 'Amy', birthDate: '2020-05-01', clothingSize: '6-7Y' })).body;
  const bad = await call('POST', '/clothes/items', { childId: kid.id, name: 'Hat', type: 'hat' });
  assert.strictEqual(bad.status, 400);
  const ok = await call('POST', '/clothes/items', { childId: kid.id, name: 'Tee', type: 'top', colour: 'blue', size: '6-7y' });
  assert.strictEqual(ok.body.size, '6-7Y');
  const dash = (await call('GET', '/dashboard')).body;
  assert.strictEqual(dash.clothes[0].fitting.top, 1);
  assert.strictEqual(dash.family.people, 5);

  await call('DELETE', '/family/children/' + kid.id);
  assert.strictEqual((await call('GET', '/clothes/items')).body.length, 0);
});
