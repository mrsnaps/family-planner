// Pure functions: match pantry items to recipe ingredients, suggest meals,
// and estimate how many meals the food in stock will make for this family.

const { dietFlags, weekBalance } = require('./diet');

// ---- units ---------------------------------------------------------------
const UNITS = {
  g: ['mass', 1], kg: ['mass', 1000],
  ml: ['vol', 1], l: ['vol', 1000],
  pcs: ['count', 1], each: ['count', 1], '': ['count', 1],
  tin: ['tin', 1], can: ['tin', 1],
  pack: ['pack', 1],
  tbsp: ['spoon', 3], tsp: ['spoon', 1],
};
const unitInfo = (u) => UNITS[String(u || '').trim().toLowerCase()] || [String(u).toLowerCase(), 1];

// ---- names ---------------------------------------------------------------
// Pantry names that look like an ingredient but are not it.
const DECOYS = ['black pepper', 'white pepper', 'chicken stock', 'beef stock', 'vegetable stock', 'peanut butter'];

const singular = (w) =>
  w.length > 4 && w.endsWith('oes') ? w.slice(0, -2)
    : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1)
      : w;
const words = (s) => String(s).toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean).map(singular);

// term -> concept, built from every recipe's ingredient names and aliases.
function buildIndex(recipes) {
  const index = new Map();
  for (const rec of recipes) {
    for (const ing of rec.ingredients) {
      for (const term of [ing.name, ...(ing.aliases || [])]) {
        index.set(words(term).join(' '), ing.name.toLowerCase());
      }
    }
  }
  for (const d of DECOYS) {
    const w = words(d).join(' ');
    if (!index.has(w)) index.set(w, `__${d}`);
  }
  // stock cubes named "chicken stock" etc. are stock
  if ([...index.values()].includes('stock')) {
    for (const d of ['chicken stock', 'beef stock', 'vegetable stock']) index.set(words(d).join(' '), 'stock');
  }
  return index;
}

// Which ingredient concepts a pantry item counts as. The most specific matching
// term wins, so "coconut milk" is not milk and "red pepper" is not black pepper.
function conceptsFor(itemName, index) {
  const have = new Set(words(itemName));
  let best = 0;
  let found = new Set();
  for (const [term, concept] of index) {
    const tw = term.split(' ');
    if (!tw.every((w) => have.has(w))) continue;
    if (tw.length > best) {
      best = tw.length;
      found = new Set([concept]);
    } else if (tw.length === best) {
      found.add(concept);
    }
  }
  return found;
}

// ---- stock simulation ----------------------------------------------------
// A "stock" is a working copy of the pantry: concept -> list of lots.
function makeStock(pantry, index) {
  const stock = new Map();
  for (const item of pantry) {
    const [family, factor] = unitInfo(item.unit);
    const qty = Number(item.quantity);
    const lot = {
      id: item.id,
      name: item.name,
      family,
      amount: Number.isFinite(qty) && qty > 0 ? qty * factor : null,
      expiry: item.expiry || null,
    };
    if (lot.amount === null && Number(item.quantity) === 0) continue; // used up
    for (const c of conceptsFor(item.name, index)) {
      if (!stock.has(c)) stock.set(c, []);
      stock.get(c).push(lot);
    }
  }
  for (const lots of stock.values()) {
    lots.sort((a, b) => (a.expiry || '9999').localeCompare(b.expiry || '9999'));
  }
  return stock;
}

// Amount of an ingredient needed for this family, in the ingredient's base unit.
function needFor(ing, recipe, portions) {
  const [family, factor] = unitInfo(ing.unit);
  let amount = (ing.qty * factor * portions) / recipe.servings;
  if (family === 'count' || family === 'tin' || family === 'pack') amount = Math.max(1, Math.ceil(amount - 0.25));
  return { family, amount };
}

// Check one ingredient against stock. Lots in a different unit family (e.g. "1 bag"
// of rice when the recipe wants grams) count as present but untracked: never run out.
function checkIngredient(ing, recipe, portions, stock) {
  const lots = (stock.get(ing.name.toLowerCase()) || []).filter((l) => l.amount === null || l.amount > 0);
  if (!lots.length) return { status: 'missing' };
  const { family, amount } = needFor(ing, recipe, portions);
  const same = lots.filter((l) => l.family === family && l.amount !== null);
  const untracked = lots.some((l) => l.family !== family || l.amount === null);
  const have = same.reduce((s, l) => s + l.amount, 0);
  if (untracked || have >= amount) return { status: 'ok', lots: same, amount, untracked };
  return { status: 'short', have, amount, family };
}

function consume(check) {
  if (check.untracked) return;
  let left = check.amount;
  for (const lot of check.lots) {
    const take = Math.min(lot.amount, left);
    lot.amount -= take;
    left -= take;
    if (left <= 0) break;
  }
}

function evaluate(recipe, portions, stock, today) {
  const missing = [];
  const short = [];
  const checks = [];
  let usesExpiring = false;
  for (const ing of recipe.ingredients) {
    const c = checkIngredient(ing, recipe, portions, stock);
    if (c.status === 'missing') {
      if (!ing.optional) missing.push(ing.name);
    } else if (c.status === 'short') {
      if (!ing.optional) short.push({ name: ing.name, have: round(c.have), need: round(c.amount), unit: baseUnit(c.family) });
    } else {
      checks.push(c);
      if (c.lots.some((l) => l.expiry && daysBetween(today, l.expiry) <= 3)) usesExpiring = true;
    }
  }
  return { missing, short, checks, usesExpiring };
}

const round = (n) => Math.round(n * 10) / 10;
const baseUnit = (family) => ({ mass: 'g', vol: 'ml', count: 'pcs', tin: 'tin', pack: 'pack', spoon: 'tsp' }[family] || family);
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

// ---- public API ----------------------------------------------------------
function suggestMeals(pantry, recipes, portions, { today = new Date().toISOString().slice(0, 10), maxMissing = 2, favourites = [], indexRecipes = recipes } = {}) {
  const index = buildIndex(indexRecipes);
  const fav = new Set(favourites);
  const stock = makeStock(pantry, index);
  const out = [];
  for (const recipe of recipes) {
    const e = evaluate(recipe, portions, stock, today);
    if (e.missing.length > maxMissing) continue;
    const status = e.missing.length ? 'missing' : e.short.length ? 'short' : 'ready';
    out.push({
      id: recipe.id,
      name: recipe.name,
      minutes: recipe.minutes,
      tags: recipe.tags,
      status,
      missing: e.missing,
      short: e.short,
      usesExpiring: e.usesExpiring,
      builtin: recipe.builtin !== false,
      favourite: fav.has(recipe.id),
      diet: dietFlags(recipe),
      ingredients: recipe.ingredients.map((ing) => {
        const { family, amount } = needFor(ing, recipe, portions);
        return { name: ing.name, amount: round(amount), unit: baseUnit(family), optional: Boolean(ing.optional) };
      }),
    });
  }
  const rank = { ready: 0, short: 1, missing: 2 };
  out.sort((a, b) =>
    rank[a.status] - rank[b.status] ||
    Number(b.usesExpiring) - Number(a.usesExpiring) ||
    Number(b.favourite) - Number(a.favourite) ||
    a.missing.length - b.missing.length ||
    a.minutes - b.minutes
  );
  return out;
}

// Greedy plan: keep cooking the best ready meal (prefer ones that use food about
// to expire, then ones cooked least) until nothing more can be made.
function estimateMeals(pantry, recipes, portions, { today = new Date().toISOString().slice(0, 10), cap = 60, favourites = [], indexRecipes = recipes } = {}) {
  const index = buildIndex(indexRecipes);
  const fav = new Set(favourites);
  const stock = makeStock(pantry, index);
  const cooked = new Map();
  const plan = [];
  const mains = recipes.filter((r) => !(r.tags || []).includes('breakfast'));
  while (plan.length < cap) {
    let best = null;
    for (const recipe of mains) {
      const e = evaluate(recipe, portions, stock, today);
      if (e.missing.length || e.short.length) continue;
      const score = (e.usesExpiring ? 100 : 0) - 10 * (cooked.get(recipe.id) || 0) + (fav.has(recipe.id) ? 5 : 0) +
        e.checks.filter((c) => !c.untracked).length;
      if (!best || score > best.score) best = { recipe, e, score };
    }
    if (!best) break;
    best.e.checks.forEach(consume);
    cooked.set(best.recipe.id, (cooked.get(best.recipe.id) || 0) + 1);
    plan.push({ id: best.recipe.id, name: best.recipe.name });
  }

  const expiringSoon = pantry
    .filter((p) => p.expiry && daysBetween(today, p.expiry) <= 3)
    .map((p) => ({ id: p.id, name: p.name, expiry: p.expiry, days: daysBetween(today, p.expiry) }))
    .sort((a, b) => a.days - b.days);

  const unmatched = pantry.filter((p) => conceptsFor(p.name, index).size === 0).map((p) => p.name);

  return {
    portions,
    mealsLeft: plan.length,
    capped: plan.length >= cap,
    plan,
    balance: weekBalance(plan.map((p) => recipes.find((r) => r.id === p.id))),
    expiringSoon,
    unmatched,
  };
}

// Deduct one cooking of a recipe from the pantry. Returns the updated pantry items.
function cook(pantry, recipe, portions, recipes) {
  const index = buildIndex(recipes);
  const stock = makeStock(pantry, index);
  const e = evaluate(recipe, portions, stock, new Date().toISOString().slice(0, 10));
  if (e.missing.length || e.short.length) return { ok: false, missing: e.missing, short: e.short };
  e.checks.forEach(consume);
  const lots = new Map();
  for (const ls of stock.values()) for (const l of ls) lots.set(l.id, l);
  const updated = pantry.map((p) => {
    const lot = lots.get(p.id);
    if (!lot || lot.amount === null || lot.family !== unitInfo(p.unit)[0]) return p;
    const factor = unitInfo(p.unit)[1];
    return { ...p, quantity: round(lot.amount / factor) };
  });
  return { ok: true, pantry: updated };
}

module.exports = { suggestMeals, estimateMeals, cook, conceptsFor, buildIndex, needFor, UNITS };
