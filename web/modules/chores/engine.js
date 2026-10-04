// Chores: plain rules, no AI. Each chore repeats every so many days. The rota shares the
// next week's chores out fairly: only to people old enough, fewest effort points first
// (counting the last two weeks), and not the same person twice in a row when it can help.
const DAY = 86400000;

// Common household chores to start from. effort: 1 quick, 2 medium, 3 big job.
const STARTERS = [
  { key: 'dishes', name: 'Wash up or load the dishwasher', emoji: '🍽️', area: 'Kitchen', every: 1, effort: 1, minAge: 7 },
  { key: 'table', name: 'Set and clear the table', emoji: '🍴', area: 'Kitchen', every: 1, effort: 1, minAge: 4 },
  { key: 'kitchen', name: 'Wipe the kitchen sides and hob', emoji: '🧽', area: 'Kitchen', every: 2, effort: 1, minAge: 9 },
  { key: 'bins', name: 'Take the bins out', emoji: '🗑️', area: 'Outside', every: 7, effort: 1, minAge: 8 },
  { key: 'recycling', name: 'Sort the recycling', emoji: '♻️', area: 'Kitchen', every: 3, effort: 1, minAge: 5 },
  { key: 'hoover', name: 'Hoover downstairs', emoji: '🧹', area: 'Living room', every: 4, effort: 2, minAge: 9 },
  { key: 'mop', name: 'Mop the floors', emoji: '🪣', area: 'Kitchen', every: 7, effort: 2, minAge: 11 },
  { key: 'bathroom', name: 'Clean the bathroom', emoji: '🛁', area: 'Bathroom', every: 7, effort: 3, minAge: 12 },
  { key: 'toilet', name: 'Clean the toilet', emoji: '🚽', area: 'Bathroom', every: 4, effort: 2, minAge: 12 },
  { key: 'laundry', name: 'Put a wash on and hang it out', emoji: '🧺', area: 'Laundry', every: 2, effort: 2, minAge: 11 },
  { key: 'fold', name: 'Fold and put away clothes', emoji: '👕', area: 'Laundry', every: 3, effort: 1, minAge: 5 },
  { key: 'beds', name: 'Change the beds', emoji: '🛏️', area: 'Bedrooms', every: 14, effort: 2, minAge: 10 },
  { key: 'tidy-room', name: 'Tidy bedroom', emoji: '🧸', area: 'Bedrooms', every: 2, effort: 1, minAge: 3, each: true },
  { key: 'toys', name: 'Put toys away', emoji: '🧩', area: 'Living room', every: 1, effort: 1, minAge: 3 },
  { key: 'dust', name: 'Dust', emoji: '🪶', area: 'Living room', every: 7, effort: 1, minAge: 6 },
  { key: 'fridge', name: 'Clear out the fridge', emoji: '🧊', area: 'Kitchen', every: 7, effort: 1, minAge: 12 },
  { key: 'plants', name: 'Water the plants', emoji: '🪴', area: 'Outside', every: 3, effort: 1, minAge: 5 },
  { key: 'pet', name: 'Feed the pet', emoji: '🐾', area: 'Pets', every: 1, effort: 1, minAge: 6 },
  { key: 'windows', name: 'Clean the windows', emoji: '🪟', area: 'Whole house', every: 30, effort: 3, minAge: 12 },
  { key: 'car', name: 'Clean the car', emoji: '🚗', area: 'Outside', every: 21, effort: 3, minAge: 10 },
  { key: 'lawn', name: 'Mow the lawn', emoji: '🌱', area: 'Outside', every: 10, effort: 3, minAge: 14 },
];

const dayOf = (d) => new Date(d).toISOString().slice(0, 10);
const addDays = (day, n) => dayOf(new Date(day + 'T12:00:00Z').getTime() + n * DAY);
const between = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / DAY);

// When a chore is next due: never done means today; snoozing pushes it to a later day.
function nextDue(chore, today) {
  let due = chore.lastDone ? addDays(dayOf(chore.lastDone), chore.every) : today;
  if (chore.snoozedUntil && chore.snoozedUntil > due) due = chore.snoozedUntil;
  return due;
}

function status(chore, today) {
  const due = nextDue(chore, today);
  const days = between(today, due);
  return { due, dueIn: days, state: days < 0 ? 'overdue' : days === 0 ? 'today' : 'later' };
}

// Everyone who can help: grown-ups always, children once they're old enough for the chore.
const canDo = (person, chore) => person.adult || (person.age != null && person.age >= (chore.minAge || 0));

function pointsSince(log, since) {
  const pts = new Map();
  for (const e of log) if (e.at >= since && e.by) pts.set(e.by, (pts.get(e.by) || 0) + (e.effort || 1));
  return pts;
}

// The next `days` days of chores, each with someone to do it. Overdue chores land on today.
function rota(chores, people, log = [], { today = dayOf(new Date()), days = 7 } = {}) {
  const load = pointsSince(log, addDays(today, -14));
  const lastBy = new Map();
  for (const e of [...log].sort((a, b) => (a.at < b.at ? -1 : 1))) lastBy.set(e.choreId, e.by);
  const byId = new Map(people.map((p) => [p.id, p]));
  const out = [];
  for (let d = 0; d < days; d++) out.push({ date: addDays(today, d), items: [] });
  const jobs = [];
  for (const c of chores) {
    if (c.paused) continue;
    let due = nextDue(c, today);
    if (due < today) due = today;
    for (let day = due; between(today, day) < days; day = addDays(day, Math.max(1, c.every))) jobs.push({ c, day });
  }
  // Bigger jobs are handed out first, so the small ones even things up.
  jobs.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : (b.c.effort || 1) - (a.c.effort || 1)));
  for (const { c, day } of jobs) {
    let who = c.who && byId.has(c.who) ? byId.get(c.who) : null;
    if (!who) {
      const able = people.filter((p) => canDo(p, c));
      able.sort((a, b) => (load.get(a.id) || 0) - (load.get(b.id) || 0) || Number(lastBy.get(c.id) === a.id) - Number(lastBy.get(c.id) === b.id) || Number(!!a.adult) - Number(!!b.adult));
      who = able[0] || null;
    }
    if (who) {
      load.set(who.id, (load.get(who.id) || 0) + (c.effort || 1));
      lastBy.set(c.id, who.id);
    }
    out[between(today, day)].items.push({ choreId: c.id, name: c.name, emoji: c.emoji || '🧹', effort: c.effort || 1, who: who ? who.id : null, whoName: who ? who.name : null, overdue: nextDue(c, today) < today && day === today });
  }
  return out;
}

// Ideas from the household's own record: starters that suit the family, and chores done
// much more or less often than planned (suggest the gap they actually keep to).
function choreSuggestions(chores, people, log = [], { today = dayOf(new Date()) } = {}) {
  const out = [];
  const have = new Set(chores.map((c) => c.starter || c.name.toLowerCase()));
  const kids = people.filter((p) => !p.adult && p.age != null);
  for (const c of chores) {
    const dates = [...new Set(log.filter((e) => e.choreId === c.id).map((e) => dayOf(e.at)))].sort().slice(-4);
    if (dates.length < 3) continue;
    const gaps = dates.slice(1).map((d, i) => between(dates[i], d)).sort((a, b) => a - b);
    const typical = gaps[Math.floor(gaps.length / 2)];
    if (typical >= 1 && Math.abs(typical - c.every) / c.every >= 0.5 && Math.abs(typical - c.every) >= 2) {
      out.push({ kind: 'every', choreId: c.id, name: c.name, every: typical, reason: `You usually do this every ${typical} day${typical === 1 ? '' : 's'}, not every ${c.every}.` });
    }
  }
  let adds = 0;
  for (const s of STARTERS) {
    if (adds >= 4) break;
    if (have.has(s.key) || have.has(s.name.toLowerCase()) || s.key === 'pet' || s.key === 'lawn' || s.key === 'car') continue;
    const young = kids.filter((k) => k.age >= s.minAge && k.age < s.minAge + 6);
    if (!young.length) continue;
    adds += 1;
    out.push({ kind: 'add', starter: s.key, name: s.name, emoji: s.emoji, every: s.every, reason: `${young.map((k) => k.name).join(' and ')} ${young.length === 1 ? 'is' : 'are'} old enough to help with this.` });
  }
  // Nothing at all yet: suggest the everyday basics.
  if (!chores.length && !out.some((x) => x.kind === 'add')) {
    for (const key of ['dishes', 'bins', 'hoover', 'bathroom', 'laundry', 'beds']) {
      const s = STARTERS.find((x) => x.key === key);
      out.push({ kind: 'add', starter: s.key, name: s.name, emoji: s.emoji, every: s.every, reason: 'A common household chore to start with.' });
    }
  }
  return out.slice(0, 8);
}

// The week so far for each person: chores done, effort points and pocket money earned.
function weekTotals(people, log, { today = dayOf(new Date()), perPoint = 0 } = {}) {
  const since = addDays(today, -6);
  return people.map((p) => {
    const mine = log.filter((e) => e.by === p.id && dayOf(e.at) >= since);
    const points = mine.reduce((t, e) => t + (e.effort || 1), 0);
    return { id: p.id, name: p.name, adult: !!p.adult, done: mine.length, points, money: !p.adult && perPoint ? Math.round(points * perPoint) / 100 : null };
  });
}

module.exports = { STARTERS, nextDue, status, rota, choreSuggestions, weekTotals, canDo, dayOf, addDays };
