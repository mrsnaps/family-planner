// Bills module: HTTP routes over the engine. Owns the "bills" key in the store.
// Family bills are seen by the whole household. Personal bills are seen only by the person
// who added them (X-Family-Member): when signed in, the app saves them online in that
// person's own file, never in the household's (phone/mobile/cloud.js, infra/lambda/index.js).
const { newId } = require('../../lib/store');
const { HttpError, text } = require('../../lib/http');
const { CATEGORIES, EVERY, step, overview, dayOf, ruleTips, nextDue } = require('./engine');

const DEFAULT = { items: [], dismissed: {} };
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !isNaN(new Date(v));
const who = (req) => (req && req.headers && String(req.headers['x-family-member'] || '').toLowerCase()) || null;
const money = (v) => Number(String(v ?? '').replace(/[£,\s]/g, ''));

// Personal bills belong to whoever added them. On a device nobody has signed in to, or one
// that only holds its own person's bills, there's no one else to hide them from.
const canSee = (b, me) => !b.personal || !b.owner || !me || b.owner === me;

function clean(input, existing, me) {
  const b = { ...existing };
  if (input.name !== undefined) b.name = text(input.name, 60);
  if (!b.name) throw new HttpError(400, 'Give the bill a name, like Council tax');
  if (input.amount !== undefined) {
    const n = money(input.amount);
    if (!Number.isFinite(n) || n < 0 || n > 100000) throw new HttpError(400, 'Amount in pounds, like 120.50');
    const amount = Math.round(n * 100) / 100;
    // Price changes are kept, so the app can point out bills going up.
    if (existing && existing.amount !== undefined && existing.amount !== amount) {
      b.changes = [...(existing.changes || []), { date: dayOf(new Date()), from: existing.amount, to: amount }].slice(-12);
    }
    b.amount = amount;
  }
  if (b.amount === undefined) throw new HttpError(400, 'How much is it?');
  if (input.every !== undefined) {
    if (!EVERY.some(([k]) => k === input.every)) throw new HttpError(400, `every: ${EVERY.map(([k]) => k).join('|')}`);
    b.every = input.every;
  }
  b.every = b.every || 'month';
  if (input.due !== undefined) {
    if (!isDay(input.due)) throw new HttpError(400, 'due must look like 2026-10-28');
    b.due = String(input.due);
    b.day = Number(b.due.slice(8, 10));
    delete b.done;
  }
  if (!b.due) throw new HttpError(400, 'When is it next due?');
  if (input.category !== undefined) b.category = CATEGORIES.some(([k]) => k === input.category) ? input.category : 'other';
  b.category = b.category || 'other';
  if (input.auto !== undefined) b.auto = Boolean(input.auto);
  b.auto = Boolean(b.auto);
  if (input.ends !== undefined) {
    if (input.ends && !isDay(input.ends)) throw new HttpError(400, 'ends must look like 2027-03-31');
    b.ends = input.ends || null;
  }
  if (input.notes !== undefined) b.notes = text(input.notes, 200) || null;
  if (input.personal !== undefined) {
    const personal = Boolean(input.personal);
    // A family bill someone else added stays theirs to make private.
    if (personal && !b.personal && b.owner && me && b.owner !== me) throw new HttpError(403, 'Only the person who added this bill can make it personal');
    b.personal = personal;
    if (personal && me) b.owner = me;
  }
  b.personal = Boolean(b.personal);
  if (!b.owner && me) b.owner = me;
  return b;
}

function register(router, store) {
  const data = () => {
    const d = store.get('bills', DEFAULT);
    if (!Array.isArray(d.items)) d.items = [];
    if (!d.dismissed || typeof d.dismissed !== 'object') d.dismissed = {};
    return d;
  };
  const visible = (me) => data().items.filter((b) => canSee(b, me));
  const find = (id, me) => {
    const b = data().items.find((x) => x.id === id);
    if (!b || !canSee(b, me)) throw new HttpError(404, 'No such bill');
    return b;
  };
  const view = (me) => overview(visible(me), { dismissed: data().dismissed });

  router.get('/api/v1/bills', (req) => ({ ...view(who(req)), categories: CATEGORIES.map(([key, label, emoji]) => ({ key, label, emoji })), every: EVERY.map(([key, label]) => ({ key, label })) }));
  router.post('/api/v1/bills', (req, body) => {
    const me = who(req);
    const b = { id: newId(), addedAt: new Date().toISOString(), ...clean({ personal: false, ...body }, undefined, me) };
    data().items.push(b);
    store.save();
    return b;
  });
  router.put('/api/v1/bills/:id', (req, body, { id }) => {
    const me = who(req);
    const b = find(id, me);
    Object.assign(b, clean(body, b, me));
    store.save();
    return b;
  });
  router.delete('/api/v1/bills/:id', (req, body, { id }) => {
    find(id, who(req));
    data().items = data().items.filter((x) => x.id !== id);
    store.save();
    return { ok: true };
  });
  // Paid: kept in the bill's history, and it moves on to the next time it's due.
  router.post('/api/v1/bills/:id/paid', (req, body, { id }) => {
    const b = find(id, who(req));
    if (b.done) throw new HttpError(409, 'That bill is already paid');
    const today = dayOf(new Date());
    const amount = body.amount !== undefined && body.amount !== '' ? money(body.amount) : b.amount;
    if (!Number.isFinite(amount) || amount < 0 || amount > 100000) throw new HttpError(400, 'Amount in pounds, like 120.50');
    const due = nextDue(b, today);
    b.paid = [...(b.paid || []), { id: newId(), date: isDay(body.date) ? body.date : today, amount: Math.round(amount * 100) / 100, due }].slice(-24);
    if (b.every === 'once') b.done = true;
    else b.due = step(due, b.every, b.day);
    store.save();
    return b;
  });
  // Undo the last "Paid", for a tap by mistake.
  router.post('/api/v1/bills/:id/unpaid', (req, body, { id }) => {
    const b = find(id, who(req));
    const last = (b.paid || []).pop();
    if (!last) throw new HttpError(409, 'Nothing to undo');
    if (last.due) b.due = last.due;
    delete b.done;
    store.save();
    return b;
  });
  router.post('/api/v1/bills/tips/dismiss', (req, body) => {
    const key = text(body.key, 120);
    if (!key) throw new HttpError(400, 'key is needed');
    const d = data();
    const now = Date.now();
    const until = new Date(now + 30 * 86400000).toISOString();
    const bill = d.items.find((b) => b.id === key.split('|')[1] && canSee(b, who(req)));
    if (bill && bill.personal) {
      bill.dismissed = Object.fromEntries(Object.entries(bill.dismissed || {}).filter(([, u]) => Date.parse(u) > now));
      bill.dismissed[key] = until;
    } else {
      for (const [k, u] of Object.entries(d.dismissed)) if (Date.parse(u) < now) delete d.dismissed[k];
      d.dismissed[key] = until;
    }
    store.save();
    return { ok: true };
  });

  return {
    // For reminders, the AI and the dashboard: only what this person may see.
    view,
    visible,
    tips: (me) => ruleTips(visible(me), dayOf(new Date()), data().dismissed),
  };
}

module.exports = { register, canSee };
