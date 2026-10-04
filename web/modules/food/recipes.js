// Built-in, family-friendly recipes. Quantities are for `servings` adult portions.
// Ingredient `name` is matched against pantry item names (see engine.matches);
// `aliases` lists other pantry names that also count.
const r = (id, name, minutes, tags, ingredients, servings = 4) => ({
  id, name, minutes, tags, servings, builtin: true, ingredients,
});
const i = (name, qty, unit, extra = {}) => ({ name, qty, unit, ...extra });

const PASTA = { aliases: ['spaghetti', 'penne', 'fusilli', 'macaroni', 'linguine', 'tagliatelle'] };
const MINCE = { aliases: ['minced beef', 'beef mince', 'ground beef', 'turkey mince'] };
const TOMS = { aliases: ['chopped tomatoes', 'tinned tomatoes', 'canned tomatoes', 'passata'] };
const CHEESE = { aliases: ['cheddar', 'mozzarella', 'parmesan'] };
const RICE = { aliases: ['basmati', 'long grain rice'] };
const WRAPS = { aliases: ['tortilla', 'tortillas'] };
const SAUSAGE = { aliases: ['sausages'] };

module.exports = [
  r('spag-bol', 'Spaghetti bolognese', 40, ['dinner'], [
    i('pasta', 400, 'g', PASTA), i('mince', 500, 'g', MINCE), i('tomatoes', 2, 'tin', TOMS),
    i('onion', 1, 'pcs'), i('garlic', 2, 'pcs', { optional: true }), i('carrot', 1, 'pcs', { optional: true }),
  ]),
  r('mac-cheese', 'Macaroni cheese', 30, ['dinner', 'vegetarian'], [
    i('pasta', 350, 'g', PASTA), i('cheese', 200, 'g', CHEESE), i('milk', 600, 'ml'),
    i('butter', 50, 'g'), i('flour', 50, 'g'),
  ]),
  r('tomato-pasta', 'Tomato pasta', 20, ['dinner', 'vegetarian', 'quick'], [
    i('pasta', 400, 'g', PASTA), i('tomatoes', 1, 'tin', TOMS), i('onion', 1, 'pcs'),
    i('garlic', 2, 'pcs', { optional: true }), i('cheese', 50, 'g', { ...CHEESE, optional: true }),
  ]),
  r('chilli', 'Chilli con carne', 45, ['dinner'], [
    i('mince', 500, 'g', MINCE), i('kidney beans', 1, 'tin'), i('tomatoes', 1, 'tin', TOMS),
    i('onion', 1, 'pcs'), i('rice', 300, 'g', RICE), i('pepper', 1, 'pcs', { optional: true, aliases: ['bell pepper', 'red pepper', 'green pepper'] }),
  ]),
  r('cottage-pie', 'Cottage pie', 60, ['dinner'], [
    i('mince', 500, 'g', MINCE), i('potatoes', 1000, 'g', { aliases: ['potato'] }), i('onion', 1, 'pcs'),
    i('carrot', 2, 'pcs'), i('peas', 150, 'g', { optional: true }), i('butter', 30, 'g'), i('milk', 100, 'ml'),
  ]),
  r('chicken-curry', 'Mild chicken curry', 40, ['dinner'], [
    i('chicken', 500, 'g', { aliases: ['chicken breast', 'chicken thighs'] }), i('rice', 300, 'g', RICE),
    i('onion', 1, 'pcs'), i('coconut milk', 1, 'tin'), i('curry paste', 2, 'tbsp', { optional: true, aliases: ['curry powder'] }),
  ]),
  r('chicken-stir-fry', 'Chicken stir fry', 25, ['dinner', 'quick'], [
    i('chicken', 400, 'g', { aliases: ['chicken breast', 'chicken thighs'] }), i('noodles', 300, 'g', { aliases: ['egg noodles', 'rice noodles'] }),
    i('pepper', 1, 'pcs', { aliases: ['bell pepper', 'red pepper', 'green pepper'] }), i('carrot', 1, 'pcs'),
    i('soy sauce', 3, 'tbsp', { optional: true }),
  ]),
  r('roast-chicken', 'Roast chicken dinner', 100, ['dinner', 'sunday'], [
    i('whole chicken', 1, 'pcs'), i('potatoes', 1000, 'g', { aliases: ['potato'] }), i('carrot', 3, 'pcs'),
    i('broccoli', 1, 'pcs', { optional: true }), i('gravy', 1, 'pack', { optional: true, aliases: ['gravy granules'] }),
  ]),
  r('fish-fingers', 'Fish fingers, chips and peas', 25, ['dinner', 'quick'], [
    i('fish fingers', 12, 'pcs'), i('chips', 600, 'g', { aliases: ['oven chips'] }), i('peas', 300, 'g'),
  ]),
  r('sausage-mash', 'Sausage and mash', 35, ['dinner'], [
    i('sausage', 8, 'pcs', SAUSAGE), i('potatoes', 1000, 'g', { aliases: ['potato'] }), i('butter', 30, 'g'),
    i('milk', 100, 'ml'), i('peas', 200, 'g', { optional: true }), i('gravy', 1, 'pack', { optional: true, aliases: ['gravy granules'] }),
  ]),
  r('toad-hole', 'Toad in the hole', 45, ['dinner'], [
    i('sausage', 8, 'pcs', SAUSAGE), i('eggs', 3, 'pcs', { aliases: ['egg'] }), i('flour', 140, 'g'), i('milk', 200, 'ml'),
  ]),
  r('jacket-potatoes', 'Jacket potatoes with beans and cheese', 70, ['dinner', 'vegetarian'], [
    i('potatoes', 4, 'pcs', { aliases: ['potato', 'baking potatoes'] }), i('baked beans', 2, 'tin'),
    i('cheese', 120, 'g', CHEESE),
  ]),
  r('omelette', 'Cheese omelette', 10, ['lunch', 'vegetarian', 'quick'], [
    i('eggs', 8, 'pcs', { aliases: ['egg'] }), i('cheese', 100, 'g', CHEESE), i('butter', 20, 'g', { optional: true }),
  ]),
  r('egg-fried-rice', 'Egg fried rice', 20, ['dinner', 'vegetarian', 'quick'], [
    i('rice', 300, 'g', RICE), i('eggs', 4, 'pcs', { aliases: ['egg'] }), i('peas', 150, 'g'),
    i('soy sauce', 3, 'tbsp', { optional: true }), i('spring onion', 2, 'pcs', { optional: true }),
  ]),
  r('beans-toast', 'Beans on toast', 10, ['lunch', 'vegetarian', 'quick'], [
    i('bread', 8, 'pcs', { aliases: ['loaf'] }), i('baked beans', 2, 'tin'), i('butter', 20, 'g', { optional: true }),
  ]),
  r('cheese-toasties', 'Cheese toasties', 10, ['lunch', 'vegetarian', 'quick'], [
    i('bread', 8, 'pcs', { aliases: ['loaf'] }), i('cheese', 150, 'g', CHEESE), i('butter', 30, 'g'),
  ]),
  r('tuna-pasta-bake', 'Tuna pasta bake', 35, ['dinner'], [
    i('pasta', 350, 'g', PASTA), i('tuna', 2, 'tin'), i('sweetcorn', 1, 'tin'), i('cheese', 120, 'g', CHEESE),
    i('tomatoes', 1, 'tin', TOMS),
  ]),
  r('fajitas', 'Chicken fajitas', 25, ['dinner', 'quick'], [
    i('chicken', 400, 'g', { aliases: ['chicken breast', 'chicken thighs'] }), i('wraps', 8, 'pcs', WRAPS),
    i('pepper', 2, 'pcs', { aliases: ['bell pepper', 'red pepper', 'green pepper'] }), i('onion', 1, 'pcs'),
    i('cheese', 80, 'g', { ...CHEESE, optional: true }),
  ]),
  r('quesadillas', 'Bean and cheese quesadillas', 15, ['lunch', 'vegetarian', 'quick'], [
    i('wraps', 8, 'pcs', WRAPS), i('cheese', 150, 'g', CHEESE), i('kidney beans', 1, 'tin', { aliases: ['black beans', 'refried beans'] }),
  ]),
  r('pizza-wraps', 'Wrap pizzas', 15, ['dinner', 'quick'], [
    i('wraps', 4, 'pcs', WRAPS), i('tomato puree', 4, 'tbsp', { aliases: ['passata', 'pizza sauce'] }),
    i('cheese', 150, 'g', CHEESE), i('ham', 100, 'g', { optional: true }),
  ]),
  r('pancakes', 'Pancakes', 20, ['breakfast', 'vegetarian'], [
    i('flour', 200, 'g'), i('eggs', 2, 'pcs', { aliases: ['egg'] }), i('milk', 300, 'ml'),
  ]),
  r('porridge', 'Porridge', 10, ['breakfast', 'vegetarian', 'quick'], [
    i('oats', 200, 'g', { aliases: ['porridge oats', 'rolled oats'] }), i('milk', 800, 'ml'),
    i('banana', 2, 'pcs', { optional: true }),
  ]),
  r('veg-soup', 'Vegetable soup and bread', 40, ['lunch', 'vegetarian'], [
    i('carrot', 3, 'pcs'), i('potatoes', 400, 'g', { aliases: ['potato'] }), i('onion', 1, 'pcs'),
    i('stock', 1, 'pcs', { aliases: ['stock cube'] }), i('bread', 4, 'pcs', { optional: true, aliases: ['loaf'] }),
  ]),
  r('salmon-rice', 'Salmon, rice and broccoli', 25, ['dinner', 'quick'], [
    i('salmon', 4, 'pcs', { aliases: ['salmon fillets'] }), i('rice', 300, 'g', RICE), i('broccoli', 1, 'pcs'),
  ]),
  r('ham-sandwiches', 'Ham sandwiches', 5, ['lunch', 'quick'], [
    i('bread', 8, 'pcs', { aliases: ['loaf'] }), i('ham', 150, 'g'), i('butter', 20, 'g', { optional: true }),
  ]),
];
