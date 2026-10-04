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
  console.log('\nAll phone app checks passed.');
} finally {
  await browser.close();
  ai.server.close();
  srv.kill();
}
