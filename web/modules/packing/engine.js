// Packing lists: plain rules, no AI. A trip has dates, who's going and the weather
// expected; the list scales clothes by nights away, adds what little ones need, and
// names real clothes from each child's wardrobe that fit and are clean.
const DAY = 86400000;
const nightsOf = (start, end) => Math.max(1, Math.round((new Date(end + 'T12:00:00Z') - new Date(start + 'T12:00:00Z')) / DAY));

// What the weather will probably be: what the person chose, else a guess from the month.
function weatherFor(trip) {
  if (trip.weather && ['hot', 'mild', 'cold'].includes(trip.weather.feel)) return trip.weather;
  const m = Number(String(trip.start).slice(5, 7));
  return { feel: m >= 6 && m <= 8 ? 'hot' : m >= 11 || m <= 2 ? 'cold' : 'mild', rain: Boolean(trip.weather && trip.weather.rain), guessed: true };
}

// Clothes counts for n nights (washing is assumed for long trips: at most a week's worth).
function clothesCounts(n, feel, rain) {
  const d = Math.min(n, 7);
  const c = [
    ['top', 'Tops', d + 1],
    ['bottom', 'Trousers, shorts or skirts', Math.ceil(d / 2) + 1],
    [null, 'Pants', d + 1],
    [null, 'Socks', d + 1],
    [null, 'Pyjamas', Math.max(1, Math.ceil(d / 3))],
    ['jumper', 'Jumpers or hoodies', feel === 'cold' ? Math.ceil(d / 2) + 1 : feel === 'mild' ? 2 : 1],
    ['shoes', 'Shoes', feel === 'hot' ? 2 : 1],
  ];
  if (feel !== 'hot' || rain) c.push(['outerwear', rain ? 'Waterproof coat' : 'Coat', 1]);
  if (feel === 'hot') c.push([null, 'Swimwear', 1], [null, 'Sun hat', 1], [null, 'Sandals', 1]);
  if (feel === 'cold') c.push([null, 'Hat, gloves and scarf', 1]);
  if (rain) c.push([null, 'Wellies', 1]);
  return c;
}

const { fitsChild } = require('../clothes/engine');

const usable = (items, child) => items.filter((i) => i.childId === child.id && !i.inWash && !i.stored && fitsChild(i, child));

function generate(trip, { adults = 2, adultNames = [], children = [], clothes = [] } = {}) {
  const n = nightsOf(trip.start, trip.end);
  const w = weatherFor(trip);
  const going = children.filter((c) => !trip.who || !trip.who.length || trip.who.includes(c.id));
  const out = [];
  const add = (group, name, qty = 1, extra = {}) => out.push({ group, name, qty, ...extra });

  for (const c of going) {
    const mine = usable(clothes, c).filter((i) => !(w.feel === 'cold' && i.season === 'summer') && !(w.feel === 'hot' && i.season === 'winter'));
    for (const [type, name, qty] of clothesCounts(n, w.feel, w.rain)) {
      const picks = type ? mine.filter((i) => i.type === type || (type === 'top' && i.type === 'dress')).slice(0, qty).map((i) => i.name) : [];
      add(c.name, name, qty, { childId: c.id, ...(picks.length ? { detail: picks.join(', ') } : {}) });
    }
    if (c.age != null && c.age < 3) {
      add(c.name, 'Nappies', n * 6 + 6, { childId: c.id });
      add(c.name, 'Wipes', Math.ceil(n / 3), { childId: c.id });
      add(c.name, 'Nappy bags and changing mat', 1, { childId: c.id });
      add(c.name, 'Buggy or carrier', 1, { childId: c.id });
      add(c.name, 'Bottles and milk', 1, { childId: c.id });
    }
    if (c.age != null && c.age < 6) add(c.name, 'Comforter or favourite teddy', 1, { childId: c.id });
    if (c.age != null && c.age >= 4) add(c.name, 'Books, toys or games for the journey', 1, { childId: c.id });
  }
  const grownUps = adultNames.length ? adultNames.slice(0, adults) : Array.from({ length: adults }, (_, i) => `Grown-up ${i + 1}`);
  for (const name of grownUps) {
    add(name, `Clothes for ${n} night${n === 1 ? '' : 's'}`, 1);
    add(name, 'Pyjamas', 1);
    if (w.feel === 'hot') add(name, 'Swimwear and sunglasses', 1);
    if (w.feel !== 'hot' || w.rain) add(name, w.rain ? 'Waterproof coat' : 'Coat', 1);
  }
  const all = 'Everyone';
  add(all, 'Toothbrushes and toothpaste', 1);
  add(all, 'Shampoo and shower gel', 1);
  add(all, 'Hairbrush and hair bobbles', 1);
  add(all, 'Medicines and Calpol', 1);
  add(all, 'Plasters and first aid', 1);
  if (w.feel === 'hot') add(all, 'Suncream and after-sun', 1);
  if (w.rain) add(all, 'Umbrella', 1);
  add(all, 'Phone chargers', 1);
  add(all, 'Snacks and water bottles for the journey', 1);
  add(all, 'Tickets, booking details and money', 1);
  if (trip.abroad) {
    add(all, 'Passports', 1);
    add(all, 'Travel insurance and EHIC/GHIC cards', 1);
    add(all, 'Plug adaptors', 1);
  }
  if (n >= 4) add(all, 'Washing powder or laundry bag', 1);
  return { nights: n, weather: w, items: out };
}

module.exports = { generate, nightsOf, weatherFor, clothesCounts };
