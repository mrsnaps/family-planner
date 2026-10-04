// Demo mode: fills the app with a made-up family (the Parkers) to show it off, as if it
// had been in use for a few weeks. The household's own data is put aside and comes back
// untouched when the demo ends. The AI settings are left alone.
// The sample is built through the app's own API on a scratch copy, so it always has the
// same shape as real data; then dates are moved back so there's some history.
const { Store } = require('../lib/store');
const { HttpError } = require('../lib/http');

const SECTIONS = ['family', 'food', 'clothes', 'shopping', 'chores', 'calendar', 'packing', 'money'];
const DAY = 86400000;
const ALEX = 'alex@parker.example';
const SAM = 'sam@parker.example';

// Calls the app's request handler directly, with no network.
function caller(handler) {
  return (method, url, body, member) => new Promise((resolve, reject) => {
    const text = body === undefined ? '' : JSON.stringify(body);
    const req = {
      method,
      url,
      headers: { 'content-type': 'application/json', ...(member ? { 'x-family-member': member } : {}) },
      on(event, cb) {
        if (event === 'data' && text) setTimeout(() => cb(text));
        if (event === 'end') setTimeout(cb);
        return req;
      },
    };
    const res = {
      status: 200,
      setHeader() {},
      writeHead(status) { this.status = status; return this; },
      end(out = '') {
        const data = out ? JSON.parse(out) : null;
        if (this.status >= 400) reject(new Error(`Demo data: ${method} ${url} failed: ${data && data.error}`));
        else resolve(data);
        return this;
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

async function buildSample(createApp, now = new Date()) {
  const store = new Store(null);
  const call = caller(createApp(store));
  const day = (n) => new Date(now.getTime() + n * DAY).toISOString().slice(0, 10);
  const at = (n, hour = 18) => new Date(Date.parse(day(n) + 'T00:00:00Z') + hour * 3600000).toISOString();
  const yearsAgo = (y, m = 0) => new Date(Date.UTC(now.getUTCFullYear() - y, now.getUTCMonth() - m, 14)).toISOString().slice(0, 10);

  // The family: two grown-ups and three children.
  await call('PUT', '/api/v1/family', { name: 'The Parkers', adults: 2, dietary: [], location: { name: 'Bristol', lat: 51.4545, lon: -2.5879 } });
  const mia = await call('POST', '/api/v1/family/children', { name: 'Mia', birthDate: yearsAgo(9, 4), clothingSize: '9-10Y', shoeSize: '2' });
  const leo = await call('POST', '/api/v1/family/children', { name: 'Leo', birthDate: yearsAgo(6, 7), clothingSize: '6-7Y', shoeSize: '12' });
  const ruby = await call('POST', '/api/v1/family/children', { name: 'Ruby', birthDate: yearsAgo(2, 2), clothingSize: '2-3Y', shoeSize: '6' });

  // The kitchen: a normal mid-week cupboard, with a few things going off soon.
  const pantry = [
    ['Spaghetti', 500, 'g', 120], ['Penne', 350, 'g', 200], ['Basmati', 1, 'kg', 300], ['Beef mince', 500, 'g', 2],
    ['Chicken breast', 600, 'g', 1], ['Chopped tomatoes', 3, 'tin', 400], ['Onion', 4, 'pcs', 14], ['Garlic', 6, 'pcs', 20],
    ['Carrot', 5, 'pcs', 9], ['Cheddar', 350, 'g', 12], ['Milk', 2, 'l', 3], ['Butter', 200, 'g', 25], ['Eggs', 8, 'pcs', 10],
    ['Bread', 1, 'pack', 2], ['Bananas', 5, 'pcs', 3], ['Apples', 6, 'pcs', 12], ['Yoghurt', 4, 'pcs', 4],
    ['Frozen peas', 900, 'g', 180, { frozen: day(-40) }], ['Fish fingers', 0, 'pack', 150, { frozen: day(-20) }], ['Tortilla wraps', 8, 'pcs', 6], ['Potatoes', 2, 'kg', 15],
    // Lunchbox bits.
    ['Ham', 200, 'g', 4], ['Crisps', 6, 'pcs', 60], ['Satsumas', 6, 'pcs', 10], ['Apple juice cartons', 6, 'pcs', 90], ['Cheese strings', 6, 'pcs', 14],
    ['Chicken thighs', 500, 'g', 200, { frozen: day(-110) }],
  ];
  await call('POST', '/api/v1/food/items/bulk', { items: pantry.map(([name, quantity, unit, days, extra = {}]) => ({ name, quantity, unit, expiry: day(days), ...extra })) });
  const pie = await call('POST', '/api/v1/food/recipes', {
    name: "Grandma's fish pie", servings: 4, minutes: 50, tags: ['dinner'],
    ingredients: [{ name: 'white fish', qty: 400, unit: 'g' }, { name: 'potatoes', qty: 1, unit: 'kg' }, { name: 'milk', qty: 300, unit: 'ml' }, { name: 'cheddar', qty: 100, unit: 'g' }, { name: 'frozen peas', qty: 200, unit: 'g' }],
    steps: ['Boil and mash the potatoes', 'Poach the fish in the milk', 'Layer with peas, top with mash and cheese', 'Bake for 25 minutes'],
  });
  await call('PUT', '/api/v1/food/recipes/spag-bol/favourite', { on: true });
  await call('PUT', `/api/v1/food/recipes/${pie.id}/favourite`, { on: true });
  // Leftovers: some bolognese from last night in the fridge, and a fish pie in the freezer
  // since the summer (old enough to get a "use it up" nudge).
  const bol = await call('POST', '/api/v1/food/leftovers', { recipeId: 'spag-bol', portions: 3 });
  const frozenPie = await call('POST', '/api/v1/food/leftovers', { recipeId: pie.id, portions: 4, freeze: true });

  // Wardrobes, with a few things outgrown, worn out or in the wash.
  const clothes = (child, list) => list.map(([name, type, colour, size, extra = {}]) => ({ childId: child.id, name, type, colour, size, season: 'all', pattern: 'plain', ...extra }));
  await call('POST', '/api/v1/clothes/items/bulk', {
    items: [
      ...clothes(mia, [
        ['Navy school jumper', 'top', 'navy', '9-10Y', { uniform: true }], ['White polo shirt', 'top', 'white', '9-10Y', { uniform: true }],
        ['Grey school skirt', 'bottom', 'grey', '9-10Y', { uniform: true }], ['Rainbow T-shirt', 'top', 'white', '9-10Y', { pattern: 'patterned', season: 'summer' }],
        ['Denim jeans', 'bottom', 'blue', '9-10Y'], ['Denim shorts', 'bottom', 'blue', '9-10Y', { season: 'summer' }],
        ['Sundress', 'dress', 'yellow', '9-10Y', { season: 'summer' }], ['Purple hoodie', 'top', 'purple', '9-10Y', { inWash: true }],
        ['Yellow raincoat', 'outerwear', 'yellow', '9-10Y'], ['Unicorn pyjamas', 'pyjamas', 'pink', '8-9Y', { pattern: 'patterned' }],
        ['Trainers', 'shoes', 'white', '2'], ['Striped top', 'top', 'red', '7-8Y', { pattern: 'patterned' }],
        ['Green cord trousers', 'bottom', 'green', '7-8Y'], ['Blue fleece', 'top', 'blue', '7-8Y'],
      ]),
      ...clothes(leo, [
        ['Dinosaur T-shirt', 'top', 'green', '6-7Y', { pattern: 'patterned' }], ['Grey joggers', 'bottom', 'grey', '6-7Y'],
        ['Navy school jumper', 'top', 'navy', '6-7Y', { uniform: true }], ['Grey school trousers', 'bottom', 'grey', '6-7Y', { uniform: true, wornOut: true }],
        ['Red hoodie', 'top', 'red', '6-7Y', { inWash: true }], ['Puffer coat', 'outerwear', 'navy', '6-7Y', { season: 'winter' }],
        ['Space pyjamas', 'pyjamas', 'blue', '6-7Y', { pattern: 'patterned' }], ['Wellies', 'shoes', 'green', '12'],
      ]),
      ...clothes(ruby, [
        ['Floral dress', 'dress', 'pink', '2-3Y', { pattern: 'patterned', season: 'summer' }], ['Leggings', 'bottom', 'black', '2-3Y'],
        ['Cardigan', 'top', 'yellow', '2-3Y'], ['Spotty top', 'top', 'white', '2-3Y', { pattern: 'patterned' }],
        ['Sleepsuit', 'pyjamas', 'grey', '18-24M'], ['Snowsuit', 'outerwear', 'pink', '2-3Y', { season: 'winter' }],
        ['First shoes', 'shoes', 'red', '6'],
      ]),
    ],
  });

  // Chores: the grown-ups' names, everyday jobs, and pocket money at 10p a point.
  const chores = await call('GET', '/api/v1/chores');
  await call('PUT', '/api/v1/chores/people', { adults: chores.people.filter((p) => p.adult).map((p, i) => ({ id: p.id, name: i ? 'Sam' : 'Alex' })) });
  await call('PUT', '/api/v1/chores/settings', { perPoint: 10 });
  for (const starter of ['dishes', 'table', 'bins', 'recycling', 'hoover', 'bathroom', 'laundry', 'tidy-room', 'plants', 'beds']) {
    await call('POST', '/api/v1/chores', { starter });
  }

  // What everyone thought of recent dinners (Leo has gone off macaroni cheese), and what
  // the children won't have in their lunchboxes.
  const who = Object.fromEntries((await call('GET', '/api/v1/food/ratings')).people.map((p) => [p.name, p.id]));
  for (const [ago, recipeId, scores] of [
    [1, 'spag-bol', { Alex: 1, Sam: 1, Mia: 1, Leo: 1, Ruby: 0 }],
    [3, 'mac-cheese', { Alex: 0, Mia: 1, Leo: -1, Ruby: 1 }],
    [5, pie.id, { Alex: 1, Sam: 1, Mia: 0, Leo: 1 }],
    [8, 'spag-bol', { Mia: 1, Leo: 1, Ruby: 1 }],
    [11, 'tomato-pasta', { Mia: 1, Ruby: 1, Leo: 0 }],
    [22, 'mac-cheese', { Leo: -1, Mia: 1 }],
  ]) {
    await call('POST', '/api/v1/food/ratings', { recipeId, date: day(-ago), ratings: Object.entries(scores).map(([n, score]) => ({ personId: who[n], score })) });
  }
  await call('PUT', '/api/v1/food/lunchbox/wont-eat', { childId: mia.id, foods: ['tomatoes'] });
  await call('PUT', '/api/v1/food/lunchbox/wont-eat', { childId: leo.id, foods: ['tuna', 'crisps'] });

  // Shopping: names for who added what, a few things on the list.
  await call('PUT', '/api/v1/shopping/people/me', { name: 'Alex' }, ALEX);
  await call('PUT', '/api/v1/shopping/people/me', { name: 'Sam' }, SAM);
  for (const [name, quantity, by, extra = {}] of [['Milk', 2, SAM], ['Bread', 1, ALEX], ['Bananas', 6, SAM, { done: true }], ['Washing-up liquid', 1, ALEX, { kind: 'other' }], ['Cheddar', 1, SAM], ['Fish fingers', 1, ALEX]]) {
    await call('POST', '/api/v1/shopping/items', { name, quantity, kind: 'food', ...extra }, by);
  }
  const shopping = (await call('GET', '/api/v1/shopping')).items;
  const done = shopping.find((i) => i.name === 'Bananas');
  if (done && !done.done) await call('PUT', `/api/v1/shopping/items/${done.id}`, { done: true });
  await call('POST', '/api/v1/shopping/items', { name: 'School shoes', kind: 'clothes', childId: leo.id, size: '13' }, SAM);

  // Food spending over the last six weeks.
  for (const [amount, ago, shop, by] of [[86.4, 2, 'Tesco', SAM], [23.15, 6, 'Co-op', ALEX], [91.8, 9, 'Tesco', ALEX], [14.6, 13, 'Lidl', SAM], [78.25, 16, 'Sainsbury\'s', SAM], [88.9, 23, 'Tesco', ALEX], [19.4, 27, 'Co-op', SAM], [83.1, 30, 'Tesco', ALEX], [76.5, 37, 'Sainsbury\'s', SAM]]) {
    await call('POST', '/api/v1/spending', { amount, date: day(-ago), shop }, by);
  }

  // Other spending this month, and a monthly budget.
  for (const [amount, ago, shop, category, by] of [[42, 4, 'Next', 'clothes', SAM], [24, 8, 'Swim school', 'activities', ALEX], [11.5, 3, 'Wilko', 'household', ALEX]]) {
    await call('POST', '/api/v1/spending', { amount, date: day(-ago), shop, category }, by);
  }
  await call('PUT', '/api/v1/money/budget', { budget: 750 });

  // The calendar: school kit days (one tomorrow, so there's something to pack), clubs, a one-off.
  const weekday = (n) => new Date(now.getTime() + n * DAY).getUTCDay();
  await call('POST', '/api/v1/calendar/events', { starter: 'pe', days: [2, 4], who: [mia.id] });
  await call('POST', '/api/v1/calendar/events', { starter: 'swimming', days: [weekday(1)], who: [leo.id] });
  await call('POST', '/api/v1/calendar/events', { starter: 'library', days: [1], who: [leo.id] });
  await call('POST', '/api/v1/calendar/events', { starter: 'football', days: [6], time: '10:00', who: [mia.id] });
  await call('POST', '/api/v1/calendar/events', { title: 'Toddler group', emoji: '🧸', repeat: 'weekly', days: [3], time: '09:30', who: [ruby.id] });
  await call('POST', '/api/v1/calendar/events', { title: "Parents' evening", emoji: '🏫', date: day(9), time: '17:45' });
  await call('POST', '/api/v1/calendar/events', { title: 'Gran and Grandad visit', emoji: '👵', date: day(3) });

  // A trip coming up, half packed.
  const trip = await call('POST', '/api/v1/packing/trips', { name: "Half term at Gran's", destination: 'Cardiff', start: day(12), end: day(15), weather: { feel: 'mild', rain: true } });
  for (const it of trip.items.filter((x, i) => i % 3 === 0)) {
    await call('PUT', `/api/v1/packing/trips/${trip.id}/items/${it.id}`, { packed: true });
  }

  // History, moved back in time: the weekly shops, meals cooked, and chores done.
  const d = store.data;
  const lb = d.food.pantry.find((p) => p.id === bol.id);
  Object.assign(lb, { expiry: day(1), leftover: { ...lb.leftover, cookedAt: day(-1) } });
  const fp = d.food.pantry.find((p) => p.id === frozenPie.id);
  Object.assign(fp, { frozen: day(-100), leftover: { ...fp.leftover, cookedAt: day(-100) } });
  const added = [];
  for (const ago of [3, 10, 17, 24, 31, 38]) {
    for (const [name, quantity, unit] of [['milk', 2, 'l'], ['bread', 1, 'pack'], ['bananas', 6, 'pcs'], ['eggs', 12, 'pcs'], ['cheddar', 400, 'g'], ['apples', 6, 'pcs'], ['yoghurt', 4, 'pcs'], ['chicken breast', 600, 'g']]) {
      added.push({ name, quantity, unit, at: at(-ago, 10) });
    }
    if (ago % 14 === 3) added.push({ name: 'fish fingers', quantity: 1, unit: 'pack', at: at(-ago, 10) });
  }
  for (const ago of [6, 20, 34]) added.push({ name: 'beef mince', quantity: 500, unit: 'g', at: at(-ago, 11) }, { name: 'chopped tomatoes', quantity: 2, unit: 'tin', at: at(-ago, 11) });
  d.food.history = {
    added: added.sort((a, b) => (a.at < b.at ? -1 : 1)),
    cooked: [[1, 'spag-bol', 'Spaghetti bolognese'], [3, 'mac-cheese', 'Macaroni cheese'], [5, pie.id, pie.name], [8, 'spag-bol', 'Spaghetti bolognese'], [11, 'tomato-pasta', 'Tomato pasta'], [15, 'spag-bol', 'Spaghetti bolognese'], [19, pie.id, pie.name], [22, 'mac-cheese', 'Macaroni cheese']]
      .map(([ago, recipeId, name]) => ({ recipeId, name, at: at(-ago) })).reverse(),
  };

  const people = (await call('GET', '/api/v1/chores')).people;
  const byName = (n) => people.find((p) => p.name === n)?.id || null;
  const log = [];
  const jobs = d.chores.list;
  const doneBy = {
    dishes: ['Alex', 'Mia', 'Sam', 'Mia', 'Alex', 'Sam', 'Mia', 'Alex', 'Sam'],
    table: ['Leo', 'Mia', 'Leo', 'Leo', 'Mia', 'Leo', 'Leo', 'Mia'],
    bins: ['Sam', 'Alex'],
    recycling: ['Leo', 'Mia', 'Leo'],
    hoover: ['Alex', 'Mia', 'Sam'],
    bathroom: ['Sam'],
    laundry: ['Alex', 'Sam', 'Alex', 'Sam'],
    plants: ['Leo', 'Mia', 'Leo'],
  };
  for (const c of jobs) {
    const names = c.starter === 'tidy-room' ? [c.name.includes('Mia') ? 'Mia' : 'Leo', null, null] : doneBy[c.starter] || [];
    names.forEach((n, i) => {
      const ago = 1 + Math.floor(i * Math.max(1, c.every) * 0.9);
      if (!n || ago > 13) return;
      log.push({ id: `demo-${c.id.slice(0, 8)}-${i}`, choreId: c.id, name: c.name, by: byName(n), effort: c.effort || 1, at: at(-ago, 19), before: null });
    });
    const last = log.filter((e) => e.choreId === c.id).sort((a, b) => (a.at < b.at ? 1 : -1))[0];
    if (last) c.lastDone = last.at;
  }
  // Something done already today, so Home shows progress.
  const dishes = jobs.find((c) => c.starter === 'table');
  if (dishes) {
    const e = { id: 'demo-today', choreId: dishes.id, name: dishes.name, by: byName('Leo'), effort: dishes.effort || 1, at: new Date(now.getTime() - 2 * 3600000).toISOString(), before: dishes.lastDone || null };
    log.push(e);
    dishes.lastDone = e.at;
  }
  d.chores.log = log.sort((a, b) => (a.at < b.at ? -1 : 1));

  const out = {};
  for (const k of SECTIONS) out[k] = d[k];
  return out;
}

function register(router, store, createApp) {
  const status = () => ({ on: Boolean(store.data.demo), since: store.data.demo?.since || null });

  router.get('/api/v1/demo', () => status());

  // Start the demo (or start it again from fresh): put the household's data aside first.
  router.post('/api/v1/demo/start', async () => {
    const sample = await buildSample(createApp);
    if (!store.data.demo) {
      const saved = {};
      for (const k of SECTIONS) if (store.data[k] !== undefined) saved[k] = store.data[k];
      store.data.demoSaved = saved;
    }
    for (const k of SECTIONS) store.data[k] = sample[k];
    store.data.demo = { since: new Date().toISOString() };
    store.save();
    return status();
  });

  // End the demo: the household's own data comes back exactly as it was.
  router.post('/api/v1/demo/stop', () => {
    if (!store.data.demo) return status();
    const saved = store.data.demoSaved || {};
    for (const k of SECTIONS) {
      if (saved[k] !== undefined) store.data[k] = saved[k];
      else delete store.data[k];
    }
    delete store.data.demoSaved;
    delete store.data.demo;
    store.save();
    return status();
  });

  return { status, inDemo: () => Boolean(store.data.demo) };
}

const blockInDemo = (demo) => {
  if (demo.inDemo()) throw new HttpError(409, 'Leave the demo first (Settings > Demo).');
};

module.exports = { register, buildSample, blockInDemo, SECTIONS };
