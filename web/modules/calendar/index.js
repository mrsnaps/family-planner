// Calendar module: HTTP routes over the engine. Owns the "calendar" key in the store.
const { newId } = require('../../lib/store');
const { HttpError, text } = require('../../lib/http');
const { STARTERS, occurrences, kitFor, dayOf, addDays, weekday } = require('./engine');

const DEFAULT = { events: [] };
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !isNaN(new Date(v));

function cleanEvent(input, existing = {}, children) {
  const e = { ...existing };
  if (input.title !== undefined) e.title = text(input.title, 60);
  if (!e.title) throw new HttpError(400, 'Event needs a name');
  if (input.emoji !== undefined) e.emoji = text(input.emoji, 8) || null;
  if (input.date !== undefined) {
    if (!isDay(input.date)) throw new HttpError(400, 'date must look like 2026-10-04');
    e.date = String(input.date);
  }
  if (!e.date) e.date = dayOf(new Date());
  if (input.time !== undefined) {
    if (input.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(input.time))) throw new HttpError(400, 'time must look like 15:30');
    e.time = input.time || null;
  }
  if (input.repeat !== undefined) {
    if (!['none', 'weekly', 'yearly'].includes(input.repeat)) throw new HttpError(400, 'repeat: none|weekly|yearly');
    e.repeat = input.repeat;
  }
  e.repeat = e.repeat || 'none';
  if (input.days !== undefined) {
    const days = Array.isArray(input.days) ? [...new Set(input.days.map(Number))] : [];
    if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new HttpError(400, 'days are weekdays 0 (Sunday) to 6');
    e.days = days.sort();
  }
  if (e.repeat === 'weekly' && !(e.days && e.days.length)) e.days = [weekday(e.date)];
  if (input.until !== undefined) {
    if (input.until && !isDay(input.until)) throw new HttpError(400, 'until must look like 2026-12-19');
    e.until = input.until || null;
  }
  if (input.who !== undefined) {
    const who = Array.isArray(input.who) ? [...new Set(input.who.map(String))] : [];
    if (who.some((id) => !children.some((c) => c.id === id))) throw new HttpError(400, 'Unknown child');
    e.who = who;
  }
  e.who = e.who || [];
  if (input.kit !== undefined) {
    const kit = (Array.isArray(input.kit) ? input.kit : String(input.kit || '').split(/[,\n]/)).map((k) => text(k, 40)).filter(Boolean);
    if (kit.length > 12) throw new HttpError(400, 'At most 12 things to pack');
    e.kit = [...new Set(kit)];
  }
  e.kit = e.kit || [];
  if (input.notes !== undefined) e.notes = text(input.notes, 200) || null;
  if (input.paused !== undefined) e.paused = Boolean(input.paused);
  return e;
}

function register(router, store, family) {
  const data = () => {
    const d = store.get('calendar', DEFAULT);
    if (!Array.isArray(d.events)) d.events = [];
    return d;
  };
  const today = () => dayOf(new Date());
  const kids = () => family().children;
  const upcoming = (days = 30, from = today()) => occurrences(data().events, kids(), { from, days });

  const view = (days = 30) => {
    const t = today();
    const list = upcoming(days, t);
    return {
      today: t,
      upcoming: list,
      events: data().events,
      kitToday: kitFor(list, t),
      kitTomorrow: kitFor(list, addDays(t, 1)),
      starters: STARTERS,
    };
  };

  router.get('/api/v1/calendar', (req) => {
    const days = Math.max(1, Math.min(400, Number(req.query && req.query.get('days')) || 30));
    return view(days);
  });

  // Add an event, or a starter (by key) on chosen weekdays for chosen children.
  router.post('/api/v1/calendar/events', (req, body) => {
    let input = body || {};
    if (input.starter) {
      const s = STARTERS.find((x) => x.key === input.starter);
      if (!s) throw new HttpError(404, 'No such starter');
      const { key, school, ...rest } = s;
      input = { ...rest, ...input, starter: key };
    }
    const e = { id: newId(), createdAt: new Date().toISOString(), ...(input.starter ? { starter: input.starter } : {}), ...cleanEvent(input, {}, kids()) };
    data().events.push(e);
    store.save();
    return e;
  });

  router.put('/api/v1/calendar/events/:id', (req, body, { id }) => {
    const d = data();
    const i = d.events.findIndex((e) => e.id === id);
    if (i < 0) throw new HttpError(404, 'No such event');
    d.events[i] = cleanEvent(body || {}, d.events[i], kids());
    store.save();
    return d.events[i];
  });

  // Skip one date of a repeating event (a bank holiday, a cancelled lesson).
  router.post('/api/v1/calendar/events/:id/skip', (req, body, { id }) => {
    const e = data().events.find((x) => x.id === id);
    if (!e) throw new HttpError(404, 'No such event');
    if (!isDay(body && body.date)) throw new HttpError(400, 'Which date? (date)');
    e.skip = [...new Set([...(e.skip || []), body.date])].filter((d) => d >= addDays(today(), -7)).sort();
    store.save();
    return e;
  });

  router.delete('/api/v1/calendar/events/:id', (req, body, { id }) => {
    const d = data();
    const before = d.events.length;
    d.events = d.events.filter((e) => e.id !== id);
    if (d.events.length === before) throw new HttpError(404, 'No such event');
    store.save();
    return { ok: true };
  });

  // For reminders, Home and the kitchen screen.
  const summary = () => {
    const t = today();
    const list = upcoming(15, t);
    return {
      today: t,
      todayList: list.filter((o) => o.date === t),
      tomorrowList: list.filter((o) => o.date === addDays(t, 1)),
      week: list.filter((o) => o.date <= addDays(t, 6)),
      birthdays: list.filter((o) => o.kind === 'birthday'),
      kitToday: kitFor(list, t),
      kitTomorrow: kitFor(list, addDays(t, 1)),
    };
  };

  return { view, summary, upcoming, events: () => data().events };
}

module.exports = { register };
