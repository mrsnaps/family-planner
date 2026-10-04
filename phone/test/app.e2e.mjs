// End-to-end check of the phone build in Chromium at iPhone size, with a stand-in for
// Apple's on-device AI and a mock extra AI. Run after `npm run build`: npm run test:e2e
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockAI, answerFor, MEAL } from './mock-ai.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.SHOTS || path.join(ROOT, 'test', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const srv = spawn('node', [path.join(ROOT, 'scripts', 'serve.mjs')], { env: { ...process.env, PORT: '5173' } });
await new Promise((r) => srv.stdout.once('data', r));
const ai = await startMockAI(5174);
const browser = await chromium.launch();
const ok = (m) => console.log('✓ ' + m);

// Pretend to be an iPhone with Apple Intelligence.
function onDeviceMock({ available = true, fail = null } = {}) {
  return `globalThis.__fpOnDeviceMock = {
    calls: [],
    availability: async () => (${JSON.stringify(available)} ? { available: true, reason: 'available' } : { available: false, reason: 'deviceNotEligible' }),
    generate: async (o) => {
      globalThis.__fpOnDeviceMock.calls.push(o);
      if (${JSON.stringify(fail)}) throw Object.assign(new Error('too long'), { code: ${JSON.stringify(fail)} });
      const MEAL = ${JSON.stringify(MEAL)};
      return { text: JSON.stringify((${answerFor.toString()})(o.instructions + o.prompt)) };
    },
    scanImage: async () => ({ text: 'TSC CHPD TOM 2X400G 1.10  CARROTS 1KG 0.65', barcodes: ['5000157024671'], labels: [{ name: 'jeans', confidence: 0.82 }], colour: 'navy' }),
  };`;
}

async function open({ init = null, width = 390 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: width < 500, hasTouch: true });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://world.openfoodfacts.org/**', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 1, product: { product_name: 'Heinz Baked Beans', quantity: '415 g' } }) }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ body: '' }));
  await page.goto('http://localhost:5173/');
  await page.waitForFunction(() => document.querySelector('#page')?.children.length > 0);
  const api = (p, method = 'GET', body) => page.evaluate(async ([p, method, body]) => {
    const r = await fetch('/api/v1' + p, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => null) };
  }, [p, method, body]);
  return { ctx, page, api, errors };
}

const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

try {
  // 1. Plain browser: the app runs with no server and keeps its data.
  {
    const { ctx, page, api, errors } = await open();
    assert.equal((await api('/family/children', 'POST', { name: 'Sam', birthDate: '2021-03-01', clothingSize: '4-5Y', shoeSize: '10' })).status, 200);
    const soon = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    for (const it of [{ name: 'chicken breast', quantity: 500, unit: 'g', expiry: soon }, { name: 'rice', quantity: 1, unit: 'kg' }]) {
      assert.equal((await api('/food/items', 'POST', it)).status, 200);
    }
    assert.equal((await api('/food/items/nope', 'DELETE')).status, 404);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#page')?.children.length > 0);
    assert.equal((await api('/food/items')).data.length, 2);
    for (const p of ['/dashboard', '/reminders', '/clothes/stats', '/shopping', '/export']) assert.equal((await api(p)).status, 200, p);
    ok('app runs on the phone with no server, and data survives a restart');

    const s = (await api('/ai/settings')).data;
    assert.equal(s.onDeviceAvailable, false);
    assert.equal(s.onDeviceReason, 'Only available in the iPhone app.');
    assert.equal(s.ready, false);
    ok('AI settings report that on-device AI is missing outside the iPhone');

    // The extra AI of your choice, from the phone (OpenAI-compatible mock).
    assert.equal((await api('/ai/settings', 'PUT', { provider: 'custom', baseUrl: 'http://localhost:5174/v1', model: 'mock' })).status, 200);
    const m = await api('/ai/meal-ideas', 'POST', { request: 'quick' });
    assert.equal(m.status, 200, JSON.stringify(m.data));
    assert.equal(m.data.ideas[0].name, 'Chicken and rice traybake');
    ok('extra AI (OpenAI-compatible) works from the phone');

    // With an AI set up, suggestions come from it: shown on the Shopping page with an AI badge.
    assert.equal((await api('/ai/settings')).data.suggestions, true);
    const sm = await api('/ai/suggest/meals', 'POST', {});
    assert.equal(sm.status, 200, JSON.stringify(sm.data));
    assert.equal(sm.data.by, 'mock');
    assert.equal(sm.data.picks[0].why, 'Uses the chicken before it goes off.');
    await page.click('[data-nav="shopping"]:visible');
    await page.waitForSelector('#suggest-card :text("Teabags")');
    assert.match(await page.textContent('#suggest-card'), /✨ AI/);
    await page.click('[data-nav="settings"]:visible');
    await page.click('[data-ai-suggestions]');
    await page.waitForSelector('[data-ai-suggestions]:not(:checked)');
    await page.click('[data-nav="shopping"]:visible');
    await page.waitForSelector('#suggest-card');
    assert.doesNotMatch(await page.textContent('#suggest-card'), /Teabags|✨ AI/);
    await api('/ai/settings', 'PUT', { useForSuggestions: true });
    ok('with an AI set up, suggestions come from it; switching it off brings back the rules');

    // Claude as the extra AI: the browser-access header is added on the way out.
    let claudeHeaders = null;
    await page.route('https://api.anthropic.com/**', (r) => {
      claudeHeaders = r.request().headers();
      r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answerFor('cook')) }] }) });
    });
    await api('/ai/settings', 'PUT', { provider: 'anthropic', apiKey: 'sk-test', model: 'claude-opus-5-5' });
    const c = await api('/ai/meal-ideas', 'POST', {});
    assert.equal(c.status, 200, JSON.stringify(c.data));
    assert.equal(claudeHeaders['anthropic-dangerous-direct-browser-access'], 'true');
    assert.equal(claudeHeaders['x-api-key'], 'sk-test');
    ok('Claude works from the phone (browser-access header added)');

    const bc = await api('/food/barcode/5000157024671');
    assert.equal(bc.data.name, 'Heinz Baked Beans');
    assert.equal(bc.data.quantity, 415);
    ok('barcode lookup reaches Open Food Facts from the phone');

    await page.screenshot({ path: `${SHOTS}/phone-home.png` });
    assert.deepEqual(errors, []);
    await ctx.close();
  }

  // 2. iPhone with Apple Intelligence: AI runs on the phone.
  {
    const { ctx, page, api, errors } = await open({ init: onDeviceMock() });
    await api('/family/children', 'POST', { name: 'Ava', birthDate: '2020-05-01', clothingSize: '5-6Y' });
    await api('/food/items', 'POST', { name: 'chicken thighs', quantity: 600, unit: 'g' });
    const s = (await api('/ai/settings')).data;
    assert.equal(s.onDeviceAvailable, true);
    assert.equal(s.ready, true);
    ok('with Apple Intelligence, AI counts as ready with no extra AI set up');

    const extraCalls = ai.calls.length;
    const m = await api('/ai/meal-ideas', 'POST', { request: 'no spice' });
    assert.equal(m.status, 200, JSON.stringify(m.data));
    assert.equal(m.data.by, 'iPhone AI');
    const call = await page.evaluate(() => globalThis.__fpOnDeviceMock.calls.at(-1));
    assert.match(call.prompt, /chicken thighs: 600 g/);
    assert.match(call.prompt, /no spice/);
    assert.equal(JSON.parse(call.schemaJson).required[0], 'ideas');

    // Suggestions on the iPhone's own AI, outfits included.
    const ss = await api('/ai/suggest/shopping', 'POST', {});
    assert.equal(ss.status, 200, JSON.stringify(ss.data));
    assert.equal(ss.data.by, 'iPhone AI');
    assert.equal(ss.data.suggestions[0].name, 'Teabags');
    const kid = (await api('/family')).data.children[0];
    const top = (await api('/clothes/items', 'POST', { childId: kid.id, name: 'Red tee', type: 'top', size: '5-6Y', colour: 'red' })).data;
    await api('/clothes/items', 'POST', { childId: kid.id, name: 'Blue jeans', type: 'bottom', size: '5-6Y', colour: 'blue' });
    const so = await api('/ai/suggest/outfits', 'POST', { childId: kid.id });
    assert.equal(so.data.by, 'iPhone AI');
    assert.equal(so.data.outfits[0].items[0].id, top.id);
    assert.equal(ai.calls.length, extraCalls, 'nothing went to the extra AI');
    // New clothes changed what the AI should know, so it was asked again; asking twice is free.
    assert.equal((await api('/ai/suggest/shopping', 'POST', {})).data.cached, false);
    const deviceCalls = await page.evaluate(() => globalThis.__fpOnDeviceMock.calls.length);
    assert.equal((await api('/ai/suggest/shopping', 'POST', {})).data.cached, true);
    assert.equal(await page.evaluate(() => globalThis.__fpOnDeviceMock.calls.length), deviceCalls, 'unchanged data is answered from memory');
    await page.click('[data-nav="clothes"]:visible');
    await page.waitForSelector('#ootd-body :text("Comfy for the park")');
    ok('suggestions and outfits run on the iPhone AI, and repeat questions are answered from memory');
    assert.equal(ai.calls.length, extraCalls); // nothing went to an extra AI
    ok('meal ideas run on the iPhone, using the web app’s own prompt and schema');

    const food = await api('/ai/scan', 'POST', { kind: 'food', image: PHOTO });
    assert.equal(food.status, 200, JSON.stringify(food.data));
    const names = food.data.items.map((i) => i.name);
    assert.deepEqual(names, ['Heinz Baked Beans', 'Chopped tomatoes', 'Carrots']);
    assert.equal(food.data.items[2].quantity, null);
    ok('food photo: barcode looked up, receipt text read and listed on the phone');

    const clothes = await api('/ai/scan', 'POST', { kind: 'clothes', image: PHOTO });
    assert.equal(clothes.data.items[0].type, 'bottom');
    const cc = await page.evaluate(() => globalThis.__fpOnDeviceMock.calls.at(-1));
    assert.match(cc.prompt, /jeans \(82%\)/);
    assert.match(cc.prompt, /Main colour: navy/);
    ok('clothes photo described on the phone');

    assert.equal((await api('/ai/test', 'POST')).data.by, 'iPhone AI');
    assert.equal((await api('/ai/scan', 'POST', { kind: 'food' })).status, 400);

    // Turning on-device off sends work to the extra AI instead.
    await api('/ai/settings', 'PUT', { onDevice: false, provider: 'custom', baseUrl: 'http://localhost:5174/v1', model: 'mock' });
    const before = ai.calls.length;
    const off = await api('/ai/meal-ideas', 'POST', {});
    assert.equal(off.status, 200);
    assert.equal(off.data.by, undefined);
    assert.equal(ai.calls.length, before + 1);
    ok('with on-device turned off, the extra AI is used');
    await page.screenshot({ path: `${SHOTS}/phone-ondevice.png` });
    assert.deepEqual(errors, []);
    await ctx.close();
  }

  // 3. On-device can't cope: falls back to the extra AI, or explains.
  {
    const { ctx, api } = await open({ init: onDeviceMock({ fail: 'contextTooLong' }) });
    await api('/food/items', 'POST', { name: 'pasta', quantity: 500, unit: 'g' });
    const no = await api('/ai/meal-ideas', 'POST', {});
    assert.equal(no.status, 502);
    assert.match(no.data.error, /too much for the iPhone’s built-in AI/);
    await api('/ai/settings', 'PUT', { provider: 'custom', baseUrl: 'http://localhost:5174/v1', model: 'mock' });
    const yes = await api('/ai/meal-ideas', 'POST', {});
    assert.equal(yes.status, 200);
    assert.equal(yes.data.ideas.length, 1);
    ok('too much for on-device: clear message, or hand-over to the extra AI');
    await ctx.close();
  }

  // 4. iPhone without Apple Intelligence.
  {
    const { ctx, api } = await open({ init: onDeviceMock({ available: false }) });
    const s = (await api('/ai/settings')).data;
    assert.equal(s.onDeviceAvailable, false);
    assert.match(s.onDeviceReason, /iPhone 15 Pro or newer/);
    ok('older iPhones get a plain reason');
    await ctx.close();
  }

  // 5. Quicker adding on the Shopping page: usuals, the last shop again, bought all ticked.
  {
    const { ctx, page, api, errors } = await open();
    const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
    const added = [
      ['milk', 2, 'l', 8], ['bread', 1, 'loaf', 8], ['apples', 6, 'pcs', 8],
      ['milk', 2, 'l', 1], ['bread', 1, 'loaf', 1], ['pasta', 500, 'g', 1],
    ].map(([name, quantity, unit, n]) => ({ name, quantity, unit, at: day(n) }));
    const backup = (await api('/export')).data;
    backup.data.food.history = { added, cooked: [] };
    assert.equal((await api('/import', 'POST', backup)).status, 200);
    await page.click('[data-nav="shopping"]:visible');
    await page.waitForSelector('#quick-add');
    assert.match(await page.textContent('#quick-add'), /Your usuals[\s\S]*Milk 2 l/);
    assert.doesNotMatch(await page.textContent('#quick-add'), /Pasta|Apples/, 'bought once is not a usual');
    await page.click('#quick-add [data-usual]:has-text("Milk")');
    await page.waitForSelector('#page .list :text("Milk")');
    await page.click('[data-repeat-shop]');
    await page.waitForSelector('#quick-add :text("is on the list")');
    assert.deepEqual((await api('/shopping')).data.items.map((i) => i.name), ['milk', 'bread', 'pasta']);
    for (let n = 0; n < 2; n++) await page.click('#page .list [data-toggle][data-state="false"]');
    await page.waitForSelector('#page .list .row.done >> nth=1');
    await page.click('[data-bought-ticked]');
    await page.waitForSelector('#toast.show:has-text("2 things in the cupboard")');
    assert.deepEqual((await api('/shopping')).data.items.map((i) => i.name), ['pasta']);
    assert.deepEqual((await api('/food/items')).data.map((i) => i.name).sort(), ['bread', 'milk']);
    assert.deepEqual(errors, []);
    ok('one-tap usuals, "Same as last shop" and "Bought all ticked" on the Shopping page');

    // Bought all ticked then asks what the shop cost; spending shows on the Shopping page.
    await page.waitForSelector('#dialog-form :text("How much was the shop?")');
    await page.fill('#dialog-form input[name=amount]', '42.50');
    await page.fill('#dialog-form input[name=shop]', 'Aldi');
    await page.click('#dialog-form button:has-text("Add")');
    await page.waitForSelector('#spending-card :text("£42.50")');
    await page.fill('#spend-form input[name=amount]', '7.25');
    await page.click('#spend-form button');
    await page.waitForSelector('#spending-card :text("£49.75")');
    assert.match(await page.textContent('#spending-card'), /£49\.75 this month[\s\S]*Aldi/);
    ok('food spending: asked after a shop, added by hand, totalled for the month');

    // Shop for the week from the home page: fills the gaps and adds what's needed.
    await page.click('[data-nav="home"]:visible');
    await page.click('[data-week-shop]');
    await page.waitForSelector('#dialog-form :text("Shop for the week")');
    const adds = Number((await page.textContent('#dialog-form button:has-text("to the list")')).match(/\d+/)[0]);
    assert.ok(adds > 3, `adds ${adds}`);
    await page.click('#dialog-form button:has-text("to the list")');
    const said = await page.textContent('#toast.show:has-text("for the week")');
    const skipped = Number((said.match(/(\d+) already on the list/) || [0, 0])[1]);
    const listed = (await api('/shopping')).data.items;
    assert.equal(listed.filter((i) => i.note === 'For the week').length + skipped, adds, said);
    ok('"Shop for the week" plans every dinner and adds what they need');

    // Hand-me-downs: pass everything a sibling can use in one tap.
    const amy = (await api('/family/children', 'POST', { name: 'Amy', birthDate: '2018-01-01', clothingSize: '8-9Y', shoeSize: '1' })).data;
    const ben = (await api('/family/children', 'POST', { name: 'Ben', birthDate: '2020-06-01', clothingSize: '6-7Y', shoeSize: '12' })).data;
    for (const n of ['Red top', 'Blue top']) await api('/clothes/items', 'POST', { childId: amy.id, name: n, type: 'top', size: '6-7Y', colour: 'red' });
    await page.click('[data-nav="clothes"]:visible');
    await page.click('[data-nav="home"]:visible');
    await page.waitForSelector('#week-strip');
    await page.waitForSelector('#page :text("Counting 2 hand-me-downs from Amy")');
    await page.waitForSelector('[data-pass-all]');
    await page.click('[data-pass-all]');
    await page.waitForSelector('#toast.show:has-text("Passed on 2 things")');
    assert.equal((await api(`/clothes/items?childId=${ben.id}`)).data.length, 2);
    assert.deepEqual(errors, []);
    ok('hand-me-downs count towards what a sibling needs, and pass on in one tap');
    await ctx.close();
  }
  // 6. Chores: add, share out, tick off with points, and the AI's rota when it's on.
  {
    const { ctx, page, api, errors } = await open();
    const ava = (await api('/family/children', 'POST', { name: 'Ava', birthDate: '2016-01-01', clothingSize: '9-10Y', shoeSize: '3' })).data;
    await page.click('[data-nav="chores"]:visible');
    await page.waitForSelector('#chores-today :text("No chores yet")');
    await page.click('[data-chore-starter="dishes"]');
    await page.waitForSelector('#chores-today :text("Wash up or load the dishwasher")');
    await page.fill('#chore-form input[name=name]', 'Feed the hamster');
    await page.selectOption('#chore-form select[name=every]', '1');
    await page.selectOption('#chore-form select[name=who]', ava.id);
    await page.click('#chore-form button.primary');
    await page.waitForSelector('#chores-today :text("Feed the hamster")');
    assert.match(await page.textContent('#chores-today'), /Feed the hamster[\s\S]*Ava/);
    await page.fill('#pocket-form input[name=perPoint]', '50');
    await page.click('#pocket-form button');
    await page.waitForSelector('#toast.show:has-text("50p a point")');
    const hamster = (await api('/chores')).data.chores.find((c) => c.name === 'Feed the hamster');
    await page.click(`[data-chore-done="${hamster.id}"]`);
    await page.waitForSelector('#toast.show:has-text("Well done, Ava")');
    await page.waitForSelector('#chores-points :text("£0.50")');
    await page.click('[data-chore-undo]');
    await page.waitForFunction(() => !document.querySelector('[data-chore-undo]'));
    assert.equal((await api('/chores')).data.stats.doneToday, 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'nothing wider than the phone');
    ok('chores: add from common ones or your own, tick off for points and pocket money, undo');

    await page.click('[data-nav="home"]:visible');
    await page.waitForSelector('#chores-home :text("Feed the hamster")');
    await page.click(`#chores-home [data-chore-done="${hamster.id}"]`);
    for (let i = 0; i < 20 && (await api('/chores')).data.stats.doneToday !== 1; i++) await page.waitForTimeout(100);
    assert.equal((await api('/chores')).data.stats.doneToday, 1);
    ok("today's chores show on Home and can be ticked off there");

    await api('/ai/settings', 'PUT', { provider: 'custom', baseUrl: 'http://localhost:5174/v1', model: 'mock' });
    await page.click('[data-nav="chores"]:visible');
    await page.waitForSelector('#chores-by :text("Ask again")');
    await page.waitForSelector('#chore-ideas :text("Water the plants")');
    assert.match(await page.textContent('#chore-ideas'), /✨ AI/);
    await page.click('#chore-ideas [data-chore-idea="0"]');
    await page.waitForSelector('#toast.show:has-text("Added Water the plants")');
    assert.ok((await api('/chores')).data.chores.some((c) => c.name === 'Water the plants'));
    assert.deepEqual(errors, []);
    ok('with an AI on, it shares out the chores and suggests new ones');
    await ctx.close();
  }
  // 7. Booby-trapped data (from a backup file, or saved by someone else in the household)
  // is shown as text on every page, never turned into page code.
  {
    const { ctx, page, api } = await open();
    const X = '"><b class="pwned">x</b><x a="';
    const today = new Date().toISOString().slice(0, 10);
    const data = {
      family: { adults: 2, dietary: [], children: [{ id: 'k' + X, name: 'Sam' + X, birthDate: '2018-01-01', clothingSize: '7-8Y', shoeSize: '1' + X }] },
      food: {
        pantry: [{ id: 'p' + X, name: 'Rice' + X, quantity: X, unit: X, expiry: today }],
        recipes: [{ id: 'r' + X, name: 'Rice bowl' + X, servings: X, minutes: X, tags: ['dinner' + X], ingredients: [{ name: 'rice', qty: 1, unit: X }], steps: [X] }],
        favourites: ['r' + X],
      },
      clothes: { items: [{ id: 'c' + X, childId: 'k' + X, name: 'Tee' + X, type: 'top', colour: 'blue' + X, size: '7-8Y', pattern: 'plain', season: 'all' }, { id: 'c2' + X, childId: 'k' + X, name: 'Odd' + X, type: X, size: X }], targets: { top: X }, prices: { top: X } },
      shopping: { items: [{ id: 's' + X, name: 'Milk' + X, kind: 'food', quantity: X, unit: X, note: X, done: false, addedBy: X }], people: { [X]: X }, spending: [{ id: 'm' + X, amount: 5, date: today, shop: X, addedBy: X }] },
      chores: { list: [{ id: 'h' + X, name: 'Bins' + X, emoji: X, every: X, effort: 1, minAge: X, who: null }], log: [{ id: 'l' + X, choreId: 'h' + X, name: X, by: X, effort: 1, at: new Date().toISOString() }], adults: [{ id: 'a' + X, name: 'Mum' + X }], perPoint: X, dismissed: {} },
    };
    assert.equal((await api('/import', 'POST', { app: 'family-planner', data })).status, 200);
    for (const nav of ['home', 'food', 'clothes', 'shopping', 'chores', 'family', 'settings']) {
      // (Clicked from code: the long test strings can push things about on screen.)
      await page.evaluate((n) => document.querySelector(`#tabbar [data-nav="${n}"]`).click(), nav);
      await page.waitForFunction((n) => document.querySelector('#page-title')?.textContent && document.querySelector(`#tabbar [data-nav="${n}"]`)?.classList.contains('active'), nav);
      await page.waitForTimeout(300);
      assert.equal(await page.locator('.pwned').count(), 0, `page code injected on ${nav}`);
    }
    ok('text from saved or imported data never becomes page code');
    await ctx.close();
  }
  // 8. The hidden demo: five taps on "Family Planner" in Settings, then a sample family.
  {
    const { ctx, page, api, errors } = await open();
    await api('/family/children', 'POST', { name: 'Real kid', birthDate: '2019-01-01' });
    await page.click('[data-nav="settings"]:visible');
    await page.waitForSelector('#about-line');
    assert.equal(await page.locator('#demo-card').isVisible(), false, 'the demo is hidden at first');
    for (let i = 0; i < 5; i++) await page.click('#about-line');
    await page.click('#demo-card [data-demo="start"]');
    await page.click('#dialog .actions button:has-text("Show the demo")');
    await page.waitForSelector('#demo-banner:has-text("sample family")');
    await page.waitForSelector('#page :text("Mia")');
    for (const nav of ['home', 'food', 'clothes', 'shopping', 'chores', 'family']) {
      await page.click(`[data-nav="${nav}"]:visible`);
      await page.waitForFunction((n) => document.querySelector(`#tabbar [data-nav="${n}"]`)?.classList.contains('active'), nav);
      await page.waitForTimeout(400);
      assert.equal(await page.locator('#demo-banner').isVisible(), true);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${nav} fits the screen`);
      await page.screenshot({ path: `${SHOTS}/demo-${nav}.png`, fullPage: true });
    }
    await page.click('#demo-banner [data-demo="stop"]');
    await page.waitForSelector('#toast.show:has-text("your own data is back")');
    assert.deepEqual((await api('/family')).data.children.map((c) => c.name), ['Real kid']);
    assert.equal(await page.locator('#demo-banner').isVisible(), false);
    assert.deepEqual(errors, []);
    ok('hidden demo fills the app with a sample family, and leaving it brings yours back');
    await ctx.close();
  }
  // 9. Customise (colour, tabs, household name, start page) and the kitchen screen.
  for (const [width, height, name] of [[1180, 820, 'tablet'], [390, 844, 'phone']]) {
    const { ctx, page, api, errors } = await open({ width });
    await page.setViewportSize({ width, height });
    await api('/demo/start', 'POST');
    await page.evaluate(() => document.querySelector(`[data-nav="settings"]`).click());
    await page.waitForSelector('#customise-card');
    // Nothing on Settings looks like a login form, so browsers don't fill the AI boxes with it.
    assert.equal(await page.locator('#page input[type=password]').count(), 0);
    assert.equal(await page.getAttribute('#ai-form', 'autocomplete'), 'off');
    await page.click('[data-look-accent="purple"]');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.accent), 'purple');
    await page.uncheck('[data-look-tab="clothes"]');
    assert.equal(await page.locator('#tabbar [data-nav="clothes"], #nav [data-nav="clothes"]').count(), 0, 'clothes tab hidden');
    await page.fill('#household-name-form input[name=name]', 'The Schofields');
    await page.click('#household-name-form button');
    await page.waitForFunction(() => document.querySelector('.brand-name')?.textContent === 'The Schofields');
    await page.selectOption('[data-look-start]', 'kitchen');
    await page.uncheck('[data-look-panel="reminders"]');
    await page.check('[data-look-panel="week"]');

    // Reopening goes straight to the kitchen screen, in purple, with no tabs.
    await page.goto('http://localhost:5173/');
    await page.waitForSelector('.k-head .k-clock');
    assert.equal(await page.evaluate(() => document.body.classList.contains('kitchen-mode')), true);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.accent), 'purple');
    assert.match(await page.textContent('.k-title'), /The Schofields/);
    assert.equal(await page.locator('#k-reminders').count(), 0);
    assert.equal(await page.locator('#k-outfits').count(), 0, 'outfits leave with the clothes tab');
    await page.waitForSelector('#k-week .week');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'kitchen screen fits');
    await page.screenshot({ path: `${SHOTS}/kitchen-${name}.png`, fullPage: name === 'phone' });

    // Ticking things off from the kitchen.
    const before = await page.locator('#k-shopping .k-shop li').count();
    await page.click('#k-shopping [data-toggle] >> nth=0');
    await page.waitForFunction((n) => document.querySelectorAll('#k-shopping .k-shop li').length === n - 1, before);
    await page.click('#k-chores [data-chore-done] >> nth=0');
    if (await page.locator('#dialog[open]').count()) await page.click('#dialog .actions button:has-text("Done")');
    await page.waitForSelector('#toast.show:has-text("Well done")');

    // Home shows no clothes cards while clothes are hidden; turning it back on restores them.
    await page.click('.k-actions [data-nav]');
    await page.waitForSelector('#customise-card');
    await page.check('[data-look-tab="clothes"]');
    await page.selectOption('[data-look-start]', 'home');
    await page.evaluate(() => document.querySelector('[data-nav="home"]').click());
    await page.waitForSelector('[data-tool="clothes"]');
    await api('/demo/stop', 'POST');
    assert.deepEqual(errors, []);
    ok(`customise and the kitchen screen work on a ${name}`);
    await ctx.close();
  }
  // 10. First-run guide: a new family is walked through children, cupboards and clothes.
  {
    const { ctx, page, api, errors } = await open();
    console.log('✓ dbg 1 ' + 'const { ctx, page, api, errors } = await open();');
    await page.waitForSelector('#guide-card :text("0 of 3 done")');
    console.log('✓ dbg 2 ' + 'await page.waitForSelector(\'#guide-card :text("0 of 3 done")');
    await page.click('#guide-card button:has-text("Start")');
    console.log('✓ dbg 3 ' + 'await page.click(\'#guide-card button:has-text("Start")\');');
    await page.waitForSelector('#guide-banner :text("Step 1 of 3: Add your children")');
    console.log('✓ dbg 4 ' + 'await page.waitForSelector(\'#guide-banner :text("Step 1 of 3');
    await page.screenshot({ path: path.join(SHOTS, 'guide-step.png') });
    console.log('✓ dbg 5 ' + "await page.screenshot({ path: path.join(SHOTS, 'guide-step.p");
    await api('/family/children', 'POST', { name: 'Ava', birthDate: '2019-05-01', clothingSize: '6-7Y' });
    console.log('✓ dbg 6 ' + "await api('/family/children', 'POST', { name: 'Ava', birthDa");
    await page.evaluate(() => document.querySelector('[data-nav="family"]').click());
    console.log('✓ dbg 7 ' + "await page.evaluate(() => document.querySelector('[data-nav=");
    await page.waitForSelector('#guide-banner button:has-text("Next: Add what\'s in the cupboards")');
    console.log('✓ dbg 8 ' + 'await page.waitForSelector(\'#guide-banner button:has-text("N');
    await page.click('#guide-banner button:has-text("Next")');
    console.log('✓ dbg 9 ' + 'await page.click(\'#guide-banner button:has-text("Next")\');');
    await page.waitForSelector('#guide-banner :text("Step 2 of 3")');
    console.log('✓ dbg 10 ' + 'await page.waitForSelector(\'#guide-banner :text("Step 2 of 3');
    await api('/food/items', 'POST', { name: 'Pasta', quantity: 1, unit: 'pack' });
    console.log('✓ dbg 11 ' + "await api('/food/items', 'POST', { name: 'Pasta', quantity: ");
    await page.evaluate(() => document.querySelector('[data-nav="home"]').click());
    console.log('✓ dbg 12 ' + "await page.evaluate(() => document.querySelector('[data-nav=");
    await page.waitForSelector('#guide-card :text("2 of 3 done")');
    console.log('✓ dbg 13 ' + 'await page.waitForSelector(\'#guide-card :text("2 of 3 done")');
    await page.screenshot({ path: path.join(SHOTS, 'guide-home.png') });
    console.log('✓ dbg 14 ' + "await page.screenshot({ path: path.join(SHOTS, 'guide-home.p");
    const kid = (await api('/family')).data.children[0].id;
    console.log('✓ dbg 15 ' + "const kid = (await api('/family')).data.children[0].id;");
    const added = await api('/clothes/items', 'POST', { childId: kid, name: 'Blue jeans', type: 'bottom', size: '6-7Y' });
    console.log('✓ dbg 16 ' + "const added = await api('/clothes/items', 'POST', { childId:");
    assert.equal(added.status, 200, JSON.stringify(added.data));
    await page.evaluate(() => document.querySelector('[data-nav="clothes"]').click());
    console.log('✓ dbg 17 ' + "await page.evaluate(() => document.querySelector('[data-nav=");
    await page.waitForSelector('#toast.show:has-text("all set up")');
    console.log('✓ dbg 18 ' + 'await page.waitForSelector(\'#toast.show:has-text("all set up');
    assert.equal(await page.$('#guide-banner'), null);
    await page.evaluate(() => document.querySelector('[data-nav="home"]').click());
    console.log('✓ dbg 19 ' + "await page.evaluate(() => document.querySelector('[data-nav=");
    await page.waitForSelector('.kpi');
    console.log('✓ dbg 20 ' + "await page.waitForSelector('.kpi');");
    assert.equal(await page.$('#guide-card'), null);
    // Skipping on another fresh device hides it for good.
    const other = await open();
    console.log('✓ dbg 21 ' + 'const other = await open();');
    await other.page.click('[data-guide="skip"]');
    console.log('✓ dbg 22 ' + 'await other.page.click(\'[data-guide="skip"]\');');
    await other.page.waitForSelector('#toast.show:has-text("No problem")');
    console.log('✓ dbg 23 ' + 'await other.page.waitForSelector(\'#toast.show:has-text("No p');
    assert.equal(await other.page.$('#guide-card'), null);
    await other.page.evaluate(() => document.querySelector('[data-nav="family"]').click());
    console.log('✓ dbg 24 ' + "await other.page.evaluate(() => document.querySelector('[dat");
    await other.page.waitForSelector('#page .card');
    console.log('✓ dbg 25 ' + "await other.page.waitForSelector('#page .card');");
    assert.equal(await other.page.$('#guide-banner'), null);
    assert.deepEqual([...errors, ...other.errors], []);
    ok('first-run guide walks a new family through the three steps, and can be skipped');
    await other.ctx.close();
    await ctx.close();
  }
  console.log('\nAll phone app checks passed.');
} finally {
  await browser.close();
  ai.server.close();
  srv.kill();
}
