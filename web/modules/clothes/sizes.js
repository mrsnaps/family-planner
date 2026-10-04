// UK/EU kids clothing sizes are age bands: "0-3M", "12-18M", "2-3Y", "7-8Y" ...
// Everything here works in years so bands can be compared and stepped through.
const BANDS = [
  '0-3M', '3-6M', '6-9M', '9-12M', '12-18M', '18-24M',
  '2-3Y', '3-4Y', '4-5Y', '5-6Y', '6-7Y', '7-8Y', '8-9Y',
  '9-10Y', '10-11Y', '11-12Y', '12-13Y', '13-14Y', '14-15Y', '15-16Y',
];

function parseSize(label) {
  if (!label) return null;
  const m = /^\s*(\d+)\s*-\s*(\d+)\s*([MY])\s*$/i.exec(String(label));
  if (!m) return null;
  const unit = m[3].toUpperCase() === 'M' ? 1 / 12 : 1;
  const from = Number(m[1]) * unit;
  const to = Number(m[2]) * unit;
  if (to <= from) return null;
  const canonical = `${Number(m[1])}-${Number(m[2])}${m[3].toUpperCase()}`;
  return { label: canonical, from, to, index: BANDS.indexOf(canonical) };
}

function normalise(label) {
  const s = parseSize(label);
  return s ? s.label : label;
}

function nextSize(label) {
  const s = parseSize(label);
  if (!s || s.index < 0 || s.index >= BANDS.length - 1) return null;
  return BANDS[s.index + 1];
}

// -1: smaller than current (outgrown), 0: fits now, 1: bigger (grow into it).
function compareSize(itemLabel, currentLabel) {
  const a = parseSize(itemLabel);
  const b = parseSize(currentLabel);
  if (!a || !b) return 0; // unknown sizes are assumed to fit
  if (a.label === b.label) return 0;
  // Overlapping bands (e.g. "2-3Y" vs "18-24M" style mixes) count as fitting.
  if (a.to <= b.from) return -1;
  if (a.from >= b.to) return 1;
  return 0;
}

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

// Estimate when a child moves out of their current size.
// Kids move roughly one band per band-width of age. If the child's age sits inside
// the band we use it directly; if they are big or small for their age we assume they
// were mid-band when the size was recorded and grow at the normal rate from there.
function predictOutgrow({ clothingSize, birthDate, sizeRecordedAt }, now = new Date()) {
  const s = parseSize(clothingSize);
  if (!s) return null;
  const recorded = sizeRecordedAt ? new Date(sizeRecordedAt) : now;
  let ageEquivalent = s.from + (s.to - s.from) / 2;
  if (birthDate) {
    const ageAtRecord = (recorded - new Date(birthDate)) / YEAR_MS;
    if (ageAtRecord >= s.from && ageAtRecord < s.to) ageEquivalent = ageAtRecord;
  }
  const date = new Date(recorded.getTime() + (s.to - ageEquivalent) * YEAR_MS);
  const daysLeft = Math.round((date - now) / (24 * 3600 * 1000));
  return {
    currentSize: s.label,
    nextSize: nextSize(s.label),
    date: date.toISOString().slice(0, 10),
    daysLeft,
  };
}

module.exports = { BANDS, parseSize, normalise, nextSize, compareSize, predictOutgrow };
