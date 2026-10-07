// Bills: what goes out, how often and when, worked out with plain rules (no AI needed).
// A bill is either the family's (everyone in the household sees it) or personal (only the
// person who added it sees it; online it's kept in their own file, see infra/lambda/index.js).
const CATEGORIES = [
  ['home', 'Rent or mortgage', '🏠'],
  ['council', 'Council tax', '🏛️'],
  ['energy', 'Gas and electric', '⚡'],
  ['water', 'Water', '💧'],
  ['internet', 'Phone and internet', '📶'],
  ['insurance', 'Insurance', '🛡️'],
  ['subscriptions', 'Subscriptions', '📺'],
  ['childcare', 'Childcare and school', '🎒'],
  ['car', 'Car', '🚗'],
  ['loans', 'Loans and cards', '💳'],
  ['other', 'Other', '🧾'],
];
const EVERY = [
  ['week', 'Every week'],
  ['fortnight', 'Every 2 weeks'],
  ['4weeks', 'Every 4 weeks'],
  ['month', 'Every month'],
  ['quarter', 'Every 3 months'],
  ['year', 'Every year'],
  ['once', 'Just once'],
];
const PER_MONTH = { week: 52 / 12, fortnight: 26 / 12, '4weeks': 13 / 12, month: 1, quarter: 1 / 3, year: 1 / 12, once: 0 };
// Bills worth shopping around for before they renew.
const SHOP_AROUND = new Set(['insurance', 'energy', 'internet', 'car']);
const DAY = 86400000;

const round = (n) => Math.round(n * 100) / 100;
const dayOf = (d) => new Date(d).toISOString().slice(0, 10);
const toTime = (s) => Date.parse(s + 'T12:00:00Z');
const daysBetween = (a, b) => Math.round((toTime(b) - toTime(a)) / DAY);
const addDays = (s, n) => dayOf(toTime(s) + n * DAY);
const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
// Months keep the bill's own day (the 31st goes out on the last day of shorter months).
function addMonths(s, n, anchor) {
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  const d = Math.min(anchor || Number(s.slice(8, 10)), daysIn(yy, mm));
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function step(date, every, anchor) {
  switch (every) {
    case 'week': return addDays(date, 7);
    case 'fortnight': return addDays(date, 14);
    case '4weeks': return addDays(date, 28);
    case 'month': return addMonths(date, 1, anchor);
    case 'quarter': return addMonths(date, 3, anchor);
    case 'year': return addMonths(date, 12, anchor);
    default: return null;
  }
}

// When the bill is next due. A bill that pays itself (direct debit, standing order) moves on
// by itself once its day has passed; one paid by hand stays due until it's marked paid.
function nextDue(b, today) {
  if (b.done) return null;
  let d = b.due;
  if (!b.auto || b.every === 'once') return d;
  for (let i = 0; d < today && i < 2000; i++) d = step(d, b.every, b.day);
  return d;
}

// Every date the bill falls on between two days (inclusive), starting from its next due date.
function occurrences(b, from, to, today) {
  const out = [];
  let d = nextDue(b, today);
  for (let i = 0; d && d <= to && i < 400; i++) {
    if (d >= from || (!b.auto && d < today)) out.push(d);
    d = step(d, b.every, b.day);
  }
  return out;
}

const monthly = (b) => (b.done ? 0 : round(b.amount * (PER_MONTH[b.every] ?? 0)));
const catOf = (k) => CATEGORIES.find((c) => c[0] === k) || CATEGORIES[CATEGORIES.length - 1];
const pounds = (n) => `£${Number(n).toFixed(Number(n) % 1 ? 2 : 0)}`;
const prettyDay = (s) => new Date(toTime(s)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// Tips from plain rules: deals ending, renewals to shop around for, prices going up and
// subscriptions adding up. Each has a stable key so "Not now" can hide it for a while.
function ruleTips(bills, today, dismissed = {}) {
  const tips = [];
  const live = bills.filter((b) => !b.done);
  for (const b of live) {
    const next = nextDue(b, today);
    if (b.ends) {
      const left = daysBetween(today, b.ends);
      if (left >= 0 && left <= 45) {
        tips.push({ key: `ends|${b.id}|${b.ends}`, billId: b.id, kind: 'renewal', text: `${b.name}: the deal ends on ${prettyDay(b.ends)}. Compare prices or ask for a new deal before then, or it may go up.` });
      } else if (left < 0 && left >= -90) {
        tips.push({ key: `ended|${b.id}|${b.ends}`, billId: b.id, kind: 'renewal', text: `${b.name}: the deal ended on ${prettyDay(b.ends)}, so you may be paying the out-of-contract price. It's worth asking for a new deal.` });
      }
    } else if (b.every === 'year' && SHOP_AROUND.has(b.category) && next && daysBetween(today, next) <= 30 && daysBetween(today, next) >= 0) {
      tips.push({ key: `renew|${b.id}|${next}`, billId: b.id, kind: 'renewal', text: `${b.name} renews on ${prettyDay(next)}. Getting a few quotes first often saves money.` });
    }
    const last = (b.changes || [])[b.changes ? b.changes.length - 1 : 0];
    if (last && last.from > 0 && last.to > last.from * 1.05 && daysBetween(last.date, today) <= 90) {
      const pct = Math.round(((last.to - last.from) / last.from) * 100);
      tips.push({ key: `rise|${b.id}|${last.date}`, billId: b.id, kind: 'price', text: `${b.name} went up ${pct}%, from ${pounds(last.from)} to ${pounds(last.to)}. Check it's right, and whether there's a cheaper option.` });
    }
  }
  const subs = live.filter((b) => b.category === 'subscriptions' && b.every !== 'once');
  if (subs.length >= 3) {
    const total = round(subs.reduce((n, b) => n + monthly(b), 0));
    tips.push({ key: `subs|${subs.length}`, kind: 'subscriptions', text: `${subs.length} subscriptions come to about ${pounds(total)} a month (${subs.map((b) => b.name).join(', ')}). Worth checking you still use them all.` });
  }
  // "Not now" on a personal bill's tip is kept on that bill, so it stays private too.
  const now = toTime(today);
  const byId = new Map(bills.map((b) => [b.id, b]));
  const until = (t) => dismissed[t.key] || (t.billId && byId.get(t.billId)?.dismissed?.[t.key]);
  return tips.filter((t) => !(until(t) && Date.parse(until(t)) > now));
}

// Everything the Bills page shows, for the bills this person can see.
function overview(bills, { today = dayOf(new Date()), dismissed = {} } = {}) {
  const in30 = addDays(today, 30);
  const monthEnd = `${today.slice(0, 7)}-${String(daysIn(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1)).padStart(2, '0')}`;
  const list = bills.map((b) => {
    const next = nextDue(b, today);
    const days = next ? daysBetween(today, next) : null;
    const [, label, emoji] = catOf(b.category);
    return {
      ...b,
      next,
      days,
      status: b.done ? 'done' : days < 0 ? 'overdue' : days === 0 ? 'today' : days <= 7 ? 'soon' : 'later',
      monthly: monthly(b),
      label,
      emoji,
    };
  }).sort((a, b) => (a.done - b.done) || String(a.next || '9').localeCompare(String(b.next || '9')) || a.name.localeCompare(b.name));
  const upcoming = [];
  for (const b of list) {
    for (const date of occurrences(b, today, in30, today)) {
      upcoming.push({ billId: b.id, name: b.name, emoji: b.emoji, amount: b.amount, date, days: daysBetween(today, date), auto: Boolean(b.auto), personal: Boolean(b.personal) });
    }
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const sum = (xs) => round(xs.reduce((n, b) => n + b.monthly, 0));
  const leftThisMonth = round(upcoming.filter((u) => u.date <= monthEnd).reduce((n, u) => n + u.amount, 0));
  const byCat = new Map();
  for (const b of list) if (b.monthly) byCat.set(b.category, round((byCat.get(b.category) || 0) + b.monthly));
  return {
    today,
    bills: list,
    upcoming,
    totals: {
      family: sum(list.filter((b) => !b.personal)),
      personal: sum(list.filter((b) => b.personal)),
      all: sum(list),
      leftThisMonth,
      overdue: list.filter((b) => b.status === 'overdue').length,
    },
    byCategory: [...byCat].sort((a, b) => b[1] - a[1]).map(([key, total]) => ({ key, label: catOf(key)[1], emoji: catOf(key)[2], total })),
    tips: ruleTips(bills, today, dismissed),
  };
}

module.exports = { CATEGORIES, EVERY, PER_MONTH, nextDue, occurrences, step, monthly, ruleTips, overview, addDays, daysBetween, dayOf, prettyDay, pounds };
