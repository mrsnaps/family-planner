// Food module: HTTP routes over the engine. Owns the "food" key in the store.
const { newId } = require('../../lib/store');
const { HttpError } = require('../../lib/http');
const BUILTIN = require('./recipes');
const { suggestMeals, estimateMeals, cook, UNITS } = require('./engine');
const { suitsDiet, DIETS } = require('./diet');
const { lookupBarcode } = require('./barcode');

const DEFAULT = { pantry: [], recipes: [], favourites: [] };
// What the household adds to the cupboard and cooks, kept for shopping suggestions.
const HISTORY_LIMIT = { added: 400, cooked: 200 };

function cleanItem(input, existing = {}) {
  const it = { ...existing };
  if (input.name !== undefined) it.name = String(input.name).trim();
  if (!it.name) throw new HttpError(400, 'Item needs a name');
  if (input.quantity !== undefined) {
    const q = Number(input.quantity);
    if (input.quantity !== null && input.quantity !== '' && (!Number.isFinite(q) || q < 0)) {
      throw new HttpError(400, 'quantity must be a number ≥ 0');
    }
    it.quantity = input.quantity === null || input.quantity === '' ? null : q;
  }
  if (input.unit !== undefined) it.unit = String(input.unit || '').trim().toLowerCase();
  if (input.category !== undefined) it.category = String(input.category || '').trim() || null;
  if (input.expiry !== undefined) {
    if (input.expiry && isNaN(new Date(input.expiry))) throw new HttpError(400, 'Bad expiry date');
    it.expiry = input.expiry || null;
  }
  return it;
}

function cleanRecipe(input) {
  const name = String(input.name || '').trim();
  if (!name) throw new HttpError(400, 'Recipe needs a name');
  const servings = Number(input.servings) || 4;
  if (!Array.isArray(input.ingredients) || !input.ingredients.length) {
    throw new HttpError(400, 'Recipe needs ingredients');
  }
  const ingredients = input.ingredients.map((g) => {
    const qty = Number(g.qty);
    if (!g.name || !Number.isFinite(qty) || qty <= 0) throw new HttpError(400, 'Each ingredient needs name and qty');
    return {
      name: String(g.name).trim().toLowerCase(),
      qty,
      unit: String(g.unit || 'pcs').toLowerCase(),
      optional: Boolean(g.optional),
      aliases: Array.isArray(g.aliases) ? g.aliases.map(String) : [],
    };
  });
  return {
    name,
    servings,
    minutes: Number(input.minutes) || 30,
    tags: Array.isArray(input.tags) ? input.tags.map(String) : ['dinner'],
    ingredients,
    steps: Array.isArray(input.steps) ? input.steps.map(String).slice(0, 30) : [],
    builtin: false,
  };
}

function register(router, store, familySummary) {
  const data = () => store.get('food', DEFAULT);
  const recipes = () => [...BUILTIN, ...data().recipes];
  const portions = () => familySummary().portions;
  // Recipes that fit the family's diet settings (all of them if none are set).
  const familyRecipes = () => recipes().filter((r) => suitsDiet(r, familySummary().dietary));
  const favourites = () => (data().favourites ||= []);
  const engineOpts = () => ({ favourites: favourites(), indexRecipes: recipes() });

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
    return { ok: true, pantry: result.pantry };
  });

  const stats = () => estimateMeals(data().pantry, familyRecipes(), portions(), engineOpts());
  router.get('/api/v1/food/stats', () => stats());

  const meals = () => suggestMeals(data().pantry, familyRecipes(), portions(), engineOpts());
  // Every listed recipe, however much is missing (for meals the family cooks often).
  const mealsFor = (ids) => suggestMeals(data().pantry, recipes().filter((r) => ids.includes(r.id)), portions(), { ...engineOpts(), maxMissing: Infinity });
  return { stats, meals, mealsFor, history, favourites, addPantryItem, recipes, familyRecipes, pantry: () => data().pantry, addRecipe: (b) => {
    const recipe = { id: newId(), ...cleanRecipe(b) };
    data().recipes.push(recipe);
    store.save();
    return recipe;
  } };
}

module.exports = { register };
