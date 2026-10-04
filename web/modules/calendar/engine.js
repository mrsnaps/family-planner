// Family calendar: plain rules, no AI. Events happen once, every week on chosen days, or
// every year. Children's birthdays come from the family list. An event can say what kit
// to take (PE kit, swimming bag), so the evening before the app reminds whoever packs bags.
const DAY = 86400000;
const dayOf = (d) => new Date(d).toISOString().slice(0, 10);
const addDays = (day, n) => dayOf(new Date(day + 'T12:00:00Z').getTime() + n * DAY);
const weekday = (day) => new Date(day + 'T12:00:00Z').getUTCDay(); // 0 Sunday

// School and club days most families have. "kit" is what to pack that morning.
const STARTERS = [
  { key: 'pe', title: 'PE', emoji: '🏃', repeat: 'weekly', kit: ['PE kit', 'Trainers'], school: true },
  { key: 'swimming', title: 'Swimming', emoji: '🏊', repeat: 'weekly', kit: ['Swimming costume', 'Towel', 'Goggles'], school: true },
  { key: 'forest', title: 'Forest school', emoji: '🌳', repeat: 'weekly', kit: ['Wellies', 'Waterproofs', 'Old clothes'], school: true },
  { key: 'library', title: 'Library day', emoji: '📚', repeat: 'weekly', kit: ['Library book'], school: true },
  { key: 'spelling', title: 'Spelling test', emoji: '✏️', repeat: 'weekly', kit: ['Spelling book'], school: true },
  { key: 'football', title: 'Football', emoji: '⚽', repeat: 'weekly', kit: ['Football boots', 'Shin pads', 'Water bottle'] },
  { key: 'dance', title: 'Dance class', emoji: '🩰', repeat: 'weekly', kit: ['Dance shoes', 'Leotard'] },
  { key: 'swim-club', title: 'Swimming lesson', emoji: '🏊', repeat: 'weekly', kit: ['Swimming costume', 'Towel', 'Goggles', '£1 for the locker'] },
  { key: 'beavers', title: 'Beavers, Cubs or Brownies', emoji: '🏕️', repeat: 'weekly', kit: ['Uniform', 'Subs'] },
  { key: 'non-uniform', title: 'Non-uniform day', emoji: '🎨', repeat: 'none', kit: ['£1 donation'], school: true },
];

// Every occurrence from `from` for `days` days (inclusive of from), soonest first.
function occurrences(events, children, { from = dayOf(new Date()), days = 30 } = {}) {
  const to = addDays(from, days - 1);
  const out = [];
  const kids = new Map(children.map((c) => [c.id, c]));
  const names = (who) => (who && who.length ? who.map((id) => kids.get(id)?.name).filter(Boolean) : []);
  for (const e of events) {
    if (e.paused) continue;
    const push = (date) => {
      if (date < from || date > to || (e.until && date > e.until) || (e.skip || []).includes(date)) return;
      out.push({ id: `${e.id}:${date}`, eventId: e.id, date, title: e.title, emoji: e.emoji || '📅', time: e.time || null,
        who: e.who || [], whoNames: names(e.who), kit: e.kit || [], kind: e.kit && e.kit.length ? 'kit' : 'event', notes: e.notes || null });
    };
    if (e.repeat === 'weekly') {
      const wd = new Set(e.days && e.days.length ? e.days : [weekday(e.date)]);
      for (let d = 0; d < days; d++) {
        const date = addDays(from, d);
        if (date >= e.date && wd.has(weekday(date))) push(date);
      }
    } else if (e.repeat === 'yearly') {
      for (const y of [Number(from.slice(0, 4)), Number(from.slice(0, 4)) + 1]) {
        if (y >= Number(e.date.slice(0, 4))) push(`${y}${e.date.slice(4)}`);
      }
    } else push(e.date);
  }
  // Birthdays, worked out from each child's birth date.
  for (const c of children) {
    if (!c.birthDate) continue;
    const b = dayOf(c.birthDate);
    for (const y of [Number(from.slice(0, 4)), Number(from.slice(0, 4)) + 1]) {
      // A 29 February birthday is kept on 28 February in other years.
      let date = `${y}${b.slice(4)}`;
      if (b.slice(5) === '02-29' && dayOf(`${y}-03-01T12:00:00Z`) === addDays(`${y}-02-28`, 1)) date = `${y}-02-28`;
      if (date < from || date > to) continue;
      const age = y - Number(b.slice(0, 4));
      out.push({ id: `birthday-${c.id}-${y}`, eventId: null, date, title: `${c.name}'s birthday${age > 0 ? ` (${age})` : ''}`, emoji: '🎂', time: null,
        who: [c.id], whoNames: [c.name], kit: [], kind: 'birthday', notes: null });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time || '') < (b.time || '') ? -1 : 1));
}

// Kit to pack for a day, gathered per child (or "Everyone" for events with nobody chosen).
function kitFor(list, date) {
  const by = new Map();
  for (const o of list) {
    if (o.date !== date || !o.kit.length) continue;
    const keys = o.whoNames.length ? o.whoNames : ['Everyone'];
    for (const name of keys) {
      const g = by.get(name) || { name, items: [], events: [] };
      for (const k of o.kit) if (!g.items.includes(k)) g.items.push(k);
      g.events.push(o.title);
      by.set(name, g);
    }
  }
  return [...by.values()];
}

module.exports = { STARTERS, occurrences, kitFor, dayOf, addDays, weekday };
