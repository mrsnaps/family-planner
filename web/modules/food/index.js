// Food module: HTTP routes over the engine. Owns the "food" key in the store.
const { newId } = require('../../lib/store');
const { HttpError, text } = require('../../lib/http');
const BUILTIN = require('./recipes');
const { suggestMeals, estimateMeals, shopForWeek, cook, UNITS } = require('./engine');
const { suitsDiet, DIETS } = require('./diet');
const { lookupBarcode } = require('./barcode');
const ratingsLib = require('./ratings');
const { planLunchboxes, lunchboxFood } = require('./lunchbox');
const { parseRecipePage } = require('./recipe-link');

const DEFAULT = { pantry: [], recipes: [], favourites: [], ratings: [], lunchbox: { wontEat: {} } };
const DAY = 86400000;
const dayOf = (d = new Date()) => new Date(d).toISOString().slice(0, 10);
const addDays = (n, from = new Date()) => dayOf(new Date(from).getTime() + n * DAY);
// Leftovers keep 2 days in the fridge; defrosted ones should be eaten within a day.
const LEFTOVER_FRIDGE_DAYS = 2;
// What the household adds to the cupboard and cooks, kept for shopping suggestions.
const HISTORY_LIMIT = { added: 400, cooked: 200 };

function cleanItem(input, existing = {}) {
  const it = { ...existing };
  if (input.name !== undefined) it.name = text(input.name, 80);
  if (!it.name) throw new HttpError(400, 'Item needs a name');
  if (input.quantity !== undefined) {
    const q = Number(input.quantity);
    if (input.quantity !== null && input.quantity !== '' && (!Number.isFinite(q) || q < 0)) {
      throw new HttpError(400, 'quantity must be a number ≥ 0');
    }
    it.quantity = input.quantity === null || input.quantity === '' ? null : q;
  }
  if (input.unit !== undefined) it.unit = text(input.unit, 12).toLowerCase();
  if (input.category !== undefined) it.category = text(input.category, 40) || null;
  if (input.expiry !== undefined) {
    if (input.expiry && isNaN(new Date(input.expiry))) throw new HttpError(400, 'Bad expiry date');
    it.expiry = input.expiry || null;
  }
  // In the freezer: true (frozen today), a date (frozen then), or false/null (taken out).
  if (input.frozen !== undefined) {
    const was = it.frozen || null;
    if (input.frozen === true || input.frozen === 'true' || input.frozen === 'on') it.frozen = was || dayOf();
    else if (!input.frozen || input.frozen === 'false') it.frozen = null;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(String(input.frozen)) && !isNaN(new Date(input.frozen))) it.frozen = String(input.frozen);
    else throw new HttpError(400, 'frozen should be true, false or a date');
    // Defrosted leftovers: eat within a day.
    if (was && !it.frozen && it.leftover) it.expiry = addDays(1);
  }
  return it;
}

function cleanRecipe(input) {
  const name = text(input.name, 80);
  if (!name) throw new HttpError(400, 'Recipe needs a name');
  const servings = Math.min(50, Math.max(1, Math.round(Number(input.servings)) || 4));
  if (!Array.isArray(input.ingredients) || !input.ingredients.length || input.ingredients.length > 60) {
    throw new HttpError(400, 'Recipe needs ingredients');
  }
  const ingredients = input.ingredients.map((g) => {
    const qty = Number(g.qty);
    if (!g.name || !Number.isFinite(qty) || qty <= 0) throw new HttpError(400, 'Each ingredient needs name and qty');
    return {
      name: text(g.name, 80).toLowerCase(),
      qty,
      unit: text(g.unit || 'pcs', 12).toLowerCase(),
      optional: Boolean(g.optional),
      aliases: Array.isArray(g.aliases) ? g.aliases.slice(0, 10).map((a) => text(a, 80)) : [],
    };
  });
  return {
    name,
    servings,
    minutes: Math.min(1440, Math.max(1, Math.round(Number(input.minutes)) || 30)),
    tags: Array.isArray(input.tags) ? input.tags.slice(0, 10).map((t) => text(t, 30)) : ['dinner'],
    ingredients,
    steps: Array.isArray(input.steps) ? input.steps.slice(0, 30).map((t) => text(t, 500)).filter(Boolean) : [],
    ...(typeof input.source === 'string' && /^https?:\/\//i.test(input.source.trim()) ? { source: text(input.source, 500) } : {}),
    builtin: false,
  };
}

// options.fetchPage: async (url) => html, for "Recipe from a link" (see fetch-page.js).
// options.people: () => [{ id, name, adult }] for who can rate dinners (the chores page names
// the grown-ups); without it, the children plus "Grown-ups".
function register(router, store, familySummary, options = {}) {
  const data = () => {
    const d = store.get('food', DEFAULT);
    if (!Array.isArray(d.ratings)) d.ratings = [];
    if (!d.lunchbox || typeof d.lunchbox !== 'object' || Array.isArray(d.lunchbox)) d.lunchbox = { wontEat: {} };
    if (!d.lunchbox.wontEat || typeof d.lunchbox.wontEat !== 'object' || Array.isArray(d.lunchbox.wontEat)) d.lunchbox.wontEat = {};
    return d;
  };
  const recipes = () => [...BUILTIN, ...data().recipes];
  const portions = () => familySummary().portions;
  // Recipes that fit the family's diet settings (all of them if none are set).
  const familyRecipes = () => recipes().filter((r) => suitsDiet(r, familySummary().dietary));
  const favourites = () => (data().favourites ||= []);
  const people = () => {
    if (options.people) return options.people();
    const f = familySummary();
    return [{ id: 'grown-ups', name: 'Grown-ups', adult: true }, ...f.children.map((c) => ({ id: c.id, name: c.name, adult: false }))];
  };
  const ratingSummary = () => ratingsLib.summarise(data().ratings, people());
  const engineOpts = () => ({ favourites: favourites(), indexRecipes: recipes(), ratings: ratingSummary() });

  router.get('/api/v1/food/meta', () => ({ units: Object.keys(UNITS).filter(Boolean), diets: DIETS }));

  router.get('/api/v1/food/items', () => data().pantry);

  const history = () => {
    const h = (data().history ||= {});
    h.added ||= [];
    h.cooked ||= [];
    return h;
  };
  const remember = (list, entry) => {
    const h = history();
    h[list].push(entry);
    if (h[list].length > HISTORY_LIMIT[list]) h[list].splice(0, h[list].length - HISTORY_LIMIT[list]);
  };
  const rememberAdded = (item) =>
    remember('added', { name: item.name.toLowerCase(), quantity: item.quantity, unit: item.unit, at: new Date().toISOString() });

  const addPantryItem = (body) => {
    const item = { id: newId(), quantity: null, unit: 'pcs', category: null, expiry: null, ...cleanItem(body) };
    data().pantry.push(item);
    rememberAdded(item);
    store.save();
    return item;
  };
  router.post('/api/v1/food/items', (req, body) => addPantryItem(body));

  // Add many at once (barcode runs, AI photo scans, the phone app). All or nothing.
  router.post('/api/v1/food/items/bulk', (req, body) => {
    if (!Array.isArray(body.items) || !body.items.length) throw new HttpError(400, 'items must be a non-empty array');
    if (body.items.length > 200) throw new HttpError(400, 'At most 200 items at once');
    const items = body.items.map((b) => ({ id: newId(), quantity: null, unit: 'pcs', category: null, expiry: null, ...cleanItem(b) }));
    data().pantry.push(...items);
    items.forEach(rememberAdded);
    store.save();
    return items;
  });

  // Look a barcode up in Open Food Facts. Doesn't add anything; the caller confirms first.
  router.get('/api/v1/food/barcode/:code', async (req, body, { code }) => {
    if (!/^\d{6,14}$/.test(code)) throw new HttpError(400, 'Barcode should be 6 to 14 digits');
    const found = await lookupBarcode(code);
    if (!found) throw new HttpError(404, 'Product not found');
    return found;
  });

  router.put('/api/v1/food/items/:id', (req, body, { id }) => {
    const p = data().pantry;
    const i = p.findIndex((x) => x.id === id);
    if (i < 0) throw new HttpError(404, 'No such item');
    p[i] = cleanItem(body, p[i]);
    store.save();
    return p[i];
  });

  router.delete('/api/v1/food/items/:id', (req, body, { id }) => {
    const d = data();
    const before = d.pantry.length;
    d.pantry = d.pantry.filter((x) => x.id !== id);
    if (d.pantry.length === before) throw new HttpError(404, 'No such item');
    store.save();
    return { ok: true };
  });

  router.get('/api/v1/food/recipes', () => recipes());

  router.post('/api/v1/food/recipes', (req, body) => {
    const recipe = { id: newId(), ...cleanRecipe(body) };
    data().recipes.push(recipe);
    store.save();
    return recipe;
  });

  router.delete('/api/v1/food/recipes/:id', (req, body, { id }) => {
    const d = data();
    if (BUILTIN.some((r) => r.id === id)) throw new HttpError(400, 'Built-in recipes cannot be deleted');
    const before = d.recipes.length;
    d.recipes = d.recipes.filter((r) => r.id !== id);
    if (d.recipes.length === before) throw new HttpError(404, 'No such recipe');
    store.save();
    return { ok: true };
  });

  router.get('/api/v1/food/meals', (req) => {
    const maxMissing = Number(req.query.get('maxMissing') ?? 2);
    const list = req.query.get('all') === '1' ? recipes() : familyRecipes();
    return {
      portions: portions(),
      dietary: familySummary().dietary,
      meals: suggestMeals(data().pantry, list, portions(), { maxMissing, ...engineOpts() }),
      // Leftovers to eat first, and who can rate dinners.
      leftovers: stats().leftovers,
      people: people(),
    };
  });

  router.put('/api/v1/food/recipes/:id/favourite', (req, body, { id }) => {
    if (!recipes().some((r) => r.id === id)) throw new HttpError(404, 'No such recipe');
    const f = favourites();
    const on = body.favourite !== false;
    data().favourites = on ? [...new Set([...f, id])] : f.filter((x) => x !== id);
    store.save();
    return { id, favourite: on };
  });

  // Mark a meal as cooked: deducts its ingredients (scaled to the family) from the pantry.
  router.post('/api/v1/food/meals/:id/cook', (req, body, { id }) => {
    const recipe = recipes().find((r) => r.id === id);
    if (!recipe) throw new HttpError(404, 'No such recipe');
    const result = cook(data().pantry, recipe, portions(), recipes());
    if (!result.ok) throw new HttpError(409, 'Not enough in stock: ' + [...result.missing, ...result.short.map((s) => s.name)].join(', '));
    data().pantry = result.pantry;
    remember('cooked', { recipeId: recipe.id, name: recipe.name, at: new Date().toISOString() });
    store.save();
    return { ok: true, pantry: result.pantry, recipe: { id: recipe.id, name: recipe.name }, portions: portions(), people: people() };
  });

  // ---- leftovers and the freezer ----
  // Save what's left of a dinner: portions, in the fridge (use within 2 days) or the freezer.
  router.post('/api/v1/food/leftovers', (req, body) => {
    const recipe = recipes().find((r) => r.id === body.recipeId);
    const name = recipe ? recipe.name : text(body.name, 70);
    if (!name) throw new HttpError(400, 'Which meal are the leftovers from?');
    const n = Number(body.portions);
    if (!Number.isFinite(n) || n <= 0 || n > 50) throw new HttpError(400, 'portions should be a number above 0');
    const freeze = body.freeze === true || body.freeze === 'true' || body.freeze === 'freezer';
    const item = {
      id: newId(),
      name: `Leftover ${name.charAt(0).toLowerCase()}${name.slice(1)}`.slice(0, 80),
      quantity: Math.round(n * 10) / 10,
      unit: 'portion',
      category: 'Leftovers',
      expiry: freeze ? null : addDays(LEFTOVER_FRIDGE_DAYS),
      frozen: freeze ? dayOf() : null,
      leftover: { recipeId: recipe ? recipe.id : null, recipeName: name, cookedAt: dayOf() },
    };
    data().pantry.push(item);
    store.save();
    return item;
  });

  // Eat some leftovers: takes off a meal's worth (or `portions`), and clears them when they're gone.
  router.post('/api/v1/food/leftovers/:id/eat', (req, body, { id }) => {
    const d = data();
    const item = d.pantry.find((p) => p.id === id && p.leftover);
    if (!item) throw new HttpError(404, 'No such leftovers');
    const eat = Number(body.portions) > 0 ? Number(body.portions) : portions();
    const left = Math.round(((Number(item.quantity) || 0) - eat) * 10) / 10;
    if (left < 1) d.pantry = d.pantry.filter((p) => p !== item);
    else item.quantity = left;
    store.save();
    return { ok: true, left: left < 1 ? 0 : left };
  });

  // ---- ratings ----
  router.get('/api/v1/food/ratings', () => ({ people: people(), recipes: ratingSummary() }));

  // { recipeId, ratings: [{ personId, score }] } where score is 1 (thumbs up), 0 (meh) or -1
  // (thumbs down), or "up", "meh", "down". One rating per person per recipe per day: a second replaces it.
  router.post('/api/v1/food/ratings', (req, body) => {
    const recipe = recipes().find((r) => r.id === body.recipeId);
    if (!recipe) throw new HttpError(404, 'No such recipe');
    const list = Array.isArray(body.ratings) ? body.ratings : [{ personId: body.personId, score: body.score }];
    const who = new Map(people().map((p) => [p.id, p]));
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) ? String(body.date) : dayOf();
    const d = data();
    let saved = 0;
    for (const r of list.slice(0, 30)) {
      const score = ratingsLib.scoreOf(r && r.score);
      if (score === null || !who.has(r.personId)) continue;
      d.ratings = d.ratings.filter((x) => !(x.recipeId === recipe.id && x.personId === r.personId && x.date === date));
      d.ratings.push({ recipeId: recipe.id, personId: r.personId, score, date });
      saved++;
    }
    if (!saved) throw new HttpError(400, 'Give each rating a personId and a score of 1, 0 or -1');
    if (d.ratings.length > ratingsLib.LIMIT) d.ratings.splice(0, d.ratings.length - ratingsLib.LIMIT);
    store.save();
    return { recipeId: recipe.id, saved, rating: ratingSummary()[recipe.id] || null };
  });

  // ---- lunchboxes ----
  const school = () => familySummary().children;
  // Each child's won't-eat list, plus foods from dinners they aren't keen on.
  const lunchDislikes = () => {
    const wont = data().lunchbox.wontEat;
    const out = {};
    for (const c of school()) {
      out[c.id] = [...new Set([...(Array.isArray(wont[c.id]) ? wont[c.id] : []), ...ratingsLib.dislikedFoods(c.id, data().ratings, recipes(), people())])];
    }
    return out;
  };
  const lunchbox = () => {
    const plan = planLunchboxes({ pantry: data().pantry, children: school(), dietary: familySummary().dietary, dislikes: lunchDislikes() });
    const wont = data().lunchbox.wontEat;
    for (const c of plan.children) c.wontEat = Array.isArray(wont[c.childId]) ? wont[c.childId] : [];
    return plan;
  };
  router.get('/api/v1/food/lunchbox', () => lunchbox());

  // What a child won't eat in their lunchbox: { childId, foods: ['tuna', 'tomatoes'] } (or a comma list).
  router.put('/api/v1/food/lunchbox/wont-eat', (req, body) => {
    const child = school().find((c) => c.id === body.childId);
    if (!child) throw new HttpError(404, 'No such child');
    const raw = Array.isArray(body.foods) ? body.foods : String(body.foods || '').split(/[,\n]/);
    const foods = [...new Set(raw.map((f) => text(f, 40).toLowerCase()).filter(Boolean))].slice(0, 30);
    data().lunchbox.wontEat[child.id] = foods;
    store.save();
    return { childId: child.id, foods };
  });

  // ---- recipe from a link ----
  // { url } fetches the page (on the server, or through FamilyPlannerFetchPage in the browser
  // build); { html } parses a page, its JSON-LD or plain text pasted in. Returns a draft to
  // check and then save with POST /api/v1/food/recipes. Nothing is saved here.
  router.post('/api/v1/food/recipes/from-link', async (req, body) => {
    let html = typeof body.html === 'string' ? body.html : typeof body.text === 'string' ? body.text : null;
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (html === null) {
      if (!url) throw new HttpError(400, "Send the recipe page's address as url, or its text as html");
      if (url.length > 2000 || !/^https?:\/\//i.test(url)) throw new HttpError(400, 'Use a link starting with http:// or https://');
      const fetchPage = typeof globalThis.FamilyPlannerFetchPage === 'function' ? globalThis.FamilyPlannerFetchPage : options.fetchPage;
      if (!fetchPage) throw new HttpError(409, "Paste the recipe page's text instead");
      try {
        html = String(await fetchPage(url));
      } catch (e) {
        const status = Number(e && e.status);
        throw new HttpError(status >= 400 && status < 600 ? status : 502, (e && e.message) || "Couldn't open that page");
      }
    }
    if (html.length > 2 * 1024 * 1024) throw new HttpError(413, 'That is too much text. Paste just the recipe.');
    if (!html.trim()) throw new HttpError(400, 'Paste the recipe first');
    const draft = parseRecipePage(html, url);
    if (!draft) throw new HttpError(422, "Couldn't find a recipe there. Try pasting the ingredients and method instead.");
    return draft;
  });

  // Shop for the week: fill the plan's empty days and list what to buy for all of it.
  // `week` is the plan on screen (the rules' or the AI's): recipe ids, or null for a gap.
  router.post('/api/v1/food/week-shop', (req, body) => {
    const week = Array.isArray(body && body.week) ? body.week.slice(0, 7).map((x) => (typeof x === 'string' ? x : null)) : [];
    const since = Date.now() - 60 * 86400000;
    const counts = new Map();
    for (const c of history().cooked || []) if (new Date(c.at) >= since) counts.set(c.recipeId, (counts.get(c.recipeId) || 0) + 1);
    const often = [...counts].filter(([, n]) => n >= 2).map(([id]) => id);
    return shopForWeek(data().pantry, familyRecipes(), portions(), { week, favourites: favourites(), often, indexRecipes: recipes(), ratings: ratingSummary() });
  });

  const stats = () => estimateMeals(data().pantry, familyRecipes(), portions(), engineOpts());
  router.get('/api/v1/food/stats', () => stats());

  const meals = () => suggestMeals(data().pantry, familyRecipes(), portions(), engineOpts());
  // Every listed recipe, however much is missing (for meals the family cooks often).
  const mealsFor = (ids) => suggestMeals(data().pantry, recipes().filter((r) => ids.includes(r.id)), portions(), { ...engineOpts(), maxMissing: Infinity });
  return { stats, meals, mealsFor, history, favourites, addPantryItem, recipes, familyRecipes, pantry: () => data().pantry, ratingSummary, people, lunchbox, lunchDislikes,
    lunchboxFood: () => lunchboxFood(data().pantry, dayOf()), addRecipe: (b) => {
    const recipe = { id: newId(), ...cleanRecipe(b) };
    data().recipes.push(recipe);
    store.save();
    return recipe;
  } };
}

module.exports = { register };
