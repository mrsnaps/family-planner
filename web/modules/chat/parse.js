// The chat's rules version: turns everyday sentences into the app's actions with plain
// patterns, no AI. "we need milk and eggs", "Leo did the bins", "spent £20 at Tesco",
// "Mia has a party Saturday at 2", "what's on today". Used when no AI is set up, offline, and
// by the "Hey Siri, tell Family Planner" Shortcut on the server (infra/lambda/index.js inlines
// this file, so it must not require anything).
//
// parse(text, ctx) -> { actions: [{ name, args }], unknown: ['bits it could not follow'] }
// ctx: { today: 'YYYY-MM-DD', people: [{ id, name, adult }], children: [{ id, name }],
//        shopping: [{ id, name, done }], pantry: [{ id, name, quantity }], chores: [{ id, name, who }],
//        events: [{ id, title }] }  (any can be missing)

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_RE = '(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?';
const HOUSEHOLD = /\b(bin bags?|bin liners?|toilet (?:roll|paper)s?|kitchen roll|loo roll|washing[- ]up liquid|washing (?:powder|liquid|pods?)|fabric conditioner|dishwasher (?:tablets?|salt)|bleach|sponges?|foil|cling ?film|batter(?:y|ies)|light ?bulbs?|soap|hand wash|shampoo|conditioner|toothpaste|toothbrush(?:es)?|nappies|wipes|tissues|plasters|calpol|presents?|cards?|wrapping paper|candles|sellotape)\b/i;
const UNIT_WORDS = { kg: 'kg', kilo: 'kg', kilos: 'kg', g: 'g', gram: 'g', grams: 'g', ml: 'ml', l: 'l', litre: 'l', litres: 'l', liter: 'l', pack: 'pack', packs: 'pack', tin: 'tin', tins: 'tin', can: 'tin', cans: 'tin', bottle: 'pcs', bottles: 'pcs', loaf: 'pcs', loaves: 'pcs', box: 'pack', boxes: 'pack', bag: 'pack', bags: 'pack', pint: 'pcs', pints: 'pcs' };
const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, dozen: 12, half: 0.5 };
const SPEND = { food: /\b(food|groceries|grocery|shopping|supermarket|tesco|sainsbury'?s?|asda|aldi|lidl|morrisons|waitrose|co-?op|iceland|m&s|ocado)\b/i, clothes: /\b(clothes|shoes|uniform|clothing|next|primark|george|matalan|clarks|h&m|zara|tu)\b/i, household: /\b(household|cleaning|boots|superdrug|b&m|wilko|ikea|argos|home ?bargains|the range|bills?)\b/i, activities: /\b(activit(?:y|ies)|club|clubs|swimming|lessons?|football|dance|cinema|trip|tickets?|party|parties)\b/i };

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const norm = (s) => clean(String(s || '').toLowerCase().replace(/[^a-z0-9£&' -]/g, ' ')).replace(/^(the|some|a|an|my|our)\s+/, '').replace(/(es|s)$/, '');
const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const listOf = (s) => String(s || '').split(/\s*(?:,|;|&|\band\b|\bplus\b)\s*/i).map((x) => clean(x).replace(/^[.!?]+|[.!?]+$/g, '')).filter(Boolean);

// Find the best match by name: exact, then one containing the other.
function find(list, name, key = 'name') {
  const n = norm(name);
  if (!n || !Array.isArray(list)) return null;
  const named = list.filter((x) => x && x[key]);
  return named.find((x) => norm(x[key]) === n)
    || named.find((x) => norm(x[key]).split(' ').includes(n) || norm(x[key]).startsWith(n + ' '))
    || named.find((x) => norm(x[key]).includes(n) || n.includes(norm(x[key])))
    || null;
}

// Dates, worked out from today in UTC like the rest of the app.
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const dowOf = (day) => new Date(day + 'T00:00:00Z').getUTCDay();
function weekdayIndex(word) {
  const w = String(word || '').toLowerCase().slice(0, 3);
  return WEEKDAYS.findIndex((d) => d.startsWith(w));
}
// The coming weekday (today if it is that day), or the one after with "next" when said a week ahead.
function dateFor(word, today, next = false) {
  const w = String(word || '').toLowerCase();
  if (w === 'today' || w === 'tonight') return today;
  if (w === 'tomorrow') return addDays(today, 1);
  const i = weekdayIndex(w);
  if (i < 0) return null;
  let gap = (i - dowOf(today) + 7) % 7;
  if (next && gap === 0) gap = 7;
  return addDays(today, gap);
}
// "at 2", "at 2pm", "at 10.30am", "at 14:30" -> "14:00". Small hours without am/pm are afternoon.
function timeOf(h, m, ampm) {
  let hour = Number(h);
  const min = Number(m || 0);
  if (!Number.isInteger(hour) || hour > 23 || min > 59) return null;
  const ap = String(ampm || '').toLowerCase();
  if (ap === 'pm' && hour < 12) hour += 12;
  else if (ap === 'am' && hour === 12) hour = 0;
  else if (!ap && hour >= 1 && hour <= 7) hour += 12;
  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
// "Friday", "tomorrow", "12 Oct", "12/10" -> a date, for use-by dates.
function looseDate(text, today) {
  const t = clean(text).toLowerCase();
  const d = dateFor(t.replace(/^(this|next)\s+/, ''), today, /^next\b/.test(t));
  if (d) return d;
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  let m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})/.exec(t);
  let day;
  let month;
  if (m) {
    day = Number(m[1]);
    month = months.indexOf(m[2]);
  } else if ((m = /^(\d{1,2})\/(\d{1,2})$/.exec(t))) {
    day = Number(m[1]);
    month = Number(m[2]) - 1;
  } else return null;
  if (month < 0 || day < 1 || day > 31) return null;
  let year = Number(today.slice(0, 4));
  let out = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (out < addDays(today, -30)) out = `${year + 1}${out.slice(4)}`;
  return isNaN(Date.parse(out)) ? null : out;
}

// "2kg chicken thighs", "3 eggs", "a loaf of bread", "milk x2" -> { name, quantity, unit }.
function item(text) {
  let t = clean(text).replace(/^(some|more|another)\s+/i, '');
  let quantity = null;
  let unit = null;
  let m = /^(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|half a|half|a dozen|dozen)\s*(kg|kilos?|g|grams?|ml|l|litres?|liters?|packs?|tins?|cans?|bottles?|loaf|loaves|box(?:es)?|bags?|pints?)?\s+(?:of\s+)?(.+)$/i.exec(t);
  if (m) {
    const n = m[1].toLowerCase().replace(/^half a$/, 'half').replace(/^a dozen$/, 'dozen');
    quantity = NUMBER_WORDS[n] !== undefined ? NUMBER_WORDS[n] : Number(n);
    if (m[2]) unit = UNIT_WORDS[m[2].toLowerCase()] || null;
    t = m[3];
    // "a bin bags" style slips: just the name.
    if ((n === 'a' || n === 'an') && !m[2]) quantity = null;
  } else if ((m = /^(.+?)\s*(?:x|×)\s*(\d+)$/i.exec(t))) {
    t = m[1];
    quantity = Number(m[2]);
  }
  const name = clean(t).replace(/^(the|some)\s+/i, '').slice(0, 80);
  if (!name) return null;
  return { name: capFirst(name), quantity, unit, kind: HOUSEHOLD.test(name) ? 'other' : 'food' };
}

const personRe = (ctx) => {
  const names = [...(ctx.people || []), ...(ctx.children || [])].map((p) => p.name).filter(Boolean)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return names.length ? names.join('|') : null;
};
const personByName = (ctx, name) => find([...(ctx.people || []), ...(ctx.children || [])], name);

// Where " and " starts a new request rather than another item: "milk and Leo did the bins".
function clauses(text, ctx) {
  const who = personRe(ctx);
  const starts = new RegExp(`^(?:(?:we|i)\\s+(?:need|spent|bought|got|used|finished)|(?:please\\s+)?add|spent|tick|put|move|undo|what|how|no\\s|${who ? `(?:${who})\\s+(?:did|has|done|finished|have)` : '\\b\\B'})`, 'i');
  const out = [];
  for (const sentence of String(text || '').split(/(?:[.!?;]+\s+|\n+|\bthen\b)/i)) {
    let parts = [sentence];
    const bits = sentence.split(/\s+and\s+(?:also\s+)?/i);
    if (bits.length > 1) {
      parts = [bits[0]];
      for (const b of bits.slice(1)) {
        if (starts.test(clean(b))) parts.push(b);
        else parts[parts.length - 1] += ' and ' + b;
      }
    }
    out.push(...parts.map((p) => clean(p).replace(/[.!?]+$/, '')).filter(Boolean));
  }
  return out;
}

function parse(text, ctx = {}) {
  const today = ctx.today || new Date().toISOString().slice(0, 10);
  const actions = [];
  const unknown = [];
  const add = (name, args = {}) => actions.push({ name, args });
  for (const raw of clauses(text, ctx)) {
    const t = raw.replace(/^(?:ok(?:ay)?|right|hi|hey|please|can you|could you)[,\s]+/i, '').replace(/\s+please$/i, '');
    let m;
    if (/^(undo|undo that|undo it|take that back|cancel that|go back)$/i.test(t)) { add('undo_last'); continue; }
    if (/^(help|what can you do\??)$/i.test(t)) { add('help', {}); continue; }
    if ((m = /^how (?:do|can|would) (?:i|we|you)\s+(.+)$/i.exec(t))) { add('help', { topic: m[1] }); continue; }
    if (/^(?:what'?s|what is|show(?: me)?|read(?: me)?)(?: left)? (?:on )?(?:the )?(?:shopping )?list\??$|^what (?:do|else do) (?:we|i) need(?: to buy)?\??$/i.test(t)) { add('shopping.list'); continue; }
    if ((m = /^(?:what'?s|what is) (?:on|happening|up)(?: (today|tomorrow|this week|next week))?\??$|^what do (?:i|we) need to know(?: today)?\??$|^(?:today|morning) briefing$/i.exec(t))) {
      const w = (m[1] || 'today').toLowerCase();
      add('briefing', { days: w === 'this week' || w === 'next week' ? 7 : w === 'tomorrow' ? 2 : 1 });
      continue;
    }
    if (/^(?:what'?s|what is|what'?ll we have) for (?:dinner|tea|supper)|^what (?:can|could|shall|should) (?:i|we) (?:cook|make|have)(?: for (?:dinner|tea))?|^dinner ideas|^ideas for (?:dinner|tea)/i.test(t)) { add('food.meals_now'); continue; }
    if (/^plan (?:the |our |this )?(?:week|week'?s (?:dinners|meals)|dinners|meals)/i.test(t)) { add('food.plan_week', {}); continue; }
    if (/(?:is )?anything going off|what'?s going off|use[- ]by|going out of date/i.test(t) && !/^(?:just )?bought/i.test(t)) { add('food.expiring'); continue; }
    if ((m = /^how many points (?:has|does|have) (\w+)/i.exec(t)) || (m = /^(\w+)'s points$/i.exec(t))) {
      const p = personByName(ctx, m[1]);
      add('chores.status', p ? { personId: p.id } : {});
      continue;
    }
    if (/^(?:what|which) chores|^what jobs|^whose turn|^who'?s doing/i.test(t)) { add('chores.status', {}); continue; }
    if ((m = /^what (?:should|can|will) (\w+) wear/i.exec(t))) {
      const c = find(ctx.children, m[1]);
      if (c) add('clothes.outfit', { childId: c.id });
      else unknown.push(raw);
      continue;
    }
    if (/^how much (?:have|did|has) (?:we|i|the family) spen[dt]|^what have we spent|^spending this month|^how'?s the budget/i.test(t)) { add('money.overview'); continue; }
    if ((m = /^(?:(?:i|we)\s+)?(?:just\s+)?spent\s+£?\s*(\d+(?:\.\d{1,2})?)(?:\s*(?:pounds|quid))?(?:\s+(?:at|in)\s+([\w'&. -]+?))?(?:\s+on\s+([\w' -]+?))?$/i.exec(t))) {
      const shop = m[2] ? clean(m[2]) : null;
      const what = `${m[3] || ''} ${shop || ''}`;
      const category = Object.keys(SPEND).find((k) => SPEND[k].test(m[3] || '')) || Object.keys(SPEND).find((k) => SPEND[k].test(what)) || (m[3] ? 'other' : 'food');
      add('money.spend', { amount: Number(m[1]), shop: shop ? capFirst(shop) : null, category });
      continue;
    }
    const who = personRe(ctx);
    if (who && (m = new RegExp(`^(${who})\\s+(?:did|has done|done|finished|has finished|have done|just did)\\s+(.+)$`, 'i').exec(t))) {
      const p = personByName(ctx, m[1]);
      for (const job of listOf(m[2])) {
        const c = find(ctx.chores, job.replace(/^(the|their|his|her|my)\s+/i, ''));
        if (c) add('chores.done', { choreId: c.id, by: p.id });
        else unknown.push(`${p.name} did ${job}`);
      }
      continue;
    }
    if ((m = /^(?:i\s+|we\s+)?(?:put|move|moved|froze|freeze)\s+(?:the\s+)?(.+?)\s+(?:in|into)\s+the\s+freezer$/i.exec(t)) || (m = /^freeze\s+(?:the\s+)?(.+)$/i.exec(t))) {
      for (const n of listOf(m[1])) {
        const p = find(ctx.pantry, n);
        if (p) add('food.freeze', { itemId: p.id, frozen: true });
        else unknown.push(`${n} isn't in the cupboards`);
      }
      continue;
    }
    if ((m = /^(?:take|took|get|got)\s+(?:the\s+)?(.+?)\s+out of the freezer$/i.exec(t)) || (m = /^defrost\s+(?:the\s+)?(.+)$/i.exec(t))) {
      for (const n of listOf(m[1])) {
        const p = find(ctx.pantry, n);
        if (p) add('food.freeze', { itemId: p.id, frozen: false });
        else unknown.push(`${n} isn't in the freezer`);
      }
      continue;
    }
    if ((m = /^(?:we(?:'ve| have)?\s+|i(?:'ve| have)?\s+)?(?:used|finished)\s+(?:up\s+)?(?:the\s+)?(?:last\s+(?:of\s+)?)?(?:the\s+)?(.+)$/i.exec(t))) {
      for (const n of listOf(m[1])) {
        const p = find(ctx.pantry, n);
        if (p) add('food.used_up', { itemId: p.id });
        else unknown.push(`${n} isn't in the cupboards`);
      }
      continue;
    }
    if ((m = /^(?:we(?:'re| are)\s+|i(?:'m| am)\s+|we(?:'ve| have)\s+)?(?:run|ran|running)?\s*out of\s+(.+)$/i.exec(t))) {
      const items = listOf(m[1]).map(item).filter(Boolean);
      for (const it of items) {
        const p = find(ctx.pantry, it.name);
        if (p && p.quantity !== 0) add('food.used_up', { itemId: p.id });
      }
      if (items.length) add('shopping.add', { items });
      continue;
    }
    if ((m = /^(?:i\s+|we\s+)?(?:just\s+)?(?:bought|got|picked up)\s+(.+)$/i.exec(t))) {
      let rest = m[1];
      let expiry = null;
      const ub = /,?\s*(?:use by|best before|goes off|off)\s+(?:on\s+)?(.+)$/i.exec(rest);
      if (ub) {
        expiry = looseDate(ub[1], today);
        rest = rest.slice(0, ub.index);
      }
      const fresh = [];
      for (const it of listOf(rest).map(item).filter(Boolean)) {
        const onList = find((ctx.shopping || []).filter((s) => !s.done), it.name);
        if (onList) add('shopping.bought', { itemId: onList.id, ...(it.quantity ? { quantity: it.quantity } : {}), ...(it.unit ? { unit: it.unit } : {}), ...(expiry ? { expiry } : {}) });
        else if (it.kind === 'food') fresh.push({ name: it.name, quantity: it.quantity, unit: it.unit || 'pcs', ...(expiry ? { expiry } : {}) });
      }
      if (fresh.length) add('food.add', { items: fresh });
      continue;
    }
    if ((m = /^tick(?:\s+off)?\s+(.+?)(?:\s+(?:on|off)\s+the\s+(?:shopping\s+)?list)?$/i.exec(t))) {
      for (const n of listOf(m[1])) {
        const s = find(ctx.shopping, n);
        if (s) add('shopping.tick', { itemId: s.id, done: true });
        else unknown.push(`${n} isn't on the list`);
      }
      continue;
    }
    if ((m = /^(?:remove|take|delete|cross)\s+(.+?)\s+(?:off|from)\s+(?:the\s+)?(?:shopping\s+)?list$/i.exec(t))) {
      for (const n of listOf(m[1])) {
        const s = find(ctx.shopping, n);
        if (s) add('shopping.remove', { itemId: s.id });
        else unknown.push(`${n} isn't on the list`);
      }
      continue;
    }
    if ((m = /^(?:add|put)\s+(.+?)\s+(?:to|in|into)\s+(?:the\s+)?(?:cupboards?|fridge|pantry|what'?s in)$/i.exec(t))) {
      const items = listOf(m[1]).map(item).filter(Boolean).map((it) => ({ name: it.name, quantity: it.quantity, unit: it.unit || 'pcs' }));
      if (items.length) add('food.add', { items });
      continue;
    }
    // "No PE next Tuesday", "no swimming this week": skip one date of a repeating event.
    if ((m = new RegExp(`^no\\s+(.+?)\\s+(?:on\\s+)?(this|next)?\\s*(${DAY_RE}|today|tomorrow)$`, 'i').exec(t))) {
      const ev = find(ctx.events, m[1], 'title');
      const date = dateFor(m[3], today, m[2] === 'next');
      if (ev && date) add('calendar.skip', { eventId: ev.id, date });
      else unknown.push(raw);
      continue;
    }
    if ((m = /^(?:please\s+)?(?:add|we need|i need|need|buy|get|pick up|put)\s+(.+?)(?:\s+(?:to|on|onto)\s+(?:the\s+)?(?:shopping\s+)?list)?$/i.exec(t))) {
      const items = listOf(m[1]).map(item).filter(Boolean);
      if (items.length) add('shopping.add', { items });
      else unknown.push(raw);
      continue;
    }
    const ev = event(t, ctx, today);
    if (ev) {
      add('calendar.add', ev.event);
      if (ev.present) add('shopping.add', { items: [{ name: ev.present, kind: 'other', quantity: null, unit: null }] });
      continue;
    }
    unknown.push(raw);
  }
  return { actions, unknown };
}

// "Mia has a party Saturday at 2, she needs a present", "PE on Tuesday for Mia",
// "Leo has swimming every Thursday from next week" -> a Diary event.
function event(text, ctx, today) {
  const dayM = new RegExp(`\\b(?:(every|each|on|this|next)\\s+)?(${DAY_RE}s?|today|tonight|tomorrow)\\b`, 'i').exec(text);
  if (!dayM) return null;
  let t = text;
  const weekly = /^(every|each)$/i.test(dayM[1] || '') || /days$/i.test(dayM[2]) && !/^(to|tomo)/i.test(dayM[2]);
  const next = /^next$/i.test(dayM[1] || '');
  const dayWord = dayM[2].replace(/s$/i, '');
  let date = dateFor(dayWord, today, next);
  if (!date) return null;
  const fromNext = /\bfrom next week\b/i.test(t);
  if (fromNext) date = addDays(date, dowOf(date) === dowOf(today) || addDays(today, 7) > date ? 7 : 0);
  t = t.replace(dayM[0], ' ').replace(/\bfrom next week\b/i, ' ');
  let time = null;
  const tm = /\b(?:at|from)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/i.exec(t);
  if (tm) {
    time = timeOf(tm[1], tm[2], tm[3]);
    t = t.replace(tm[0], ' ');
  }
  // A present to buy: "she needs a present", "need to get a present".
  let present = null;
  const pm = /[,;]?\s*(?:and\s+)?(?:she|he|they|we|i)?\s*(?:needs?|need to get|has to take|must take)\s+(?:a\s+)?(present|gift|card)\b.*$/i.exec(t);
  if (pm) {
    t = t.slice(0, pm.index);
    present = pm[1].toLowerCase();
  }
  const who = [];
  for (const c of ctx.children || []) {
    const re = new RegExp(`\\b${c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:'s)?\\b`, 'i');
    if (re.test(t)) {
      who.push(c.id);
      t = t.replace(re, ' ');
    }
  }
  const title = clean(t
    .replace(/\b(?:has|have|got|is going to|are going to|is at|goes to|go to|there'?s|there is|we have|we've got)\b/gi, ' ')
    .replace(/\b(?:for|with|on|at|the|a|an|and)\s*$/gi, ' ')
    .replace(/^\s*(?:a|an|the|for|with|on|and)\b/gi, ' ')
    .replace(/[,;]+/g, ' '))
    .replace(/\s+(?:for|on|at|and)$/i, '')
    .replace(/^(?:for|on|at|and|a|an)\s+/i, '');
  if (!title || title.length < 2) return null;
  const names = who.map((id) => (ctx.children || []).find((c) => c.id === id).name);
  const out = {
    title: capFirst(title).slice(0, 60),
    date,
    time,
    repeat: weekly ? 'weekly' : 'none',
    who,
  };
  if (weekly) out.days = [dowOf(date)];
  if (present) out.notes = `${names.length ? names.join(' and ') + ' needs' : 'Needs'} a ${present}`;
  return { event: out, present: present ? `${capFirst(present)}${names.length ? ` for ${title.toLowerCase().includes('party') ? 'the party' : names.join(' and ')}` : ''}` : null };
}

module.exports = { parse, item, find, norm, dateFor, timeOf, looseDate, addDays, clauses };
