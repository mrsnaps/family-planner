// Barcode lookup via Open Food Facts (free, no key). OFF_BASE_URL lets tests point elsewhere.
const BASE = () => process.env.OFF_BASE_URL || 'https://world.openfoodfacts.org';

function parseQuantity(q) {
  const m = /([\d.,]+)\s*(kg|g|ml|cl|l)\b/i.exec(String(q || ''));
  if (!m) return { quantity: null, unit: 'pcs' };
  let n = Number(m[1].replace(',', '.'));
  let unit = m[2].toLowerCase();
  if (unit === 'cl') { n *= 10; unit = 'ml'; }
  return { quantity: n, unit };
}

async function lookupBarcode(code) {
  const url = `${BASE()}/api/v2/product/${code}.json?fields=product_name,product_name_en,brands,quantity`;
  const res = await fetch(url, { headers: { 'User-Agent': 'FamilyPlanner/0.2 (home use)' }, signal: AbortSignal.timeout(8000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Open Food Facts returned ${res.status}`);
  const data = await res.json();
  if (!data.product || data.status === 0) return null;
  const p = data.product;
  const name = (p.product_name_en || p.product_name || '').trim();
  if (!name) return null;
  return { barcode: code, name, brand: (p.brands || '').split(',')[0].trim() || null, packSize: p.quantity || null, ...parseQuantity(p.quantity) };
}

module.exports = { lookupBarcode, parseQuantity };
