// Calendar (school kit days, clubs, birthdays), packing lists (rules and AI), the month's
// spending with a budget, and the seasonal clothes swap.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createApp } = require('../server');
const { Store } = require('../lib/store');
const { occurrences, kitFor } = require('../modules/calendar/engine');
const { generate } = require('../modules/packing/engine');
const { overview } = require('../modules/money');
const { swapPlan, inSwapWindow } = require('../modules/clothes/swap');
const { reminders } = require('../modules/reminders');

async function start(t, store = new Store(null)) {
  const server = http.createServer(createApp(store)).listen(0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}/api/v1`;
  return async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
}

// 2026-10-04 is a Sunday.
const FROM = '2026-10-04';
const kids = [{ id: 'ava', name: 'Ava', birthDate: '2016-10-10' }, { id: 'leo', name: 'Leo', birthDate: '2020-02-29' }];

test('calendar: weekly days, once, yearly, skips, an end date, and birthdays', () => {
  const events = [
    { id: 'pe', title: 'PE', repeat: 'weekly', days: [2, 4], date: '2026-09-01', who: ['ava'], kit: ['PE kit'] },
    { id: 'swim', title: 'Swimming', repeat: 'weekly', days: [1], date: '2026-09-01', who: ['leo'], kit: ['Towel'], skip: ['2026-10-05'] },
    { id: 'club', title: 'Club', repeat: 'weekly', days: [3], date: '2026-09-01', until: '2026-10-10' },
    { id: 'eve', title: "Parents' evening", repeat: 'none', date: '2026-10-08', time: '17:45' },
    { id: 'anniv', title: 'Anniversary', repeat: 'yearly', date: '2015-10-06' },
    { id: 'old', title: 'Gone', repeat: 'none', date: '2026-10-01' },
    { id: 'off', title: 'Paused', repeat: 'weekly', days: [0], date: '2026-09-01', paused: true },
  ];
  const list = occurrences(events, kids, { from: FROM, days: 14 });
  const on = (title) => list.filter((o) => o.title.startsWith(title)).map((o) => o.date);
  assert.deepStrictEqual(on('PE'), ['2026-10-06', '2026-10-08', '2026-10-13', '2026-10-15']);
  assert.deepStrictEqual(on('Swimming'), ['2026-10-12'], 'a skipped date is left out');
  assert.deepStrictEqual(on('Club'), ['2026-10-07'], 'stops after its end date');
  assert.deepStrictEqual(on("Parents'"), ['2026-10-08']);
  assert.deepStrictEqual(on('Anniversary'), ['2026-10-06']);
  assert.deepStrictEqual(on('Gone'), []);
  assert.deepStrictEqual(on('Paused'), []);
  assert.deepStrictEqual(on("Ava's birthday"), ['2026-10-10']);
  assert.strictEqual(list.find((o) => o.kind === 'birthday').title, "Ava's birthday (10)");
  assert.ok(list.every((o, i) => i === 0 || list[i - 1].date <= o.date), 'soonest first');
  // A 29 February birthday falls on 28 February in other years.
  const leap = occurrences([], kids, { from: '2027-02-01', days: 40 });
  assert.deepStrictEqual(leap.map((o) => o.date), ['2027-02-28']);

  const kit = kitFor(list, '2026-10-06');
  assert.deepStrictEqual(kit, [{ name: 'Ava', items: ['PE kit'], events: ['PE'] }]);
});

test('calendar API: starters, checks, skip, and reminders the day before', async (t) => {
  const call = await start(t);
  const ava = (await call('POST', '/family/children', { name: 'Ava', birthDate: '2016-01-01' })).body;
  const tomorrow = new Date(Date.now() + 86400000);
  const pe = await call('POST', '/calendar/events', { starter: 'pe', days: [tomorrow.getUTCDay()], who: [ava.id] });
  assert.strictEqual(pe.status, 200);
  assert.deepStrictEqual(pe.body.kit, ['PE kit', 'Trainers']);
  assert.strictEqual(pe.body.repeat, 'weekly');
  assert.strictEqual((await call('POST', '/calendar/events', { starter: 'nope' })).status, 404);
  assert.strictEqual((await call('POST', '/calendar/events', { title: 'X', who: ['someone'] })).status, 400);
  assert.strictEqual((await call('POST', '/calendar/events', { title: 'X', time: '25:00' })).status, 400);
  assert.strictEqual((await call('POST', '/calendar/events', { title: 'X', repeat: 'weekly', days: [9] })).status, 400);
  assert.strictEqual((await call('POST', '/calendar/events', { title: '' })).status, 400);

  const cal = (await call('GET', '/calendar')).body;
  assert.strictEqual(cal.kitTomorrow[0].name, 'Ava');
  const rem = (await call('GET', '/reminders')).body;
  assert.ok(rem.some((r) => r.kind === 'calendar' && r.title === "Pack Ava's things for PE tomorrow" && r.detail === 'PE kit, Trainers'));

  const date = tomorrow.toISOString().slice(0, 10);
  await call('POST', `/calendar/events/${pe.body.id}/skip`, { date });
  assert.strictEqual((await call('GET', '/calendar')).body.kitTomorrow.length, 0, 'skipped this week');
  await call('PUT', `/calendar/events/${pe.body.id}`, { kit: 'Trainers, Water bottle' });
  assert.deepStrictEqual((await call('GET', '/calendar')).body.events[0].kit, ['Trainers', 'Water bottle']);
  assert.strictEqual((await call('DELETE', `/calendar/events/${pe.body.id}`)).status, 200);
  assert.strictEqual((await call('DELETE', `/calendar/events/${pe.body.id}`)).status, 404);

  // Kept in backups.
  await call('POST', '/calendar/events', { title: 'Dentist', date: '2026-12-01' });
  const backup = (await call('GET', '/export')).body;
  assert.strictEqual(backup.data.calendar.events[0].title, 'Dentist');
  assert.strictEqual((await call('POST', '/import', { ...backup, data: { calendar: { events: 'bad' } } })).status, 400);
});

test('packing rules: scale with nights, suit the weather and ages, and name real clothes', () => {
  const children = [{ id: 'ava', name: 'Ava', age: 9, clothingSize: '9-10Y' }, { id: 'ruby', name: 'Ruby', age: 1.5, clothingSize: '18-24M' }];
  const clothes = [
    { id: '1', childId: 'ava', name: 'Rainbow tee', type: 'top', size: '9-10Y', season: 'summer' },
    { id: '2', childId: 'ava', name: 'Old tee', type: 'top', size: '7-8Y', season: 'all' },
    { id: '3', childId: 'ava', name: 'Dirty tee', type: 'top', size: '9-10Y', inWash: true },
    { id: '4', childId: 'ava', name: 'Packed tee', type: 'top', size: '9-10Y', stored: true },
  ];
  const hot = generate({ start: '2026-07-01', end: '2026-07-05', weather: { feel: 'hot', rain: false } }, { adults: 2, adultNames: ['Alex', 'Sam'], children, clothes });
  assert.strictEqual(hot.nights, 4);
  const item = (g, n) => hot.items.find((i) => i.group === g && i.name === n);
  assert.strictEqual(item('Ava', 'Tops').qty, 5);
  assert.strictEqual(item('Ava', 'Tops').detail, 'Rainbow tee', 'only clean things that fit and are not packed away');
  assert.ok(item('Ava', 'Swimwear') && item('Everyone', 'Suncream and after-sun'));
  assert.ok(!item('Ava', 'Coat'), 'no coat in the heat without rain');
  assert.strictEqual(item('Ruby', 'Nappies').qty, 30);
  assert.ok(item('Ruby', 'Comforter or favourite teddy'));
  assert.ok(item('Alex', 'Clothes for 4 nights') && item('Sam', 'Pyjamas'));

  const cold = generate({ start: '2026-12-20', end: '2026-12-21', weather: { feel: 'cold', rain: true }, abroad: true, who: ['ava'] }, { adults: 1, children, clothes });
  const c = (g, n) => cold.items.find((i) => i.group === g && i.name === n);
  assert.ok(c('Ava', 'Waterproof coat') && c('Ava', 'Hat, gloves and scarf') && c('Ava', 'Wellies'));
  assert.ok(!c('Ava', 'Tops').detail, 'summer clothes stay at home in the cold');
  assert.ok(!cold.items.some((i) => i.group === 'Ruby'), 'only children going');
  assert.ok(c('Everyone', 'Passports'));
  assert.ok(c('Grown-up 1', 'Clothes for 1 night'));

  // A long trip assumes washing: no more than a week of clothes.
  const long = generate({ start: '2026-08-01', end: '2026-08-15', weather: { feel: 'mild' } }, { adults: 0, children: [children[0]], clothes });
  assert.strictEqual(long.items.find((i) => i.name === 'Tops').qty, 8);
  // Without a forecast, the time of year decides.
  assert.strictEqual(generate({ start: '2026-01-10', end: '2026-01-12' }, { children: [] }).weather.feel, 'cold');
});

test('packing API: trips, ticking, own items, starting again keeps ticks, and the AI list', async (t) => {
  const answers = [];
  const ai = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      answers.push(JSON.parse(raw).messages.map((m) => m.content).join('\n'));
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [
        { group: 'Ava', name: 'Tops', qty: 4, detail: 'Rainbow tee' },
        { group: 'Ava', name: 'Tops', qty: 9, detail: 'a duplicate, dropped' },
        { group: 'Everyone', name: 'Kite for the beach', qty: 1, detail: '' },
        { group: 'Everyone', name: '', qty: 1, detail: 'blank, dropped' },
      ] }) } }] }));
    });
  }).listen(0);
  t.after(() => ai.close());
  const call = await start(t);
  const ava = (await call('POST', '/family/children', { name: 'Ava', birthDate: '2017-01-01', clothingSize: '9-10Y' })).body;
  await call('POST', '/clothes/items', { name: 'Rainbow tee', type: 'top', childId: ava.id, size: '9-10Y' });

  assert.strictEqual((await call('POST', '/packing/trips', { name: 'X', start: '2026-10-10', end: '2026-10-08' })).status, 400);
  assert.strictEqual((await call('POST', '/packing/trips', { name: 'X' })).status, 400);
  const trip = (await call('POST', '/packing/trips', { name: 'Cornwall', destination: 'St Ives', start: '2026-10-20', end: '2026-10-23', weather: { feel: '', rain: true } })).body;
  assert.strictEqual(trip.nights, 3);
  assert.strictEqual(trip.weatherUsed.rain, true, 'rain kept even when the warmth is guessed');
  assert.strictEqual(trip.weatherUsed.guessed, true);
  const tops = trip.items.find((i) => i.group === 'Ava' && i.name === 'Tops');
  let r = (await call('PUT', `/packing/trips/${trip.id}/items/${tops.id}`, { packed: true })).body;
  assert.strictEqual(r.packedCount, 1);
  r = (await call('POST', `/packing/trips/${trip.id}/items`, { name: 'Bucket and spade', group: 'Everyone' })).body;
  assert.ok(r.items.some((i) => i.name === 'Bucket and spade' && i.custom));
  r = (await call('POST', `/packing/trips/${trip.id}/rebuild`, {})).body;
  assert.ok(r.items.find((i) => i.group === 'Ava' && i.name === 'Tops').packed, 'ticks survive starting again');
  assert.ok(r.items.some((i) => i.name === 'Bucket and spade'), 'own items stay');

  // The AI's list, checked: duplicates and blanks dropped, the child's group linked.
  await call('PUT', '/ai/settings', { provider: 'custom' });
  await call('PUT', '/ai/settings', { baseUrl: `http://localhost:${ai.address().port}`, model: 'mock' });
  const s = (await call('POST', '/ai/suggest/packing', { tripId: trip.id })).body;
  assert.deepStrictEqual(s.items.map((i) => i.name), ['Tops', 'Kite for the beach']);
  assert.strictEqual(s.items[0].childId, ava.id);
  assert.match(answers[0], /Cornwall to St Ives/);
  assert.match(answers[0], /Rainbow tee \(top\)/);
  assert.strictEqual((await call('POST', '/ai/suggest/packing', {})).status, 400, 'needs a trip');
  assert.strictEqual((await call('POST', '/ai/suggest/packing', { tripId: 'nope' })).status, 404);
  r = (await call('POST', `/packing/trips/${trip.id}/rebuild`, { items: s.items, by: s.by })).body;
  assert.strictEqual(r.by, 'mock');
  assert.ok(r.items.find((i) => i.name === 'Tops').packed);
  assert.strictEqual((await call('POST', `/packing/trips/${trip.id}/reset`, {})).body.packedCount, 0);

  const backup = (await call('GET', '/export')).body;
  assert.strictEqual(backup.data.packing.trips.length, 1);
  assert.strictEqual((await call('DELETE', `/packing/trips/${trip.id}`)).status, 200);
});

test('money: the month by category, pocket money, budget status and history', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const entries = [
    { amount: 80, date: '2026-10-02', shop: 'Tesco' },
    { amount: 40, date: '2026-10-05', shop: 'Next', category: 'clothes' },
    { amount: 20, date: '2026-10-06', shop: 'Tesco' },
    { amount: 100, date: '2026-09-15' },
    { amount: 50, date: '2026-05-01' },
  ];
  const chores = { perPoint: 10, people: [{ id: 'mum', adult: true }, { id: 'ava' }], log: [{ by: 'ava', effort: 2, at: '2026-10-03T09:00:00Z' }, { by: 'ava', effort: 3, at: '2026-09-03T09:00:00Z' }, { by: 'mum', effort: 3, at: '2026-10-03T09:00:00Z' }] };
  const m = overview({ entries, chores, budget: 300, now });
  assert.strictEqual(m.month, '2026-10');
  assert.deepStrictEqual(m.categories.map((c) => c.total), [100, 40, 0, 0, 0]);
  assert.strictEqual(m.pocketMoney, 0.2);
  assert.strictEqual(m.spent, 140.2);
  assert.strictEqual(m.projected, Math.round((140.2 / 10) * 31 * 100) / 100);
  assert.strictEqual(m.status, 'heading-over');
  assert.strictEqual(m.left, 159.8);
  assert.strictEqual(m.lastMonth, 100);
  assert.deepStrictEqual(m.history.map((h) => h.month), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  assert.deepStrictEqual(m.shops[0], { name: 'Tesco', total: 100 });
  assert.strictEqual(overview({ entries, budget: 120, now }).status, 'over');
  assert.strictEqual(overview({ entries, budget: 0, now }).status, null);
  assert.strictEqual(overview({ entries, budget: 300, now, month: '2026-09' }).status, 'ok');
  const r = reminders({ food: { expiringSoon: [], mealsLeft: 5 }, clothes: [], shopping: 0, money: m });
  assert.deepStrictEqual(r.map((x) => x.title), ['On course to go over the budget this month']);
});

test('money API: spending categories and the budget', async (t) => {
  const call = await start(t);
  await call('POST', '/spending', { amount: 30, category: 'activities', shop: 'Swim school' });
  await call('POST', '/spending', { amount: 50 });
  await call('POST', '/spending', { amount: 5, category: 'made-up' });
  assert.strictEqual((await call('GET', '/spending')).body.thisMonth, 55, 'food spending leaves out other categories');
  assert.strictEqual((await call('PUT', '/money/budget', { budget: '£1,000' })).body.budget, 1000);
  assert.strictEqual((await call('PUT', '/money/budget', { budget: -1 })).status, 400);
  const m = (await call('GET', '/money')).body;
  assert.strictEqual(m.spent, 85);
  assert.strictEqual(m.categories.find((c) => c.key === 'activities').total, 30);
  assert.strictEqual((await call('GET', '/money?month=2026-13')).status, 400);
  assert.strictEqual((await call('GET', '/export')).body.data.money.budget, 1000);
});

test('seasonal swap: when to nudge, what to pack away and get out, and doing it', async (t) => {
  assert.ok(inSwapWindow('2026-10-04') && inSwapWindow('2026-04-01'));
  assert.ok(!inSwapWindow('2026-07-01') && !inSwapWindow('2026-01-10'));
  const child = { id: 'ava', name: 'Ava', clothingSize: '9-10Y' };
  const items = [
    { id: 's1', childId: 'ava', name: 'Shorts', type: 'bottom', size: '9-10Y', season: 'summer' },
    { id: 's2', childId: 'ava', name: 'Sundress', type: 'dress', size: '9-10Y', season: 'summer' },
    { id: 's3', childId: 'ava', name: 'Sun top', type: 'top', size: '9-10Y', season: 'summer' },
    { id: 'w1', childId: 'ava', name: 'Fleece', type: 'top', size: '9-10Y', season: 'winter', stored: true },
    { id: 'w2', childId: 'ava', name: 'Old coat', type: 'outerwear', size: '7-8Y', season: 'winter', stored: true },
    { id: 'a1', childId: 'ava', name: 'Jeans', type: 'bottom', size: '9-10Y', season: 'all' },
  ];
  const plan = swapPlan(child, items, '2026-10-04');
  assert.strictEqual(plan.season, 'winter');
  assert.strictEqual(plan.due, true);
  assert.deepStrictEqual(plan.packAway.map((i) => i.id), ['s1', 's2', 's3']);
  assert.deepStrictEqual(plan.getOut.map((i) => i.id), ['w1']);
  assert.deepStrictEqual(plan.outgrown.map((i) => i.id), ['w2']);
  assert.strictEqual(swapPlan(child, items, '2026-07-01').due, false);

  const call = await start(t);
  const ava = (await call('POST', '/family/children', { name: 'Ava', birthDate: '2017-01-01', clothingSize: '9-10Y' })).body;
  for (const it of items) await call('POST', '/clothes/items', { ...it, id: undefined, childId: ava.id });
  const outfitsBefore = (await call('GET', `/clothes/outfits/${ava.id}`)).body.total;
  const done = (await call('POST', `/clothes/swap/${ava.id}`, {})).body;
  assert.strictEqual(done.packAway.length, 0);
  assert.strictEqual(done.getOut.length, 0);
  const now = (await call('GET', `/clothes/items?childId=${ava.id}`)).body;
  assert.ok(now.filter((i) => i.season === 'summer').every((i) => i.stored));
  assert.ok(now.filter((i) => i.season === 'winter').every((i) => !i.stored));
  assert.notStrictEqual((await call('GET', `/clothes/outfits/${ava.id}`)).body.total, outfitsBefore, 'packed-away clothes leave the outfits');
  // One thing back out by hand.
  const shorts = now.find((i) => i.name === 'Shorts');
  assert.strictEqual((await call('PUT', `/clothes/items/${shorts.id}`, { stored: false })).body.stored, undefined);
});

test('reminders: kit today, birthdays, trips coming up and the seasonal swap', () => {
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const r = reminders({
    food: { expiringSoon: [], mealsLeft: 5 }, clothes: [], shopping: 0,
    calendar: {
      today, todayList: [{ id: 'x', date: today, title: 'Dentist', time: '15:30', kit: [], kind: 'event', whoNames: ['Ava'] }], tomorrowList: [],
      birthdays: [{ id: 'b', date: soon, title: "Leo's birthday (7)", whoNames: ['Leo'], kind: 'birthday' }],
      kitToday: [{ name: 'Ava', items: ['Towel'], events: ['Swimming'] }], kitTomorrow: [],
    },
    trips: [{ id: 't', name: 'Cornwall', start: soon, items: 10, packed: 4 }],
    swaps: [{ childId: 'ava', name: 'Ava', season: 'winter', due: true, packAway: [1, 2, 3], getOut: [1], outgrown: [] }],
  });
  const titles = r.map((x) => x.title);
  assert.ok(titles.includes('Ava has Swimming today'));
  assert.ok(titles.includes('Dentist at 15:30 today'));
  assert.ok(titles.includes("Leo's birthday (7) is in 2 days"));
  assert.ok(titles.includes('Cornwall in 2 days'));
  assert.ok(titles.includes("Time to swap Ava's summer clothes for winter ones"));
});
