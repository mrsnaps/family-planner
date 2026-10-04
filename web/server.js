// Family Planner: one HTTP server, one JSON API (/api/v1), one web UI (public/).
// Each tool is a separate module under modules/ that registers its own routes.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Store } = require('./lib/store');
const { Router, HttpError, readJson } = require('./lib/http');
const family = require('./modules/family');
const food = require('./modules/food');
const clothes = require('./modules/clothes');
const shopping = require('./modules/shopping');
const chores = require('./modules/chores');
const calendar = require('./modules/calendar');
const packing = require('./modules/packing');
const money = require('./modules/money');
const ai = require('./modules/ai');
const { createSuggesters } = require('./modules/ai/suggest');
const { reminders } = require('./modules/reminders');
const demo = require('./modules/demo');
const { nodeFetchPage } = require('./modules/food/fetch-page');

const PUBLIC = path.join(__dirname, 'public');
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(/\s+/).filter(Boolean);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// options.fetchPage: how "Recipe from a link" opens a page (async (url) => html). By default
// the Node server fetches it itself; the browser build has none (see modules/food/fetch-page.js).
function createApp(store, options = {}) {
  const router = new Router();
  const fam = family.register(router, store);
  let choresApi = null;
  const foodApi = food.register(router, store, fam.summary, {
    fetchPage: options.fetchPage !== undefined ? options.fetchPage : nodeFetchPage(),
    people: () => (choresApi ? choresApi.people() : []),
  });
  const clothesApi = clothes.register(router, store, fam.family);
  const shoppingApi = shopping.register(router, store, {
    meals: foodApi.meals,
    mealsFor: foodApi.mealsFor,
    foodHistory: foodApi.history,
    favourites: foodApi.favourites,
    pantry: foodApi.pantry,
    clothesStats: clothesApi.stats,
    addPantryItem: foodApi.addPantryItem,
    addClothesItem: clothesApi.addItem,
  });

  choresApi = chores.register(router, store, fam.summary);
  const calendarApi = calendar.register(router, store, fam.summary);
  const packingApi = packing.register(router, store, {
    family: fam.summary,
    adultNames: () => choresApi.people().filter((p) => p.adult).map((p) => p.name),
    clothesItems: clothesApi.items,
  });
  const moneyApi = money.register(router, store, { spending: shoppingApi.spending, chores: choresApi, clothesStats: clothesApi.stats });

  const suggesters = createSuggesters({ familySummary: fam.summary, food: foodApi, clothes: clothesApi, shopping: shoppingApi, chores: choresApi, packing: packingApi });
  const aiApi = ai.register(router, store, { familySummary: fam.summary, food: foodApi, suggesters });

  const remindersNow = (food = foodApi.stats(), clothesStats = clothesApi.stats(), choreSummary = choresApi.summary(), calendarSummary = calendarApi.summary()) =>
    reminders({ food, clothes: clothesStats, shopping: shoppingApi.count(), chores: choreSummary, calendar: calendarSummary, swaps: clothesApi.swaps(), money: moneyApi.summary(), trips: packingApi.upcoming() });

  // The combined data panel: one call for a dashboard (or a phone app's home screen).
  router.get('/api/v1/dashboard', () => {
    const food = foodApi.stats();
    const clothesStats = clothesApi.stats();
    const choreSummary = choresApi.summary();
    const calendarSummary = calendarApi.summary();
    return {
      family: fam.summary(),
      food,
      clothes: clothesStats,
      shoppingCount: shoppingApi.count(),
      chores: choreSummary,
      calendar: calendarSummary,
      trips: packingApi.upcoming(),
      reminders: remindersNow(food, clothesStats, choreSummary, calendarSummary),
      handMeDowns: clothesApi.handMeDowns(),
      ai: { ready: aiApi.publicSettings().ready, onDevice: aiApi.publicSettings().onDevice },
    };
  });
  router.get('/api/v1/reminders', () => remindersNow());

  const demoApi = demo.register(router, store, createApp);

  // Backup and restore everything except the AI key. In the demo, the backup is still the
  // household's own data, and restoring waits until the demo is over.
  const SECTIONS = ['family', 'food', 'clothes', 'shopping', 'chores', 'calendar', 'packing', 'money'];
  router.get('/api/v1/export', () => {
    const data = {};
    const source = demoApi.inDemo() ? store.data.demoSaved || {} : store.data;
    for (const k of SECTIONS) if (source[k] !== undefined) data[k] = source[k];
    if (store.data.ai) {
      const { apiKey, keyFor, usage, suggestCache, ...rest } = store.data.ai;
      data.ai = rest;
    }
    return { app: 'family-planner', version: 1, exportedAt: new Date().toISOString(), data };
  });
  router.post('/api/v1/import', (req, body) => {
    demo.blockInDemo(demoApi);
    const data = body && body.app === 'family-planner' ? body.data : null;
    if (!data || typeof data !== 'object') throw new HttpError(400, 'That is not a Family Planner backup file');
    for (const k of SECTIONS) {
      if (data[k] !== undefined && (typeof data[k] !== 'object' || Array.isArray(data[k]))) throw new HttpError(400, `Backup section ${k} is damaged`);
    }
    // Lists the app reads straight away must be lists, or the pages would break after restoring.
    const LISTS = { family: ['children', 'dietary'], food: ['pantry', 'recipes', 'favourites', 'ratings'], clothes: ['items'], shopping: ['items'], chores: ['list', 'log', 'adults'], calendar: ['events'], packing: ['trips'] };
    for (const [k, keys] of Object.entries(LISTS)) {
      for (const key of keys) {
        const v = data[k] && data[k][key];
        if (v !== undefined && (!Array.isArray(v) || v.some((x) => key !== 'dietary' && key !== 'favourites' && (x === null || typeof x !== 'object')))) {
          throw new HttpError(400, `Backup section ${k} is damaged`);
        }
      }
    }
    if (data.ai !== undefined && (typeof data.ai !== 'object' || data.ai === null || Array.isArray(data.ai))) throw new HttpError(400, 'Backup section ai is damaged');
    for (const k of SECTIONS) if (data[k] !== undefined) store.data[k] = data[k];
    if (data.ai) {
      // This device's AI key (and which server it's for) and its usage count are never taken from a file.
      const { apiKey, keyFor, usage, ...ai } = data.ai;
      const mine = store.data.ai || {};
      store.data.ai = { ...mine, ...ai, apiKey: mine.apiKey || '', keyFor: mine.keyFor, usage: mine.usage };
    }
    store.save();
    return { ok: true };
  });
  router.get('/api/v1/health', () => ({ ok: true }));

  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    // Other web pages can't use this API: only addresses listed in CORS_ORIGINS (space
    // separated, for another front end) are let in. The app itself is on the same address.
    const origin = req.headers && req.headers.origin;
    if (origin && CORS_ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Family-Member');
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();

    if (url.pathname.startsWith('/api/')) {
      const hit = router.match(req.method, url.pathname);
      try {
        if (!hit) throw new HttpError(404, 'Not found');
        // Changes must be sent as JSON. A form on another site can't send that without asking first.
        if (['POST', 'PUT'].includes(req.method) && !/^application\/json\b/i.test((req.headers && req.headers['content-type']) || '')) {
          throw new HttpError(415, 'Send JSON (Content-Type: application/json)');
        }
        let body = ['POST', 'PUT'].includes(req.method) ? await readJson(req) : {};
        if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};
        req.query = url.searchParams;
        const result = await hit.handler(req, body, hit.params);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
      } catch (err) {
        const status = err.status || 500;
        if (status === 500) console.error(err);
        res.writeHead(status, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ error: status === 500 ? 'Server error' : err.message }));
      }
      return;
    }

    // Static files; anything unknown falls back to the single-page app.
    let file = path.normalize(path.join(PUBLIC, url.pathname));
    if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) return res.writeHead(403).end();
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const dataFile = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');
  http.createServer(createApp(new Store(dataFile))).listen(port, () => {
    console.log(`Family Planner running at http://localhost:${port} (data: ${dataFile})`);
  });
}

module.exports = { createApp };
