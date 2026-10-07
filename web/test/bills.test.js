// Bills: when they're due, paying and undoing, tips from rules and the AI, reminders, and
// personal bills that only the person who added them can see.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createApp } = require('../server');
const { Store } = require('../lib/store');
const { nextDue, occurrences, overview, ruleTips, step } = require('../modules/bills/engine');

const ALEX = 'alex@example.com';
const SAM = 'sam@example.com';

async function start(t) {
  const server = http.createServer(createApp(new Store(null))).listen(0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}/api/v1`;
  return async (method, path, body, member) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(member ? { 'X-Family-Member': member } : {}) }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
}
const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

test('due dates: months keep their day, ones that pay themselves move on by themselves', () => {
  assert.strictEqual(step('2026-01-31', 'month', 31), '2026-02-28');
  assert.strictEqual(step('2026-02-28', 'month', 31), '2026-03-31', 'back to the 31st after a short month');
  assert.strictEqual(step('2026-10-07', '4weeks'), '2026-11-04');
  assert.strictEqual(step('2026-10-07', 'year', 7), '2027-10-07');
  assert.strictEqual(step('2026-10-07', 'once'), null);
  const dd = { every: 'month', due: '2026-08-15', day: 15, auto: true };
  assert.strictEqual(nextDue(dd, '2026-10-07'), '2026-10-15');
  assert.strictEqual(nextDue({ ...dd, auto: false }, '2026-10-07'), '2026-08-15', 'paid by hand stays due until marked paid');
  assert.deepStrictEqual(occurrences({ every: 'week', due: '2026-10-08', auto: true }, '2026-10-07', '2026-10-25', '2026-10-07'), ['2026-10-08', '2026-10-15', '2026-10-22']);
});

test('rule tips: deals ending, renewals, price rises and subscriptions, and "Not now"', () => {
  const t = '2026-10-07';
  const bills = [
    { id: 'bb', name: 'Broadband', amount: 32, every: 'month', due: '2026-10-12', auto: true, category: 'internet', ends: '2026-10-30' },
    { id: 'car', name: 'Car insurance', amount: 480, every: 'year', due: '2026-10-25', category: 'insurance' },
    { id: 'gas', name: 'Gas', amount: 118, every: 'month', due: '2026-10-20', auto: true, category: 'energy', changes: [{ date: '2026-10-01', from: 96, to: 118 }] },
    { id: 'n', name: 'Netflix', amount: 10.99, every: 'month', due: '2026-10-04', auto: true, category: 'subscriptions' },
    { id: 'd', name: 'Disney+', amount: 7.99, every: 'month', due: '2026-10-22', auto: true, category: 'subscriptions' },
    { id: 's', name: 'Spotify', amount: 19.99, every: 'month', due: '2026-10-09', auto: true, category: 'subscriptions' },
  ];
  const tips = ruleTips(bills, t);
  assert.deepStrictEqual(tips.map((x) => x.kind), ['renewal', 'renewal', 'price', 'subscriptions']);
  assert.match(tips[2].text, /Gas went up 23%, from £96 to £118/);
  assert.match(tips[3].text, /3 subscriptions come to about £38\.97 a month/);
  const dismissed = { [tips[0].key]: '2026-11-01T00:00:00Z' };
  assert.strictEqual(ruleTips(bills, t, dismissed).length, 3);
  const v = overview(bills, { today: t });
  assert.strictEqual(v.totals.all, round(32 + 40 + 118 + 10.99 + 7.99 + 19.99));
  assert.ok(v.upcoming.every((u) => u.date >= t && u.date <= '2026-11-06'));
});
const round = (n) => Math.round(n * 100) / 100;

test('personal bills: only the person who added them sees them, change them or gets reminders', async (t) => {
  const call = await start(t);
  const family = (await call('POST', '/bills', { name: 'Council tax', amount: '£168', every: 'month', due: inDays(2), category: 'council' }, ALEX)).body;
  const gym = (await call('POST', '/bills', { name: 'Gym', amount: 29, due: inDays(1), category: 'other', personal: true }, ALEX)).body;
  assert.strictEqual(family.amount, 168);
  assert.strictEqual(family.personal, false);
  assert.strictEqual(gym.owner, ALEX);

  const alex = (await call('GET', '/bills', null, ALEX)).body;
  const sam = (await call('GET', '/bills', null, SAM)).body;
  assert.deepStrictEqual(alex.bills.map((b) => b.name).sort(), ['Council tax', 'Gym']);
  assert.deepStrictEqual(sam.bills.map((b) => b.name), ['Council tax']);
  assert.strictEqual(alex.totals.personal, 29);
  assert.strictEqual(sam.totals.personal, 0);
  assert.strictEqual((await call('PUT', `/bills/${gym.id}`, { amount: 1 }, SAM)).status, 404);
  assert.strictEqual((await call('DELETE', `/bills/${gym.id}`, null, SAM)).status, 404);
  assert.strictEqual((await call('POST', `/bills/${gym.id}/paid`, {}, SAM)).status, 404);

  const remindersFor = async (who) => (await call('GET', '/reminders', null, who)).body.filter((r) => r.kind === 'bills').map((r) => r.title);
  assert.deepStrictEqual((await remindersFor(ALEX)).sort(), ['Council tax is due in 2 days', 'Gym is due in 1 day']);
  assert.deepStrictEqual(await remindersFor(SAM), ['Council tax is due in 2 days']);
  assert.ok((await call('GET', '/dashboard', null, ALEX)).body.reminders.find((r) => r.title.startsWith('Gym')).personal, 'marked for the kitchen screen');
  assert.deepStrictEqual((await call('GET', '/dashboard', null, SAM)).body.bills.upcoming.map((u) => u.name), ['Council tax']);

  // Only the person who added a family bill can make it personal; either way back is fine.
  assert.strictEqual((await call('PUT', `/bills/${family.id}`, { personal: true }, SAM)).status, 403);
  assert.strictEqual((await call('PUT', `/bills/${family.id}`, { personal: true }, ALEX)).body.personal, true);
  assert.strictEqual((await call('GET', '/bills', null, SAM)).body.bills.length, 0);
  await call('PUT', `/bills/${family.id}`, { personal: false }, ALEX);
  await call('PUT', `/bills/${gym.id}`, { personal: false }, ALEX);
  assert.strictEqual((await call('GET', '/bills', null, SAM)).body.bills.length, 2, 'shared with the family again');
});

test('paying moves a bill on, undo puts it back, a one-off is done; price changes are kept', async (t) => {
  const call = await start(t);
  const b = (await call('POST', '/bills', { name: 'Water', amount: 42, every: 'month', due: inDays(-3), category: 'water' })).body;
  const before = (await call('GET', '/bills')).body.bills[0];
  assert.strictEqual(before.status, 'overdue');
  assert.ok((await call('GET', '/reminders')).body.some((r) => r.title === 'Water was due 3 days ago' && r.level === 'urgent'));
  const paid = (await call('POST', `/bills/${b.id}/paid`, {})).body;
  assert.strictEqual(paid.paid.length, 1);
  assert.strictEqual(paid.paid[0].amount, 42);
  assert.ok(paid.due > inDays(20), 'next month');
  const undone = (await call('POST', `/bills/${b.id}/unpaid`, {})).body;
  assert.strictEqual(undone.due, inDays(-3));
  assert.strictEqual((await call('POST', `/bills/${b.id}/unpaid`, {})).status, 409);

  const trip = (await call('POST', '/bills', { name: 'School trip', amount: 18.5, every: 'once', due: inDays(4) })).body;
  assert.strictEqual((await call('POST', `/bills/${trip.id}/paid`, {})).body.done, true);
  assert.strictEqual((await call('POST', `/bills/${trip.id}/paid`, {})).status, 409);
  assert.strictEqual((await call('GET', '/bills')).body.bills.find((x) => x.id === trip.id).status, 'done');

  const up = (await call('PUT', `/bills/${b.id}`, { amount: 50 })).body;
  assert.deepStrictEqual(up.changes, [{ date: today(), from: 42, to: 50 }]);
  assert.ok((await call('GET', '/bills')).body.tips.some((x) => x.kind === 'price'));
  assert.strictEqual((await call('POST', '/bills', { name: 'Bad', amount: 'lots', due: today() })).status, 400);
  assert.strictEqual((await call('POST', '/bills', { name: 'Bad', amount: 1, due: 'soon' })).status, 400);
  assert.strictEqual((await call('POST', '/bills', { name: 'Bad', amount: 1, due: today(), every: 'daily' })).status, 400);
});

test('"Not now" on a personal bill\'s tip is kept on that bill, not in the shared list', async (t) => {
  const call = await start(t);
  const ins = (await call('POST', '/bills', { name: 'Phone insurance', amount: 90, every: 'year', due: inDays(10), category: 'insurance', personal: true }, ALEX)).body;
  const tip = (await call('GET', '/bills', null, ALEX)).body.tips.find((x) => x.billId === ins.id);
  assert.ok(tip);
  await call('POST', '/bills/tips/dismiss', { key: tip.key }, ALEX);
  assert.strictEqual((await call('GET', '/bills', null, ALEX)).body.tips.length, 0);
  const backup = (await call('GET', '/export')).body.data.bills;
  assert.deepStrictEqual(backup.dismissed, {});
  assert.ok(backup.items[0].dismissed[tip.key]);
});

test('AI tips: the prompt has only what this person may see, and answers are kept per person', async (t) => {
  const call = await start(t);
  await call('POST', '/bills', { name: 'Mortgage', amount: 945, due: inDays(5), category: 'home', auto: true }, ALEX);
  const secret = (await call('POST', '/bills', { name: 'Secret savings', amount: 100, due: inDays(6), personal: true }, ALEX)).body;
  const promptFor = async (who) => (await call('GET', '/ai/tasks/suggest-bills', null, who)).body.prompt;
  assert.match(await promptFor(ALEX), /Secret savings/);
  assert.doesNotMatch(await promptFor(SAM), /Secret savings/);
  assert.match(await promptFor(SAM), /Mortgage/);

  const r = (await call('POST', '/ai/suggest/bills', { by: 'iPhone AI', result: { tips: [{ billId: secret.id, text: 'Move the savings to a better rate.' }, { billId: 'nope', text: 'Check the mortgage rate.' }, { billId: '', text: '' }] } }, ALEX)).body;
  assert.deepStrictEqual(r.tips.map((x) => [x.billId || null, x.text]), [[secret.id, 'Move the savings to a better rate.'], [null, 'Check the mortgage rate.']]);
  assert.strictEqual((await call('POST', '/ai/suggest/bills', { cacheOnly: true }, SAM)).status, 404, "Sam doesn't get Alex's tips");
  assert.strictEqual((await call('POST', '/ai/suggest/bills', { cacheOnly: true }, ALEX)).body.cached, true);
});

test('bills are in the backup and come back from it', async (t) => {
  const call = await start(t);
  await call('POST', '/bills', { name: 'Water', amount: 42, due: today() });
  const backup = (await call('GET', '/export')).body;
  assert.strictEqual(backup.data.bills.items[0].name, 'Water');
  const other = await start(t);
  assert.strictEqual((await other('POST', '/import', backup)).status, 200);
  assert.strictEqual((await other('GET', '/bills')).body.bills[0].name, 'Water');
  assert.strictEqual((await other('POST', '/import', { app: 'family-planner', data: { bills: { items: 'x' } } })).status, 400);
});
