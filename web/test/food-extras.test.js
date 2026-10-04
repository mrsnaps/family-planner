// Leftovers and the freezer, kids rating dinners, the lunchbox planner and recipes from a link.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createApp } = require('../server');
const { Store } = require('../lib/store');
const { suggestMeals, estimateMeals } = require('../modules/food/engine');
const { summarise, dislikedFoods } = require('../modules/food/ratings');
const { planLunchboxes, kindOf } = require('../modules/food/lunchbox');
const { parseRecipePage, parseIngredient, parseDuration, parseYield } = require('../modules/food/recipe-link');
const { makeFetchPage, isPrivateAddress } = require('../modules/food/fetch-page');
const { reminders } = require('../modules/reminders');
const BUILTIN = require('../modules/food/recipes');

const DAY = 86400000;
const day = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

async function start(t, options) {
  const server = http.createServer(createApp(new Store(null), options)).listen(0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}/api/v1`;
  return async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
}

// ---- leftovers and the freezer ----

test('leftovers are saved after cooking, eaten first, and counted as meals', async (t) => {
  const call = await start(t);
  await call('PUT', '/family', { adults: 2 });
  await call('POST', '/food/items/bulk', { items: [
    { name: 'Spaghetti', quantity: 500, unit: 'g' }, { name: 'Beef mince', quantity: 500, unit: 'g' },
    { name: 'Chopped tomatoes', quantity: 2, unit: 'tin' }, { name: 'Onion', quantity: 2, unit: 'pcs' },
  ] });
  const before = (await call('GET', '/food/stats')).body.mealsLeft;
  const cooked = (await call('POST', '/food/meals/spag-bol/cook')).body;
  assert.deepStrictEqual(cooked.recipe, { id: 'spag-bol', name: 'Spaghetti bolognese' });
  assert.ok(Array.isArray(cooked.people));

  const left = await call('POST', '/food/leftovers', { recipeId: 'spag-bol', portions: 4 });
  assert.strictEqual(left.status, 200);
  assert.strictEqual(left.body.name, 'Leftover spaghetti bolognese');
  assert.strictEqual(left.body.unit, 'portion');
  assert.strictEqual(left.body.expiry, day(2), 'leftovers keep 2 days in the fridge');
  assert.strictEqual(left.body.frozen, null);

  const stats = (await call('GET', '/food/stats')).body;
  assert.strictEqual(stats.plan[0].name, 'Leftover spaghetti bolognese', 'leftovers come first in the week');
  assert.ok(stats.plan[0].leftover);
  assert.strictEqual(stats.plan.filter((p) => p.leftover).length, 2, '4 portions is two dinners for 2 grown-ups');
  assert.ok(stats.mealsLeft >= 2 && stats.mealsLeft >= before - 1);
  assert.ok(!stats.unmatched.includes('Leftover spaghetti bolognese'), "a leftover isn't an ingredient");
  assert.ok(stats.leftovers.some((l) => l.id === left.body.id && l.portions === 4));

  const meals = (await call('GET', '/food/meals')).body;
  assert.strictEqual(meals.leftovers[0].id, left.body.id, 'meal ideas show the leftovers');

  // A week's shop with leftovers planned doesn't buy anything for those nights.
  const shop = (await call('POST', '/food/week-shop', { week: [stats.plan[0].id] })).body;
  assert.deepStrictEqual(shop.days[0], { id: stats.plan[0].id, name: 'Leftover spaghetti bolognese', planned: true, leftover: true, buy: [] });

  // Eating takes off a meal's worth; the last bit clears them.
  assert.strictEqual((await call('POST', `/food/leftovers/${left.body.id}/eat`, {})).body.left, 2);
  assert.strictEqual((await call('POST', `/food/leftovers/${left.body.id}/eat`, {})).body.left, 0);
  assert.ok(!(await call('GET', '/food/items')).body.some((i) => i.id === left.body.id));
  assert.strictEqual((await call('POST', '/food/leftovers', { recipeId: 'spag-bol', portions: 0 })).status, 400);
});

test('the freezer: long shelf life, "use it up" after 3 months, defrosted leftovers keep a day', async (t) => {
  const call = await start(t);
  const peas = (await call('POST', '/food/items', { name: 'Peas', quantity: 900, unit: 'g', expiry: day(1), frozen: true })).body;
  assert.strictEqual(peas.frozen, day(0));
  let stats = (await call('GET', '/food/stats')).body;
  assert.ok(!stats.expiringSoon.some((e) => e.id === peas.id), "frozen food doesn't go off in 3 days");
  assert.deepStrictEqual(stats.freezerOld, []);

  await call('PUT', `/food/items/${peas.id}`, { frozen: day(-100) });
  stats = (await call('GET', '/food/stats')).body;
  assert.strictEqual(stats.freezerOld[0].id, peas.id);
  const rem = (await call('GET', '/reminders')).body;
  assert.ok(rem.some((r) => r.title === 'Use up the peas from the freezer' && r.detail === 'Frozen 3 months ago.'));

  // Taking it out: its use-by counts again.
  await call('PUT', `/food/items/${peas.id}`, { frozen: false });
  assert.ok((await call('GET', '/food/stats')).body.expiringSoon.some((e) => e.id === peas.id));
  assert.strictEqual((await call('PUT', `/food/items/${peas.id}`, { frozen: 'soon' })).status, 400);

  const pie = (await call('POST', '/food/leftovers', { name: 'Fish pie', portions: 2, freeze: true })).body;
  assert.strictEqual(pie.expiry, null);
  assert.strictEqual(pie.frozen, day(0));
  const thawed = (await call('PUT', `/food/items/${pie.id}`, { frozen: false })).body;
  assert.strictEqual(thawed.expiry, day(1), 'defrosted leftovers: eat within a day');
});

test('reminders for leftovers going off', () => {
  const food = {
    expiringSoon: [],
    leftovers: [{ id: 'a', name: 'Leftover chilli', expiry: day(0), days: 0, frozen: null }, { id: 'b', name: 'Leftover curry', expiry: null, days: null, frozen: day(-3) }],
    freezerOld: [],
    mealsLeft: 5,
  };
  const out = reminders({ food, clothes: [], shopping: 0 });
  assert.deepStrictEqual(out.map((r) => r.title), ['Eat the leftover chilli today, or freeze it']);
  assert.strictEqual(out[0].level, 'urgent');
});

// ---- ratings ----

test('ratings: liked dinners rise, a recipe someone rated down twice sinks', async (t) => {
  const call = await start(t);
  const ava = (await call('POST', '/family/children', { name: 'Ava', birthDate: '2018-03-01' })).body;
  const { people } = (await call('GET', '/food/ratings')).body;
  assert.ok(people.some((p) => p.id === ava.id && p.name === 'Ava'));
  const mum = people.find((p) => p.adult);

  await call('POST', '/food/items/bulk', { items: [
    { name: 'Bread', quantity: 16, unit: 'pcs' }, { name: 'Baked beans', quantity: 4, unit: 'tin' }, { name: 'Cheddar', quantity: 400, unit: 'g' }, { name: 'Butter', quantity: 250, unit: 'g' }, { name: 'Ham', quantity: 300, unit: 'g' },
  ] });
  const order = async () => (await call('GET', '/food/meals')).body.meals.map((m) => m.id);
  const first = await order();
  assert.ok(first.indexOf('ham-sandwiches') < first.indexOf('beans-toast'), 'quicker first when nobody has rated anything');

  // Ava turns her nose up at ham sandwiches twice; everyone loves beans on toast.
  for (const date of [day(-8), day(-1)]) {
    const r = await call('POST', '/food/ratings', { recipeId: 'ham-sandwiches', date, ratings: [{ personId: ava.id, score: -1 }, { personId: mum.id, score: 'meh' }] });
    assert.strictEqual(r.status, 200);
  }
  await call('POST', '/food/ratings', { recipeId: 'beans-toast', ratings: [{ personId: ava.id, score: 'up' }, { personId: mum.id, score: 1 }] });
  const after = await order();
  assert.ok(after.indexOf('beans-toast') < after.indexOf('ham-sandwiches'), 'liked meals come before disliked ones');

  const ham = (await call('GET', '/food/meals')).body.meals.find((m) => m.id === 'ham-sandwiches');
  assert.deepStrictEqual(ham.rating.notKeen, ['Ava']);
  assert.deepStrictEqual([ham.rating.up, ham.rating.meh, ham.rating.down], [0, 2, 2]);

  // Rating again the same day replaces it; bad input is refused.
  await call('POST', '/food/ratings', { recipeId: 'beans-toast', ratings: [{ personId: ava.id, score: 0 }] });
  assert.strictEqual((await call('GET', '/food/ratings')).body.recipes['beans-toast'].meh, 1);
  assert.strictEqual((await call('POST', '/food/ratings', { recipeId: 'beans-toast', ratings: [{ personId: 'nobody', score: 1 }] })).status, 400);
  assert.strictEqual((await call('POST', '/food/ratings', { recipeId: 'nope', ratings: [] })).status, 404);

  // The AI's meal prompt hears what the family thought.
  const task = (await call('GET', '/ai/tasks/suggest-meals')).body;
  assert.match(task.prompt, /ham-sandwiches \| Ham sandwiches[^\n]*Ava isn't keen/);
  assert.match(task.system, /isn't keen/);
});

test('ratings summary and the engine', () => {
  const people = [{ id: 'a', name: 'Ava' }, { id: 'b', name: 'Ben' }];
  const ratings = [
    { recipeId: 'chilli', personId: 'a', score: -1, date: '2026-01-01' },
    { recipeId: 'chilli', personId: 'a', score: -1, date: '2026-01-08' },
    { recipeId: 'chilli', personId: 'b', score: 1, date: '2026-01-08' },
    { recipeId: 'omelette', personId: 'b', score: -1, date: '2026-01-02' },
    { recipeId: 'omelette', personId: 'b', score: 1, date: '2026-01-03' },
    { recipeId: 'omelette', personId: 'b', score: -1, date: '2026-01-04' },
  ];
  const s = summarise(ratings, people);
  assert.deepStrictEqual(s.chilli.notKeen, ['Ava']);
  assert.deepStrictEqual(s.chilli.likedBy, ['Ben']);
  assert.deepStrictEqual(s.omelette.notKeen, [], 'a thumbs up in between resets the count');
  // Ava isn't keen on chilli: kidney beans and mince, but not the rice she liked elsewhere.
  const liked = [{ recipeId: 'egg-fried-rice', personId: 'a', score: 1, date: '2026-01-09' }];
  const foods = dislikedFoods('a', [...ratings, ...liked], BUILTIN, people);
  assert.ok(foods.includes('kidney beans') && !foods.includes('rice'));

  const pantry = [{ id: 1, name: 'Eggs', quantity: 12, unit: 'pcs' }, { id: 2, name: 'Cheddar', quantity: 500, unit: 'g' }, { id: 3, name: 'Bread', quantity: 20, unit: 'pcs' }, { id: 4, name: 'Butter', quantity: 250, unit: 'g' }];
  const recipes = BUILTIN.filter((r) => ['omelette', 'cheese-toasties'].includes(r.id));
  const base = suggestMeals(pantry, recipes, 2).map((m) => m.id);
  const ranked = suggestMeals(pantry, recipes, 2, { ratings: { [base[0]]: { score: -2, notKeen: ['Ava'] } } }).map((m) => m.id);
  assert.notStrictEqual(ranked[0], base[0]);
  const plan = estimateMeals(pantry, recipes, 2, { ratings: { [base[0]]: { score: -2, notKeen: ['Ava'] } } }).plan;
  assert.strictEqual(plan[0].id, base[1], 'the week starts with the meal nobody minds');
});

// ---- lunchboxes ----

test('lunchbox planner: Monday to Friday, varied, within the diet and what each child eats', () => {
  const pantry = [
    { id: 'b', name: 'Bread', quantity: 1, unit: 'pack', expiry: '2026-10-20' },
    { id: 'w', name: 'Tortilla wraps', quantity: 8, unit: 'pcs' },
    { id: 'h', name: 'Ham', quantity: 200, unit: 'g' },
    { id: 'c', name: 'Cheddar', quantity: 300, unit: 'g' },
    { id: 't', name: 'Tuna', quantity: 2, unit: 'tin' },
    { id: 'a', name: 'Apples', quantity: 6, unit: 'pcs' },
    { id: 's', name: 'Satsumas', quantity: 4, unit: 'pcs' },
    { id: 'y', name: 'Yoghurts', quantity: 4, unit: 'pcs' },
    { id: 'k', name: 'Crisps', quantity: 6, unit: 'pcs' },
    { id: 'j', name: 'Apple juice cartons', quantity: 3, unit: 'pcs' },
    { id: 'm', name: 'Beef mince', quantity: 500, unit: 'g' },
    { id: 'f', name: 'Fish fingers', quantity: 10, unit: 'pcs', frozen: '2026-09-01' },
    { id: 'l', name: 'Leftover chilli', quantity: 2, unit: 'portion', leftover: { recipeId: 'chilli' } },
  ];
  const children = [{ id: 'ava', name: 'Ava', age: 8 }, { id: 'ben', name: 'Ben', age: 6 }, { id: 'tot', name: 'Tot', age: 2 }];
  const plan = planLunchboxes({ pantry, children, dislikes: { ben: ['tuna', 'crisps'] }, today: '2026-10-04' });
  assert.deepStrictEqual(plan.days.map((d) => d.day), ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
  assert.deepStrictEqual(plan.days[0].date, '2026-10-05');
  assert.deepStrictEqual(plan.children.map((c) => c.name), ['Ava', 'Ben']);
  assert.deepStrictEqual(plan.notAtSchool, ['Tot']);
  const all = plan.children.flatMap((c) => c.days.flatMap((d) => [d.main, d.snack, d.fruit, d.drink].filter(Boolean).flatMap((s) => s.uses)));
  assert.ok(!all.some((n) => /mince|fish fingers|leftover/i.test(n)), 'no raw mince, frozen food or leftovers');
  const ben = plan.children[1].days;
  assert.ok(!ben.some((d) => [d.main, d.snack].some((s) => s && /tuna|crisps/i.test(s.uses.join(' ')))), "Ben's won't-eat list is respected");
  const ava = plan.children[0].days;
  assert.ok(ava.every((d) => d.main && d.fruit && d.drink), 'every day has a main, fruit and a drink');
  assert.ok(new Set(ava.map((d) => d.main.name)).size >= 3, `mains vary: ${ava.map((d) => d.main.name)}`);
  assert.notStrictEqual(ava[0].main.name, ava[1].main.name);
  assert.ok(ava.some((d) => d.drink.name === 'Water') && ava.some((d) => d.drink.name === 'Apple juice carton'));
  // 4 yoghurts, 6 crisps (Ava only): 10 snacks are needed, so some are missing.
  assert.ok(plan.missing.some((m) => m.for === 'snack'));

  const veggie = planLunchboxes({ pantry, children: [children[0]], dietary: ['vegetarian'], today: '2026-10-04' });
  assert.ok(veggie.children[0].days.every((d) => !d.main || !/ham|tuna/i.test(d.main.name)));
  const noGluten = planLunchboxes({ pantry, children: [children[0]], dietary: ['gluten-free'], today: '2026-10-04' });
  assert.ok(noGluten.children[0].days.every((d) => d.main === null), 'no bread or wraps when gluten-free');
  assert.ok(noGluten.missing.some((m) => m.name === 'Rice cakes'));
  assert.strictEqual(kindOf('Chopped tomatoes'), null);
  assert.strictEqual(kindOf('Cheese strings'), 'snack');
});

test('lunchbox API, won\'t-eat lists and the AI version', async (t) => {
  const call = await start(t);
  const ava = (await call('POST', '/family/children', { name: 'Ava', birthDate: '2017-05-01' })).body;
  await call('POST', '/food/items/bulk', { items: [
    { name: 'Bread', quantity: 16, unit: 'pcs' }, { name: 'Ham', quantity: 200, unit: 'g' }, { name: 'Tuna', quantity: 2, unit: 'tin' },
    { name: 'Apples', quantity: 6, unit: 'pcs' }, { name: 'Crisps', quantity: 6, unit: 'pcs' },
  ] });
  assert.strictEqual((await call('PUT', '/food/lunchbox/wont-eat', { childId: ava.id, foods: 'Tuna, ' })).body.foods[0], 'tuna');
  const plan = (await call('GET', '/food/lunchbox')).body;
  assert.deepStrictEqual(plan.children[0].wontEat, ['tuna']);
  assert.ok(plan.children[0].days.every((d) => !d.main || !/tuna/i.test(d.main.name)));
  assert.strictEqual((await call('PUT', '/food/lunchbox/wont-eat', { childId: 'nope', foods: [] })).status, 404);

  // The AI prompt lists the food by id; its answer keeps only food that's really there.
  const task = (await call('GET', '/ai/tasks/suggest-lunchbox')).body;
  assert.match(task.prompt, /won't eat: tuna/);
  const items = (await call('GET', '/food/items')).body;
  const id = (n) => items.find((i) => i.name === n).id;
  const result = { boxes: [
    { childId: ava.id, day: 0, main: { name: 'Ham sandwich', itemIds: [id('Bread'), id('Ham')] }, snack: { name: 'Cake', itemIds: ['made-up'] }, fruit: { name: 'Apple', itemIds: [id('Apples')] }, drink: { name: 'Water', itemIds: [] } },
    { childId: ava.id, day: 1, main: { name: 'Tuna sandwich', itemIds: [id('Bread'), id('Tuna')] }, snack: { name: 'Crisps', itemIds: [id('Crisps')] }, fruit: { name: 'Lemonade', itemIds: [] }, drink: { name: 'Water', itemIds: [] } },
    { childId: 'someone-else', day: 2, main: { name: 'Ham sandwich', itemIds: [id('Ham')] }, snack: { name: 'x', itemIds: [] }, fruit: { name: 'x', itemIds: [] }, drink: { name: 'x', itemIds: [] } },
  ], toBuy: ['Satsumas', 'Ham', ''] };
  const r = (await call('POST', '/ai/suggest/lunchbox', { result })).body;
  const days = r.children[0].days;
  assert.deepStrictEqual(days[0].main, { name: 'Ham sandwich', uses: ['Bread', 'Ham'] });
  assert.strictEqual(days[0].snack, null, 'made-up food is dropped');
  assert.strictEqual(days[1].main, null, "tuna is on Ava's won't-eat list");
  assert.strictEqual(days[1].fruit, null);
  assert.strictEqual(days[2].main, null);
  assert.deepStrictEqual(r.toBuy, ['Satsumas'], 'nothing they already have');
  assert.strictEqual(r.children.length, 1);
});

// ---- recipe from a link ----

const PAGE = `<!doctype html><html><head><title>Easy chilli | Some Site</title>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"x"},
{"@type":["Recipe","NewsArticle"],"name":"Easy chilli con carne","recipeYield":["4","4 servings"],"prepTime":"PT15M","cookTime":"PT1H",
"recipeCategory":"Dinner","recipeIngredient":["1 tbsp olive oil","1 large onion, chopped","500g lean beef mince","400g tin chopped tomatoes","2 x 400g tins kidney beans, drained","1 &frac12; tsp chilli powder","Salt and pepper, to taste"],
"recipeInstructions":[{"@type":"HowToSection","name":"Cook","itemListElement":[{"@type":"HowToStep","text":"Heat the oil and fry the onion."},{"@type":"HowToStep","text":"Add the mince &amp; brown it."}]},{"@type":"HowToStep","text":"Stir in the rest and simmer."}]}]}
</script></head><body><h1>Easy chilli</h1></body></html>`;

test('recipe pages: JSON-LD with @graph, sections, durations and yields', () => {
  const r = parseRecipePage(PAGE, 'https://example.org/chilli');
  assert.strictEqual(r.name, 'Easy chilli con carne');
  assert.strictEqual(r.servings, 4);
  assert.strictEqual(r.minutes, 75);
  assert.deepStrictEqual(r.tags, ['dinner']);
  assert.deepStrictEqual(r.steps, ['Heat the oil and fry the onion.', 'Add the mince & brown it.', 'Stir in the rest and simmer.']);
  assert.strictEqual(r.source, 'https://example.org/chilli');
  const ing = Object.fromEntries(r.ingredients.map((i) => [i.name, [i.qty, i.unit, i.optional]]));
  assert.deepStrictEqual(ing['olive oil'], [1, 'tbsp', false]);
  assert.deepStrictEqual(ing.onion, [1, 'pcs', false]);
  assert.deepStrictEqual(ing['lean beef mince'], [500, 'g', false]);
  assert.deepStrictEqual(ing['chopped tomatoes'], [1, 'tin', false]);
  assert.deepStrictEqual(ing['kidney beans'], [2, 'tin', false]);
  assert.deepStrictEqual(ing['chilli powder'], [1.5, 'tsp', false]);
  assert.deepStrictEqual(ing['salt and pepper'], [1, 'pcs', true]);

  assert.strictEqual(parseDuration('P0DT1H30M'), 90);
  assert.strictEqual(parseDuration('PT45M'), 45);
  assert.strictEqual(parseDuration('soon'), null);
  assert.strictEqual(parseYield('Serves 6'), 6);
  assert.strictEqual(parseYield(['8']), 8);
  assert.deepStrictEqual(parseIngredient('2 tbsp olive oil'), { name: 'olive oil', qty: 2, unit: 'tbsp', optional: false, original: '2 tbsp olive oil' });
  assert.deepStrictEqual(parseIngredient('3 garlic cloves, crushed').name, 'garlic');
  assert.deepStrictEqual([parseIngredient('1 1/2 cups milk').qty, parseIngredient('1 1/2 cups milk').unit], [360, 'ml']);
  assert.deepStrictEqual([parseIngredient('100g/4oz cheddar, grated').name, parseIngredient('100g/4oz cheddar, grated').qty], ['cheddar', 100]);

  // A lone JSON-LD object pasted in, and an array of them.
  const lone = parseRecipePage(JSON.stringify([{ '@type': 'Recipe', name: 'Toast', recipeYield: 2, totalTime: 'PT5M', recipeIngredient: ['2 slices bread'], recipeInstructions: 'Toast the bread.\nButter it.' }]));
  assert.deepStrictEqual([lone.name, lone.servings, lone.minutes, lone.steps.length], ['Toast', 2, 5, 2]);
  assert.deepStrictEqual(lone.ingredients[0], { name: 'bread', qty: 2, unit: 'pcs', optional: false, original: '2 slices bread' });
});

test('recipe pages without JSON-LD: plain text between "Ingredients" and "Method"', () => {
  const text = `Nana's flapjacks\nServes 12\nReady in 40 mins\n\nIngredients\n250g butter\n250g golden syrup\nFor the topping:\n500g porridge oats\n\nMethod\n1. Melt the butter and syrup.\n2. Stir in the oats and bake for 25 minutes.\nNotes\nKeeps a week.`;
  const r = parseRecipePage(text);
  assert.strictEqual(r.name, "Nana's flapjacks");
  assert.deepStrictEqual([r.servings, r.minutes], [12, 40]);
  assert.deepStrictEqual(r.ingredients.map((i) => i.name), ['butter', 'golden syrup', 'porridge oats']);
  assert.deepStrictEqual(r.steps, ['Melt the butter and syrup.', 'Stir in the oats and bake for 25 minutes.']);
  const html = parseRecipePage('<html><head><title>Pancakes - Food</title></head><body><h1>Pancakes</h1><h2>Ingredients</h2><ul><li>100g plain flour</li><li>2 eggs</li><li>300ml milk</li></ul><h2>Instructions</h2><p>Whisk.</p><p>Fry.</p></body></html>');
  assert.strictEqual(html.name, 'Pancakes');
  assert.deepStrictEqual(html.ingredients.map((i) => [i.name, i.qty, i.unit]), [['plain flour', 100, 'g'], ['eggs', 2, 'pcs'], ['milk', 300, 'ml']]);
  assert.deepStrictEqual(html.steps, ['Whisk.', 'Fry.']);
  assert.strictEqual(parseRecipePage('<p>Just a blog post</p>'), null);
});

test('the from-link route: injected fetcher, the browser hook, and paste when neither', async (t) => {
  const asked = [];
  const call = await start(t, { fetchPage: async (url) => { asked.push(url); return PAGE; } });
  const r = await call('POST', '/food/recipes/from-link', { url: 'https://example.org/chilli' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.name, 'Easy chilli con carne');
  assert.deepStrictEqual(asked, ['https://example.org/chilli']);
  assert.strictEqual((await call('GET', '/food/recipes')).body.filter((x) => !x.builtin).length, 0, 'nothing saved until it is checked');
  assert.strictEqual((await call('POST', '/food/recipes/from-link', { url: 'file:///etc/passwd' })).status, 400);
  assert.strictEqual((await call('POST', '/food/recipes/from-link', { html: '<p>nothing here</p>' })).status, 422);

  // Saving the checked draft keeps its method and where it came from.
  const saved = (await call('POST', '/food/recipes', r.body)).body;
  assert.strictEqual(saved.source, 'https://example.org/chilli');
  assert.strictEqual(saved.steps.length, 3);

  // The browser build: no fetcher, so "paste it instead" -- unless a proxy hook is set.
  const browser = await start(t, { fetchPage: null });
  const none = await browser('POST', '/food/recipes/from-link', { url: 'https://example.org/chilli' });
  assert.strictEqual(none.status, 409);
  assert.strictEqual(none.body.error, "Paste the recipe page's text instead");
  assert.strictEqual((await browser('POST', '/food/recipes/from-link', { html: PAGE })).body.servings, 4);
  globalThis.FamilyPlannerFetchPage = async () => { throw Object.assign(new Error('The proxy is busy'), { status: 503 }); };
  t.after(() => { delete globalThis.FamilyPlannerFetchPage; });
  const busy = await browser('POST', '/food/recipes/from-link', { url: 'https://example.org/chilli' });
  assert.deepStrictEqual([busy.status, busy.body.error], [503, 'The proxy is busy']);
  globalThis.FamilyPlannerFetchPage = async () => PAGE;
  assert.strictEqual((await browser('POST', '/food/recipes/from-link', { url: 'https://example.org/chilli' })).body.name, 'Easy chilli con carne');
});

test('fetching a page: only public http(s) addresses, 2 MB at most, redirects checked too', async (t) => {
  // The fetcher's timeout timer doesn't keep Node running by itself (a server would).
  const awake = setInterval(() => {}, 1000);
  t.after(() => clearInterval(awake));
  for (const a of ['127.0.0.1', '10.1.2.3', '192.168.1.10', '172.20.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1']) {
    assert.ok(isPrivateAddress(a), a);
  }
  for (const a of ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946', '8.8.8.8']) assert.ok(!isPrivateAddress(a), a);

  const dns = { 'good.example': ['93.184.216.34'], 'sneaky.example': ['10.0.0.5'], 'big.example': ['93.184.216.35'], 'hop.example': ['93.184.216.36'] };
  const lookup = async (h) => dns[h] || (/^[\d.]+$/.test(h) ? [h] : Promise.reject(new Error('ENOTFOUND')));
  const fetched = [];
  const fakeFetch = async (url, opts) => {
    fetched.push(url);
    assert.strictEqual(opts.redirect, 'manual');
    assert.ok(opts.signal);
    const host = new URL(url).hostname;
    if (host === 'hop.example') return new Response(null, { status: 302, headers: { location: 'http://sneaky.example/admin' } });
    if (host === 'big.example') return new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(512 * 1024)); } }), { headers: { 'content-type': 'text/html' } });
    return new Response('<h1>Hi</h1>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  const get = makeFetchPage({ lookup, fetch: fakeFetch });
  assert.strictEqual(await get('https://good.example/recipe'), '<h1>Hi</h1>');
  const refused = async (url, status) => {
    await assert.rejects(get(url), (e) => e.status === status, url);
  };
  await refused('http://127.0.0.1/', 400);
  await refused('http://localhost:3000/api/v1/export', 400);
  await refused('http://sneaky.example/', 400);
  await refused('ftp://good.example/', 400);
  await refused('http://user:pw@good.example/', 400);
  await refused('http://hop.example/', 400);
  await refused('https://big.example/', 413);
  await refused('https://nowhere.example/', 502);
  assert.ok(!fetched.some((u) => /sneaky|127\.0\.0\.1|localhost/.test(u)), 'private addresses are never fetched');

  const slow = makeFetchPage({ lookup, timeoutMs: 50, fetch: (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))) });
  await assert.rejects(slow('https://good.example/'), (e) => e.status === 504);
});

// ---- backups ----

test('backups keep leftovers, the freezer, ratings and lunchbox settings', async (t) => {
  const call = await start(t);
  const ava = (await call('POST', '/family/children', { name: 'Ava', birthDate: '2017-05-01' })).body;
  await call('POST', '/food/leftovers', { recipeId: 'chilli', portions: 3, freeze: true });
  await call('POST', '/food/ratings', { recipeId: 'chilli', ratings: [{ personId: ava.id, score: -1 }] });
  await call('PUT', '/food/lunchbox/wont-eat', { childId: ava.id, foods: ['tuna'] });
  const backup = (await call('GET', '/export')).body;
  assert.strictEqual(backup.data.food.ratings.length, 1);
  assert.deepStrictEqual(backup.data.food.lunchbox.wontEat[ava.id], ['tuna']);
  assert.ok(backup.data.food.pantry.some((p) => p.leftover && p.frozen));

  const other = await start(t);
  assert.strictEqual((await other('POST', '/import', backup)).status, 200);
  assert.deepStrictEqual((await other('GET', '/export')).body.data.food, backup.data.food);
  assert.strictEqual((await other('GET', '/food/ratings')).body.recipes.chilli.down, 1);
  assert.strictEqual((await other('POST', '/import', { app: 'family-planner', data: { food: { ratings: 'lots' } } })).status, 400);
  // An older backup without these is fine.
  assert.strictEqual((await other('POST', '/import', { app: 'family-planner', data: { food: { pantry: [], recipes: [], favourites: [] } } })).status, 200);
  assert.strictEqual((await other('GET', '/food/lunchbox')).status, 200);
});
