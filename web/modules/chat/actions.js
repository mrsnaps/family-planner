// The chat's actions: the only things it can do. Each one goes through the app's own API
// (ctx.call runs a route in-process), so every name, date and quantity is checked exactly as
// if the form had been used. Reads answer questions; changes happen straight away with Undo;
// "delete" actions wait for the person to tap Yes.
//
// { name, kind: 'read' | 'change' | 'delete', page, about (for the AI), run(args, ctx) }
// A read returns { data (for the AI), say (plain words, for the rules version), links? }.
// A change returns { icon, text } describing what it did.
const { find, norm } = require('./parse');

const qs = (o) => '?' + new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
const listed = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] || '');
const amount = (q, unit) => (q ? ` ${Number(q)}${unit && unit !== 'pcs' ? ' ' + unit : ''}` : '');
const shortDay = (d, today) => {
  if (d === today) return 'today';
  const t = new Date(Date.parse(today + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  if (d === t) return 'tomorrow';
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
};
const fail = (msg) => { throw Object.assign(new Error(msg), { status: 400 }); };
const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
const num = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// An id from the summary, or a name the person used.
function pick(list, ref, what, key = 'name') {
  if (ref === undefined || ref === null || ref === '') fail(`Which ${what}?`);
  const s = String(ref);
  // The AI sees ids cut to 8 characters (index.js short()), to keep what it reads small.
  const byPrefix = s.length >= 6 ? list.filter((x) => typeof x.id === 'string' && x.id.startsWith(s)) : [];
  return list.find((x) => x.id === s) || (byPrefix.length === 1 ? byPrefix[0] : null) || find(list, s, key) || fail(`I couldn't find ${what} "${s}"`);
}

const A = [];
const def = (name, kind, page, about, run) => {
  const a = { name, kind, page, about, run };
  A.push(a);
  return a;
};

// ---------- shopping ----------
def('shopping.list', 'read', 'shopping', 'What is on the shopping list. args {}', async (a, ctx) => {
  const r = await ctx.call('GET', '/shopping');
  const left = r.items.filter((i) => !i.done);
  return {
    data: { items: r.items.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, unit: i.unit, kind: i.kind, done: i.done })), suggestions: r.suggestions.slice(0, 8).map((s) => s.name) },
    say: left.length ? `${left.length} on the list: ${listed(left.slice(0, 15).map((i) => i.name + amount(i.quantity, i.unit)))}${left.length > 15 ? '…' : ''}.` : r.items.length ? 'Everything on the list is ticked off.' : 'The shopping list is empty.',
  };
});
def('shopping.add', 'change', 'shopping', 'Add to the shopping list. args { items: [{ name, quantity?, unit? (g kg ml l pcs tin pack), kind? (food|clothes|other: anything not eaten is other), childId? (clothes), size?, note? }] }', async (a, ctx) => {
  const items = asList(a.items).slice(0, 40).map((i) => (typeof i === 'string' ? { name: i } : i))
    .map((i) => ({ name: i.name, quantity: num(i.quantity), unit: i.unit || null, kind: ['food', 'clothes', 'other'].includes(i.kind) ? i.kind : 'food', ...(i.childId ? { childId: ctx.child(i.childId).id } : {}), ...(i.size ? { size: String(i.size) } : {}), ...(i.note ? { note: String(i.note) } : {}) }));
  if (!items.length) fail('What should go on the list?');
  const r = await ctx.call('POST', '/shopping/items/bulk', { items });
  const names = r.items.map((i) => i.name + amount(i.quantity, i.unit));
  if (!names.length) return { icon: '🛒', text: `${listed(items.map((i) => i.name))} ${items.length > 1 ? 'were' : 'was'} already on the list`, nothing: true };
  return { icon: '🛒', text: `Added ${listed(names)} to the shopping list${r.skipped ? ` (${r.skipped} already on it)` : ''}` };
});
def('shopping.tick', 'change', 'shopping', 'Tick an item on the list as got (or untick with done false). args { itemId, done? }', async (a, ctx) => {
  const it = pick(ctx.data.shopping(), a.itemId || a.name, 'that on the list');
  const done = a.done !== false;
  await ctx.call('PUT', `/shopping/items/${encodeURIComponent(it.id)}`, { done });
  return { icon: '✅', text: `${done ? 'Ticked off' : 'Unticked'} ${it.name}` };
});
def('shopping.update', 'change', 'shopping', 'Change a list item: quantity, unit, name or note. args { itemId, quantity?, unit?, name?, note? }', async (a, ctx) => {
  const it = pick(ctx.data.shopping(), a.itemId || a.name, 'that on the list');
  const body = {};
  for (const k of ['quantity', 'unit', 'note']) if (a[k] !== undefined) body[k] = a[k];
  if (a.newName) body.name = a.newName;
  else if (a.name && a.itemId) body.name = a.name;
  const r = await ctx.call('PUT', `/shopping/items/${encodeURIComponent(it.id)}`, body);
  return { icon: '✏️', text: `Changed ${it.name} to ${r.name}${amount(r.quantity, r.unit)}` };
});
def('shopping.bought', 'change', 'shopping', 'Bought something on the list: it leaves the list and goes into the cupboard (food) or the child\'s wardrobe (clothes). args { itemId, quantity?, unit?, expiry? }', async (a, ctx) => {
  const it = pick(ctx.data.shopping(), a.itemId || a.name, 'that on the list');
  const body = {};
  for (const k of ['quantity', 'unit', 'expiry']) if (a[k] !== undefined && a[k] !== null) body[k] = a[k];
  await ctx.call('POST', `/shopping/items/${encodeURIComponent(it.id)}/bought`, body);
  return { icon: '🧺', text: `Bought ${it.name}: ${it.kind === 'food' ? 'into the cupboard' : it.kind === 'clothes' ? 'into the wardrobe' : 'off the list'}` };
});
def('shopping.remove', 'delete', 'shopping', 'Take an item off the list without buying it. args { itemId }', async (a, ctx) => {
  const it = pick(ctx.data.shopping(), a.itemId || a.name, 'that on the list');
  await ctx.call('DELETE', `/shopping/items/${encodeURIComponent(it.id)}`);
  return { icon: '🗑️', text: `Took ${it.name} off the list` };
}).ask = (a, ctx) => `Take ${pick(ctx.data.shopping(), a.itemId || a.name, 'that on the list').name} off the list?`;
def('shopping.clear_done', 'delete', 'shopping', 'Clear everything ticked off the list. args {}', async (a, ctx) => {
  const n = ctx.data.shopping().filter((i) => i.done).length;
  await ctx.call('POST', '/shopping/clear-done', {});
  return { icon: '🧹', text: `Cleared ${n} ticked item${n === 1 ? '' : 's'}` };
});
A.at(-1).ask = (a, ctx) => `Clear the ${ctx.data.shopping().filter((i) => i.done).length} ticked things off the list?`;

// ---------- cupboards ----------
def('food.cupboard', 'read', 'food', 'Everything in the cupboards, fridge and freezer (id, name, amount, use-by, frozen, leftovers). args {}', async (a, ctx) => {
  const items = ctx.data.pantry();
  return {
    data: items.map((p) => ({ id: p.id, name: p.name, quantity: p.quantity, unit: p.unit, expiry: p.expiry || undefined, frozen: p.frozen || undefined, leftover: p.leftover ? true : undefined })),
    say: items.length ? `${items.length} things in: ${listed(items.slice(0, 20).map((p) => p.name))}${items.length > 20 ? '…' : ''}.` : 'Nothing is in the cupboards yet.',
  };
});
def('food.expiring', 'read', 'food', 'Food going off soon. args {}', async (a, ctx) => {
  const s = await ctx.call('GET', '/food/stats');
  const list = s.expiringSoon || [];
  return {
    data: list,
    say: list.length ? `Going off soon: ${listed(list.map((e) => `${e.name} (${e.days < 0 ? 'out of date' : e.days === 0 ? 'today' : `in ${e.days} day${e.days === 1 ? '' : 's'}`})`))}.` : 'Nothing is going off in the next few days.',
  };
});
def('food.add', 'change', 'food', 'Add food to the cupboards ("What\'s in"). args { items: [{ name, quantity?, unit? (g kg ml l pcs tin pack), expiry? (YYYY-MM-DD), frozen? }] }', async (a, ctx) => {
  const items = asList(a.items).slice(0, 60).map((i) => (typeof i === 'string' ? { name: i } : i))
    .map((i) => ({ name: i.name, quantity: num(i.quantity), unit: i.unit || 'pcs', ...(i.expiry ? { expiry: i.expiry } : {}), ...(i.frozen ? { frozen: true } : {}) }));
  if (!items.length) fail('What should go in the cupboard?');
  const r = await ctx.call('POST', '/food/items/bulk', { items });
  return { icon: '🥫', text: `Added ${listed(r.map((p) => p.name + amount(p.quantity, p.unit) + (p.expiry ? ` (use by ${shortDay(p.expiry, ctx.today)})` : '')))} to what's in` };
});
def('food.update', 'change', 'food', 'Change a cupboard item: quantity, unit, use-by or name. args { itemId, quantity?, unit?, expiry?, name? }', async (a, ctx) => {
  const it = pick(ctx.data.pantry(), a.itemId || a.name, 'that in the cupboards');
  const body = {};
  for (const k of ['quantity', 'unit', 'expiry']) if (a[k] !== undefined) body[k] = a[k];
  if (a.name && a.itemId) body.name = a.name;
  const r = await ctx.call('PUT', `/food/items/${encodeURIComponent(it.id)}`, body);
  return { icon: '✏️', text: `Updated ${r.name}${amount(r.quantity, r.unit)}${r.expiry ? `, use by ${shortDay(r.expiry, ctx.today)}` : ''}` };
});
def('food.used_up', 'change', 'food', 'Food used up or run out: sets it to none left (so it can be suggested for the list). args { itemId }', async (a, ctx) => {
  const it = pick(ctx.data.pantry(), a.itemId || a.name, 'that in the cupboards');
  await ctx.call('PUT', `/food/items/${encodeURIComponent(it.id)}`, { quantity: 0 });
  return { icon: '🫙', text: `${it.name}: none left` };
});
def('food.freeze', 'change', 'food', 'Put food in the freezer (frozen true) or take it out (false). args { itemId, frozen }', async (a, ctx) => {
  const it = pick(ctx.data.pantry(), a.itemId || a.name, 'that in the cupboards');
  const frozen = a.frozen !== false;
  await ctx.call('PUT', `/food/items/${encodeURIComponent(it.id)}`, { frozen });
  return { icon: frozen ? '🧊' : '🌡️', text: frozen ? `Put ${it.name} in the freezer` : `Took ${it.name} out of the freezer` };
});
def('food.remove', 'delete', 'food', 'Remove something from the cupboards entirely. args { itemId }', async (a, ctx) => {
  const it = pick(ctx.data.pantry(), a.itemId || a.name, 'that in the cupboards');
  await ctx.call('DELETE', `/food/items/${encodeURIComponent(it.id)}`);
  return { icon: '🗑️', text: `Removed ${it.name} from what's in` };
}).ask = (a, ctx) => `Remove ${pick(ctx.data.pantry(), a.itemId || a.name, 'that in the cupboards').name} from the cupboards?`;

// ---------- meals ----------
def('food.meals_now', 'read', 'food', 'Meals that can be cooked now (or nearly) from what\'s in, best first, with what is missing. args {}', async (a, ctx) => {
  const r = await ctx.call('GET', '/food/meals');
  const top = r.meals.slice(0, 8);
  const ready = top.filter((m) => !m.missing.length && !m.short.length);
  return {
    data: { meals: top.map((m) => ({ recipeId: m.id, name: m.name, minutes: m.minutes, missing: [...m.missing, ...m.short.map((s) => s.name)], usesSoon: m.usesExpiring || undefined })), leftovers: r.leftovers },
    say: top.length ? `${ready.length ? `You can cook ${listed(ready.slice(0, 3).map((m) => m.name))} now.` : ''} ${top.filter((m) => !ready.includes(m)).slice(0, 2).map((m) => `${m.name} needs ${listed([...m.missing, ...m.short.map((s) => s.name)])}.`).join(' ')}`.trim() : 'Nothing can be cooked from what\'s in yet. Add food on the Food page.',
    links: [{ page: 'food', label: 'Open meal ideas' }],
  };
});
def('food.recipes', 'read', 'food', 'All recipes the family has (id, name, minutes, tags, favourite). args { search? }', async (a, ctx) => {
  const favs = new Set(ctx.api.food.favourites());
  const q = a.search ? norm(a.search) : '';
  const list = ctx.api.food.familyRecipes().filter((r) => !q || norm(r.name).includes(q) || (r.ingredients || []).some((g) => norm(g.name).includes(q)));
  return { data: list.slice(0, 150).map((r) => ({ id: r.id, name: r.name, minutes: r.minutes, tags: r.tags, favourite: favs.has(r.id) || undefined, ingredients: q ? r.ingredients.map((g) => g.name) : undefined })), say: `${list.length} recipes${q ? ` with "${a.search}"` : ''}: ${listed(list.slice(0, 10).map((r) => r.name))}${list.length > 10 ? '…' : ''}.` };
});
def('food.plan_week', 'read', 'food', 'Plan the week\'s dinners: give up to 7 recipeIds (null for "let the rules choose"); returns each day and what to buy. Then use shopping.add to add what to buy if they want. args { recipeIds?: [..] }', async (a, ctx) => {
  const week = asList(a.recipeIds).slice(0, 7).map((x) => (x ? pick(ctx.api.food.recipes(), x, 'that recipe').id : null));
  const r = await ctx.call('POST', '/food/week-shop', { week });
  const day = (i) => (i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(Date.parse(ctx.today + 'T00:00:00Z') + i * 86400000).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' }));
  return {
    data: r,
    say: `${r.days.map((m, i) => (m ? `${day(i)}: ${m.name}` : null)).filter(Boolean).join('. ')}.${r.list.length ? ` That needs ${r.list.length} thing${r.list.length === 1 ? '' : 's'} from the shops.` : ' Everything is in.'}`,
    offers: r.list.length ? ['Add what the week needs to the shopping list'] : [],
  };
});
def('food.add_week_shop', 'change', 'shopping', 'Add everything the week\'s dinners need to the shopping list. args { recipeIds?: [..] } (same as food.plan_week)', async (a, ctx) => {
  const week = asList(a.recipeIds).slice(0, 7).map((x) => (x ? pick(ctx.api.food.recipes(), x, 'that recipe').id : null));
  const r = await ctx.call('POST', '/food/week-shop', { week });
  if (!r.list.length) return { icon: '🛒', text: 'Everything for the week is already in', nothing: true };
  const added = await ctx.call('POST', '/shopping/items/bulk', { items: r.list.map(({ name, quantity, unit }) => ({ kind: 'food', name, quantity, unit, note: 'For the week' })) });
  return { icon: '🛒', text: `Added ${added.added} thing${added.added === 1 ? '' : 's'} for the week's dinners${added.skipped ? ` (${added.skipped} already on the list)` : ''}` };
});
def('food.cooked', 'change', 'food', 'Mark a recipe as cooked: takes its ingredients out of the cupboards. args { recipeId }', async (a, ctx) => {
  const r = pick(ctx.api.food.recipes(), a.recipeId || a.name, 'that recipe');
  await ctx.call('POST', `/food/meals/${encodeURIComponent(r.id)}/cook`, {});
  return { icon: '🍳', text: `Cooked ${r.name}: used its ingredients from the cupboards` };
});
def('food.leftovers', 'change', 'food', 'Save leftovers of a meal, in the fridge or freezer. args { recipeId? or name, portions, freeze? }', async (a, ctx) => {
  const r = a.recipeId ? pick(ctx.api.food.recipes(), a.recipeId, 'that recipe') : (a.name && find(ctx.api.food.recipes(), a.name)) || null;
  const it = await ctx.call('POST', '/food/leftovers', { recipeId: r ? r.id : undefined, name: r ? undefined : a.name, portions: a.portions, freeze: Boolean(a.freeze) });
  return { icon: '🥡', text: `Saved ${it.quantity} portion${it.quantity === 1 ? '' : 's'} of ${it.leftover.recipeName.toLowerCase()} ${a.freeze ? 'in the freezer' : 'in the fridge'}` };
});
def('food.eat_leftovers', 'change', 'food', 'Eat some leftovers. args { itemId, portions? }', async (a, ctx) => {
  const it = pick(ctx.data.pantry().filter((p) => p.leftover), a.itemId || a.name, 'those leftovers');
  const r = await ctx.call('POST', `/food/leftovers/${encodeURIComponent(it.id)}/eat`, a.portions ? { portions: a.portions } : {});
  return { icon: '🍽️', text: `Ate ${it.name.toLowerCase()}${r.left ? `, ${r.left} portion${r.left === 1 ? '' : 's'} left` : ', all gone'}` };
});
def('food.rate', 'change', 'food', 'Record how people liked a dinner. args { recipeId, ratings: [{ personId, score: "up" | "meh" | "down" }] }', async (a, ctx) => {
  const r = pick(ctx.api.food.recipes(), a.recipeId || a.name, 'that recipe');
  const people = ctx.api.food.people();
  const ratings = asList(a.ratings).map((x) => ({ personId: pick(people, x.personId || x.name, 'that person').id, score: x.score }));
  await ctx.call('POST', '/food/ratings', { recipeId: r.id, ratings });
  const word = { up: 'liked', 1: 'liked', meh: 'thought so-so of', 0: 'thought so-so of', down: "didn't like", '-1': "didn't like" };
  return { icon: '⭐', text: ratings.map((x) => `${people.find((p) => p.id === x.personId).name} ${word[String(x.score)] || 'rated'} ${r.name}`).join('; ') };
});
def('food.favourite', 'change', 'food', 'Star (or unstar) a recipe as a favourite. args { recipeId, favourite }', async (a, ctx) => {
  const r = pick(ctx.api.food.recipes(), a.recipeId || a.name, 'that recipe');
  const on = a.favourite !== false;
  await ctx.call('PUT', `/food/recipes/${encodeURIComponent(r.id)}/favourite`, { favourite: on });
  return { icon: on ? '⭐' : '☆', text: `${on ? 'Starred' : 'Unstarred'} ${r.name}` };
});
def('food.save_recipe', 'change', 'food', 'Save a recipe from a web link or pasted recipe text. args { url? , text? }', async (a, ctx) => {
  const draft = await ctx.call('POST', '/food/recipes/from-link', a.url ? { url: String(a.url) } : { text: String(a.text || '') });
  const ingredients = (draft.ingredients || []).filter((g) => g.qty > 0 && g.name);
  if (!ingredients.length) fail("I couldn't read the ingredients. Open Recipes and paste it there.");
  const saved = await ctx.call('POST', '/food/recipes', { ...draft, ingredients });
  return { icon: '📖', text: `Saved the recipe ${saved.name} (${saved.ingredients.length} ingredients). Check it under Recipes.` };
});
def('food.lunchbox', 'read', 'food', 'This week\'s lunchbox plan for each child. args {}', async (a, ctx) => {
  const r = await ctx.call('GET', '/food/lunchbox');
  return { data: r, say: r.children && r.children.length ? r.children.map((c) => `${c.name}: ${(c.days || []).slice(0, 5).map((d) => (d.items || []).map((i) => i.name).join(', ')).filter(Boolean)[0] || 'nothing planned'}`).join('. ') : 'No lunchboxes to plan.', links: [{ page: 'food', label: 'Open lunchboxes' }] };
});
def('food.wont_eat', 'change', 'food', 'Add foods a child won\'t eat in their lunchbox (or remove with remove: true). args { childId, foods: [..], remove? }', async (a, ctx) => {
  const c = ctx.child(a.childId || a.name);
  const have = (ctx.api.food.lunchbox().children.find((x) => x.childId === c.id) || {}).wontEat || [];
  const given = asList(a.foods).map((f) => String(f).toLowerCase().trim()).filter(Boolean);
  const foods = a.remove ? have.filter((f) => !given.includes(f)) : [...new Set([...have, ...given])];
  await ctx.call('PUT', '/food/lunchbox/wont-eat', { childId: c.id, foods });
  return { icon: '🥪', text: `${c.name} ${a.remove ? 'will eat' : "won't eat"} ${listed(given)} in lunchboxes` };
});

// ---------- Diary ----------
def('calendar.upcoming', 'read', 'calendar', 'Diary: everything coming up (events, kit days, birthdays) for the next N days. args { days? }', async (a, ctx) => {
  const days = Math.max(1, Math.min(60, Number(a.days) || 7));
  const r = await ctx.call('GET', '/calendar', undefined, { days });
  return {
    data: { upcoming: r.upcoming.map((o) => ({ eventId: o.eventId || o.id, title: o.title, date: o.date, time: o.time || undefined, who: o.whoNames || o.who, kit: o.kit && o.kit.length ? o.kit : undefined, kind: o.kind })), events: r.events.map((e) => ({ id: e.id, title: e.title, repeat: e.repeat, days: e.days, date: e.date, who: e.who })) },
    say: r.upcoming.length ? r.upcoming.slice(0, 12).map((o) => `${shortDay(o.date, ctx.today)}${o.time ? ' ' + o.time : ''}: ${o.title}`).join('. ') + '.' : `Nothing in the Diary for the next ${days} days.`,
    links: [{ page: 'calendar', label: 'Open the Diary' }],
  };
});
def('calendar.add', 'change', 'calendar', 'Add to the Diary. args { title, date (YYYY-MM-DD, first date), time? (HH:MM), repeat? (none|weekly|yearly), days? (weekdays 0=Sun..6, for weekly), until?, who? (childIds), kit? (things to take), notes? }', async (a, ctx) => {
  const body = { title: a.title, date: a.date, time: a.time || null, repeat: a.repeat || 'none', who: asList(a.who).map((w) => ctx.child(w).id) };
  for (const k of ['days', 'until', 'kit', 'notes', 'emoji']) if (a[k] !== undefined && a[k] !== null) body[k] = a[k];
  const e = await ctx.call('POST', '/calendar/events', body);
  const names = e.who.map((id) => ctx.child(id).name);
  const when = e.repeat === 'weekly' ? `every ${e.days.map((d) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]).join(' and ')}${e.date > ctx.today ? ` from ${shortDay(e.date, ctx.today)}` : ''}` : e.repeat === 'yearly' ? `every year on ${shortDay(e.date, ctx.today)}` : shortDay(e.date, ctx.today);
  return { icon: '📅', text: `Added ${e.title}${names.length ? ` (${listed(names)})` : ''} to the Diary, ${when}${e.time ? ` at ${e.time}` : ''}${e.kit.length ? `. Take: ${e.kit.join(', ')}` : ''}` };
});
def('calendar.update', 'change', 'calendar', 'Change a Diary event (any calendar.add field). args { eventId, ...fields }', async (a, ctx) => {
  const ev = pick(ctx.data.events(), a.eventId || a.title, 'that in the Diary', 'title');
  const body = {};
  for (const k of ['title', 'date', 'time', 'repeat', 'days', 'until', 'kit', 'notes', 'paused']) if (a[k] !== undefined && !(k === 'title' && !a.eventId)) body[k] = a[k];
  if (a.who !== undefined) body.who = asList(a.who).map((w) => ctx.child(w).id);
  const e = await ctx.call('PUT', `/calendar/events/${encodeURIComponent(ev.id)}`, body);
  return { icon: '📅', text: `Changed ${e.title} in the Diary` };
});
def('calendar.skip', 'change', 'calendar', 'Skip one date of a repeating event (cancelled lesson, holiday). args { eventId, date }', async (a, ctx) => {
  const ev = pick(ctx.data.events(), a.eventId || a.title, 'that in the Diary', 'title');
  await ctx.call('POST', `/calendar/events/${encodeURIComponent(ev.id)}/skip`, { date: a.date });
  return { icon: '⏭️', text: `No ${ev.title} on ${shortDay(a.date, ctx.today)}` };
});
def('calendar.remove', 'delete', 'calendar', 'Delete an event from the Diary altogether. args { eventId }', async (a, ctx) => {
  const ev = pick(ctx.data.events(), a.eventId || a.title, 'that in the Diary', 'title');
  await ctx.call('DELETE', `/calendar/events/${encodeURIComponent(ev.id)}`);
  return { icon: '🗑️', text: `Deleted ${ev.title} from the Diary` };
}).ask = (a, ctx) => `Delete ${pick(ctx.data.events(), a.eventId || a.title, 'that in the Diary', 'title').title} from the Diary?`;

// ---------- chores ----------
def('chores.status', 'read', 'chores', 'Chores: what is due today, who does what this week, and each person\'s points and pocket money this week. args { personId? }', async (a, ctx) => {
  const v = await ctx.call('GET', '/chores');
  const p = a.personId ? v.people.find((x) => x.id === a.personId) : null;
  const t = p ? v.totals.find((x) => x.id === p.id) : null;
  const money = (x) => (x.money ? `, £${x.money.toFixed(2)}` : '');
  return {
    data: { today: v.rota[0], totals: v.totals, chores: v.chores.map((c) => ({ id: c.id, name: c.name, who: c.whoName, state: c.state, due: c.due })) },
    say: t ? `${p.name} has ${t.points} point${t.points === 1 ? '' : 's'} this week from ${t.done} job${t.done === 1 ? '' : 's'}${money(t)}.`
      : `${v.stats.dueToday} chore${v.stats.dueToday === 1 ? '' : 's'} due today${v.stats.overdue ? ` (${v.stats.overdue} overdue)` : ''}. ${v.totals.filter((x) => x.points).map((x) => `${x.name} ${x.points}`).join(', ')}${v.totals.some((x) => x.points) ? ' points this week.' : ''}`.trim(),
    links: [{ page: 'chores', label: 'Open chores' }],
  };
});
def('chores.done', 'change', 'chores', 'Tick a chore as done, by someone. args { choreId, by? (personId) }', async (a, ctx) => {
  const c = pick(ctx.data.chores(), a.choreId || a.name, 'that chore');
  const by = a.by ? ctx.person(a.by) : null;
  await ctx.call('POST', `/chores/${encodeURIComponent(c.id)}/done`, by ? { by: by.id } : {});
  const who = by || ctx.api.chores.people().find((p) => p.id === c.who);
  return { icon: '🧹', text: `${who ? who.name + ' did' : 'Done:'} ${c.name.charAt(0).toLowerCase() + c.name.slice(1)}${c.effort ? ` (+${c.effort} point${c.effort === 1 ? '' : 's'})` : ''}` };
});
def('chores.skip', 'change', 'chores', 'Put a chore off (to tomorrow or N days). args { choreId, days? }', async (a, ctx) => {
  const c = pick(ctx.data.chores(), a.choreId || a.name, 'that chore');
  await ctx.call('POST', `/chores/${encodeURIComponent(c.id)}/skip`, { days: a.days || 1 });
  return { icon: '⏭️', text: `Put off ${c.name} ${Number(a.days) > 1 ? `for ${a.days} days` : 'until tomorrow'}` };
});
def('chores.add', 'change', 'chores', 'Add a new chore. args { name, every? (days, 1-365), effort? (1-3), who? (personId), minAge? }', async (a, ctx) => {
  const body = { name: a.name };
  for (const k of ['every', 'effort', 'minAge', 'emoji']) if (a[k] !== undefined) body[k] = a[k];
  if (a.who) body.who = ctx.person(a.who).id;
  const c = await ctx.call('POST', '/chores', body);
  return { icon: '🧹', text: `Added the chore ${c.name}, every ${c.every === 1 ? 'day' : c.every === 7 ? 'week' : c.every + ' days'}` };
});

// ---------- clothes ----------
def('clothes.items', 'read', 'clothes', 'A child\'s wardrobe (id, name, type, colour, size, in the wash, packed away). args { childId }', async (a, ctx) => {
  const c = ctx.child(a.childId || a.name);
  const items = ctx.api.clothes.items().filter((i) => i.childId === c.id && !i.wornOut);
  return { data: items.map((i) => ({ id: i.id, name: i.name, type: i.type, colour: i.colour, size: i.size, inWash: i.inWash || undefined, stored: i.stored || undefined, uniform: i.uniform || undefined })), say: `${c.name} has ${items.length} things.`, links: [{ page: 'clothes', label: 'Open wardrobes' }] };
});
def('clothes.outfit', 'read', 'clothes', 'An outfit for a child today from their clean clothes, for the weather if known. args { childId, uniform? (true for school uniform) }', async (a, ctx) => {
  const c = ctx.child(a.childId || a.name);
  const w = ctx.weather || {};
  const r = await ctx.call('GET', `/clothes/outfit-of-the-day/${encodeURIComponent(c.id)}`, undefined, { tempC: w.tempC, rain: w.rain ? '1' : undefined, uniform: a.uniform ? 'only' : undefined });
  const o = r.outfit;
  const names = o ? (o.items || []).map((i) => i.name) : [];
  return { data: r, say: names.length ? `${c.name} could wear ${listed(names)}.${r.weather ? ' ' + r.weather : ''}` : `I couldn't make an outfit for ${c.name}: add more clean clothes in their size.`, links: [{ page: 'clothes', label: 'Open outfits' }] };
});
def('clothes.needs', 'read', 'clothes', 'What each child is short of, their sizes, and when they\'ll move up a size or need new shoes. args {}', async (a, ctx) => {
  const stats = ctx.api.clothes.stats();
  return {
    data: stats.map((s) => ({ childId: s.childId, name: s.name, size: s.clothingSize, shoeSize: s.shoeSize, shortfall: s.shortfall, status: s.status, nextSize: s.forecast && { size: s.forecast.nextSize, date: s.forecast.date }, shoes: s.shoeForecast && { next: s.shoeForecast.nextSize, date: s.shoeForecast.date } })),
    say: stats.map((s) => {
      const short = Object.entries(s.shortfall || {}).map(([t, n]) => `${n} ${t}`);
      return `${s.name}: ${short.length ? 'short of ' + listed(short) : 'all good'}${s.forecast ? `, size ${s.forecast.nextSize} around ${s.forecast.date}` : ''}`;
    }).join('. ') + '.',
    links: [{ page: 'clothes', label: 'Open clothes' }],
  };
});
def('clothes.update', 'change', 'clothes', 'Change a clothes item: inWash, wornOut, stored (packed away), uniform, size, colour, name. args { itemId, ...fields }', async (a, ctx) => {
  const it = pick(ctx.api.clothes.items(), a.itemId || a.name, 'that item of clothing');
  const body = {};
  for (const k of ['inWash', 'wornOut', 'stored', 'uniform', 'size', 'colour', 'season', 'pattern']) if (a[k] !== undefined) body[k] = a[k];
  if (a.name && a.itemId) body.name = a.name;
  await ctx.call('PUT', `/clothes/items/${encodeURIComponent(it.id)}`, body);
  const what = body.inWash === true ? 'in the wash' : body.inWash === false ? 'out of the wash' : body.wornOut ? 'marked worn out' : body.stored === true ? 'packed away' : body.stored === false ? 'got out' : 'updated';
  return { icon: '👕', text: `${it.name}: ${what}` };
});
def('clothes.add', 'change', 'clothes', 'Add clothes to a child\'s wardrobe. args { childId, items: [{ name, type (top bottom dress onesie outerwear shoes pyjamas other), colour?, size?, season? (all summer winter), uniform? }] }', async (a, ctx) => {
  const c = ctx.child(a.childId);
  const items = asList(a.items).slice(0, 40).map((i) => ({ ...i, childId: c.id, size: i.size || (i.type === 'shoes' ? c.shoeSize : c.clothingSize) || null }));
  const r = await ctx.call('POST', '/clothes/items/bulk', { items });
  return { icon: '👕', text: `Added ${listed(r.map((i) => i.name))} to ${c.name}'s wardrobe` };
});
def('clothes.laundry_done', 'change', 'clothes', 'Laundry done: everything (or one child\'s things) out of the wash. args { childId? }', async (a, ctx) => {
  const c = a.childId ? ctx.child(a.childId) : null;
  const r = await ctx.call('POST', '/clothes/laundry/done', c ? { childId: c.id } : {});
  return { icon: '🧺', text: `${r.cleaned} thing${r.cleaned === 1 ? '' : 's'} out of the wash${c ? ` for ${c.name}` : ''}` };
});
def('family.sizes', 'change', 'family', 'Record a child\'s new clothing size (like 7-8Y) or shoe size (like 13 or 1). args { childId, clothingSize?, shoeSize? }', async (a, ctx) => {
  const c = ctx.child(a.childId || a.name);
  const body = {};
  if (a.clothingSize) body.clothingSize = String(a.clothingSize);
  if (a.shoeSize) body.shoeSize = String(a.shoeSize);
  if (!Object.keys(body).length) fail('Which size?');
  const r = await ctx.call('PUT', `/family/children/${encodeURIComponent(c.id)}`, body);
  return { icon: '📏', text: `${c.name} is now ${[body.clothingSize && `size ${r.clothingSize}`, body.shoeSize && `shoe size ${r.shoeSize}`].filter(Boolean).join(' and ')}` };
});

// ---------- trips ----------
def('packing.trips', 'read', 'calendar', 'Trips and how packed each one is. args { tripId? (to get its full list) }', async (a, ctx) => {
  if (a.tripId) {
    const t = await ctx.call('GET', `/packing/trips/${encodeURIComponent(pick(ctx.data.trips(), a.tripId, 'that trip').id)}`);
    return { data: { ...t, items: t.items.map((i) => ({ id: i.id, name: i.name, group: i.group, qty: i.qty, packed: i.packed })) }, say: `${t.name}: ${t.packedCount} of ${t.items.length} packed.` };
  }
  const r = await ctx.call('GET', '/packing');
  return { data: r.trips.map((t) => ({ id: t.id, name: t.name, destination: t.destination, start: t.start, end: t.end, packed: `${t.packedCount}/${t.items.length}` })), say: r.trips.length ? r.trips.map((t) => `${t.name} ${shortDay(t.start, ctx.today)}: ${t.packedCount} of ${t.items.length} packed`).join('. ') + '.' : 'No trips planned.', links: [{ page: 'calendar', label: 'Open trips' }] };
});
def('packing.add_trip', 'change', 'calendar', 'Plan a trip: makes its packing list for everyone going. args { name, destination?, start, end (YYYY-MM-DD), who? (childIds going; default all), abroad? }', async (a, ctx) => {
  const who = a.who ? asList(a.who).map((w) => ctx.child(w).id) : ctx.api.family().children.map((c) => c.id);
  const t = await ctx.call('POST', '/packing/trips', { name: a.name, destination: a.destination || null, start: a.start, end: a.end, who, abroad: Boolean(a.abroad) });
  return { icon: '🧳', text: `Planned ${t.name}, ${shortDay(t.start, ctx.today)} to ${shortDay(t.end, ctx.today)}, with a packing list of ${t.items.length} things` };
});
def('packing.add_item', 'change', 'calendar', 'Add to a trip\'s packing list. args { tripId, items: [{ name, group? (a person\'s name or Everyone), qty? }] }', async (a, ctx) => {
  const t = pick(ctx.data.trips(), a.tripId || a.trip, 'that trip');
  const names = [];
  for (const i of asList(a.items).slice(0, 30).map((x) => (typeof x === 'string' ? { name: x } : x))) {
    const it = await ctx.call('POST', `/packing/trips/${encodeURIComponent(t.id)}/items`, { name: i.name, group: i.group || 'Everyone', qty: i.qty || 1 });
    names.push(it.name);
  }
  return { icon: '🧳', text: `Added ${listed(names)} to the ${t.name} packing list` };
});
def('packing.tick', 'change', 'calendar', 'Tick packing list items as packed (or unpacked). args { tripId, itemIds: [..], packed? }', async (a, ctx) => {
  const t = pick(ctx.data.trips(), a.tripId || a.trip, 'that trip');
  const packed = a.packed !== false;
  const names = [];
  for (const ref of asList(a.itemIds || a.items)) {
    const it = pick(t.items, ref, 'that on the packing list');
    await ctx.call('PUT', `/packing/trips/${encodeURIComponent(t.id)}/items/${encodeURIComponent(it.id)}`, { packed });
    names.push(it.name);
  }
  return { icon: '🧳', text: `${packed ? 'Packed' : 'Unpacked'} ${listed(names)}` };
});
def('packing.remove_trip', 'delete', 'calendar', 'Delete a trip and its packing list. args { tripId }', async (a, ctx) => {
  const t = pick(ctx.data.trips(), a.tripId || a.trip, 'that trip');
  await ctx.call('DELETE', `/packing/trips/${encodeURIComponent(t.id)}`);
  return { icon: '🗑️', text: `Deleted the trip ${t.name}` };
}).ask = (a, ctx) => `Delete the trip ${pick(ctx.data.trips(), a.tripId || a.trip, 'that trip').name} and its packing list?`;

// ---------- money ----------
def('money.overview', 'read', 'shopping', 'This month\'s spending by category against the budget, with last month. args { month? (YYYY-MM) }', async (a, ctx) => {
  const r = await ctx.call('GET', '/money', undefined, { month: a.month });
  const p = (n) => '£' + Number(n || 0).toFixed(2).replace(/\.00$/, '');
  return {
    data: r,
    say: `${p(r.spent)} spent this month${r.budget ? ` of a ${p(r.budget)} budget (${r.left >= 0 ? p(r.left) + ' left' : p(-r.left) + ' over'})` : ''}${r.lastMonth ? `. Last month was ${p(r.lastMonth)}` : ''}.`,
    links: [{ page: 'shopping', label: 'Open spending' }],
  };
});
def('money.spend', 'change', 'shopping', 'Record money spent. args { amount (pounds), shop?, category? (food clothes household activities other), date? }', async (a, ctx) => {
  const r = await ctx.call('POST', '/spending', { amount: a.amount, shop: a.shop || null, category: a.category || 'food', date: a.date || undefined });
  return { icon: '💷', text: `Recorded £${r.entry.amount.toFixed(2)}${r.entry.shop ? ' at ' + r.entry.shop : ''} (${r.entry.category || 'food'})` };
});
def('money.remove_spend', 'delete', 'shopping', 'Delete a spending entry. args { entryId }', async (a, ctx) => {
  const e = pick(ctx.data.spending(), a.entryId, 'that spending');
  await ctx.call('DELETE', `/spending/${encodeURIComponent(e.id)}`);
  return { icon: '🗑️', text: `Deleted £${e.amount.toFixed(2)}${e.shop ? ' at ' + e.shop : ''}` };
}).ask = (a, ctx) => { const e = pick(ctx.data.spending(), a.entryId, 'that spending'); return `Delete £${e.amount.toFixed(2)}${e.shop ? ' at ' + e.shop : ''} on ${e.date}?`; };
def('money.budget', 'change', 'shopping', 'Set the monthly budget in pounds. args { budget }', async (a, ctx) => {
  const r = await ctx.call('PUT', '/money/budget', { budget: a.budget });
  return { icon: '💷', text: `Monthly budget set to £${r.budget}` };
});

// ---------- everything ----------
def('briefing', 'read', 'home', 'A short briefing: reminders, the Diary, chores due and food going off. args { days? (1 today, 2 with tomorrow, 7 the week) }', async (a, ctx) => {
  const days = Math.max(1, Math.min(14, Number(a.days) || 1));
  const [rem, cal, ch] = await Promise.all([ctx.call('GET', '/reminders'), ctx.call('GET', '/calendar', undefined, { days }), ctx.call('GET', '/chores')]);
  const bits = [];
  if (cal.upcoming.length) bits.push(cal.upcoming.slice(0, 8).map((o) => `${days > 1 ? shortDay(o.date, ctx.today) + ' ' : ''}${o.time ? o.time + ' ' : ''}${o.title}`).join(', '));
  else bits.push(`Nothing in the Diary${days === 1 ? ' today' : ''}`);
  if (days === 1 && cal.kitToday && cal.kitToday.length) bits.push(`Take: ${cal.kitToday.map((g) => `${g.name} ${g.items.join(', ')}`).join('; ')}`);
  if (ch.stats.dueToday) bits.push(`${ch.stats.dueToday} chore${ch.stats.dueToday === 1 ? '' : 's'} due`);
  const other = rem.filter((r) => !/calendar|birthday/.test(r.kind || '')).slice(0, 4).map((r) => r.title).filter(Boolean);
  if (other.length) bits.push(other.join('. '));
  return { data: { reminders: rem, upcoming: cal.upcoming, chores: ch.stats, kitToday: cal.kitToday, kitTomorrow: cal.kitTomorrow }, say: bits.join('. ') + '.' };
});

const HELP = [
  { keys: /invite|partner|join|household|share|husband|wife/, text: 'Settings, Account, Invite someone makes an 8-letter code. They make their own login, then use Join a household with the code.', page: 'settings' },
  { keys: /siri|shortcut|voice|talk/, text: 'Settings has the Siri card: it makes a key and shows how to set up the "Add to shopping" and "Tell Family Planner" shortcuts.', page: 'settings' },
  { keys: /notif|remind|alert|push/, text: 'Settings, Notifications turns on reminders on this phone: kit days, birthdays, food going off and more.', page: 'settings' },
  { keys: /\bai\b|key|openrouter|claude|chatgpt|gemini/, text: 'Settings, AI is where you choose the AI and add its key. The chat and every suggestion use it.', page: 'settings' },
  { keys: /child|kid|size|age|birthday/, text: 'The Family page has each child, their birthday and sizes.', page: 'family' },
  { keys: /chore|job|pocket|point|rota/, text: 'The Chores page has the rota, points and pocket money. Name the grown-ups at the top.', page: 'chores' },
  { keys: /trip|pack|holiday/, text: 'The Diary page has a Trips tab: add a trip and it makes the packing list.', page: 'calendar' },
  { keys: /diary|calendar|event|pe\b|swim|kit/, text: 'The Diary page holds events, kit days and birthdays.', page: 'calendar' },
  { keys: /budget|spend|money/, text: 'The Shopping page has spending and the monthly budget.', page: 'shopping' },
  { keys: /recipe|meal|cook|dinner|lunch/, text: 'The Food page has meal ideas, recipes (add one from a link), lunchboxes and leftovers.', page: 'food' },
  { keys: /cupboard|fridge|freezer|barcode|scan|photo/, text: "The Food page's What's in tab: add food by hand, barcode or a photo.", page: 'food' },
  { keys: /cloth|wardrobe|outfit|wash|swap|hand.?me/, text: 'The Clothes page has each wardrobe, outfits, the wash and hand-me-downs.', page: 'clothes' },
  { keys: /backup|export|restore|import/, text: 'Settings, Backup saves or restores everything as a file.', page: 'settings' },
  { keys: /delete|account|password|sign/, text: 'Settings, Account has signing in and out, and deleting your account.', page: 'settings' },
  { keys: /colour|color|theme|tab|customis|kitchen/, text: 'Settings, Customise changes colours, text size, the tabs along the bottom and the kitchen screen.', page: 'settings' },
];
def('help', 'read', 'settings', 'How to do something in the app. args { topic }', async (a) => {
  const t = String(a.topic || '').toLowerCase();
  const hits = t ? HELP.filter((h) => h.keys.test(t)) : [];
  if (!hits.length) {
    return { data: HELP.map((h) => h.text), say: 'I can add to the shopping list, the cupboards and the Diary, tick off chores, record spending, and answer "what\'s on today?" or "what\'s for dinner?". Try "we need milk and eggs" or "Leo did the bins".' };
  }
  return { data: hits.map((h) => h.text), say: hits.slice(0, 2).map((h) => h.text).join(' '), links: [...new Set(hits.slice(0, 2).map((h) => h.page))].map((p) => ({ page: p, label: `Open ${p === 'calendar' ? 'the Diary' : p.charAt(0).toUpperCase() + p.slice(1)}` })) };
});

const ACTIONS = new Map(A.map((a) => [a.name, a]));
module.exports = { ACTIONS, HELP, listed, shortDay, pick };
