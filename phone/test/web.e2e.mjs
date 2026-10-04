// Checks the home screen build (dist-web/): runs in Safari-like conditions, keeps data,
// and still opens with no internet once loaded. Run after `npm run build:web`.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srv = spawn('node', [path.join(ROOT, 'scripts', 'serve.mjs')], { env: { ...process.env, PORT: '5175', SERVE_DIR: 'dist-web' } });
await new Promise((r) => srv.stdout.once('data', r));
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ body: '' }));
  await page.goto('http://localhost:5175/');
  await page.waitForFunction(() => document.querySelector('#page')?.children.length > 0);
  const html = await page.content();
  assert.match(html, /apple-touch-icon/);
  assert.match(html, /apple-mobile-web-app-capable/);
  const icon = await page.evaluate(async () => (await fetch('/apple-touch-icon.png')).headers.get('content-type'));
  assert.equal(icon, 'image/png');
  console.log('✓ home screen icon and settings are in place');

  await page.evaluate(() => fetch('/api/v1/food/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'pasta', quantity: 500, unit: 'g' }) }));
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // let the service worker take control and cache everything
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await page.waitForTimeout(500);

  await ctx.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#page')?.children.length > 0);
  const items = await page.evaluate(async () => (await fetch('/api/v1/food/items')).json());
  assert.equal(items[0].name, 'pasta');
  await page.goto('http://localhost:5175/some/other/page');
  await page.waitForFunction(() => document.querySelector('#page')?.children.length > 0);
  console.log('✓ opens with no internet, with the data still there');
  assert.deepEqual(errors, []);
  console.log('\nHome screen version checks passed.');
} finally {
  await browser.close();
  srv.kill();
}
