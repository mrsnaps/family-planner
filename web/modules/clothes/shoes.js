// UK shoe sizes run 0 to 13.5 for children, then restart at 1 for "adult" sizes.
// We put them on one scale (kids 0-13.5, then adult 1 = 14) so we can step through them.
const YEAR_MS = 365.25 * 24 * 3600 * 1000;
const MONTH_MS = YEAR_MS / 12;

function parseShoe(label, age) {
  if (label === null || label === undefined || label === '') return null;
  const m = /^\s*(\d+(?:\.5)?)\s*(a|adult)?\s*$/i.exec(String(label));
  if (!m) return null;
  const v = Number(m[1]);
  // Small numbers on an older child are adult sizes (a 7 year old in a "2" wears adult 2).
  const adult = Boolean(m[2]) || (age !== null && age !== undefined && age >= 5 && v < 8);
  if (!adult && v > 13.5) return null;
  return { linear: adult ? 13 + v : v, adult };
}

function shoeLabel(linear) {
  return linear > 13.5 ? `${linear - 13} adult` : String(linear);
}

// Months per half size, by age. Feet grow fastest in toddlers and slow right down by the teens.
function monthsPerHalfSize(age) {
  if (age === null || age === undefined) return 4;
  if (age < 1.5) return 2;
  if (age < 3) return 2.5;
  if (age < 5) return 3.5;
  if (age < 8) return 5;
  if (age < 12) return 6;
  return 9;
}

function predictShoes({ shoeSize, birthDate, shoeSizeRecordedAt }, now = new Date()) {
  const recorded = shoeSizeRecordedAt ? new Date(shoeSizeRecordedAt) : now;
  const age = birthDate ? (recorded - new Date(birthDate)) / YEAR_MS : null;
  const s = parseShoe(shoeSize, age);
  if (!s) return null;
  const date = new Date(recorded.getTime() + monthsPerHalfSize(age) * MONTH_MS);
  return {
    currentSize: shoeLabel(s.linear),
    nextSize: shoeLabel(s.linear + 0.5),
    date: date.toISOString().slice(0, 10),
    daysLeft: Math.round((date - now) / 86400000),
  };
}

module.exports = { parseShoe, shoeLabel, predictShoes, monthsPerHalfSize };
