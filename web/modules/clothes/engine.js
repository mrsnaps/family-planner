// Pure functions: outfit matching and the clothes data panel. No storage, no HTTP.
const { compareSize, predictOutgrow, parseSize } = require('./sizes');
const { predictShoes } = require('./shoes');

const TYPES = ['top', 'bottom', 'dress', 'onesie', 'outerwear', 'shoes', 'pyjamas', 'other'];
const DEFAULT_TARGETS = { top: 7, bottom: 5, pyjamas: 3, outerwear: 1, shoes: 2 };
// Typical UK high-street prices (GBP) for the budget forecast. Editable per household.
const DEFAULT_PRICES = { top: 6, bottom: 8, dress: 10, onesie: 8, outerwear: 25, shoes: 25, pyjamas: 8, other: 5 };
const UNIFORM_TARGETS = { top: 5, bottom: 3 };

const NEUTRALS = new Set([
  'black', 'white', 'grey', 'gray', 'navy', 'denim', 'beige', 'cream', 'brown', 'khaki', 'tan',
]);
const CLASHES = [
  ['red', 'pink'], ['red', 'orange'], ['pink', 'orange'], ['red', 'green'],
  ['purple', 'orange'], ['brown', 'black'], ['navy', 'black'], ['purple', 'red'],
];

const colourOf = (it) => String(it.colour || '').trim().toLowerCase();
const isNeutral = (it) => NEUTRALS.has(colourOf(it)) || !colourOf(it);
const isPatterned = (it) => it.pattern === 'patterned';

function pairScore(a, b) {
  let score = 0;
  const ca = colourOf(a);
  const cb = colourOf(b);
  const reasons = [];
  if (isPatterned(a) && isPatterned(b)) {
    score -= 40;
    reasons.push('two patterns');
  }
  if (CLASHES.some(([x, y]) => (ca === x && cb === y) || (ca === y && cb === x))) {
    score -= 30;
    reasons.push(`${ca} and ${cb} can clash`);
  }
  if (isNeutral(a) !== isNeutral(b)) score += 10; // a colour anchored by a neutral
  else if (ca && ca === cb && !isNeutral(a)) score -= 10; // all one bright colour
  return { score, reasons };
}

function seasonsCompatible(items, season) {
  const s = items.map((i) => i.season || 'all').filter((x) => x !== 'all');
  if (s.includes('summer') && s.includes('winter')) return false;
  if (season && season !== 'any') return s.every((x) => x === season);
  return true;
}

function fitsChild(item, child) {
  if (item.wornOut) return false;
  if (item.type === 'shoes') {
    return !child.shoeSize || !item.size || String(item.size).trim() === String(child.shoeSize).trim();
  }
  return compareSize(item.size, child.clothingSize) === 0;
}

// Best extra layer (coat, shoes) for a base outfit: the one that matches best, if any.
function bestAddOn(base, candidates, season) {
  let best = null;
  for (const c of candidates) {
    if (!seasonsCompatible([...base, c], season)) continue;
    const s = base.reduce((sum, b) => sum + pairScore(b, c).score, 0);
    if (!best || s > best.score) best = { item: c, score: s };
  }
  return best;
}

// Wearable today: fits, isn't in the wash, and matches the uniform setting.
// Weather (tempC, rain) is optional: cold days drop summer clothes and want a coat,
// hot days drop winter clothes and skip the coat unless it's raining.
function outfitsFor(child, items, { season = 'any', limit = 50, uniform = 'exclude', tempC = null, rain = false } = {}) {
  const cold = tempC !== null && tempC < 12;
  const hot = tempC !== null && tempC >= 20;
  const mine = items.filter((it) => it.childId === child.id && fitsChild(it, child) && !it.inWash &&
    (uniform === 'any' || (uniform === 'only' ? it.uniform || ['shoes', 'outerwear'].includes(it.type) : !it.uniform)) &&
    !(cold && it.season === 'summer') && !(hot && it.season === 'winter'));
  const by = (t) => mine.filter((it) => it.type === t);
  const bases = [];

  for (const top of by('top')) {
    for (const bottom of by('bottom')) {
      if (!seasonsCompatible([top, bottom], season)) continue;
      const { score, reasons } = pairScore(top, bottom);
      bases.push({ items: [top, bottom], score, reasons });
    }
  }
  for (const one of [...by('dress'), ...by('onesie')]) {
    if (!seasonsCompatible([one], season)) continue;
    bases.push({ items: [one], score: 5, reasons: [] });
  }

  const outerwear = hot && !rain ? [] : by('outerwear');
  const shoes = by('shoes');
  const outfits = bases.map((b) => {
    const extras = [];
    const notes = [...b.reasons];
    let score = 85 + b.score;
    for (const pool of [outerwear, shoes]) {
      const add = bestAddOn(b.items, pool, season);
      if (add) {
        extras.push(add.item);
        score += Math.max(-20, add.score / 2);
      }
    }
    if ((cold || rain) && !extras.some((e) => e.type === 'outerwear')) {
      score -= 15;
      notes.push(rain ? 'no coat for the rain' : 'no coat for the cold');
    }
    if (cold && b.items.some((i) => i.season === 'winter')) score += 5;
    if (hot && b.items.some((i) => i.season === 'summer')) score += 5;
    return {
      items: [...b.items, ...extras].map(({ id, name, type, colour }) => ({ id, name, type, colour })),
      score: Math.max(0, Math.min(100, Math.round(score))),
      notes,
    };
  });

  outfits.sort((x, y) => y.score - x.score);
  return { childId: child.id, total: outfits.length, outfits: outfits.slice(0, limit) };
}

// `waiting` is the hand-me-downs meant for this child (see handMeDowns): they count towards
// what the child has, so the app doesn't suggest buying what a sibling has outgrown.
function childStats(child, items, targets = DEFAULT_TARGETS, now = new Date(), { prices = DEFAULT_PRICES, waiting = [] } = {}) {
  const mine = items.filter((it) => it.childId === child.id);
  const count = (pred) => {
    const out = {};
    for (const t of TYPES) out[t] = 0;
    for (const it of mine) if (pred(it)) out[it.type] = (out[it.type] || 0) + 1;
    return out;
  };

  // Everyday clothes only; school uniform is counted separately below.
  const fitting = count((it) => fitsChild(it, child) && !it.uniform);
  const clean = count((it) => fitsChild(it, child) && !it.uniform && !it.inWash);
  const outgrown = mine.filter(
    (it) => it.type !== 'shoes' && !it.wornOut && compareSize(it.size, child.clothingSize) < 0
  ).length;
  const wornOut = mine.filter((it) => it.wornOut).length;

  const tally = (list) => {
    const out = {};
    for (const t of TYPES) out[t] = 0;
    for (const it of list) out[it.type] = (out[it.type] || 0) + 1;
    return out;
  };
  const passedNow = tally(waiting.filter((h) => h.fitsNow));
  // Dresses and onesies cover both a top and a bottom for the day.
  const covers = (t) => {
    const n = (k) => fitting[k] + passedNow[k];
    return t === 'top' || t === 'bottom' ? n(t) + n('dress') + n('onesie') : n(t);
  };

  const shortfall = {};
  for (const [t, want] of Object.entries(targets)) {
    const gap = want - covers(t);
    if (gap > 0) shortfall[t] = gap;
  }

  const forecast = predictOutgrow(child, now);
  let nextSizeNeeds = null;
  if (forecast && forecast.nextSize) {
    const next = parseSize(forecast.nextSize);
    const owned = count(
      (it) => !it.wornOut && it.type !== 'shoes' && parseSize(it.size)?.label === next.label
    );
    const passedNext = tally(waiting.filter((h) => parseSize(h.size)?.label === next.label));
    for (const t of TYPES) owned[t] += passedNext[t];
    const coversNext = (t) =>
      t === 'top' || t === 'bottom' ? owned[t] + owned.dress + owned.onesie : owned[t];
    nextSizeNeeds = {};
    for (const [t, want] of Object.entries(targets)) {
      if (t === 'shoes') continue;
      const gap = want - coversNext(t);
      if (gap > 0) nextSizeNeeds[t] = gap;
    }
  }

  const shoeForecast = predictShoes(child, now);

  // Laundry: how many days of clean everyday outfits are left.
  const inWash = mine.filter((it) => it.inWash && !it.wornOut).length;
  const cleanDays = Math.min(clean.top + clean.dress + clean.onesie, clean.bottom + clean.dress + clean.onesie);
  const laundry = {
    inWash,
    cleanDays,
    warning: inWash > 0 && cleanDays <= 2
      ? (cleanDays === 0 ? 'No clean outfits left. Time for a wash.' : `Only ${cleanDays} day${cleanDays === 1 ? '' : 's'} of clean outfits left.`)
      : null,
  };

  // School uniform: buy the next size for September if they'll outgrow the current one by spring.
  const uniformFitting = count((it) => fitsChild(it, child) && it.uniform);
  const y = now.getUTCMonth() >= 8 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  const termStart = `${y}-09-01`;
  const uniformTotal = mine.filter((it) => it.uniform).length;
  let uniform = null;
  if (uniformTotal) {
    const daysToTerm = Math.round((new Date(termStart) - now) / 86400000);
    const outgrowsByEaster = forecast && forecast.nextSize && new Date(forecast.date) < new Date(new Date(termStart).getTime() + 210 * 86400000);
    const size = outgrowsByEaster ? forecast.nextSize : child.clothingSize;
    const short = {};
    for (const [t, want] of Object.entries(UNIFORM_TARGETS)) {
      const have = outgrowsByEaster
        ? mine.filter((it) => it.uniform && it.type === t && parseSize(it.size)?.label === size).length
        : uniformFitting[t];
      if (want > have) short[t] = want - have;
    }
    uniform = { fitting: uniformFitting, termStart, daysToTerm, buySize: size, short, buyBeforeTerm: Object.keys(short).length > 0 };
  }

  // Budget: what the shortfall now and the next size would cost at typical prices.
  const cost = (needs) => Object.entries(needs || {}).reduce((sum, [t, n]) => sum + n * (prices[t] ?? prices.other ?? 5), 0);
  const budget = {
    currency: 'GBP',
    now: cost(shortfall),
    nextSize: cost(nextSizeNeeds),
    nextSizeBy: forecast && forecast.nextSize ? forecast.date : null,
    shoes: shoeForecast ? prices.shoes ?? 25 : 0,
    shoesBy: shoeForecast ? shoeForecast.date : null,
  };
  budget.total = budget.now + budget.nextSize;

  let status = 'ok';
  let advice = 'Wardrobe is covered for now.';
  if (Object.keys(shortfall).length) {
    status = 'buy-now';
    advice = 'Short on: ' + Object.entries(shortfall).map(([t, n]) => `${n} ${t}`).join(', ') +
      (child.clothingSize ? ` in ${child.clothingSize}` : '') + '.';
  } else if (forecast && forecast.daysLeft <= 60) {
    status = 'buy-soon';
    advice = forecast.nextSize
      ? `Likely to need ${forecast.nextSize} around ${forecast.date}.`
      : `Likely to outgrow ${forecast.currentSize} around ${forecast.date}.`;
  } else if (forecast && forecast.nextSize) {
    advice = `Next size ${forecast.nextSize}, expected around ${forecast.date}.`;
  }
  if (!child.clothingSize) advice = 'Add a current clothing size to get a forecast.';
  if (status === 'ok' && laundry.warning) advice = laundry.warning;
  if (status === 'ok' && shoeForecast && shoeForecast.daysLeft <= 30) {
    status = 'buy-soon';
    advice = `Feet may be ready for size ${shoeForecast.nextSize} around ${shoeForecast.date}. Check the fit.`;
  }

  return {
    childId: child.id,
    name: child.name,
    clothingSize: child.clothingSize || null,
    totalItems: mine.length,
    fitting,
    fittingTotal: Object.values(fitting).reduce((a, b) => a + b, 0),
    outgrown,
    wornOut,
    outfitCount: outfitsFor(child, items, { limit: 0 }).total,
    shortfall,
    forecast,
    shoeForecast,
    nextSizeNeeds,
    handMeDowns: waiting.length ? { count: waiting.length, fitNow: waiting.filter((h) => h.fitsNow).length, from: [...new Set(waiting.map((h) => h.fromName))] } : null,
    laundry,
    uniform,
    budget,
    status,
    advice,
  };
}

// Outgrown clothes that a younger sibling could wear now or grow into.
function handMeDowns(children, items) {
  const out = [];
  for (const it of items) {
    if (it.wornOut || it.type === 'shoes' || !it.size) continue;
    const owner = children.find((c) => c.id === it.childId);
    if (!owner || compareSize(it.size, owner.clothingSize) >= 0) continue;
    for (const c of children) {
      if (c.id === owner.id || !c.clothingSize) continue;
      const fit = compareSize(it.size, c.clothingSize);
      if (fit >= 0) {
        out.push({ itemId: it.id, name: it.name, type: it.type, size: it.size, fromChildId: owner.id, fromName: owner.name, toChildId: c.id, toName: c.name, fitsNow: fit === 0 });
        break;
      }
    }
  }
  return out;
}

// One outfit for the day: the same pick all day, a different one tomorrow.
function outfitOfTheDay(child, items, { date = new Date().toISOString().slice(0, 10), shuffle = 0, ...opts } = {}) {
  const all = outfitsFor(child, items, { ...opts, limit: 500 }).outfits;
  const good = all.filter((o) => o.score >= 80);
  const pool = good.length ? good : all;
  if (!pool.length) return { outfit: null, choices: 0 };
  let h = 0;
  for (const ch of date + child.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { outfit: pool[(h + shuffle) % pool.length], choices: pool.length };
}

module.exports = { TYPES, DEFAULT_TARGETS, DEFAULT_PRICES, outfitsFor, outfitOfTheDay, childStats, handMeDowns, pairScore, fitsChild };
