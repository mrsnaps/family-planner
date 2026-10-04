// Lunchbox planner (the rules version): a main, a snack, some fruit or veg and a drink for
// each school-age child, Monday to Friday, from what's in. It varies things through the week,
// keeps to the family's diet, and leaves out whatever a child won't eat. Anything it can't
// fill from the cupboards goes on a "to buy" list.
const { suitsDiet } = require('./diet');

const SCHOOL_AGE = 4;
const DAYS = 5;

const has = (name, words) => words.some((w) => new RegExp(`\\b${w}`, 'i').test(name));
// Cooking ingredients, not lunchbox food (raw meat, tins of tomatoes, stock...).
const NOT_LUNCHBOX = ['chopped', 'tinned', 'puree', 'passata', 'frozen', 'stock', 'sauce', 'paste', 'powder', 'flour', 'black pepper', 'white pepper', 'mince', 'raw', 'breast', 'thigh', 'fillet', 'whole chicken', 'drumstick'];

// What a pantry item can be in a lunchbox. Order matters: the first match wins.
const KINDS = [
  ['drink', ['juice', 'squash', 'smoothie', 'milkshake', 'water bottle', 'carton']],
  ['snack', ['crisp', 'cracker', 'rice cake', 'oatcake', 'biscuit', 'cookie', 'flapjack', 'cereal bar', 'granola bar', 'breadstick', 'popcorn', 'cheese string', 'babybel', 'yoghurt', 'yogurt', 'fromage frais', 'muffin', 'scone', 'malt loaf', 'pretzel', 'cake']],
  ['carrier', ['bread', 'loaf', 'roll', 'bagel', 'wrap', 'tortilla', 'pitta', 'pita', 'baguette', 'sub', 'pasta', 'penne', 'fusilli', 'macaroni']],
  ['fruit', ['apple', 'banana', 'grape', 'satsuma', 'clementine', 'tangerine', 'orange', 'pear', 'plum', 'strawberr', 'blueberr', 'raspberr', 'berries', 'melon', 'kiwi', 'raisin', 'sultana', 'mango', 'peach', 'nectarine', 'apricot', 'pineapple']],
  ['veg', ['carrot', 'cucumber', 'cherry tomato', 'pepper', 'sugar snap', 'mangetout', 'celery', 'sweetcorn']],
  ['filling', ['ham', 'cheese', 'cheddar', 'tuna', 'egg', 'chicken', 'turkey', 'hummus', 'houmous', 'peanut butter', 'jam', 'cream cheese', 'salami', 'falafel', 'quorn']],
];

function kindOf(name) {
  const n = String(name).toLowerCase();
  if (has(n, NOT_LUNCHBOX)) return null;
  for (const [kind, words] of KINDS) if (has(n, words)) return kind;
  return null;
}

// Rough number of lunchboxes an amount will stretch to.
function servingsOf(item) {
  const q = Number(item.quantity);
  if (item.quantity === null || item.quantity === undefined || item.quantity === '' || !Number.isFinite(q)) return 10; // amount unknown
  const unit = String(item.unit || 'pcs').toLowerCase();
  const kind = kindOf(item.name);
  if (unit === 'g') return Math.floor(q / (kind === 'carrier' ? 75 : 30));
  if (unit === 'kg') return Math.floor((q * 1000) / (kind === 'carrier' ? 75 : 30));
  if (unit === 'ml') return Math.floor(q / 200);
  if (unit === 'l') return Math.floor((q * 1000) / 200);
  if (unit === 'tin' || unit === 'can') return Math.floor(q * 2);
  if (unit === 'pack') return Math.floor(q * (kind === 'carrier' ? 8 : 6));
  // Two slices of bread make one sandwich.
  if (kind === 'carrier' && /bread|loaf/i.test(item.name)) return Math.floor(q / 2);
  return Math.floor(q);
}

const tidy = (name) => String(name).trim().replace(/\s+/g, ' ');
const lower = (name) => tidy(name).charAt(0).toLowerCase() + tidy(name).slice(1);
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function carrierWord(name) {
  const n = name.toLowerCase();
  if (/wrap|tortilla/.test(n)) return 'wrap';
  if (/pitta|pita/.test(n)) return 'pitta';
  if (/bagel/.test(n)) return 'bagel';
  if (/roll|baguette|sub\b/.test(n)) return 'roll';
  if (/pasta|penne|fusilli|macaroni/.test(n)) return 'pasta salad';
  return 'sandwich';
}
// "Apples" -> "Apple" for things that come one to a lunchbox; crisps and grapes stay as they are.
const one = (name) => tidy(name).replace(/\b(apple|banana|pear|satsuma|clementine|tangerine|orange|plum|peach|nectarine|kiwi|yoghurt|yogurt|carton|bar|muffin|scone|babybel|string|pot)s\b/i, '$1');
// "Eggs" -> "Egg", "Cheddar" -> "Cheese", for "Egg sandwich" and "Cheese wrap".
function fillingName(name) {
  const n = name.toLowerCase();
  if (/\beggs?\b/.test(n)) return 'Egg';
  if (/cheddar|mozzarella|red leicester|edam|gouda/.test(n) && !/cream cheese/.test(n)) return 'Cheese';
  if (/cooked chicken|chicken/.test(n)) return 'Chicken';
  return capital(lower(name));
}
const vegName = (name) => (/stick|slice|cherry tomato|sugar snap|mangetout|sweetcorn/i.test(name) ? tidy(name) : `${tidy(name).replace(/s$/i, '')} sticks`);

// Simple things to buy when a slot can't be filled, picked to suit the diet and the child.
const DEFAULTS = {
  carrier: ['Bread', 'Wraps', 'Rice cakes'],
  filling: ['Ham', 'Cheese', 'Hummus'],
  snack: ['Crackers', 'Yoghurts', 'Rice cakes'],
  fruit: ['Apples', 'Bananas', 'Satsumas'],
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function nextSchoolDays(today, n = DAYS) {
  const out = [];
  const d = new Date(today + 'T12:00:00Z');
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push({ date: d.toISOString().slice(0, 10), day: WEEKDAYS[wd] });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// Other names a disliked food goes by in the cupboard.
const ALSO = { cheese: ['cheddar', 'mozzarella', 'babybel', 'edam', 'gouda', 'red leicester', 'cheese string'], tomato: ['cherry tomato'], fish: ['tuna', 'salmon'], egg: ['eggs'] };
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const dislikes = (name, list) => (list || []).some((w) => {
  const word = String(w).trim().toLowerCase().replace(/oes$/, 'o').replace(/s$/, '');
  if (!word) return false;
  return [word, ...(ALSO[word] || [])].some((x) => new RegExp(`\\b${escapeRe(x)}`, 'i').test(name));
});

// The diet rules know dinner ingredients; a few lunchbox foods need adding.
const EXTRA = {
  'dairy-free': /babybel|fromage frais|milkshake|cheese/i,
  'gluten-free': /cracker|biscuit|cookie|breadstick|pretzel|muffin|scone|bagel|\broll|pitta|pita|baguette|flapjack|malt loaf|(?<!rice )cake/i,
  'nut-free': /nutella|peanut|almond|cashew|hazelnut/i,
  vegetarian: /salami|chorizo|pepperoni|ham\b|chicken|turkey|tuna/i,
};
const suits = (name, dietary) => {
  const n = String(name).toLowerCase();
  if (dietary.includes('gluten-free') && /gluten[- ]free/.test(n)) return dietary.filter((d) => d !== 'gluten-free').every((d) => suits(n, [d]));
  return suitsDiet({ ingredients: [{ name: n }] }, dietary) && !dietary.some((d) => EXTRA[d] && EXTRA[d].test(n));
};

// Everything in the kitchen that could go in a lunchbox, with how many boxes it'll fill.
function lunchboxFood(pantry, today) {
  return pantry
    .filter((p) => !p.leftover && !p.frozen && p.quantity !== 0 && kindOf(p.name))
    .filter((p) => !p.expiry || p.expiry >= today)
    .map((p) => ({ id: p.id, name: tidy(p.name), kind: kindOf(p.name), left: servingsOf(p), expiry: p.expiry || null }))
    .filter((f) => f.left > 0);
}

// children: [{ id, name, age }]; dislikes: { [childId]: [food words] } (won't-eat list plus
// foods from dinners they aren't keen on).
function planLunchboxes({ pantry = [], children = [], dietary = [], dislikes: dislikeMap = {}, today = new Date().toISOString().slice(0, 10) } = {}) {
  const days = nextSchoolDays(today);
  const food = lunchboxFood(pantry, today).filter((f) => suits(f.name, dietary));
  const school = children.filter((c) => c.age === null || c.age === undefined || c.age >= SCHOOL_AGE);
  const notYet = children.filter((c) => !school.includes(c)).map((c) => c.name);
  const missing = new Map();
  const want = (kind, childDislikes, slot) => {
    const name = DEFAULTS[kind].find((n) => suits(n, dietary) && !dislikes(n, childDislikes));
    if (!name) return;
    const m = missing.get(name) || { name, for: slot, boxes: 0 };
    m.boxes++;
    missing.set(name, m);
  };


  // Each child keeps count of what they've had, so their week varies.
  const kids = school.map((child) => ({ child, no: dislikeMap[child.id] || [], used: new Map(), lastDay: new Map(), days: [] }));

  // Day by day, sharing out the food between the children as we go.
  days.forEach((day, d) => {
    for (const k of kids) {
      const fresh = (f) => f.left > 0 && (!f.expiry || f.expiry >= day.date) && !dislikes(f.name, k.no);
      // Least used this week first, not the same as yesterday, then whatever goes off first.
      const pick = (kind) => food.filter((f) => f.kind === kind && fresh(f)).sort((a, b) =>
        (k.used.get(a.id) || 0) - (k.used.get(b.id) || 0) ||
        Number(k.lastDay.get(a.id) === d - 1) - Number(k.lastDay.get(b.id) === d - 1) ||
        (a.expiry || '9999').localeCompare(b.expiry || '9999') ||
        b.left - a.left)[0] || null;
      const take = (f) => {
        f.left--;
        k.used.set(f.id, (k.used.get(f.id) || 0) + 1);
        k.lastDay.set(f.id, d);
      };
      const box = { date: day.date, day: day.day, main: null, snack: null, fruit: null, drink: null };
      // Main: a filling in bread, a wrap, a roll or pasta.
      const carrier = pick('carrier');
      const filling = pick('filling');
      if (carrier && filling) {
        take(carrier);
        take(filling);
        box.main = { name: `${fillingName(filling.name)} ${carrierWord(carrier.name)}`, uses: [carrier.name, filling.name] };
      } else {
        if (!carrier) want('carrier', k.no, 'main');
        if (!filling) want('filling', k.no, 'main');
      }
      const snack = pick('snack');
      if (snack) {
        take(snack);
        box.snack = { name: one(snack.name), uses: [snack.name] };
      } else want('snack', k.no, 'snack');
      // Fruit most days; veg sticks for a change when there are some.
      const fruit = pick('fruit');
      const veg = pick('veg');
      const fv = d % 2 === 0 ? fruit || veg : veg || fruit;
      if (fv) {
        take(fv);
        box.fruit = { name: fv.kind === 'veg' ? capital(lower(vegName(fv.name))) : one(fv.name), uses: [fv.name] };
      } else want('fruit', k.no, 'fruit');
      // Water most days, with a carton or juice now and then.
      const drink = d % 2 === 1 ? pick('drink') : null;
      if (drink) {
        take(drink);
        box.drink = { name: one(drink.name), uses: [drink.name] };
      } else box.drink = { name: 'Water', uses: [] };
      k.days.push(box);
    }
  });

  return {
    days,
    children: kids.map((k) => ({ childId: k.child.id, name: k.child.name, days: k.days })),
    notAtSchool: notYet,
    missing: [...missing.values()],
  };
}

module.exports = { planLunchboxes, kindOf, servingsOf, lunchboxFood, nextSchoolDays, dislikes, suits, SCHOOL_AGE };
