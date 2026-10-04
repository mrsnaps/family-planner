// Diet flags and food groups worked out from ingredient names. Rough by design:
// good enough to filter meal ideas and show a weekly balance, not medical advice.
const MEAT = ['chicken', 'beef', 'mince', 'pork', 'lamb', 'sausage', 'bacon', 'ham', 'turkey', 'fish', 'salmon', 'tuna', 'cod', 'prawn', 'steak', 'gravy'];
const DAIRY = ['milk', 'cheese', 'cheddar', 'mozzarella', 'parmesan', 'butter', 'cream', 'yoghurt', 'yogurt'];
const GLUTEN = ['pasta', 'spaghetti', 'macaroni', 'bread', 'flour', 'wrap', 'tortilla', 'noodle', 'fish finger', 'sausage', 'gravy', 'stock', 'soy sauce', 'couscous', 'oat'];
const NUTS = ['peanut', 'almond', 'cashew', 'hazelnut', 'walnut', 'pecan', 'pistachio', 'nut'];
const DAIRY_FREE_MILKS = ['coconut milk', 'oat milk', 'soy milk', 'almond milk'];

const VEG = ['onion', 'garlic', 'carrot', 'potato', 'pepper', 'broccoli', 'pea', 'tomato', 'sweetcorn', 'spinach', 'mushroom', 'courgette', 'leek', 'bean', 'lettuce', 'cucumber', 'banana', 'apple', 'spring onion'];
const PROTEIN = [...MEAT.filter((m) => m !== 'gravy'), 'egg', 'bean', 'lentil', 'tofu', 'chickpea'];
const CARBS = ['pasta', 'spaghetti', 'rice', 'potato', 'bread', 'wrap', 'noodle', 'chips', 'oat', 'flour', 'couscous'];

const has = (name, words) => words.some((w) => name.includes(w));

function dietFlags(recipe) {
  const names = recipe.ingredients.filter((i) => !i.optional).map((i) => i.name.toLowerCase());
  const dairy = names.some((n) => has(n, DAIRY) && !has(n, DAIRY_FREE_MILKS));
  const flags = [];
  if (!names.some((n) => has(n, MEAT))) flags.push('vegetarian');
  if (!dairy) flags.push('dairy-free');
  if (!names.some((n) => has(n, GLUTEN))) flags.push('gluten-free');
  if (!names.some((n) => has(n, NUTS))) flags.push('nut-free');
  return flags;
}

const DIETS = ['vegetarian', 'dairy-free', 'gluten-free', 'nut-free'];

function suitsDiet(recipe, needs) {
  if (!needs || !needs.length) return true;
  const flags = dietFlags(recipe);
  return needs.every((d) => flags.includes(d));
}

function groupsOf(recipe) {
  const names = recipe.ingredients.map((i) => i.name.toLowerCase());
  return {
    veg: names.some((n) => has(n, VEG)),
    protein: names.some((n) => has(n, PROTEIN)),
    carbs: names.some((n) => has(n, CARBS)),
    dairy: names.some((n) => has(n, DAIRY) && !has(n, DAIRY_FREE_MILKS)),
  };
}

// How balanced the next week of planned meals is.
function weekBalance(planRecipes) {
  const week = planRecipes.slice(0, 7);
  const count = { veg: 0, protein: 0, carbs: 0, dairy: 0 };
  for (const r of week) {
    const g = groupsOf(r);
    for (const k of Object.keys(count)) if (g[k]) count[k]++;
  }
  const meals = week.length;
  const tips = [];
  if (meals) {
    if (count.veg < meals * 0.7) tips.push('Add veg or a side salad to a few meals.');
    if (count.protein < meals * 0.6) tips.push('Some meals are light on protein: eggs, beans or meat would help.');
    if (count.dairy > meals * 0.8) tips.push('Lots of cheese and dairy this week.');
  }
  return { meals, ...count, tips };
}

module.exports = { dietFlags, suitsDiet, groupsOf, weekBalance, DIETS };
