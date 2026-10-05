// Undo for the chat. Before each change, the chat copies the household's data; afterwards
// diff() records only what that change touched: whole items in lists with ids (a shopping
// item, an event), entries added to the end of logs, or single values. undo() puts those back,
// but only where nobody has changed them since: if someone else in the household edited the
// same item after the chat did, their edit stays and the item is counted as "kept".
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasIds = (list) => Array.isArray(list) && list.every((x) => isObj(x) && typeof x.id === 'string');
const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

// [{ path, id, index, before, after }] for items, { path, appended } for logs,
// { path, before, after, missing } for single values (missing: the key wasn't there before).
function diff(before, after, path = [], out = []) {
  if (same(before, after)) return out;
  if (isObj(before) && isObj(after)) {
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) diff(before[k], after[k], [...path, k], out);
    return out;
  }
  if (hasIds(before) && hasIds(after) && (before.length || after.length)) {
    const b = new Map(before.map((x, i) => [x.id, [x, i]]));
    const a = new Map(after.map((x) => [x.id, x]));
    for (const id of new Set([...b.keys(), ...a.keys()])) {
      const was = b.has(id) ? b.get(id)[0] : null;
      const now = a.get(id) || null;
      if (!same(was, now)) out.push({ path, id, index: b.has(id) ? b.get(id)[1] : null, before: was, after: now });
    }
    return out;
  }
  if (Array.isArray(before) && Array.isArray(after) && after.length > before.length && same(before, after.slice(0, before.length))) {
    out.push({ path, appended: after.slice(before.length) });
    return out;
  }
  out.push({ path, before: before === undefined ? null : before, after: after === undefined ? null : after, ...(before === undefined ? { missing: true } : {}), ...(after === undefined ? { gone: true } : {}) });
  return out;
}

const okPath = (path) => Array.isArray(path) && path.length > 0 && path.length < 12 &&
  path.every((k) => typeof k === 'string' && k.length < 100 && !BAD_KEYS.has(k));

function walk(root, path) {
  let v = root;
  for (const k of path) {
    if (v === null || typeof v !== 'object' || !Object.prototype.hasOwnProperty.call(v, k)) return undefined;
    v = v[k];
  }
  return v;
}

// Put back a list of changes (newest first). sections: the top-level keys it may touch.
function undo(root, changes, sections) {
  let undone = 0;
  let kept = 0;
  const allowed = new Set(sections);
  for (const c of [...(Array.isArray(changes) ? changes : [])].reverse()) {
    if (!c || !okPath(c.path) || !allowed.has(c.path[0])) { kept++; continue; }
    if (typeof c.id === 'string') {
      const list = walk(root, c.path);
      if (!Array.isArray(list)) { kept++; continue; }
      const i = list.findIndex((x) => x && x.id === c.id);
      const cur = i >= 0 ? list[i] : null;
      if (c.after === null) {
        // The chat removed it: put it back where it was, unless it's back already.
        if (cur) { kept++; continue; }
        if (!isObj(c.before)) { kept++; continue; }
        list.splice(Math.min(Number.isInteger(c.index) ? c.index : list.length, list.length), 0, c.before);
      } else if (c.before === null) {
        // The chat added it: take it away, unless someone has changed it since.
        if (!cur) { undone++; continue; }
        if (!same(cur, c.after)) { kept++; continue; }
        list.splice(i, 1);
      } else {
        if (!cur || !same(cur, c.after) || !isObj(c.before)) { kept++; continue; }
        list[i] = c.before;
      }
      undone++;
    } else if (Array.isArray(c.appended)) {
      const list = walk(root, c.path);
      if (!Array.isArray(list)) { kept++; continue; }
      for (const entry of [...c.appended].reverse()) {
        for (let j = list.length - 1; j >= 0; j--) {
          if (same(list[j], entry)) { list.splice(j, 1); break; }
        }
      }
      undone++;
    } else {
      const parent = walk(root, c.path.slice(0, -1));
      const key = c.path[c.path.length - 1];
      if (!isObj(parent)) { kept++; continue; }
      const cur = Object.prototype.hasOwnProperty.call(parent, key) ? parent[key] : undefined;
      if (!same(cur === undefined ? null : cur, c.after) || (c.gone && cur !== undefined)) { kept++; continue; }
      if (c.missing) delete parent[key];
      else parent[key] = c.before;
      undone++;
    }
  }
  return { undone, kept };
}

module.exports = { diff, undo, same };
