// Three-way merge of the household's data, used when two people save at the same time.
// `base` is the copy both started from, `mine` this device's, `theirs` the one saved first.
// Lists of things with ids (shopping items, cupboard, wardrobe...) merge item by item, so
// two people ticking different things on the list both keep their ticks. Where both changed
// the same value, the copy saved first wins.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasIds = (list) => Array.isArray(list) && list.every((x) => isObj(x) && x.id !== undefined);

export function merge3(base, mine, theirs) {
  if (same(mine, base) || same(mine, theirs)) return theirs;
  if (same(theirs, base)) return mine;
  if (isObj(mine) && isObj(theirs)) {
    const b = isObj(base) ? base : {};
    const out = {};
    for (const k of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
      if (k === '__proto__') continue; // never part of the app's data
      const inMine = k in mine;
      const inTheirs = k in theirs;
      if (inMine && inTheirs) out[k] = merge3(b[k], mine[k], theirs[k]);
      else if (inTheirs ? !(k in b) || !same(theirs[k], b[k]) : !(k in b)) out[k] = inTheirs ? theirs[k] : mine[k];
      // Otherwise one side removed a key the other left alone: it stays removed.
    }
    return out;
  }
  if (hasIds(mine) && hasIds(theirs) && (base === undefined || hasIds(base))) {
    const byId = (list) => new Map((list || []).map((x) => [x.id, x]));
    const b = byId(base);
    const m = byId(mine);
    const out = [];
    for (const t of theirs) {
      if (!m.has(t.id)) {
        // Gone here: removed on this device, unless the other device changed it meanwhile.
        if (b.has(t.id) && same(b.get(t.id), t)) continue;
        out.push(t);
      } else out.push(b.has(t.id) ? merge3(b.get(t.id), m.get(t.id), t) : t);
    }
    const t = byId(theirs);
    for (const x of mine) if (!t.has(x.id) && !b.has(x.id)) out.push(x); // new on this device
    return out;
  }
  if (Array.isArray(mine) && Array.isArray(theirs)) {
    // Logs (history of what was bought or cooked): keep both sides' new entries.
    const seen = new Set((Array.isArray(base) ? base : []).concat(theirs).map((x) => JSON.stringify(x)));
    return theirs.concat(mine.filter((x) => !seen.has(JSON.stringify(x))));
  }
  return theirs;
}
