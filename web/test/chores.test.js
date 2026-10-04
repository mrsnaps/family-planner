// Chores: repeats, a fair rota by rules, ticks with who did it, points and pocket money,
// suggestions, reminders, and the AI version of the rota.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createApp } = require('../server');
const { Store } = require('../lib/store');
const { rota, status, choreSuggestions, weekTotals } = require('../modules/chores/engine');

const TODAY = '2026-10-04';
const at = (day) => `${day}T09:00:00.000Z`;
const people = [
  { id: 'mum', name: 'Mum', adult: true },
  { id: 'dad', name: 'Dad', adult: true },
  { id: 'ava', name: 'Ava', age: 10 },
  { id: 'sam', name: 'Sam', age: 4 },
];

test('status: due from when it was last done, never done means today, snoozed moves it', () => {
  assert.deepStrictEqual(status({ every: 7, lastDone: at('2026-09-30') }, TODAY), { due: '2026-10-07', dueIn: 3, state: 'later' });
  assert.deepStrictEqual(status({ every: 2, lastDone: at('2026-09-30') }, TODAY), { due: '2026-10-02', dueIn: -2, state: 'overdue' });
  assert.strictEqual(status({ every: 3 }, TODAY).state, 'today');
  assert.strictEqual(status({ every: 1, lastDone: at('2026-10-02'), snoozedUntil: '2026-10-05' }, TODAY).due, '2026-10-05');
});

test('rota: shares out fairly, only to people old enough, and keeps fixed people', () => {
  const chores = [
    { id: 'bath', name: 'Clean the bathroom', every: 7, effort: 3, minAge: 12 },
    { id: 'hoover', name: 'Hoover', every: 2, effort: 2, minAge: 9 },
    { id: 'table', name: 'Set the table', every: 1, effort: 1, minAge: 4 },
    { id: 'room', name: 'Tidy room (Sam)', every: 2, effort: 1, minAge: 3, who: 'sam' },
    { id: 'off', name: 'Paused', every: 1, effort: 1, paused: true },
  ];
  const log = [{ choreId: 'bath', by: 'mum', effort: 3, at: at('2026-10-01') }];
  const week = rota(chores, people, log, { today: TODAY });
  assert.strictEqual(week.length, 7);
  assert.strictEqual(week[0].date, TODAY);
  const all = week.flatMap((d) => d.items);
  assert.ok(!all.some((i) => i.choreId === 'off'), 'paused chores are left out');
  assert.strictEqual(all.filter((i) => i.choreId === 'table').length, 7, 'daily chore every day');
  assert.strictEqual(all.filter((i) => i.choreId === 'hoover').length, 4);
  assert.ok(all.filter((i) => i.choreId === 'room').every((i) => i.who === 'sam'));
  assert.ok(all.filter((i) => i.choreId === 'bath').every((i) => ['mum', 'dad'].includes(i.who)), 'only grown-ups (12+)');
  assert.strictEqual(all.find((i) => i.choreId === 'bath').who, 'dad', 'mum did it last time');
  assert.ok(all.filter((i) => i.choreId === 'hoover').every((i) => i.who !== 'sam'), 'Sam is too young to hoover');
  // Fair: everyone old enough gets a share, and points end up close.
  const pts = {};
  for (const i of all) pts[i.who] = (pts[i.who] || 0) + i.effort;
  pts.mum += 3;
  const shared = ['mum', 'dad', 'ava'].map((p) => pts[p]);
  assert.ok(Math.max(...shared) - Math.min(...shared) <= 3, JSON.stringify(pts));
});

test('suggestions: chores the children are old enough for, and the gap you really keep to', () => {
  const chores = [{ id: 'bins', name: 'Take the bins out', starter: 'bins', every: 7, effort: 1, minAge: 8 }];
  const log = ['2026-09-10', '2026-09-24', '2026-10-01', '2026-10-03'].map((d) => ({ choreId: 'bins', by: 'mum', at: at(d) }));
  // Gaps 14, 7, 2: typical 7, same as planned, so nothing to change.
  assert.ok(!choreSuggestions(chores, people, log, { today: TODAY }).some((s) => s.kind === 'every'));
  const log2 = ['2026-09-01', '2026-09-15', '2026-09-29'].map((d) => ({ choreId: 'bins', by: 'mum', at: at(d) }));
  const s = choreSuggestions(chores, people, log2, { today: TODAY });
  assert.deepStrictEqual(s.find((x) => x.kind === 'every'), { kind: 'every', choreId: 'bins', name: 'Take the bins out', every: 14, reason: 'You usually do this every 14 days, not every 7.' });
  const adds = s.filter((x) => x.kind === 'add');
  assert.ok(adds.some((x) => x.starter === 'table' && /Sam/.test(x.reason)));
  assert.ok(adds.some((x) => x.starter === 'kitchen' && /Ava/.test(x.reason)) && adds.length <= 4);
  assert.ok(!adds.some((x) => x.starter === 'bins'), 'already have it');
  // Nothing set up and no children: the everyday basics.
  assert.ok(choreSuggestions([], [people[0]], [], { today: TODAY }).length >= 4);
});

test('week totals: points per person and pocket money for children', () => {
  const log = [
    { by: 'ava', effort: 2, at: at('2026-10-03') }, { by: 'ava', effort: 1, at: at('2026-10-04') },
    { by: 'ava', effort: 3, at: at('2026-09-20') }, // too long ago
    { by: 'mum', effort: 3, at: at('2026-10-02') },
  ];
  const t = weekTotals(people, log, { today: TODAY, perPoint: 25 });
  assert.deepStrictEqual(t.find((x) => x.id === 'ava'), { id: 'ava', name: 'Ava', adult: false, done: 2, points: 3, money: 0.75 });
  assert.strictEqual(t.find((x) => x.id === 'mum').money, null);
});

function start(t, store = new Store(null)) {
  const server = http.createServer(createApp(store)).listen(0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}/api/v1`;
  return async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
}

test('API: add from starters, tick off, undo, skip, names, pocket money, Home and reminders', async (t) => {
  const call = start(t);
  const ava = (await call('POST', '/family/children', { name: 'Ava', birthDate: '2016-01-01', clothingSize: '9-10Y', shoeSize: '3' })).body;
  const sam = (await call('POST', '/family/children', { name: 'Sam', birthDate: '2022-01-01', clothingSize: '4-5Y', shoeSize: '9' })).body;
  let v = (await call('GET', '/chores')).body;
  assert.deepStrictEqual(v.people.map((p) => p.name), ['Grown-up 1', 'Grown-up 2', 'Ava', 'Sam']);
  assert.ok(v.suggestions.length > 0 && v.starters.length > 10);

  const dishes = (await call('POST', '/chores', { starter: 'dishes' })).body;
  assert.deepStrictEqual([dishes.name, dishes.every, dishes.minAge, dishes.starter], ['Wash up or load the dishwasher', 1, 7, 'dishes']);
  const rooms = (await call('POST', '/chores', { starter: 'tidy-room' })).body.added;
  assert.deepStrictEqual(rooms.map((r) => [r.name, r.who]), [['Tidy bedroom (Ava)', ava.id], ['Tidy bedroom (Sam)', sam.id]]);
  const bins = (await call('POST', '/chores', { name: 'Bins', every: 7, effort: 1, minAge: 8, area: 'Outside' })).body;
  assert.strictEqual((await call('POST', '/chores', { name: 'x', every: 0 })).status, 400);
  assert.strictEqual((await call('POST', '/chores', { name: 'x', who: 'nobody' })).status, 400);
  assert.strictEqual((await call('POST', '/chores', { starter: 'nope' })).status, 404);

  v = (await call('GET', '/chores')).body;
  assert.strictEqual(v.stats.dueToday, 4);
  assert.ok(!v.starters.some((s) => s.key === 'dishes'));
  const dash = (await call('GET', '/dashboard')).body;
  assert.strictEqual(dash.chores.dueToday, 4);
  assert.strictEqual(dash.chores.todayList.length, 4);
  assert.ok(dash.reminders.some((r) => r.kind === 'chores' && r.title === '4 chores to do today'));

  // Done by Ava, ticked by a signed-in grown-up; it moves to tomorrow.
  const done = (await call('POST', `/chores/${dishes.id}/done`, { by: ava.id }, { 'X-Family-Member': 'jo@example.com' })).body;
  assert.deepStrictEqual([done.entry.by, done.entry.tickedBy, done.entry.effort, done.chore.state], [ava.id, 'jo@example.com', 1, 'later']);
  assert.strictEqual((await call('POST', `/chores/${dishes.id}/done`, { by: 'nobody' })).status, 400);
  v = (await call('GET', '/chores')).body;
  assert.strictEqual(v.stats.doneToday, 1);
  assert.strictEqual(v.totals.find((p) => p.id === ava.id).points, 1);
  // Undo puts it back.
  await call('DELETE', `/chores/log/${done.entry.id}`);
  v = (await call('GET', '/chores')).body;
  assert.strictEqual(v.chores.find((c) => c.id === dishes.id).state, 'today');
  assert.strictEqual(v.stats.doneToday, 0);
  // Skip to tomorrow.
  assert.strictEqual((await call('POST', `/chores/${bins.id}/skip`, {})).body.dueIn, 1);

  // Names for the grown-ups, pocket money per point.
  const g1 = v.people[0];
  await call('PUT', '/chores/people', { adults: [{ id: g1.id, name: 'Nathan' }] });
  await call('PUT', '/chores/settings', { perPoint: 20 });
  assert.strictEqual((await call('PUT', '/chores/settings', { perPoint: -1 })).status, 400);
  await call('POST', `/chores/${rooms[0].id}/done`, {});
  v = (await call('GET', '/chores')).body;
  assert.strictEqual(v.people[0].name, 'Nathan');
  assert.deepStrictEqual(v.totals.find((p) => p.id === ava.id), { id: ava.id, name: 'Ava', adult: false, done: 1, points: 1, money: 0.2 });

  // Edit, pause, delete; and chores are part of the backup.
  await call('PUT', `/chores/${bins.id}`, { every: 14, who: g1.id });
  await call('PUT', `/chores/${dishes.id}`, { paused: true });
  v = (await call('GET', '/chores')).body;
  assert.deepStrictEqual([v.chores.find((c) => c.id === bins.id).every, v.chores.find((c) => c.id === bins.id).whoName], [14, 'Nathan']);
  assert.ok(!v.rota.flatMap((d) => d.items).some((i) => i.choreId === dishes.id));
  assert.strictEqual((await call('DELETE', `/chores/${dishes.id}`)).status, 200);
  assert.ok((await call('GET', '/export')).body.data.chores.list.length === 3);
  assert.strictEqual((await call('POST', '/chores/suggestions/dismiss', { key: 'hoover' })).status, 200);
  assert.ok(!(await call('GET', '/chores')).body.suggestions.some((s) => s.starter === 'hoover'));
});

test('AI: who does what comes from the AI, checked against ages and fixed people', async (t) => {
  let answer = null;
  const ai = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const prompt = JSON.parse(raw).messages.map((m) => m.content).join('\n');
      answer = answer || ((p) => p);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer(prompt)) } }] }));
    });
  }).listen(0);
  t.after(() => ai.close());
  const call = start(t);
  const sam = (await call('POST', '/family/children', { name: 'Sam', birthDate: '2022-01-01', clothingSize: '4-5Y', shoeSize: '9' })).body;
  const bath = (await call('POST', '/chores', { starter: 'bathroom' })).body;
  const table = (await call('POST', '/chores', { starter: 'table' })).body;
  const fixed = (await call('POST', '/chores', { name: 'Feed the cat', every: 1, who: sam.id })).body;
  const [g1, g2] = (await call('GET', '/chores')).body.people;
  let seen = '';
  answer = (prompt) => {
    seen = prompt;
    return {
      assignments: [
        { day: 0, choreId: bath.id, personId: sam.id }, // too young: ignored
        { day: 0, choreId: table.id, personId: sam.id },
        { day: 0, choreId: fixed.id, personId: g2.id }, // fixed person: ignored
        { day: 1, choreId: 'made-up', personId: g1.id },
      ],
      suggestions: [
        { kind: 'add', name: 'Water the plants', choreId: '', every: 3, reason: 'Sam would enjoy it.' },
        { kind: 'add', name: 'Feed the cat', choreId: '', every: 1, reason: 'already exists' },
        { kind: 'every', name: '', choreId: bath.id, every: 10, reason: 'You do it about every 10 days.' },
      ],
    };
  };
  await call('PUT', '/ai/settings', { provider: 'custom' });
  await call('PUT', '/ai/settings', { baseUrl: `http://localhost:${ai.address().port}`, model: 'mock' });
  const r = (await call('POST', '/ai/suggest/chores', {})).body;
  assert.strictEqual(r.by, 'mock');
  assert.match(seen, /Share out the week's chores/);
  assert.match(seen, new RegExp(`${sam.id} \\| Sam \\| age 4`));
  const day0 = new Map(r.rota[0].items.map((i) => [i.choreId, i.who]));
  assert.strictEqual(day0.get(table.id), sam.id);
  assert.ok([g1.id, g2.id].includes(day0.get(bath.id)), 'the rules keep the bathroom with a grown-up');
  assert.strictEqual(day0.get(fixed.id), sam.id);
  assert.deepStrictEqual(r.suggestions.map((s) => [s.kind, s.name, s.every]), [['add', 'Water the plants', 3], ['every', 'Clean the bathroom', 10]]);
});
