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
const ai = require('./modules/ai');
const { reminders } = require('./modules/reminders');

const PUBLIC = path.join(__dirname, 'public');
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

function createApp(store) {
  const router = new Router();
  const fam = family.register(router, store);
  const foodApi = food.register(router, store, fam.summary);
  const clothesApi = clothes.register(router, store, fam.family);
  const shoppingApi = shopping.register(router, store, {
    meals: foodApi.meals,
    clothesStats: clothesApi.stats,
    addPantryItem: foodApi.addPantryItem,
    addClothesItem: clothesApi.addItem,
  });

  const aiApi = ai.register(router, store, { familySummary: fam.summary, food: foodApi });

  const remindersNow = (food = foodApi.stats(), clothesStats = clothesApi.stats()) =>
    reminders({ food, clothes: clothesStats, shopping: shoppingApi.count() });

  // The combined data panel: one call for a dashboard (or a phone app's home screen).
  router.get('/api/v1/dashboard', () => {
    const food = foodApi.stats();
    const clothesStats = clothesApi.stats();
    return {
      family: fam.summary(),
      food,
      clothes: clothesStats,
      shoppingCount: shoppingApi.count(),
      reminders: remindersNow(food, clothesStats),
      handMeDowns: clothesApi.handMeDowns(),
      ai: { ready: aiApi.publicSettings().ready, onDevice: aiApi.publicSettings().onDevice },
    };
  });
  router.get('/api/v1/reminders', () => remindersNow());

  // Backup and restore everything except the AI key.
  const SECTIONS = ['family', 'food', 'clothes', 'shopping'];
  router.get('/api/v1/export', () => {
    const data = {};
    for (const k of SECTIONS) if (store.data[k] !== undefined) data[k] = store.data[k];
    if (store.data.ai) {
      const { apiKey, usage, ...rest } = store.data.ai;
      data.ai = rest;
    }
    return { app: 'family-planner', version: 1, exportedAt: new Date().toISOString(), data };
  });
  router.post('/api/v1/import', (req, body) => {
    const data = body && body.app === 'family-planner' ? body.data : null;
    if (!data || typeof data !== 'object') throw new HttpError(400, 'That is not a Family Planner backup file');
    for (const k of SECTIONS) {
      if (data[k] !== undefined && (typeof data[k] !== 'object' || Array.isArray(data[k]))) throw new HttpError(400, `Backup section ${k} is damaged`);
    }
    for (const k of SECTIONS) if (data[k] !== undefined) store.data[k] = data[k];
    if (data.ai) store.data.ai = { ...(store.data.ai || {}), ...data.ai, apiKey: store.data.ai?.apiKey || '' };
    store.save();
    return { ok: true };
  });
  router.get('/api/v1/health', () => ({ ok: true }));

  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    // Open CORS so a phone app or another front end can call the API.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();

    if (url.pathname.startsWith('/api/')) {
      const hit = router.match(req.method, url.pathname);
      try {
        if (!hit) throw new HttpError(404, 'Not found');
        const body = ['POST', 'PUT'].includes(req.method) ? await readJson(req) : {};
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
    if (!file.startsWith(PUBLIC)) return res.writeHead(403).end();
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
