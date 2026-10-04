const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createApp } = require('../server');
const { Store } = require('../lib/store');
const { dietFlags } = require('../modules/food/diet');
const recipes = require('../modules/food/recipes');

async function start(t) {
  const server = http.createServer(createApp(new Store(null))).listen(0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}/api/v1`;
  return async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
}

// A stand-in AI server that records what it was sent and answers in either wire format.
function fakeAi(t, reply) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const body = JSON.parse(b);
      seen.push({ url: req.url, headers: req.headers, body });
      const text = JSON.stringify(reply(body));
      res.setHeader('content-type', 'application/json');
      if (req.url.endsWith('/v1/messages')) {
        res.end(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }] }));
      } else {
        res.end(JSON.stringify({ choices: [{ message: { content: '```json\n' + text + '\n```' } }] }));
      }
    });
  }).listen(0);
  t.after(() => server.close());
  return { url: `http://localhost:${server.address().port}`, seen };
}

test('diet flags are worked out from ingredients', () => {
  const byId = Object.fromEntries(recipes.map((r) => [r.id, dietFlags(r)]));
  assert.ok(!byId['spag-bol'].includes('vegetarian'));
  assert.ok(byId['tomato-pasta'].includes('vegetarian'));
  assert.ok(!byId['mac-cheese'].includes('dairy-free'));
  assert.ok(byId['chicken-curry'].includes('dairy-free'), 'coconut milk is not dairy');
  assert.ok(byId['chicken-curry'].includes('gluten-free'));
});

test('API: diet filter, favourites, balance, bulk add and barcode lookup', async (t) => {
  const off = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url.includes('5000000000001')) res.end(JSON.stringify({ status: 1, product: { product_name: 'Baked Beans', brands: 'Heinz', quantity: '415 g' } }));
    else res.end(JSON.stringify({ status: 0 }));
  }).listen(0);
  t.after(() => off.close());
  process.env.OFF_BASE_URL = `http://localhost:${off.address().port}`;
  const call = await start(t);

  const bulk = await call('POST', '/food/items/bulk', { items: [
    { name: 'Spaghetti', quantity: 1, unit: 'kg' }, { name: 'Beef mince', quantity: 1, unit: 'kg' },
    { name: 'Chopped tomatoes', quantity: 6, unit: 'tin' }, { name: 'Onions', quantity: 6 }, { name: 'Carrots', quantity: 6 },
  ] });
  assert.strictEqual(bulk.body.length, 5);
  assert.strictEqual((await call('POST', '/food/items/bulk', { items: [{ name: '' }] })).status, 400);

  let meals = (await call('GET', '/food/meals')).body.meals;
  assert.ok(meals.some((m) => m.id === 'spag-bol' && m.status === 'ready'));
  await call('PUT', '/family', { dietary: ['vegetarian'] });
  meals = (await call('GET', '/food/meals')).body.meals;
  assert.ok(!meals.some((m) => m.id === 'spag-bol'), 'vegetarian household hides bolognese');
  assert.ok((await call('GET', '/food/meals?all=1')).body.meals.some((m) => m.id === 'spag-bol'));
  assert.strictEqual((await call('PUT', '/family', { dietary: ['keto'] })).status, 400);
  await call('PUT', '/family', { dietary: [] });

  await call('PUT', '/food/recipes/tomato-pasta/favourite', { favourite: true });
  meals = (await call('GET', '/food/meals')).body.meals;
  assert.ok(meals.find((m) => m.id === 'tomato-pasta').favourite);

  const stats = (await call('GET', '/food/stats')).body;
  assert.ok(stats.balance.meals > 0 && stats.balance.veg > 0);

  const beans = await call('GET', '/food/barcode/5000000000001');
  assert.deepStrictEqual([beans.body.name, beans.body.quantity, beans.body.unit, beans.body.brand], ['Baked Beans', 415, 'g', 'Heinz']);
  assert.strictEqual((await call('GET', '/food/barcode/5000000000002')).status, 404);
  assert.strictEqual((await call('GET', '/food/barcode/abc')).status, 400);
});

test('API: laundry, uniform, hand-me-downs, budget, weather outfit, reminders, backup', async (t) => {
  const call = await start(t);
  const now = new Date();
  const born = (years) => new Date(now.getTime() - years * 365.25 * 86400000).toISOString().slice(0, 10);
  const amy = (await call('POST', '/family/children', { name: 'Amy', birthDate: born(6.5), clothingSize: '6-7Y' })).body;
  const ben = (await call('POST', '/family/children', { name: 'Ben', birthDate: born(4.5), clothingSize: '4-5Y' })).body;

  const add = (b) => call('POST', '/clothes/items', { childId: amy.id, ...b });
  const tee = (await add({ name: 'Tee', type: 'top', colour: 'white', size: '6-7Y' })).body;
  await add({ name: 'Jeans', type: 'bottom', colour: 'denim', size: '6-7Y' });
  await add({ name: 'Sundress', type: 'dress', colour: 'yellow', size: '6-7Y', season: 'summer' });
  await add({ name: 'Coat', type: 'outerwear', colour: 'navy', size: '6-7Y' });
  await add({ name: 'School polo', type: 'top', colour: 'white', size: '6-7Y', uniform: true });
  const old = (await add({ name: 'Old jumper', type: 'top', colour: 'red', size: '4-5Y' })).body;

  // Uniform is kept out of everyday outfits and counts.
  let s = (await call('GET', '/clothes/stats')).body.find((x) => x.childId === amy.id);
  assert.strictEqual(s.fitting.top, 1);
  assert.ok(s.uniform && s.uniform.fitting.top === 1 && s.uniform.buyBeforeTerm);
  assert.strictEqual((await call('GET', `/clothes/outfits/${amy.id}?uniform=only`)).body.outfits.length, 0);

  // Weather: cold drops the sundress and wants a coat; hot drops the coat.
  const cold = (await call('GET', `/clothes/outfits/${amy.id}?tempC=5`)).body.outfits;
  assert.ok(cold.every((o) => !o.items.some((i) => i.name === 'Sundress')));
  assert.ok(cold.every((o) => o.items.some((i) => i.name === 'Coat')));
  const hot = (await call('GET', `/clothes/outfits/${amy.id}?tempC=26`)).body.outfits;
  assert.ok(hot.every((o) => !o.items.some((i) => i.name === 'Coat')));
  const ootd = (await call('GET', `/clothes/outfit-of-the-day/${amy.id}?tempC=5&rain=1`)).body;
  assert.ok(ootd.outfit && /Cold/.test(ootd.weather) && /Rain/.test(ootd.weather));

  // Laundry.
  await call('PUT', `/clothes/items/${tee.id}`, { inWash: true });
  s = (await call('GET', '/clothes/stats')).body.find((x) => x.childId === amy.id);
  assert.strictEqual(s.laundry.inWash, 1);
  assert.strictEqual(s.laundry.cleanDays, 1); // just the sundress
  assert.ok(s.laundry.warning);
  assert.strictEqual((await call('POST', '/clothes/laundry/done', {})).body.cleaned, 1);

  // Budget uses the price list.
  await call('PUT', '/clothes/prices', { top: 10 });
  s = (await call('GET', '/clothes/stats')).body.find((x) => x.childId === amy.id);
  assert.strictEqual(s.budget.now, s.shortfall.top * 10 + (s.shortfall.bottom || 0) * 8 + (s.shortfall.pyjamas || 0) * 8 + (s.shortfall.shoes || 0) * 25 + (s.shortfall.outerwear || 0) * 25);

  // Hand-me-downs: Amy's outgrown 4-5Y jumper fits Ben.
  const hmd = (await call('GET', '/clothes/hand-me-downs')).body;
  assert.deepStrictEqual(hmd.map((h) => [h.itemId, h.toChildId, h.fitsNow]), [[old.id, ben.id, true]]);
  await call('POST', `/clothes/items/${old.id}/hand-down`, { childId: ben.id });
  assert.strictEqual((await call('GET', `/clothes/items?childId=${ben.id}`)).body.length, 1);

  // Reminders and dashboard.
  const dash = (await call('GET', '/dashboard')).body;
  assert.ok(Array.isArray(dash.reminders) && dash.reminders.some((r) => r.kind === 'food'));
  assert.ok(dash.reminders.every((r) => r.id && r.level && r.title));

  // Backup round trip, without the AI key.
  await call('PUT', '/ai/settings', { provider: 'anthropic', apiKey: 'sk-secret-1234' });
  const backup = (await call('GET', '/export')).body;
  assert.ok(!JSON.stringify(backup).includes('sk-secret'));
  await call('DELETE', `/family/children/${ben.id}`);
  assert.strictEqual((await call('POST', '/import', backup)).status, 200);
  assert.strictEqual((await call('GET', '/family')).body.children.length, 2);
  assert.strictEqual((await call('GET', '/ai/settings')).body.apiKeyHint, '…1234');
  assert.strictEqual((await call('POST', '/import', { nope: 1 })).status, 400);
});

test('API: AI meal ideas and photo scans with Claude and OpenAI-style providers', async (t) => {
  const call = await start(t);
  const ai = fakeAi(t, (body) => {
    const sys = JSON.stringify(body.system || body.messages[0].content);
    if (sys.includes('family decide what to cook')) {
      return { ideas: [{ name: 'Veg omelette', minutes: 15, servings: 4, why: 'Uses the eggs', uses: ['eggs'], missing: [], ingredients: [{ name: 'eggs', qty: 6, unit: 'pcs' }], steps: ['Whisk', 'Cook'] }] };
    }
    if (sys.includes('photos of food')) return { items: [{ name: 'Cheddar', quantity: 400, unit: 'g' }, { name: 'Apples', quantity: 0, unit: 'pcs' }] };
    return { items: [{ name: 'Blue tee', type: 'top', colour: 'blue', pattern: 'plain', season: 'all' }] };
  });
  await call('POST', '/food/items', { name: 'Eggs', quantity: 12 });

  assert.strictEqual((await call('POST', '/ai/meal-ideas', {})).status, 409, 'no AI set up yet');

  // Claude.
  await call('PUT', '/ai/settings', { provider: 'anthropic', baseUrl: ai.url, apiKey: 'k1', model: 'claude-opus-5-5' });
  const ideas = (await call('POST', '/ai/meal-ideas', { request: 'quick' })).body.ideas;
  assert.strictEqual(ideas[0].name, 'Veg omelette');
  const sent = ai.seen.at(-1);
  assert.strictEqual(sent.url, '/v1/messages');
  assert.strictEqual(sent.headers['x-api-key'], 'k1');
  assert.strictEqual(sent.body.output_config.format.type, 'json_schema');
  assert.strictEqual(sent.body.output_config.effort, 'low');
  assert.ok(sent.body.messages[0].content.at(-1).text.includes('Eggs: 12 pcs'));
  assert.ok(sent.body.messages[0].content.at(-1).text.includes('They asked for: quick'));

  const img = 'data:image/png;base64,iVBORw0KGgo=';
  const food = (await call('POST', '/ai/scan', { kind: 'food', image: img })).body;
  assert.deepStrictEqual(food.items.map((i) => [i.name, i.quantity]), [['Cheddar', 400], ['Apples', null]]);
  assert.strictEqual(ai.seen.at(-1).body.messages[0].content[0].source.media_type, 'image/png');
  assert.strictEqual((await call('POST', '/ai/scan', { kind: 'food', image: 'not an image' })).status, 400);

  const saved = (await call('POST', '/ai/meal-ideas/save', { idea: ideas[0] })).body;
  assert.deepStrictEqual(saved.steps, ['Whisk', 'Cook']);

  // A local OpenAI-compatible server (e.g. Ollama), no key needed.
  await call('PUT', '/ai/settings', { provider: 'ollama', baseUrl: ai.url + '/v1', model: 'llava' });
  const clothes = (await call('POST', '/ai/scan', { kind: 'clothes', image: img })).body;
  assert.strictEqual(clothes.items[0].type, 'top');
  const o = ai.seen.at(-1);
  assert.strictEqual(o.url, '/v1/chat/completions');
  assert.strictEqual(o.headers.authorization, undefined);
  assert.strictEqual(o.body.messages[1].content[1].image_url.url, img);

  // Monthly cap.
  await call('PUT', '/ai/settings', { monthlyLimit: 1 });
  assert.strictEqual((await call('POST', '/ai/meal-ideas', {})).status, 429);

  // On-device task description for the phone app.
  const task = (await call('GET', '/ai/tasks/meal-ideas')).body;
  assert.ok(task.prompt.includes('Eggs') && task.schema.properties.ideas);
  assert.strictEqual((await call('GET', '/ai/tasks/nope')).status, 404);
  assert.ok(!JSON.stringify((await call('GET', '/ai/settings')).body).includes('k1"'));
});
