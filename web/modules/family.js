// Shared family settings. Both modules read this: food scales portions by it,
// clothes uses each child's age and current size.
const { newId } = require('../lib/store');
const { HttpError, text } = require('../lib/http');
const { parseSize, normalise } = require('./clothes/sizes');

const DEFAULT_FAMILY = { adults: 2, children: [], dietary: [] };
const DIETS = ['vegetarian', 'dairy-free', 'gluten-free', 'nut-free'];

function ageInYears(birthDate, now = new Date()) {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (isNaN(b)) return null;
  return (now - b) / (365.25 * 24 * 3600 * 1000);
}

// How much of an adult portion a person eats. Rough guide, good enough for estimates.
function portionFactor(age) {
  if (age === null || age === undefined) return 0.75;
  if (age < 1) return 0;
  if (age < 4) return 0.5;
  if (age < 11) return 0.75;
  return 1;
}

function portions(family, now = new Date()) {
  const kids = family.children.reduce(
    (sum, c) => sum + portionFactor(ageInYears(c.birthDate, now)),
    0
  );
  return Math.round((family.adults + kids) * 100) / 100;
}

function cleanChild(input, existing = {}) {
  const c = { ...existing };
  if (input.name !== undefined) c.name = text(input.name, 40);
  if (!c.name) throw new HttpError(400, 'Child needs a name');
  if (input.birthDate !== undefined) {
    if (input.birthDate && isNaN(new Date(input.birthDate))) throw new HttpError(400, 'Bad birthDate');
    c.birthDate = input.birthDate || null;
  }
  if (input.clothingSize !== undefined) {
    if (input.clothingSize && !parseSize(input.clothingSize)) {
      throw new HttpError(400, `Unknown clothing size "${input.clothingSize}". Use e.g. 6-9M, 2-3Y, 7-8Y`);
    }
    const size = input.clothingSize ? normalise(input.clothingSize) : null;
    if (size !== existing.clothingSize) c.sizeRecordedAt = new Date().toISOString().slice(0, 10);
    c.clothingSize = size;
  }
  if (input.shoeSize !== undefined) {
    const shoe = input.shoeSize ? text(input.shoeSize, 10) : null;
    if (shoe !== existing.shoeSize) c.shoeSizeRecordedAt = shoe ? new Date().toISOString().slice(0, 10) : null;
    c.shoeSize = shoe;
  }
  const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !isNaN(new Date(v)) ? String(v) : null);
  if (input.sizeRecordedAt && day(input.sizeRecordedAt)) c.sizeRecordedAt = day(input.sizeRecordedAt);
  if (input.shoeSizeRecordedAt && day(input.shoeSizeRecordedAt)) c.shoeSizeRecordedAt = day(input.shoeSizeRecordedAt);
  return c;
}

function register(router, store) {
  const family = () => store.get('family', DEFAULT_FAMILY);

  const summary = () => {
    const f = family();
    return {
      ...f,
      dietary: f.dietary || [],
      location: f.location || null,
      people: f.adults + f.children.length,
      portions: portions(f),
      children: f.children.map((c) => ({ ...c, age: ageInYears(c.birthDate) })),
    };
  };

  router.get('/api/v1/family', () => summary());

  router.put('/api/v1/family', (req, body) => {
    const f = family();
    if (body.adults !== undefined) {
      const n = Number(body.adults);
      if (!Number.isInteger(n) || n < 0 || n > 20) throw new HttpError(400, 'adults must be 0-20');
      f.adults = n;
    }
    if (body.dietary !== undefined) {
      if (!Array.isArray(body.dietary) || body.dietary.some((d) => !DIETS.includes(d))) {
        throw new HttpError(400, `dietary must be a list from: ${DIETS.join(', ')}`);
      }
      f.dietary = [...new Set(body.dietary)];
    }
    if (body.location !== undefined) {
      // Optional, for weather-aware outfits: { name, lat, lon }.
      const l = body.location;
      if (l !== null && (typeof l !== 'object' || !Number.isFinite(Number(l.lat)) || !Number.isFinite(Number(l.lon)))) {
        throw new HttpError(400, 'location needs lat and lon');
      }
      f.location = l === null ? null : { name: text(l.name, 80), lat: Number(l.lat), lon: Number(l.lon) };
    }
    store.save();
    return summary();
  });

  router.post('/api/v1/family/children', (req, body) => {
    const child = { id: newId(), ...cleanChild(body) };
    family().children.push(child);
    store.save();
    return child;
  });

  router.put('/api/v1/family/children/:id', (req, body, { id }) => {
    const f = family();
    const i = f.children.findIndex((c) => c.id === id);
    if (i < 0) throw new HttpError(404, 'No such child');
    f.children[i] = cleanChild(body, f.children[i]);
    store.save();
    return f.children[i];
  });

  router.delete('/api/v1/family/children/:id', (req, body, { id }) => {
    const f = family();
    const before = f.children.length;
    f.children = f.children.filter((c) => c.id !== id);
    if (f.children.length === before) throw new HttpError(404, 'No such child');
    // Their clothes go with them.
    const clothes = store.get('clothes', { items: [] });
    clothes.items = clothes.items.filter((it) => it.childId !== id);
    store.save();
    return { ok: true };
  });

  return { family, summary };
}

module.exports = { register, portions, portionFactor, ageInYears, DEFAULT_FAMILY };
