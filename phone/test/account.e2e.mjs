// End-to-end check of the household account: creating an account, signing in on a second
// device, changes travelling between devices, a clash between two devices, and signing out.
// Uses a stand-in for the AWS services (mock-cloud.mjs). Run after `npm run build`.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockCloud } from './mock-cloud.mjs';

// Opens a page the way a person would: from the bottom bar, or from More when it's in there.
async function tapNav(page, id) {
  if (!(await page.locator(`[data-nav="${id}"]:visible`).count())) await page.click('[data-more-toggle]:visible');
  await page.click(`[data-nav="${id}"]:visible`);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5178;
const srv = spawn('node', [path.join(ROOT, 'scripts', 'serve.mjs')], { env: { ...process.env, PORT: String(PORT) } });
await new Promise((r) => srv.stdout.once('data', r));
const cloud = await startMockCloud(5176);
const browser = await chromium.launch();
const ok = (m) => console.log('✓ ' + m);
const EMAIL = 'nathan@example.com';
const PASSWORD = 'family123';

async function open({ poll = 600000, init = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(`globalThis.__fpCloudConfig = { region: 'eu-west-2', clientId: 'test', apiUrl: '${cloud.url}', cognitoUrl: '${cloud.url}/' }; globalThis.__fpPollMs = ${poll};`);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ body: '' }));
  const load = async () => {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => document.querySelector('#page')?.children.length > 0);
  };
  await load();
  const api = (p, method = 'GET', body) => page.evaluate(async ([p, method, body]) => {
    const r = await fetch('/api/v1' + p, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => null) };
  }, [p, method, body]);
  const status = () => page.evaluate(() => window.FamilyPlannerAccount.status());
  const sync = () => page.evaluate(() => window.FamilyPlannerAccount.syncNow());
  const fill = async (values, button) => {
    for (const [name, value] of Object.entries(values)) await page.fill(`#dialog-form input[name=${name}]`, value);
    await page.click(`#dialog-form button:has-text("${button}")`);
  };
  // Waits for a toast saying this (an earlier one may still be showing).
  const toast = (re) => page.waitForFunction((src) => {
    const t = document.querySelector('#toast.show');
    return t && new RegExp(src).test(t.textContent) && t.textContent;
  }, re.source).then((h) => h.jsonValue());
  return { ctx, page, api, status, sync, fill, toast, load, errors };
}
const pantry = async (d) => (await d.api('/food/items')).data.map((i) => i.name).sort();
// Waits for something to happen outside the page (in the stand-in cloud).
const until = async (check, ms = 8000) => {
  for (const end = Date.now() + ms; !check(); await new Promise((r) => setTimeout(r, 100))) {
    if (Date.now() > end) throw new Error('Timed out waiting');
  }
};
// Headless Chromium has no push service: stand in for the browser's notification permission
// and pushManager, as a home screen app on a phone would have them.
const PUSH_STUB = `
  window.__perm = 'default';
  window.Notification = class { static get permission() { return window.__perm; } static async requestPermission() { return (window.__perm = 'granted'); } };
  const fake = { endpoint: 'https://web.push.apple.com/test-phone', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'p', auth: 'a' } }; }, async unsubscribe() { window.__sub = null; return true; } };
  PushManager.prototype.getSubscription = async () => window.__sub || null;
  PushManager.prototype.subscribe = async (o) => { window.__serverKey = o.applicationServerKey.length; return (window.__sub = fake); };
`;

try {
  // Device A: set up the family, then create an account from Settings.
  const a = await open();
  await a.api('/family/children', 'POST', { name: 'Sam', birthDate: '2021-03-01', clothingSize: '4-5Y', shoeSize: '10' });
  await a.api('/ai/settings', 'PUT', { provider: 'anthropic' });
  await a.api('/ai/settings', 'PUT', { apiKey: 'sk-secret-key' });
  await tapNav(a.page, 'settings');
  await a.page.waitForSelector('#account-card');
  assert.match(await a.page.textContent('#account-card'), /Only on this device/);
  await a.page.click('[data-account="signup"]');
  await a.fill({ email: EMAIL, password: 'short' }, 'Create account');
  await a.page.waitForSelector('#dialog-form :text("8 characters")');
  await a.fill({ email: EMAIL, password: PASSWORD }, 'Create account');
  await a.page.waitForSelector('#dialog-form input[name=code]');
  await a.fill({ code: '000000' }, 'Confirm');
  await a.page.waitForSelector('#dialog-form :text("isn\'t right")');
  await a.fill({ code: '123456' }, 'Confirm');
  await a.toast(/Account created/);
  await a.page.waitForSelector('#account-card :text("Saved online")');
  assert.match(await a.page.textContent('#account-card'), new RegExp(`Signed in as ${EMAIL}`));
  const saved = cloud.data(EMAIL);
  assert.equal(saved.family.children[0].name, 'Sam');
  assert.equal(saved.ai.provider, 'anthropic');
  assert.ok(!('apiKey' in saved.ai), 'the AI key is not uploaded');
  ok('create an account with email code; data saved online without the AI key');

  // Device B: new device signs in from the welcome card and gets the family's data.
  const b = await open();
  await b.page.click('#page [data-account="signin"]');
  await b.fill({ email: EMAIL, password: 'wrong-pass1' }, 'Sign in');
  await b.page.waitForSelector('#dialog-form :text("Wrong email or password")');
  await b.fill({ email: EMAIL, password: PASSWORD }, 'Sign in');
  await b.toast(/Signed in/);
  assert.equal((await b.api('/family')).data.children[0].name, 'Sam');
  assert.equal((await b.api('/ai/settings')).data.hasKey, false, 'B has no AI key of its own');
  ok('second device signs in (wrong password is explained) and gets the household');

  // A change on B reaches A when A next opens the app.
  await b.api('/food/items', 'POST', { name: 'pasta', quantity: 500, unit: 'g' });
  await b.page.waitForFunction(() => !window.FamilyPlannerAccount.status().pending, null, { timeout: 5000 });
  assert.deepEqual(cloud.data(EMAIL).food.pantry.map((i) => i.name), ['pasta']);
  await a.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await a.toast(/changes from your other device/);
  assert.deepEqual(await pantry(a), ['pasta']);
  assert.equal((await a.api('/ai/settings')).data.hasKey, true, 'A keeps its own AI key');
  ok('changes on one device show up on the other, and each keeps its own AI key');

  // Both change at once: the changes are combined, and both devices end up with both.
  await a.api('/food/items', 'POST', { name: 'rice', quantity: 1, unit: 'kg' });
  await b.api('/food/items', 'POST', { name: 'beans', quantity: 2, unit: 'tin' });
  await a.sync();
  await b.sync();
  assert.deepEqual(await pantry(b), ['beans', 'pasta', 'rice']);
  await b.toast(/Combined your changes/);
  assert.deepEqual(cloud.data(EMAIL).food.pantry.map((i) => i.name).sort(), ['beans', 'pasta', 'rice']);
  await a.sync();
  assert.deepEqual(await pantry(a), ['beans', 'pasta', 'rice']);
  ok('two devices saving at once: both changes are kept on both');

  // Reopening keeps you signed in; signing out keeps the data on the device.
  await a.load();
  assert.equal((await a.status()).signedIn, true);
  assert.deepEqual(await pantry(a), ['beans', 'pasta', 'rice']);
  await tapNav(a.page, 'settings');
  await a.page.click('[data-account="signout"]');
  await a.page.click('#dialog-form button:has-text("Sign out")');
  await a.page.waitForSelector('#account-card :text("Only on this device")');
  assert.deepEqual(await pantry(a), ['beans', 'pasta', 'rice']);
  await a.api('/food/items', 'POST', { name: 'eggs', quantity: 6, unit: '' });
  await new Promise((r) => setTimeout(r, 1800));
  assert.deepEqual(cloud.data(EMAIL).food.pantry.map((i) => i.name).sort(), ['beans', 'pasta', 'rice']);
  ok('stays signed in after reopening; signing out keeps data here and stops saving online');

  // A device that already has its own data asks which copy to keep.
  const c = await open();
  await c.api('/family/children', 'POST', { name: 'Ava', birthDate: '2019-06-01', clothingSize: '6-7Y', shoeSize: '12' });
  await tapNav(c.page, 'settings');
  await c.page.click('[data-account="signin"]');
  await c.fill({ email: EMAIL, password: PASSWORD }, 'Sign in');
  await c.page.waitForSelector('#dialog-form :text("Which data should this device use?")');
  await c.page.click('#dialog-form button:has-text("Continue")');
  await c.toast(/Signed in/);
  assert.deepEqual((await c.api('/family')).data.children.map((k) => k.name), ['Sam']);
  ok("signing in on a device with its own data asks first, and keeps the account's by default");

  // Forgotten password.
  await c.page.click('[data-account="signout"]');
  await c.page.click('#dialog-form button:has-text("Sign out")');
  await c.page.waitForSelector('#account-card :text("Only on this device")');
  await c.page.click('[data-account="signin"]');
  await c.page.fill('#dialog-form input[name=email]', EMAIL);
  await c.page.click('[data-account="forgot"]');
  await c.page.waitForSelector('#dialog-form :text("Reset your password")');
  assert.equal(await c.page.inputValue('#dialog-form input[name=email]'), EMAIL);
  await c.page.click('#dialog-form button:has-text("Send code")');
  await c.page.waitForSelector('#dialog-form :text("Choose a new password")');
  await c.fill({ code: '123456', password: 'newpass123' }, 'Save password');
  await c.toast(/Password changed/);
  assert.equal((await c.status()).signedIn, true);
  ok('forgotten password: code by email, new password, signed in');

  // A second person gets their own login and joins the household with an invite code.
  await c.page.waitForSelector('#account-card :text("Just you so far")');
  await c.page.click('[data-account="invite"]');
  const code = (await c.page.textContent('#invite-code')).trim();
  assert.match(code, /^\w{4}-\w{4}$/);
  await c.page.click('#dialog-form button:has-text("Done")');
  const d = await open({ poll: 400 });
  await d.api('/food/items', 'POST', { name: 'crisps', quantity: 1, unit: 'bag' });
  // New people can register from the Sign in box too (the email they typed carries over).
  await tapNav(d.page, 'settings');
  await d.page.click('[data-account="signin"]');
  await d.page.fill('#dialog-form input[name=email]', 'partner@example.com');
  await d.page.click('#dialog-form [data-account="to-signup"]');
  await d.page.waitForSelector('#dialog-form h2:has-text("Create an account")');
  assert.equal(await d.page.inputValue('#dialog-form input[name=email]'), 'partner@example.com');
  await d.fill({ password: 'partner123' }, 'Create account');
  await d.fill({ code: '123456' }, 'Confirm');
  await d.toast(/Account created/);
  assert.deepEqual(cloud.data('partner@example.com').food.pantry.map((i) => i.name), ['crisps']);
  await d.page.waitForSelector('#account-card [data-account="join"]');
  await d.page.click('[data-account="join"]');
  await d.fill({ code: 'nope' }, 'Join');
  await d.page.waitForSelector('#dialog-form :text("isn\'t right or has expired")');
  await d.fill({ code: code.toLowerCase() }, 'Join');
  await d.toast(new RegExp(`joined ${EMAIL}'s household`));
  assert.deepEqual(await pantry(d), ['beans', 'pasta', 'rice']);
  await d.page.waitForSelector('#account-card :text("Your household")');
  assert.match(await d.page.textContent('#account-card'), new RegExp(`${EMAIL}[\\s\\S]*partner@example.com \\(you\\)`));
  ok('a second person signs up with their own email and joins with an invite code');

  // Their changes land in the shared household; leaving takes a copy back to their own.
  await d.api('/food/items', 'POST', { name: 'milk', quantity: 2, unit: 'l' });
  await d.page.waitForFunction(() => !window.FamilyPlannerAccount.status().pending, null, { timeout: 5000 });
  assert.deepEqual(cloud.data(EMAIL).food.pantry.map((i) => i.name).sort(), ['beans', 'milk', 'pasta', 'rice']);
  await c.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await c.toast(/changes from your other device/);
  assert.deepEqual(await pantry(c), ['beans', 'milk', 'pasta', 'rice']);
  ok("each person's changes reach the rest of the household");

  // Shopping together: the list updates live on the other phone, showing who added what.
  await tapNav(d.page, 'settings');
  await d.page.click('[data-account="name"]');
  await d.fill({ name: 'Jo' }, 'Save');
  await d.page.waitForSelector('#account-card :text("show as Jo")');
  await tapNav(d.page, 'shopping');
  await tapNav(c.page, 'shopping');
  await c.page.fill('#shop-form input[name=name]', 'Bananas');
  await c.page.click('#shop-form button.primary');
  await d.page.waitForSelector('#shop-list :text("Bananas")', { timeout: 5000 });
  assert.match(await d.page.textContent('#shop-list'), new RegExp(`Bananas[\\s\\S]*Added by Nathan`));
  await d.page.fill('#shop-form input[name=name]', 'Nappies');
  await d.page.click('#shop-form button.primary');
  await d.page.waitForFunction(() => !window.FamilyPlannerAccount.status().pending, null, { timeout: 5000 });
  await c.sync();
  await c.page.waitForSelector('#shop-list :text("Added by Jo")');
  assert.doesNotMatch(await c.page.textContent('#shop-list'), /Added by Nathan/, 'your own items say nothing');
  ok('the shared list updates live on the other phone and shows who added each thing');
  await tapNav(d.page, 'settings');
  await d.page.click('[data-account="leave"]');
  await d.page.click('#dialog-form button:has-text("Leave")');
  await d.toast(/left the household/);
  await d.page.waitForSelector('#account-card :text("Just you so far")');
  assert.deepEqual(cloud.data('partner@example.com').food.pantry.map((i) => i.name).sort(), ['beans', 'milk', 'pasta', 'rice']);
  assert.deepEqual(cloud.data(EMAIL).food.pantry.map((i) => i.name).sort(), ['beans', 'milk', 'pasta', 'rice']);
  ok("leaving keeps a copy and leaves the others' lists alone");

  // The demo's sample family never reaches the household's online copy.
  const before = JSON.stringify(cloud.data(EMAIL));
  await c.api('/demo/start', 'POST');
  await c.api('/food/items', 'POST', { name: 'Demo only' });
  await c.sync();
  await c.page.waitForTimeout(2500);
  assert.equal(JSON.stringify(cloud.data(EMAIL)), before, 'nothing from the demo is uploaded');
  assert.equal((await c.status()).demo, true);
  await c.api('/demo/stop', 'POST');
  await c.page.waitForFunction(() => !window.FamilyPlannerAccount.status().pending, null, { timeout: 5000 });
  assert.deepEqual(cloud.data(EMAIL).food.pantry.map((i) => i.name).sort(), ['beans', 'milk', 'pasta', 'rice']);
  assert.ok(!JSON.stringify(cloud.data(EMAIL)).includes('Mia'));
  assert.deepEqual(await pantry(c), ['beans', 'milk', 'pasta', 'rice']);
  ok('the demo stays on the device: nothing is saved online, and the real lists come back');

  // Feedback from Settings is sent with who sent it.
  await tapNav(d.page, 'settings');
  await d.page.waitForSelector('#feedback-form');
  await d.page.waitForFunction(() => !window.FamilyPlannerAccount.status().syncing);
  await d.page.waitForTimeout(300); // let the household line finish loading
  await d.page.fill('#feedback-form textarea', 'Can we have a pudding list?');
  await d.page.click('#feedback-form button');
  await d.toast(/feedback has been sent/);
  assert.deepEqual(cloud.feedback.at(-1), { from: 'partner@example.com', text: 'Can we have a pudding list?', page: 'settings' });
  assert.equal(await d.page.inputValue('#feedback-form textarea'), '');
  ok('feedback from Settings is sent with who sent it');

  // Recipe from a link: the app can't open other sites, so the server opens the page.
  const { status: linkStatus, data: draft } = await d.api('/food/recipes/from-link', 'POST', { url: 'https://example.com/flapjacks' });
  assert.equal(linkStatus, 200, JSON.stringify(draft));
  assert.equal(draft.name, 'Mock flapjacks');
  assert.ok(draft.ingredients.some((i) => /oats/i.test(i.name)));
  ok('a recipe link is opened through the account when signed in');

  // Phone notifications (home screen version) and the Siri key, from Settings.
  const e = await open({ init: PUSH_STUB });
  await tapNav(e.page, 'settings');
  await e.page.waitForSelector('#push-card :text("Sign in to get reminders on this phone")');
  await e.page.click('[data-account="signin"]');
  await e.fill({ email: EMAIL, password: 'newpass123' }, 'Sign in');
  await e.toast(/Signed in/);
  await e.page.click('#push-card [data-push="on"]');
  await e.page.waitForSelector('#push-card :text("Notifications are on for this phone")');
  assert.equal(await e.page.evaluate(() => window.__serverKey), 65, "subscribed with the server's key");
  assert.deepEqual(cloud.push.subs.map((x) => x.endpoint), ['https://web.push.apple.com/test-phone']);
  assert.equal(cloud.push.tests, 1, 'a test notification is sent');
  await until(() => cloud.push.schedules.length === 1);
  assert.ok(Array.isArray(cloud.push.schedules[0].items));
  // A change that alters the reminders is uploaded again; one that doesn't isn't.
  await e.api('/family', 'PUT', { name: 'The Testers' });
  await e.page.waitForTimeout(3500);
  assert.equal(cloud.push.schedules.length, 1, 'the same reminders are not uploaded twice');
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await e.api('/food/items', 'POST', { name: 'yoghurt', quantity: 1, unit: 'pot', expiry: tomorrow });
  await until(() => cloud.push.schedules.length === 2);
  const item = cloud.push.schedules[1].items.find((i) => i.id.startsWith('food-expiry-'));
  assert.ok(item && /yoghurt/.test(item.body) && !isNaN(new Date(item.at)), JSON.stringify(cloud.push.schedules[1]));
  await e.page.click('#push-card [data-push="test"]');
  await e.toast(/Sent/);
  assert.equal(cloud.push.tests, 2);
  ok('notifications: turned on from Settings, a test is sent and the reminders upload when they change');

  await e.page.click('#siri-card [data-siri="setup"]');
  await e.page.waitForSelector('#dialog-form #siri-key');
  assert.equal(await e.page.inputValue('#siri-key'), cloud.shortcut.key);
  assert.equal(await e.page.inputValue('#siri-url'), `${cloud.url}/shortcut/add`);
  assert.match(await e.page.textContent('#dialog-form'), /Dictate Text[\s\S]*Get Contents of URL[\s\S]*Get Dictionary Value[\s\S]*Speak Text[\s\S]*Add to shopping/);
  await e.page.click('#dialog-form button:has-text("Done")');
  await e.page.click('#siri-card [data-siri="off"]');
  await e.page.click('#dialog-form button:has-text("Turn off")');
  await e.toast(/Siri key turned off/);
  assert.equal(cloud.shortcut.key, null);
  await e.page.waitForSelector('#siri-card [data-siri="setup"]:has-text("Set up Hey Siri")');
  await e.page.click('#push-card [data-push="off"]');
  await e.page.waitForSelector('#push-card [data-push="on"]');
  assert.deepEqual(cloud.push.subs, []);
  ok('Siri: a key with the Shortcut steps, and turning it off');

  // Deleting an account needs the password, removes the login and its online lists, and
  // (by default) clears the device. Everyone else's lists are left alone.
  const others = JSON.stringify(cloud.data(EMAIL));
  await tapNav(d.page, 'settings');
  await d.page.click('[data-account="delete"]');
  await d.fill({ password: 'wrong-pass1' }, 'Delete account');
  await d.page.waitForSelector('#dialog-form :text("That password isn\'t right")');
  assert.ok(cloud.hasUser('partner@example.com'));
  // Clearing the device reloads the app.
  await Promise.all([d.page.waitForEvent('load'), d.fill({ password: 'partner123' }, 'Delete account')]);
  await d.page.waitForFunction(() => document.querySelector('#page')?.children.length > 0);
  assert.equal((await d.status()).signedIn, false);
  assert.equal(cloud.hasUser('partner@example.com'), false);
  assert.equal(cloud.data('partner@example.com'), null);
  assert.deepEqual(await pantry(d), []);
  assert.equal(JSON.stringify(cloud.data(EMAIL)), others);
  ok('deleting an account asks for the password, removes it online and clears the device');

  for (const x of [a, b, c, d, e]) assert.deepEqual(x.errors, []);
  ok('no page errors');
} finally {
  await browser.close();
  cloud.close();
  srv.kill();
}
