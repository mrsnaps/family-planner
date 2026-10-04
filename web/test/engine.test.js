const test = require('node:test');
const assert = require('node:assert');
const recipes = require('../modules/food/recipes');
const { suggestMeals, estimateMeals, cook, conceptsFor, buildIndex } = require('../modules/food/engine');
const { parseSize, nextSize, compareSize, predictOutgrow } = require('../modules/clothes/sizes');
const { outfitsFor, childStats } = require('../modules/clothes/engine');
const { portions } = require('../modules/family');

const index = buildIndex(recipes);
const pantry = [
  { id: 'a', name: 'Spaghetti', quantity: 1, unit: 'kg' },
  { id: 'b', name: 'Beef mince', quantity: 500, unit: 'g' },
  { id: 'c', name: 'Chopped tomatoes', quantity: 2, unit: 'tin' },
  { id: 'd', name: 'Onions', quantity: 3, unit: 'pcs' },
];

test('pantry names map to the most specific ingredient', () => {
  assert.deepStrictEqual([...conceptsFor('Coconut milk', index)], ['coconut milk']);
  assert.deepStrictEqual([...conceptsFor('Semi skimmed milk', index)], ['milk']);
  assert.deepStrictEqual([...conceptsFor('Red pepper', index)], ['pepper']);
  assert.ok(!conceptsFor('Black pepper', index).has('pepper'));
  assert.deepStrictEqual([...conceptsFor('Chicken stock cube', index)], ['stock']);
  assert.deepStrictEqual([...conceptsFor('Potatoes', index)], ['potatoes']);
});

test('suggests ready meals first', () => {
  const meals = suggestMeals(pantry, recipes, 4);
  assert.strictEqual(meals[0].status, 'ready');
  assert.ok(meals.some((m) => m.id === 'spag-bol' && m.status === 'ready'));
});

test('meal estimate shrinks as the family grows', () => {
  const small = estimateMeals(pantry, recipes, 2).mealsLeft;
  const big = estimateMeals(pantry, recipes, 6).mealsLeft;
  assert.ok(small > big, `${small} should be more than ${big}`);
  assert.strictEqual(estimateMeals([], recipes, 4).mealsLeft, 0);
});

test('cooking deducts scaled ingredients', () => {
  const recipe = recipes.find((r) => r.id === 'spag-bol');
  const res = cook(pantry, recipe, 2, recipes);
  assert.ok(res.ok);
  const by = Object.fromEntries(res.pantry.map((p) => [p.id, p.quantity]));
  assert.strictEqual(by.a, 0.8); // 200g of 1kg
  assert.strictEqual(by.b, 250);
  assert.strictEqual(by.c, 1);
});

test('family portions weight children by age', () => {
  const now = new Date('2026-10-04');
  const fam = { adults: 2, children: [{ birthDate: '2024-01-01' }, { birthDate: '2019-01-01' }, { birthDate: '2012-01-01' }] };
  assert.strictEqual(portions(fam, now), 2 + 0.5 + 0.75 + 1);
});

test('size bands parse and step', () => {
  assert.strictEqual(parseSize('6-7y').label, '6-7Y');
  assert.strictEqual(nextSize('18-24M'), '2-3Y');
  assert.strictEqual(compareSize('4-5Y', '6-7Y'), -1);
  assert.strictEqual(compareSize('7-8Y', '6-7Y'), 1);
  assert.strictEqual(compareSize('6-7Y', '6-7Y'), 0);
  assert.strictEqual(parseSize('large'), null);
});

test('forecast uses the child age when it sits in the band', () => {
  const f = predictOutgrow({ clothingSize: '6-7Y', birthDate: '2020-05-01', sizeRecordedAt: '2026-10-04' }, new Date('2026-10-04'));
  assert.strictEqual(f.nextSize, '7-8Y');
  assert.strictEqual(f.date, '2027-05-01');
});

test('outfits only use clothes that fit and flag clashes', () => {
  const child = { id: 'k', clothingSize: '6-7Y' };
  const items = [
    { id: '1', childId: 'k', type: 'top', name: 'Pink tee', colour: 'pink', size: '6-7Y' },
    { id: '2', childId: 'k', type: 'bottom', name: 'Jeans', colour: 'denim', size: '6-7Y' },
    { id: '3', childId: 'k', type: 'bottom', name: 'Red shorts', colour: 'red', size: '6-7Y' },
    { id: '4', childId: 'k', type: 'bottom', name: 'Old jeans', colour: 'denim', size: '4-5Y' },
    { id: '5', childId: 'k', type: 'dress', name: 'Summer dress', colour: 'yellow', size: '6-7Y', season: 'summer' },
  ];
  const r = outfitsFor(child, items);
  assert.strictEqual(r.total, 3);
  assert.strictEqual(r.outfits[0].items[1].name, 'Jeans');
  assert.ok(r.outfits.at(-1).notes.length);
  assert.strictEqual(outfitsFor(child, items, { season: 'winter' }).total, 2);

  const s = childStats(child, items, { top: 2, bottom: 2 });
  assert.strictEqual(s.outgrown, 1);
  assert.deepStrictEqual(s.shortfall, {}); // the dress counts as a top and a bottom
});
