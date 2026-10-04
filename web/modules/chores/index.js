// Chores module: HTTP routes over the engine. Owns the "chores" key in the store.
// Chores repeat every so many days; ticking one off records who did it, and the rota
// shares out the coming week. Children earn effort points, and pocket money if set.
const { newId } = require('../../lib/store');
const { HttpError } = require('../../lib/http');
const { STARTERS, status, rota, choreSuggestions, weekTotals, canDo, dayOf, addDays } = require('./engine');

const DEFAULT = { list: [], log: [], adults: [], perPoint: 0, dismissed: {} };
const LOG_LIMIT = 600;
const SNOOZE_DAYS = 30; // "Not now" on a chore suggestion

function cleanChore(input, existing = {}, people) {
  const c = { ...existing };
  for (const k of ['name', 'area', 'emoji']) {
    if (input[k] !== undefined) c[k] = String(input[k] || '').trim().slice(0, 60) || null;
  }
  if (!c.name) throw new HttpError(400, 'Chore needs a name');
  for (const [k, lo, hi, def] of [['every', 1, 365, 7], ['effort', 1, 3, 1], ['minAge', 0, 18, 0]]) {
    if (input[k] !== undefined) {
      const n = Number(input[k]);
      if (!Number.isInteger(n) || n < lo || n > hi) throw new HttpError(400, `${k} must be a whole number from ${lo} to ${hi}`);
      c[k] = n;
    }
    if (c[k] === undefined) c[k] = def;
  }
  if (input.who !== undefined) {
    if (input.who && !people.some((p) => p.id === input.who)) throw new HttpError(400, 'Unknown person');
    c.who = input.who || null;
  }
  if (input.paused !== undefined) c.paused = Boolean(input.paused);
  c.who = c.who || null;
  return c;
}

function register(router, store, family) {
  const data = () => {
    const d = store.get('chores', DEFAULT);
    for (const [k, v] of Object.entries(DEFAULT)) if (d[k] === undefined) d[k] = structuredClone(v);
    return d;
  };
  const today = () => dayOf(new Date());

  // Grown-ups (named on the Chores page, as many as the family has) and the children.
  const people = () => {
    const f = family();
    const d = data();
    while (d.adults.length < f.adults) d.adults.push({ id: `adult-${newId().slice(0, 8)}`, name: `Grown-up ${d.adults.length + 1}` });
    return [
      ...d.adults.slice(0, f.adults).map((a) => ({ ...a, adult: true })),
      ...f.children.map((c) => ({ id: c.id, name: c.name, age: c.age, adult: false })),
    ];
  };

  const ruleSuggestions = () => {
    const d = data();
    const now = new Date().toISOString();
    return choreSuggestions(d.list, people(), d.log, { today: today() })
      .filter((s) => !(d.dismissed[s.starter || s.choreId] > now));
  };

  const view = () => {
    const d = data();
    const t = today();
    const ps = people();
    const chores = d.list.map((c) => ({ ...c, ...status(c, t), whoName: ps.find((p) => p.id === c.who)?.name || null }))
      .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.name.localeCompare(b.name)));
    const week = rota(d.list, ps, d.log, { today: t });
    const totals = weekTotals(ps, d.log, { today: t, perPoint: d.perPoint });
    const active = chores.filter((c) => !c.paused);
    const doneToday = d.log.filter((e) => dayOf(e.at) === t);
    return {
      today: t,
      people: ps,
      chores,
      rota: week,
      totals,
      perPoint: d.perPoint,
      suggestions: ruleSuggestions(),
      starters: STARTERS.filter((s) => !d.list.some((c) => c.starter === s.key)),
      recent: [...d.log].reverse().slice(0, 15),
      stats: {
        dueToday: active.filter((c) => c.state !== 'later').length,
        overdue: active.filter((c) => c.state === 'overdue').length,
        doneToday: doneToday.length,
        doneThisWeek: totals.reduce((n, p) => n + p.done, 0),
      },
    };
  };

  router.get('/api/v1/chores', () => view());

  // Add a chore, or one of the starters by key. "each" starters (tidy bedroom) make one per child old enough.
  router.post('/api/v1/chores', (req, body) => {
    const d = data();
    const ps = people();
    let inputs = [body || {}];
    if (body && body.starter) {
      const s = STARTERS.find((x) => x.key === body.starter);
      if (!s) throw new HttpError(404, 'No such starter chore');
      const { key, each, ...rest } = s;
      inputs = each
        ? ps.filter((p) => !p.adult && canDo(p, s)).map((p) => ({ ...rest, name: `${rest.name} (${p.name})`, who: p.id }))
        : [rest];
      if (!inputs.length) inputs = [rest];
      inputs = inputs.map((x) => ({ ...x, starter: key }));
    }
    const added = inputs.map((x) => ({ id: newId(), createdAt: new Date().toISOString(), ...(x.starter ? { starter: x.starter } : {}), ...cleanChore(x, {}, ps) }));
    d.list.push(...added);
    store.save();
    return added.length === 1 ? added[0] : { added };
  });

  // (These two come before /chores/:id so they aren't read as a chore id.)
  router.put('/api/v1/chores/people', (req, body) => {
    const d = data();
    people();
    for (const a of Array.isArray(body && body.adults) ? body.adults : []) {
      const it = d.adults.find((x) => x.id === a.id);
      const name = String(a.name || '').trim().slice(0, 30);
      if (it && name) it.name = name;
    }
    store.save();
    return people();
  });

  router.put('/api/v1/chores/settings', (req, body) => {
    const n = Number(body && body.perPoint);
    if (!Number.isFinite(n) || n < 0 || n > 500) throw new HttpError(400, 'Pocket money per point is in pence, 0 to 500');
    data().perPoint = Math.round(n);
    store.save();
    return { perPoint: data().perPoint };
  });

  router.put('/api/v1/chores/:id', (req, body, { id }) => {
    const d = data();
    const i = d.list.findIndex((c) => c.id === id);
    if (i < 0) throw new HttpError(404, 'No such chore');
    d.list[i] = cleanChore(body || {}, d.list[i], people());
    store.save();
    return d.list[i];
  });

  router.delete('/api/v1/chores/:id', (req, body, { id }) => {
    const d = data();
    const before = d.list.length;
    d.list = d.list.filter((c) => c.id !== id);
    if (d.list.length === before) throw new HttpError(404, 'No such chore');
    store.save();
    return { ok: true };
  });

  // Done: who did it (anyone in the family), and who ticked it (when signed in).
  router.post('/api/v1/chores/:id/done', (req, body, { id }) => {
    const d = data();
    const c = d.list.find((x) => x.id === id);
    if (!c) throw new HttpError(404, 'No such chore');
    const ps = people();
    const by = (body && body.by) || c.who || null;
    if (by && !ps.some((p) => p.id === by)) throw new HttpError(400, 'Unknown person');
    const entry = { id: newId(), choreId: c.id, name: c.name, by, effort: c.effort || 1, at: new Date().toISOString(), before: c.lastDone || null };
    const ticker = req && req.headers && req.headers['x-family-member'];
    if (ticker) entry.tickedBy = ticker;
    d.log.push(entry);
    if (d.log.length > LOG_LIMIT) d.log.splice(0, d.log.length - LOG_LIMIT);
    c.lastDone = entry.at;
    delete c.snoozedUntil;
    store.save();
    return { entry, chore: { ...c, ...status(c, today()) } };
  });

  // Undo a tick (pressed by mistake): the chore goes back to when it was last done before.
  router.delete('/api/v1/chores/log/:id', (req, body, { id }) => {
    const d = data();
    const e = d.log.find((x) => x.id === id);
    if (!e) throw new HttpError(404, 'Nothing to undo');
    d.log = d.log.filter((x) => x.id !== id);
    const c = d.list.find((x) => x.id === e.choreId);
    if (c && c.lastDone === e.at) c.lastDone = e.before || null;
    store.save();
    return { ok: true };
  });

  // Not today: move it to tomorrow (or a given number of days).
  router.post('/api/v1/chores/:id/skip', (req, body, { id }) => {
    const c = data().list.find((x) => x.id === id);
    if (!c) throw new HttpError(404, 'No such chore');
    const days = Math.max(1, Math.min(30, Number(body && body.days) || 1));
    c.snoozedUntil = addDays(today(), days);
    store.save();
    return { ...c, ...status(c, today()) };
  });

  router.post('/api/v1/chores/suggestions/dismiss', (req, body) => {
    if (!body || !body.key) throw new HttpError(400, 'Which suggestion? (key)');
    data().dismissed[String(body.key)] = new Date(Date.now() + SNOOZE_DAYS * 86400000).toISOString();
    store.save();
    return { ok: true };
  });

  const summary = () => {
    const v = view();
    return { ...v.stats, today: v.today, todayList: v.rota[0].items, totals: v.totals, overdueNames: v.chores.filter((c) => c.state === 'overdue' && !c.paused).map((c) => c.name) };
  };

  return { view, summary, people, ruleSuggestions, list: () => data().list, log: () => data().log, today };
}

module.exports = { register };
