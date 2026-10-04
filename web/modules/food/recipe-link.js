// Recipe from a link: turns a recipe web page into the app's recipe shape, ready to check
// and save. Most recipe sites describe the recipe for search engines as schema.org JSON-LD;
// when a page doesn't, or someone pastes plain text, the lines after "Ingredients" (up to
// "Method" or "Instructions") are used instead.
// Nothing here touches the network: fetching the page is done by whoever calls it.

// ---- text helpers --------------------------------------------------------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', frac12: '½', frac14: '¼', frac34: '¾', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', deg: '°', eacute: 'é', egrave: 'è' };
function decode(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const stripTags = (s) => decode(String(s ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// HTML to lines of text, keeping line breaks where the page has them.
function htmlToLines(html) {
  const text = String(html)
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|ul|ol|dt|dd)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
  return decode(text).split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// ---- durations and yields ------------------------------------------------
// ISO 8601 durations: PT1H30M, P0DT0H45M, PT90M. Returns whole minutes, or null.
function parseDuration(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(String(v ?? '').trim());
  if (!m || !m.slice(1).some(Boolean)) return null;
  const [d, h, min, s] = m.slice(1).map((x) => Number(x || 0));
  return Math.round(d * 1440 + h * 60 + min + s / 60);
}

function parseYield(v) {
  for (const x of Array.isArray(v) ? v : [v]) {
    if (typeof x === 'number' && x > 0) return Math.round(x);
    const m = /(\d+)/.exec(String(x ?? ''));
    if (m && Number(m[1]) > 0) return Number(m[1]);
  }
  return null;
}

// ---- ingredient lines ----------------------------------------------------
const FRACTIONS = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅕': 0.2, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
// Unit words -> [app unit, multiplier]. The app counts in g, ml, tbsp, tsp, tin, pack and pcs.
const UNIT_WORDS = [
  [/^(kg|kgs|kilo|kilos|kilograms?)$/, 'kg', 1], [/^(g|gr|grams?|grammes?)$/, 'g', 1],
  [/^(mg)$/, 'g', 0.001],
  [/^(l|ltr|litres?|liters?)$/, 'l', 1], [/^(ml|millilitres?|milliliters?|mls)$/, 'ml', 1], [/^(cl)$/, 'ml', 10],
  [/^(tbsp|tbsps|tbs|tbl|tablespoons?|tblsp)$/, 'tbsp', 1], [/^(tsp|tsps|teaspoons?)$/, 'tsp', 1],
  [/^(dsp|dessertspoons?)$/, 'tsp', 2],
  [/^(cups?)$/, 'ml', 240], [/^(oz|ounces?)$/, 'g', 28], [/^(lb|lbs|pounds?)$/, 'g', 454], [/^(fl ?oz)$/, 'ml', 30],
  [/^(tins?|cans?)$/, 'tin', 1], [/^(packs?|packets?|pkts?|bags?|boxes|box|jars?|bottles?|tubs?|cartons?)$/, 'pack', 1],
  [/^(cloves?)$/, 'pcs', 1], [/^(slices?|rashers?|sprigs?|stalks?|sticks?|heads?|bunch|bunches|fillets?|pieces?|large|medium|small|whole|handfuls?|knobs?)$/, 'pcs', 1],
  [/^(pinch|pinches|dash|dashes|splash)$/, 'tsp', 0.25],
];
// Words that describe the unit but belong with the name ("2 cloves garlic" -> garlic).
const KEEP_AS_NAME = /^(large|medium|small|whole)$/;
const PREP = /^(large|medium|small|big|fresh|freshly|finely|roughly|thinly|thickly|chopped|diced|sliced|grated|crushed|minced|peeled|deseeded|beaten|softened|melted|cooked|uncooked|dried|ripe|good|quality|heaped|level|rounded|of|a|an|about|approx\.?|approximately|plus|extra)$/i;

function readNumber(str) {
  let s = str.replace(/(\d)\s*([½⅓⅔¼¾⅕⅛⅜⅝⅞])/g, (m, d, f) => `${d}+${FRACTIONS[f]}`)
    .replace(/[½⅓⅔¼¾⅕⅛⅜⅝⅞]/g, (f) => String(FRACTIONS[f]));
  // "1 1/2", "1/2", "1.5", "1,5", "2-3", "2 to 3", "1+0.5"
  const m = /^\s*(\d+(?:[.,]\d+)?(?:\+\d*\.?\d+)?)(?:\s+(\d+)\/(\d+)|\/(\d+))?(?:\s*(?:-|–|to)\s*\d+(?:[.,]\d+)?(?:\/\d+)?)?/.exec(s);
  if (!m) return null;
  let n = m[1].includes('+') ? m[1].split('+').reduce((a, b) => a + Number(b), 0) : Number(m[1].replace(',', '.'));
  if (m[2]) n += Number(m[2]) / Number(m[3]);
  if (m[4]) n /= Number(m[4]);
  return { value: n, rest: s.slice(m[0].length) };
}

const unitFor = (word) => {
  const w = word.toLowerCase().replace(/\.$/, '');
  for (const [re, unit, mult] of UNIT_WORDS) if (re.test(w)) return { unit, mult, keep: KEEP_AS_NAME.test(w) };
  return null;
};

function cleanName(s) {
  let name = String(s)
    .replace(/\([^)]*\)/g, ' ') // (about 400g), (optional)
    .replace(/\[[^\]]*\]/g, ' ')
    .split(/,|;| - | – /)[0] // "1 onion, chopped"
    .replace(/\b(to serve|to taste|for (?:frying|greasing|dusting|the [a-z]+)|optional)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const words = name.split(' ');
  // "Chopped tomatoes" is something you buy, not something you do.
  while (words.length > 1 && PREP.test(words[0]) && !(words[0] === 'chopped' && /^tomato/.test(words[1]))) words.shift();
  while (words.length > 1 && /^(chopped|diced|sliced|grated|crushed|minced|peeled|to|or)$/.test(words[words.length - 1])) words.pop();
  name = words.join(' ').replace(/^(of|a|an)\s+/, '').replace(/\bcloves? of\b/, '').replace(/\bcloves?\b/, '').replace(/\s+/g, ' ').trim();
  return name;
}

// "2 tbsp olive oil" -> { name: 'olive oil', qty: 2, unit: 'tbsp' }. Forgiving: anything it
// can't measure becomes 1 of the thing, marked optional when it's a seasoning "to taste".
function parseIngredient(line) {
  const raw = stripTags(line).replace(/^[\s•*·\-–—▢□☐✓]+/, '').trim();
  if (!raw) return null;
  const optional = /\b(optional|to taste|to serve|for serving|for garnish|pinch of|a pinch)\b/i.test(raw);
  let qty = null;
  let unit = 'pcs';
  let rest = raw;
  const num = readNumber(raw);
  if (num) {
    qty = num.value;
    rest = num.rest.trim();
    // "2 x 400g tins of tomatoes": the count is what matters.
    const times = /^(?:x|×)\s*/i.exec(rest);
    if (times) {
      const inner = readNumber(rest.slice(times[0].length));
      if (inner) rest = inner.rest.trim();
      const pack = /^(?:[a-z]+\s+)?(tins?|cans?|packs?|packets?|jars?|bags?|cartons?|tubs?|bottles?)\b\s*(?:of\s+)?/i.exec(rest.replace(/^(g|kg|ml|l|oz|lb)\b\s*/i, ''));
      if (pack) {
        rest = rest.replace(/^(g|kg|ml|l|oz|lb)\b\s*/i, '').slice(pack[0].length);
        unit = unitFor(pack[1]).unit;
      } else {
        unit = 'pcs';
        rest = rest.replace(/^(g|kg|ml|l|oz|lb)\b\s*/i, '');
      }
      return finish(raw, rest, qty, unit, optional);
    }
    const um = /^([a-zA-Z]+\.?(?:\s?oz)?)\b\.?\s*/.exec(rest);
    const u = um && unitFor(um[1]);
    if (u) {
      rest = rest.slice(um[0].length).replace(/^\/\s*\d+(?:[.,]\d+)?\s*[a-z]+\.?\s*/i, ''); // "100g/4oz"
      if (u.keep) rest = `${um[1]} ${rest}`;
      // "400g tin chopped tomatoes", "500g pack of mince": one tin, not 400 of them.
      const pack = /^(tins?|cans?|packs?|packets?|jars?|bags?|cartons?|tubs?|bottles?)\b\s*(?:of\s+)?/i.exec(rest);
      if (pack && ['g', 'kg', 'ml', 'l'].includes(u.unit)) {
        rest = rest.slice(pack[0].length);
        unit = unitFor(pack[1]).unit;
        qty = 1;
      } else {
        unit = u.keep ? 'pcs' : u.unit;
        qty = u.keep ? qty : qty * u.mult;
        if (u.mult !== 1 && unit !== 'tsp') qty = Math.round(qty);
      }
    }
  } else {
    // "Pinch of salt", "A handful of spinach", "Salt and pepper"
    const lead = /^(?:a|an|one)\s+([a-z]+)\s+(?:of\s+)?/i.exec(raw) || /^([a-z]+)\s+of\s+/i.exec(raw);
    const u = lead && unitFor(lead[1]);
    if (u) {
      qty = u.mult;
      unit = u.unit;
      rest = raw.slice(lead[0].length);
    }
  }
  return finish(raw, rest, qty, unit, optional || qty === null);
}

function finish(raw, rest, qty, unit, optional) {
  const name = cleanName(rest) || cleanName(raw);
  if (!name) return null;
  const q = qty && qty > 0 ? Math.round(qty * 100) / 100 : 1;
  return { name: name.slice(0, 80), qty: q, unit, optional: Boolean(optional), original: raw.slice(0, 200) };
}

// ---- schema.org JSON-LD --------------------------------------------------
const isRecipe = (o) => o && typeof o === 'object' && [].concat(o['@type'] || []).some((t) => /(^|\/|:)Recipe$/i.test(String(t)));

function findRecipe(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return null;
  if (Array.isArray(node)) {
    for (const x of node) {
      const r = findRecipe(x, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (isRecipe(node)) return node;
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item', 'about', 'hasPart']) {
    const r = findRecipe(node[key], depth + 1);
    if (r) return r;
  }
  return null;
}

function jsonLdBlocks(html) {
  const out = [];
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const text = m[1].replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '').trim();
    try {
      out.push(JSON.parse(text));
    } catch {
      try {
        // Some sites leave raw line breaks or trailing commas in their JSON.
        out.push(JSON.parse(text.replace(/[\r\n\t]+/g, ' ').replace(/,\s*([\]}])/g, '$1')));
      } catch {}
    }
  }
  return out;
}

function steps(instr, depth = 0) {
  if (!instr || depth > 5) return [];
  if (typeof instr === 'string') {
    const lines = htmlToLines(instr.replace(/\n/g, '<br>'));
    return lines.length > 1 ? lines : lines.flatMap((l) => (l.length > 400 ? l.split(/(?<=\.)\s+(?=[A-Z])/) : [l]));
  }
  if (Array.isArray(instr)) return instr.flatMap((x) => steps(x, depth + 1));
  if (typeof instr === 'object') {
    const t = [].concat(instr['@type'] || []).join(' ');
    if (/HowToSection|ItemList/i.test(t) || instr.itemListElement) return steps(instr.itemListElement, depth + 1);
    if (instr.text) return steps(String(instr.text), depth + 1);
    if (instr.name) return [stripTags(instr.name)];
  }
  return [];
}

const textOf = (v) => (Array.isArray(v) ? v.map(textOf).join(', ') : v && typeof v === 'object' ? textOf(v.name || v['@value'] || '') : stripTags(v));

function tagsFor(r) {
  const words = `${textOf(r.recipeCategory)} ${textOf(r.keywords)} ${textOf(r.name)}`.toLowerCase();
  const tags = [/breakfast|brunch/.test(words) ? 'breakfast' : /lunch|sandwich|snack/.test(words) && !/dinner|main/.test(words) ? 'lunch' : 'dinner'];
  if (/vegetarian|vegan/.test(words) || [].concat(r.suitableForDiet || []).some((d) => /Vegetarian|Vegan/i.test(String(d)))) tags.push('vegetarian');
  if (/\bquick\b|\b(10|15|20)[- ]min/.test(words)) tags.push('quick');
  return tags;
}

function fromJsonLd(r) {
  const lines = [].concat(r.recipeIngredient || r.ingredients || []).map(textOf).filter(Boolean);
  const ingredients = lines.map(parseIngredient).filter(Boolean);
  const total = parseDuration(r.totalTime);
  const parts = (parseDuration(r.prepTime) || 0) + (parseDuration(r.cookTime) || 0);
  return {
    name: textOf(r.name).slice(0, 80),
    servings: parseYield(r.recipeYield) || 4,
    minutes: total || parts || 30,
    tags: tagsFor(r),
    ingredients,
    steps: steps(r.recipeInstructions).map((s) => s.slice(0, 500)).filter(Boolean).slice(0, 30),
  };
}

// ---- plain text ----------------------------------------------------------
const INGREDIENTS_HEAD = /^(ingredients?|you will need|you'll need|what you need)\b[:\s]*$/i;
const METHOD_HEAD = /^(method|instructions?|directions?|steps?|preparation|how to make( it)?)\b[:\s]*$/i;
const END_HEAD = /^(notes?|tips?|nutrition|nutritional information|recipe tips|comments?|related|you may also like|equipment)\b/i;

function fromText(lines, titleHint = '') {
  let i = lines.findIndex((l) => INGREDIENTS_HEAD.test(l));
  if (i < 0) i = lines.findIndex((l) => /^ingredients?\b/i.test(l) && l.length < 40);
  if (i < 0) return null;
  let j = lines.findIndex((l, k) => k > i && METHOD_HEAD.test(l));
  if (j < 0) j = lines.findIndex((l, k) => k > i && /^(method|instructions?|directions?)\b/i.test(l) && l.length < 40);
  const ingLines = lines.slice(i + 1, j < 0 ? undefined : j).filter((l) => !END_HEAD.test(l) && l.length < 200);
  // Sub-headings inside the list ("For the sauce:") aren't ingredients.
  const ingredients = ingLines.filter((l) => !/:\s*$/.test(l)).slice(0, 60).map(parseIngredient).filter(Boolean);
  const stepLines = [];
  if (j >= 0) {
    for (const l of lines.slice(j + 1)) {
      if (END_HEAD.test(l)) break;
      stepLines.push(l.replace(/^(step\s*)?\d+[.):]?\s+/i, ''));
    }
  }
  const before = lines.slice(0, i);
  const serves = lines.map((l) => /\b(?:serves|servings?|makes|feeds)\s*:?\s*(\d+)/i.exec(l)).find(Boolean);
  const time = lines.map((l) => /\b(?:total time|takes|ready in|cook time)\s*:?\s*(?:(\d+)\s*h(?:ou)?rs?)?\s*(?:(\d+)\s*min)/i.exec(l)).find(Boolean);
  return {
    name: (titleHint || before.find((l) => l.length > 2 && l.length < 80 && !/^(serves|prep|cook|total|makes)/i.test(l)) || 'New recipe').slice(0, 80),
    servings: serves ? Number(serves[1]) : 4,
    minutes: time ? Number(time[1] || 0) * 60 + Number(time[2] || 0) : 30,
    tags: ['dinner'],
    ingredients,
    steps: stepLines.filter((s) => s.length > 2).map((s) => s.slice(0, 500)).slice(0, 30),
  };
}

// ---- the whole page ------------------------------------------------------
function pageTitle(html) {
  const og = /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(html) || /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i.exec(html);
  if (og) return stripTags(og[1]);
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (h1) return stripTags(h1[1]);
  const t = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return t ? stripTags(t[1]).split(/\s[|–-]\s/)[0] : '';
}

// Page HTML (or pasted JSON-LD, or plain text) -> a recipe draft, or null if there's none.
function parseRecipePage(input, url = '') {
  const src = String(input || '');
  let recipe = null;
  // Pasted JSON-LD on its own.
  if (/^\s*[[{]/.test(src)) {
    try {
      recipe = findRecipe(JSON.parse(src));
    } catch {}
  }
  if (!recipe) {
    for (const block of jsonLdBlocks(src)) {
      recipe = findRecipe(block);
      if (recipe) break;
    }
  }
  let draft = recipe ? fromJsonLd(recipe) : null;
  if (!draft || !draft.ingredients.length) {
    const html = /<[a-z][\s\S]*>/i.test(src);
    const fallback = fromText(html ? htmlToLines(src) : src.split(/\r?\n/).map((l) => l.trim()).filter(Boolean), html ? pageTitle(src) : '');
    if (fallback && fallback.ingredients.length) draft = { ...fallback, name: (draft && draft.name) || fallback.name };
  }
  if (!draft || !draft.ingredients.length) return null;
  if (!draft.name) draft.name = pageTitle(src) || 'New recipe';
  draft.servings = Math.min(50, Math.max(1, draft.servings));
  draft.minutes = Math.min(1440, Math.max(1, draft.minutes));
  if (/^https?:\/\//i.test(url)) draft.source = String(url).slice(0, 500);
  return draft;
}

module.exports = { parseRecipePage, parseIngredient, parseDuration, parseYield, htmlToLines, findRecipe };
