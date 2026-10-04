// With an AI set up, suggestions come from the AI (checked against the real data);
// without one, the rules answer and nothing is sent anywhere.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createApp } = require('../server');
const { Store } = require('../lib/store');

// A stand-in AI that answers each suggestion task from what's in the prompt.
function mockAI() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      const prompt = body.messages.map((m) => (typeof m.content === 'string' ? m.content : m.content.map((c) => c.text || '').join(''))).join('\n');
      calls.push(prompt);
      let answer = {};
      if (prompt.includes('shopping list?')) {
        answer = { suggestions: [
          { kind: 'food', name: 'Milk', quantity: 2, childName: '', size: '', reason: 'You get through about 2 l a week.' },
          { kind: 'food', name: 'Bananas', quantity: 0, childName: '', size: '', reason: 'Already on the list' },
          { kind: 'clothes', name: 'top', quantity: 2, childName: 'Ben', size: '4-5Y', reason: 'Ben is short of tops.' },
          { kind: 'food', name: '', quantity: 0, childName: '', size: '', reason: 'blank names are dropped' },
        ] };
      } else if (prompt.includes('plan dinners for the week')) {
        const ids = [...prompt.matchAll(/^- (\S+) \| /gm)].map((m) => m[1]);
        answer = { picks: [{ recipeId: ids[1], why: 'Uses the eggs first.' }, { recipeId: 'made-up', why: 'not a real recipe' }, { recipeId: ids[0], why: 'A favourite.' }], week: [{ day: 0, recipeId: ids[1] }, { day: 3, recipeId: ids[0] }, { day: 9, recipeId: ids[0] }] };
      } else if (prompt.includes('Choose outfits')) {
        const ids = [...prompt.matchAll(/^- (\S+) \| (\w+) \|/gm)].map((m) => ({ id: m[1], type: m[2] }));
        const top = ids.find((i) => i.type === 'top');
        const bottom = ids.find((i) => i.type === 'bottom');
        answer = { outfits: [{ itemIds: [top.id, bottom.id, 'nope'], why: 'Blue and grey go well.' }, { itemIds: [top.id], why: 'incomplete, dropped' }] };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }));
    });
  }).listen(0);
  return { server, calls, url: () => `http://localhost:${server.address().port}` };
}

test('AI suggestions for shopping, meals and outfits, checked and cached', async (t) => {
  const ai = mockAI();
  const server = http.createServer(createApp(new Store(null))).listen(0);
  t.after(() => { server.close(); ai.server.close(); });
  const base = `http://localhost:${server.address().port}/api/v1`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const kid = (await call('POST', '/family/children', { name: 'Ben', birthDate: '2021-01-01', clothingSize: '4-5Y', shoeSize: '10' })).body;
  await call('POST', '/food/items', { name: 'Eggs', quantity: 6 });
  await call('POST', '/shopping/items', { name: 'Bananas', kind: 'food' });

  // No AI yet: settings say so, and asking is refused without calling anything.
  assert.strictEqual((await call('GET', '/ai/settings')).body.suggestions, false);
  assert.strictEqual((await call('POST', '/ai/suggest/shopping', {})).status, 409);
  assert.strictEqual(ai.calls.length, 0);

  await call('PUT', '/ai/settings', { provider: 'custom' });
  await call('PUT', '/ai/settings', { baseUrl: ai.url(), model: 'mock' });
  assert.strictEqual((await call('GET', '/ai/settings')).body.suggestions, true);

  // Shopping: drops what's already on the list and blank names; maps clothes to the child.
  const shop = (await call('POST', '/ai/suggest/shopping', {})).body;
  assert.strictEqual(shop.by, 'mock');
  assert.deepStrictEqual(shop.suggestions.map((s) => s.name), ['Milk', 'top']);
  assert.strictEqual(shop.suggestions[1].childId, kid.id);
  assert.strictEqual(shop.suggestions[1].type, 'top');
  assert.ok(shop.suggestions.every((s) => s.key && s.source === 'ai'));
  assert.match(ai.calls[0], /Already on the shopping list:\n- Bananas/);
  assert.match(ai.calls[0], /Eggs: 6/);

  // Same data again: answered from the cache, no new AI call. Changed data: asks again.
  assert.strictEqual((await call('POST', '/ai/suggest/shopping', {})).body.cached, true);
  assert.strictEqual(ai.calls.length, 1);
  await call('POST', '/food/items', { name: 'Butter', quantity: 1 });
  assert.strictEqual((await call('POST', '/ai/suggest/shopping', {})).body.cached, false);
  assert.strictEqual(ai.calls.length, 2);

  // Meals: only real recipes, no repeats, week days 0-6 only.
  const meals = (await call('POST', '/ai/suggest/meals', {})).body;
  assert.strictEqual(meals.picks.length, 2);
  assert.ok(meals.picks.every((p) => p.name && p.why));
  assert.strictEqual(meals.week.length, 7);
  assert.ok(meals.week[0] && meals.week[3] && !meals.week[1]);

  // Outfits: needs a child; only that child's clean clothes; incomplete outfits dropped.
  assert.strictEqual((await call('POST', '/ai/suggest/outfits', {})).status, 400);
  const top = (await call('POST', '/clothes/items', { childId: kid.id, name: 'Blue tee', type: 'top', size: '4-5Y', colour: 'blue' })).body;
  const bottom = (await call('POST', '/clothes/items', { childId: kid.id, name: 'Grey joggers', type: 'bottom', size: '4-5Y', colour: 'grey' })).body;
  const outfits = (await call('POST', '/ai/suggest/outfits', { childId: kid.id, tempC: 14, rain: false })).body;
  assert.strictEqual(outfits.outfits.length, 1);
  assert.deepStrictEqual(outfits.outfits[0].items.map((i) => i.id), [top.id, bottom.id]);
  assert.deepStrictEqual(outfits.outfits[0].notes, ['Blue and grey go well.']);
  assert.match(ai.calls.at(-1), /about 14°C, dry/);

  // The phone's on-device AI gets the same prompt and schema, and hands back its answer.
  const task = (await call('GET', `/ai/tasks/suggest-outfits?childId=${kid.id}`)).body;
  assert.match(task.prompt, /Blue tee/);
  assert.ok(task.schema.properties.outfits);
  const before = ai.calls.length;
  const fromPhone = (await call('POST', '/ai/suggest/outfits', { childId: kid.id, by: 'iPhone AI', result: { outfits: [{ itemIds: [top.id, bottom.id], why: 'On the phone' }] } })).body;
  assert.strictEqual(fromPhone.by, 'iPhone AI');
  assert.strictEqual(fromPhone.outfits[0].notes[0], 'On the phone');
  assert.strictEqual(ai.calls.length, before);

  // Turning it off puts the rules back in charge; the cache isn't in backups.
  await call('PUT', '/ai/settings', { useForSuggestions: false });
  assert.strictEqual((await call('GET', '/ai/settings')).body.suggestions, false);
  assert.ok(!('suggestCache' in (await call('GET', '/ai/settings')).body));
  assert.ok(!('suggestCache' in (await call('GET', '/export')).body.data.ai));
  assert.strictEqual((await call('POST', '/ai/suggest/nonsense', {})).status, 404);
});

test('AI suggestions: cacheOnly answers from memory or says there is none', async (t) => {
  const server = http.createServer(createApp(new Store(null))).listen(0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}/api/v1`;
  const post = (body) => fetch(base + '/ai/suggest/shopping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.strictEqual((await post({ cacheOnly: true })).status, 404);
  assert.strictEqual((await post({ result: { suggestions: [{ kind: 'food', name: 'Tea', quantity: 0, childName: '', size: '', reason: 'r' }] }, by: 'iPhone AI' })).status, 200);
  const r = await (await post({ cacheOnly: true })).json();
  assert.strictEqual(r.cached, true);
  assert.deepStrictEqual(r.suggestions.map((s) => s.name), ['Tea']);
});
