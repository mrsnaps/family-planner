// Family Planner web UI. Talks only to /api/v1, the same API a phone app would use.
const API = '/api/v1';
const state = {
  page: 'home',
  family: null,
  childId: null,
  sizes: [],
  types: [],
  units: [],
  targets: {},
  foodView: 'pantry',
  mealFilter: 'all',
  wardrobeFilter: 'all',
  ootdIndex: 0,
  shoppingCount: 0,
};

// ---------- helpers ----------
const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Attributes that keep browsers and password managers from filling these boxes with the
// sign-in email and password (the AI key box is a masked text box, not a password box).
const NOFILL = 'autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other"';

const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`;
const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtShort = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

// Who is using the app, when signed in, so the shared list can show who added what.
const member = () => {
  const email = window.FamilyPlannerAccount?.status().email;
  return email ? { 'X-Family-Member': email } : {};
};

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...member() },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

const guard = (fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (e) {
    toast(e.message);
  }
};
const formData = (form) => Object.fromEntries(new FormData(form).entries());
const options = (list, selected, labels = {}) =>
  list.map((v) => `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(labels[v] || v)}</option>`).join('');

// Small confirm/prompt dialog that works on phones too.
function ask({ title, body = '', ok = 'OK', danger = false }) {
  const dlg = $('#dialog');
  $('#dialog-form').innerHTML = `
    <h2>${esc(title)}</h2>
    <div style="margin-top:10px">${body}</div>
    <div class="actions">
      <button class="btn ghost" value="cancel">Cancel</button>
      <button class="btn ${danger ? 'coral' : 'primary'}" value="ok">${esc(ok)}</button>
    </div>`;
  dlg.showModal();
  $('#dialog-form').onkeydown = (e) => {
    if (e.key === 'Enter' && e.target.matches('input:not([type=radio]):not([type=checkbox])')) {
      e.preventDefault();
      dlg.close('ok');
    }
  };
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok' ? formData($('#dialog-form')) : null), { once: true });
  });
}

// ---------- icons (Lucide-style strokes) ----------
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  food: '<path d="M7 3v8a3 3 0 0 0 6 0V3M10 3v18M17 3c-2 2-2 6 0 8v10"/>',
  shirt: '<path d="M8 3 3 6l2 5 3-1v11h8V10l3 1 2-5-5-3a4 4 0 0 1-8 0z"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M3 4h2l2.5 11h11L21 7H6.2"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9.5" r="2.5"/><path d="M16 14.2A5 5 0 0 1 22 19"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="M5 12.5 10 17l9-10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  send: '<path d="M4 12 20 4l-6 16-3-7z"/><path d="m11 13 9-9"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  ruler: '<path d="M3 17 17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  bag: '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  book: '<path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-3 3"/><path d="M20 4v14h-7"/>',
  barcode: '<path d="M3 7V4h3M18 4h3v3M21 17v3h-3M6 20H3v-3M7 8v8M10 8v8M13 8v8M17 8v8"/>',
  camera: '<path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13" r="3.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>',
  upload: '<path d="M12 16V5M7 10l5-5 5 5M4 20h16"/>',
  broom: '<path d="M14 3 10 11M6.5 11h7l3.5 10H3z"/><path d="M8 21l1-4M12 21v-4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6"/>',
};
const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// ---------- food emoji & categories ----------
const FOOD_CATS = [
  ['Leftovers', '🍱', ['leftover']],
  ['Frozen', '🧊', ['frozen', 'chips', 'fish fingers', 'ice', 'nugget']],
  ['Meat & fish', '🍗', ['chicken', 'beef', 'mince', 'pork', 'lamb', 'sausage', 'bacon', 'ham', 'turkey', 'fish', 'salmon', 'tuna', 'cod', 'prawn', 'steak']],
  ['Dairy & eggs', '🧀', ['milk', 'cheese', 'cheddar', 'mozzarella', 'parmesan', 'butter', 'yoghurt', 'yogurt', 'cream', 'egg']],
  ['Fruit & veg', '🥕', ['onion', 'garlic', 'carrot', 'potato', 'pepper', 'broccoli', 'pea', 'tomato', 'lettuce', 'cucumber', 'apple', 'banana', 'orange', 'berries', 'spinach', 'mushroom', 'courgette', 'sweetcorn', 'lemon', 'avocado', 'leek']],
  ['Bread & bakery', '🍞', ['bread', 'loaf', 'wrap', 'tortilla', 'roll', 'bagel', 'pitta', 'crumpet']],
  ['Pasta, rice & grains', '🍝', ['pasta', 'spaghetti', 'penne', 'fusilli', 'macaroni', 'rice', 'noodle', 'oat', 'couscous', 'flour', 'cereal', 'quinoa']],
  ['Tins & jars', '🥫', ['tin', 'beans', 'chopped', 'passata', 'puree', 'soup', 'coconut', 'stock', 'sauce', 'paste', 'gravy']],
];
function foodCat(name) {
  const n = String(name).toLowerCase();
  for (const [cat, emoji, words] of FOOD_CATS) if (words.some((w) => n.includes(w))) return { cat, emoji };
  return { cat: 'Other', emoji: '🛒' };
}
const QUICK_ADD = [
  ['Milk', 2, 'l'], ['Eggs', 12, 'pcs'], ['Bread', 16, 'pcs'], ['Pasta', 500, 'g'], ['Rice', 1, 'kg'],
  ['Chopped tomatoes', 4, 'tin'], ['Onions', 4, 'pcs'], ['Cheddar', 400, 'g'], ['Chicken breast', 500, 'g'],
  ['Beef mince', 500, 'g'], ['Potatoes', 2, 'kg'], ['Carrots', 6, 'pcs'], ['Baked beans', 4, 'tin'], ['Butter', 250, 'g'],
];
const MEAL_EMOJI = (name) => {
  const n = name.toLowerCase();
  const map = [['pasta', '🍝'], ['spaghetti', '🍝'], ['macaroni', '🧀'], ['curry', '🍛'], ['chilli', '🌶️'], ['rice', '🍚'], ['stir', '🥢'],
    ['roast', '🍗'], ['fish', '🐟'], ['salmon', '🐟'], ['sausage', '🌭'], ['toad', '🌭'], ['potato', '🥔'], ['omelette', '🍳'], ['egg', '🍳'],
    ['toast', '🍞'], ['sandwich', '🥪'], ['fajita', '🌯'], ['quesadilla', '🌮'], ['pizza', '🍕'], ['pancake', '🥞'], ['porridge', '🥣'],
    ['soup', '🍲'], ['pie', '🥧'], ['tuna', '🐟']];
  return (map.find(([k]) => n.includes(k)) || [null, '🍽️'])[1];
};

// ---------- clothes emoji & colours ----------
const GARMENT = { top: '👕', bottom: '👖', dress: '👗', onesie: '🧸', outerwear: '🧥', shoes: '👟', pyjamas: '🌙', other: '🧢' };
const COLOURS = {
  denim: '#4a6a96', cream: '#f3ecd8', khaki: '#b5a46a', tan: '#c8a27a', grey: '#9ca3a0', gray: '#9ca3a0', navy: '#1f2f57',
  beige: '#e3d5b8', mustard: '#d1a13a', lilac: '#c8a2c8', teal: '#2a8c8c', mint: '#a8e6cf', coral: '#ff7f61', burgundy: '#7b1e33',
};
const cssColour = (c) => {
  const k = String(c || '').toLowerCase().trim();
  if (!k) return 'var(--surface-2)';
  return COLOURS[k] || (CSS.supports('color', k) ? k : 'var(--surface-2)');
};
const swatch = (c) => `<span class="swatch" style="background:${esc(cssColour(c))}"></span>`;
const AVATAR_COLOURS = ['#d9694c', '#3c5ea8', '#2e8c6b', '#9b59b6', '#d1a13a', '#c2416b'];
const avatar = (child, i) => {
  const idx = i ?? state.family.children.findIndex((c) => c.id === child.id);
  return `<span class="avatar" style="background:${AVATAR_COLOURS[Math.max(0, idx) % AVATAR_COLOURS.length]}">${esc((child.name || '?')[0].toUpperCase())}</span>`;
};

// ---------- navigation ----------
const PAGES = [
  { id: 'home', label: 'Home', icon: 'home', title: 'Home', render: renderHome },
  { id: 'food', label: 'Food', icon: 'food', title: 'Food planner', render: renderFood },
  { id: 'clothes', label: 'Clothes', icon: 'shirt', title: 'Clothes', render: renderClothes },
  { id: 'shopping', label: 'Shop', icon: 'cart', title: 'Shopping list', render: renderShopping },
  { id: 'chores', label: 'Chores', icon: 'broom', title: 'Chores', render: renderChores },
  { id: 'calendar', label: 'Diary', icon: 'calendar', title: 'Calendar', render: renderCalendar },
  { id: 'family', label: 'Family', icon: 'people', title: 'Family', render: renderFamily },
  { id: 'settings', label: 'Settings', icon: 'gear', title: 'Settings', render: renderSettings },
  { id: 'kitchen', label: 'Kitchen', icon: 'home', title: 'Kitchen screen', render: renderKitchen, hidden: true },
  { id: 'kids', label: 'Kids', icon: 'people', title: "Kids' view", render: renderKids, hidden: true },
];
// Tools that can be hidden in Settings > Customise (Home, Family and Settings always show).
const TOOLS = ['food', 'clothes', 'shopping', 'chores', 'calendar'];

// ---------- look and layout (each device chooses its own) ----------
const LOOK_DEFAULT = {
  accent: 'green', size: 'normal', hidden: [], start: 'home', tabs: ['food', 'clothes', 'shopping'],
  kitchen: { panels: ['dinner', 'calendar', 'chores', 'shopping', 'food', 'outfits', 'reminders'], awake: true, dim: true },
};
const ACCENTS = [['green', 'Green', '#2e6b57'], ['blue', 'Blue', '#2f5fa8'], ['purple', 'Purple', '#6a4bb0'], ['orange', 'Orange', '#b65a1e'], ['pink', 'Pink', '#b03a72'], ['teal', 'Teal', '#1f7a85'], ['slate', 'Slate', '#4a5568']];
const KITCHEN_PANELS = [['dinner', "Tonight's dinner"], ['calendar', 'Today and tomorrow'], ['chores', "Today's chores"], ['shopping', 'Shopping list'], ['food', 'Food to use soon'], ['outfits', 'Outfits for today'], ['reminders', 'Reminders'], ['week', "The week's dinners"]];
const look = (() => {
  let v = {};
  try { v = JSON.parse(localStorage.getItem('fp-look') || '{}') || {}; } catch {}
  return { ...structuredClone(LOOK_DEFAULT), ...v, kitchen: { ...LOOK_DEFAULT.kitchen, ...(v.kitchen || {}) } };
})();
function applyLook() {
  const r = document.documentElement;
  r.dataset.accent = look.accent;
  r.dataset.size = look.size;
  r.dataset.hide = look.hidden.join(' ');
}
function saveLook() {
  try { localStorage.setItem('fp-look', JSON.stringify(look)); } catch {}
  applyLook();
}
applyLook();
const shownPages = () => PAGES.filter((p) => !p.hidden && !look.hidden.includes(p.id));

// On a phone the bottom bar has room for five: Home, three chosen tabs, and More for the rest.
const BOTTOM_TABS = 3;
function bottomTabs() {
  const pages = shownPages();
  if (pages.length <= BOTTOM_TABS + 2) return { main: pages, more: [] };
  const chosen = (look.tabs || []).filter((id) => id !== 'home' && pages.some((p) => p.id === id));
  for (const p of pages) if (chosen.length < BOTTOM_TABS && p.id !== 'home' && p.id !== 'settings' && !chosen.includes(p.id)) chosen.push(p.id);
  const main = pages.filter((p) => p.id === 'home' || chosen.slice(0, BOTTOM_TABS).includes(p.id));
  return { main, more: pages.filter((p) => !main.includes(p)) };
}

function renderNav() {
  const btn = (p) => `
    <button data-nav="${p.id}" class="${state.page === p.id ? 'active' : ''}" aria-current="${state.page === p.id ? 'page' : 'false'}">
      ${icon(p.icon)}<span>${p.label}</span>
      ${p.id === 'shopping' && state.shoppingCount ? `<span class="count">${state.shoppingCount}</span>` : ''}
    </button>`;
  const pages = shownPages();
  $('#nav').innerHTML = pages.map((p) => btn(p)).join('') + (state.page === 'kids' ? '' : `<button data-ask-open class="nav-ask">${icon('chat')}<span>Ask</span></button>`);
  const { main, more } = bottomTabs();
  const inMore = more.some((p) => p.id === state.page) || ['kids', 'kitchen'].includes(state.page);
  const extras = [
    ...(state.family?.children?.length && !look.hidden.includes('chores') ? [{ id: 'kids', label: "Kids' view", icon: 'people' }] : []),
    { id: 'kitchen', label: 'Kitchen', icon: 'home' },
  ];
  $('#tabbar').innerHTML = main.map((p) => btn(p)).join('') + (more.length ? `
    <button data-more-toggle class="${inMore ? 'active' : ''}" aria-expanded="${state.moreOpen ? 'true' : 'false'}" aria-controls="more-sheet">
      ${icon('grid')}<span>More</span>${more.some((p) => p.id === 'shopping') && state.shoppingCount ? `<span class="count">${state.shoppingCount}</span>` : ''}</button>
    <div class="more-sheet ${state.moreOpen ? 'open' : ''}" id="more-sheet" role="menu">
      ${more.map((p) => btn(p)).join('')}
      ${extras.map((p) => `<button data-nav="${p.id}" class="extra">${icon(p.icon)}<span>${esc(p.label)}</span></button>`).join('')}
    </div>` : '');
  $('#tabbar').style.gridTemplateColumns = `repeat(${main.length + (more.length ? 1 : 0)}, minmax(0, 1fr))`;
  document.body.classList.toggle('more-open', Boolean(state.moreOpen && more.length));
  const dark = currentTheme() === 'dark';
  $('#theme-btn').innerHTML = `${icon(dark ? 'sun' : 'moon')}<span>${dark ? 'Light mode' : 'Dark mode'}</span>`;
}
function setMore(open) {
  state.moreOpen = open;
  $('#more-sheet')?.classList.toggle('open', open);
  $('[data-more-toggle]')?.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('more-open', open);
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-more-toggle]')) return setMore(!state.moreOpen);
  if (state.moreOpen && (e.target.closest('[data-nav]') || !e.target.closest('#more-sheet'))) setMore(false);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.moreOpen) setMore(false); });

function currentTheme() {
  const t = document.documentElement.dataset.theme;
  if (t) return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
$('#theme-btn').addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('fp-theme', next); } catch {}
  renderNav();
});

function go(page) {
  state.page = PAGES.some((p) => p.id === page) ? page : 'home';
  if (state.page === 'kids' && chat.open) chatClose();
  document.body.classList.toggle('kitchen-mode', state.page === 'kitchen');
  document.body.classList.toggle('kids-mode', state.page === 'kids');
  if (state.page !== 'kitchen') kitchenOff();
  history.replaceState(null, '', '#' + state.page);
  window.scrollTo(0, 0);
  refresh();
}

async function refresh() {
  const [family, demo] = await Promise.all([api('/family'), api('/demo').catch(() => ({ on: false }))]);
  state.family = family;
  state.demo = demo;
  demoBanner();
  $('.brand-name').textContent = family.name || 'Family Planner';
  if (!state.family.children.some((c) => c.id === state.childId)) state.childId = state.family.children[0]?.id || null;
  const page = PAGES.find((p) => p.id === state.page);
  $('#page-title').textContent = page.title;
  $('#page-sub').textContent = '';
  $('#page-actions').innerHTML = '';
  $('#brand-sub').textContent = `${plural(state.family.people, 'person', 'people')} at home`;
  await guard(page.render)();
  if (page.id !== 'home' && guideMode() === 'on') {
    const done = await guideState().catch(() => null);
    if (done) guideBanner(done);
  }
  if (page.id !== 'kitchen') {
    $('#page').classList.remove('fade-in');
    void $('#page').offsetWidth;
    $('#page').classList.add('fade-in');
  }
  renderNav();
  chatShowFab();
  if (page.id === 'home') chatCheckInbox();
}

// ---------- shared pieces ----------
function statusPill(s) {
  return s.status === 'buy-now' ? `<span class="pill bad">${icon('alert')} Needs clothes</span>`
    : s.status === 'buy-soon' ? '<span class="pill warn">Buy soon</span>'
      : `<span class="pill">${icon('check')} All good</span>`;
}

function money(n) {
  return '£' + (Math.round(n * 100) / 100).toLocaleString('en-GB', { maximumFractionDigits: 0 });
}

// "Pass all 4 to Ava": one button per sibling with two or more things waiting.
function passAllButtons(list) {
  const by = new Map();
  for (const h of list) by.set(h.toChildId, { name: h.toName, n: (by.get(h.toChildId)?.n || 0) + 1, from: new Set([...(by.get(h.toChildId)?.from || []), h.fromChildId]) });
  const from = new Set(list.map((h) => h.fromChildId));
  return [...by].filter(([, v]) => v.n >= 2).map(([id, v]) =>
    `<button class="btn sm primary" data-pass-all="${esc(id)}" ${from.size === 1 ? `data-from="${esc([...from][0])}"` : ''}>Pass all ${esc(v.n)} to ${esc(v.name)}</button>`).join(' ');
}

function kidCard(s, i, { compact = false } = {}) {
  const child = state.family.children.find((c) => c.id === s.childId) || { name: s.name };
  const rows = Object.entries(state.targets).map(([t, want]) => {
    let have = s.fitting[t] || 0;
    if (t === 'top' || t === 'bottom') have += s.fitting.dress + s.fitting.onesie;
    const pct = want ? Math.min(100, (have / want) * 100) : 100;
    return `<span class="lbl">${esc(t)}</span><div class="bar ${have < want ? 'short' : ''}"><span style="width:${pct}%"></span></div><span class="val">${esc(have)}/${esc(want)}</span>`;
  }).join('');
  const f = s.forecast;
  const sh = s.shoeForecast;
  const b = s.budget;
  const u = s.uniform;
  return `
    <div class="card">
      <div class="kid-head">
        ${avatar(child, i)}
        <div class="grow" style="flex:1;min-width:0">
          <h3>${esc(s.name)}</h3>
          <div class="sub muted small">${child.age != null ? Math.floor(child.age) + ' yrs · ' : ''}${esc(s.clothingSize || 'no size set')} · ${plural(s.outfitCount, 'outfit')}</div>
        </div>
        ${statusPill(s)}
      </div>
      <p class="small" style="margin-top:12px">${esc(s.advice)}</p>
      ${s.handMeDowns ? `<p class="hint" style="margin-top:6px">♻️ Counting ${plural(s.handMeDowns.count, 'hand-me-down')} from ${esc(s.handMeDowns.from.join(' and '))}, so you don't buy what you already have.</p>` : ''}
      ${s.laundry && s.laundry.inWash ? `<div class="chips" style="margin-top:8px"><span class="pill ${s.laundry.warning ? 'warn' : 'plain'}">🧺 ${s.laundry.inWash} in the wash · ${plural(s.laundry.cleanDays, 'clean day')} left</span></div>` : ''}
      ${compact ? '' : `<div class="bars">${rows}</div>`}
      <div class="forecasts">
        <div class="forecast"><div class="k">Next clothes size</div>
          <div class="v">${f && f.nextSize ? `${esc(f.nextSize)} · ${fmtShort(f.date)}` : '—'}</div>
          ${f && f.nextSize && s.nextSizeNeeds && Object.keys(s.nextSizeNeeds).length ? `<div class="small muted">Need ${Object.entries(s.nextSizeNeeds).map(([t, n]) => `${n} ${esc(t)}`).join(', ')}</div>` : ''}
        </div>
        <div class="forecast"><div class="k">Next shoe size</div>
          <div class="v">${sh ? `${esc(sh.nextSize)} · ${fmtShort(sh.date)}` : '—'}</div>
          ${sh ? `<div class="small muted">Now ${esc(sh.currentSize)}</div>` : '<div class="small muted">Add a shoe size</div>'}
        </div>
        ${b ? `<div class="forecast"><div class="k">Clothes budget</div>
          <div class="v">${money(b.now)} now</div>
          <div class="small muted">${b.nextSize ? `+ ${money(b.nextSize)} for ${esc(f.nextSize)} by ${fmtShort(b.nextSizeBy)}` : 'Next size covered'}</div></div>` : ''}
        ${u ? `<div class="forecast"><div class="k">School uniform</div>
          <div class="v">${u.buyBeforeTerm ? `Buy ${esc(u.buySize)}` : 'Covered'}</div>
          <div class="small muted">${u.buyBeforeTerm ? Object.entries(u.short).map(([t, n]) => `${n} ${esc(t)}`).join(', ') + ` before ${fmtShort(u.termStart)}` : `Ready for ${fmtShort(u.termStart)}`}</div></div>` : ''}
      </div>
    </div>`;
}

function reminderList(list, limit = 6) {
  const icon_ = { food: '🥕', clothes: '👕', laundry: '🧺', shopping: '🛒', chores: '🧹', calendar: '🎒', birthday: '🎂', packing: '🧳', money: '💷' };
  return `<ul class="list">${list.slice(0, limit).map((r) => `
    <li class="row">
      <span class="emoji">${icon_[r.kind] || '🔔'}</span>
      <div class="grow"><div class="title">${esc(r.title)}</div>${r.detail ? `<div class="sub">${esc(r.detail)}</div>` : ''}</div>
      <span class="pill ${r.level === 'urgent' ? 'bad' : r.level === 'warn' ? 'warn' : 'plain'}">${r.level === 'urgent' ? 'Now' : r.level === 'warn' ? 'Soon' : 'FYI'}</span>
    </li>`).join('')}</ul>${list.length > limit ? `<p class="hint" style="margin-top:8px">and ${list.length - limit} more</p>` : ''}`;
}

function weekStrip(plan) {
  state.week = Array.from({ length: 7 }, (_, d) => plan[d]?.id || null);
  const days = [];
  const start = new Date();
  for (let d = 0; d < 7; d++) {
    const date = new Date(start.getTime() + d * 86400000);
    const meal = plan[d];
    const name = d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : date.toLocaleDateString(undefined, { weekday: 'short' });
    days.push(meal
      ? `<div class="day ${d === 0 ? 'today' : ''}"><div class="dname">${name}</div><div style="font-size:22px">${MEAL_EMOJI(meal.name)}</div><div class="meal">${esc(meal.name)}</div></div>`
      : `<div class="day gap"><div class="dname">${name}</div><div class="meal">Shop needed</div></div>`);
  }
  return `<div class="week">${days.join('')}</div>`;
}

function balanceChips(b) {
  if (!b || !b.meals) return '';
  const chip = (label, n) => `<span class="pill ${n >= b.meals * 0.7 ? '' : 'warn'}">${label} ${n}/${b.meals}</span>`;
  return `<div class="chips" style="margin-top:14px;align-items:center">
    <span class="small muted" style="font-weight:600">Balance this week</span>
    ${chip('🥦 Veg', b.veg)} ${chip('🍗 Protein', b.protein)} ${chip('🍞 Carbs', b.carbs)}
    <span class="pill plain">🧀 Dairy ${b.dairy}/${b.meals}</span>
  </div>${b.tips.length ? `<p class="hint" style="margin-top:6px">${b.tips.map(esc).join(' ')}</p>` : ''}`;
}

const emptyState = (emoji, text, action = '') =>
  `<div class="empty"><span class="big-emoji">${emoji}</span>${text}${action ? `<div style="margin-top:12px">${action}</div>` : ''}</div>`;

// ---------- home ----------
// ---------- first-run guide ----------
// A new family is walked through three steps (children, cupboards, clothes). It starts the first
// time Home opens with nothing set up, shows a hint on each step's page, and ends once all three
// are done or the person skips it. Kept per device in localStorage 'fp-guide'.
const GUIDE_STEPS = [
  { id: 'family', page: 'family', icon: 'people', title: 'Add your children', hint: "Add each child with their birth date, and their clothing and shoe sizes if you know them. Set how many grown-ups live with you under Household." },
  { id: 'food', page: 'food', icon: 'food', title: "Add what's in the cupboards", hint: "Add a few things from your cupboards, fridge and freezer. The quick-add buttons are fastest. Meal ideas use whatever's here." },
  { id: 'clothes', page: 'clothes', icon: 'shirt', title: "Add the kids' clothes", hint: "Add some of each child's clothes. Outfit ideas and the \"what to buy next\" forecast use them." },
];
const guideMode = () => { try { return localStorage.getItem('fp-guide'); } catch { return 'done'; } };
const setGuide = (v) => { try { localStorage.setItem('fp-guide', v); } catch {} };
async function guideProgress() {
  const [food, clothes] = await Promise.all([api('/food/items'), api('/clothes/items')]);
  return { family: state.family.children.length > 0, food: food.length > 0, clothes: clothes.length > 0 };
}
// Checks the steps; when the last one is done the guide ends with a cheer.
async function guideState() {
  if (guideMode() !== 'on' || state.demo?.on) return null;
  const done = await guideProgress();
  if (GUIDE_STEPS.every((st) => done[st.id])) {
    setGuide('done');
    toast("You're all set up! Suggestions now use your family's own lists.");
    return null;
  }
  return done;
}
function guideCard(done) {
  const count = GUIDE_STEPS.filter((st) => done[st.id]).length;
  const next = GUIDE_STEPS.find((st) => !done[st.id]);
  return `<div class="card" id="guide-card" style="margin-bottom:16px">
    <div class="card-head"><h2>Welcome! Let's set things up</h2><span class="pill plain">${count} of ${GUIDE_STEPS.length} done</span></div>
    <p class="hint" style="margin-top:6px">Three quick steps and the app starts suggesting meals, outfits and shopping for your family.</p>
    <ul class="list" style="margin-top:8px">${GUIDE_STEPS.map((st, i) => `<li class="row">
      <span class="emoji">${done[st.id] ? '✅' : `<strong>${i + 1}</strong>`}</span>
      <div class="grow"><div class="title" style="${done[st.id] ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(st.title)}</div></div>
      ${done[st.id] ? '' : `<button class="btn sm ${st === next ? 'primary' : ''}" data-nav="${st.page}">${st === next ? 'Start' : 'Go'}</button>`}</li>`).join('')}</ul>
    <p class="small" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <span class="muted">Optional:</span>
      <button class="chip" data-nav="settings">${icon('sparkle')} Pick an AI</button>
      <button class="chip" data-nav="settings">${icon('edit')} Colours and tabs</button>
      <button class="btn ghost sm" data-guide="skip">I'll do this later</button>
    </p></div>`;
}
// The hint at the top of a step's own page.
function guideBanner(done) {
  const i = GUIDE_STEPS.findIndex((st) => st.page === state.page);
  if (i < 0) return;
  const st = GUIDE_STEPS[i];
  const next = GUIDE_STEPS.find((x) => !done[x.id] && x !== st);
  $('#page').insertAdjacentHTML('afterbegin', `<div class="banner" id="guide-banner" style="margin-bottom:16px;background:var(--accent-soft);color:var(--accent)">
    <span style="font-size:22px">${done[st.id] ? '✅' : '👋'}</span>
    <div class="grow"><div>Step ${i + 1} of ${GUIDE_STEPS.length}: ${esc(st.title)}</div><div class="small" style="font-weight:400;margin-top:2px">${done[st.id] ? 'Done. Add more any time.' : esc(st.hint)}</div></div>
    ${done[st.id] && next ? `<button class="btn sm primary" data-nav="${next.page}">Next: ${esc(next.title)}</button>` : ''}
    <button class="btn ghost sm" data-nav="home">Back to the checklist</button></div>`);
}

async function renderHome() {
  state.ai = await api('/ai/settings');
  const [d, targets] = await Promise.all([api('/dashboard'), api('/clothes/targets')]);
  state.targets = targets;
  state.shoppingCount = d.shoppingCount;
  const hour = new Date().getHours();
  $('#page-title').textContent = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  $('#page-sub').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) +
    ` · ${plural(d.family.people, 'person', 'people')}, ${d.family.portions} portions a meal`;
  const kidsNeeding = d.clothes.filter((s) => s.status !== 'ok').length;
  const budget = d.clothes.reduce((sum, s) => sum + (s.budget ? s.budget.total : 0), 0);

  const firstRun = !d.family.children.length && !d.food.plan.length && !d.food.expiringSoon.length;
  if (firstRun && !guideMode() && !state.demo?.on) setGuide('on');
  const guide = await guideState();
  const signedOut = ACCOUNT && !ACCOUNT.status().signedIn && !state.demo?.on;
  let nudge = signedOut && !firstRun && !guide;
  try { nudge = nudge && !localStorage.getItem('fp-account-nudge'); } catch {}
  $('#page').innerHTML = `
    ${guide ? guideCard(guide) : ''}
    ${guide && signedOut ? `<p class="hint" style="margin:-6px 0 16px">Save your lists online and share them with your family: <button class="btn sm" data-account="signin">Sign in</button> <button class="btn sm" data-account="signup">Create account</button></p>` : ''}
    ${nudge ? `<div class="banner" style="margin-bottom:16px;background:var(--accent-soft);color:var(--accent)"><span style="font-size:22px">☁️</span>
      <div class="grow">Save your data online and use it on all your devices.</div>
      <button class="btn sm primary" data-account="signup">Create account</button><button class="btn sm" data-account="signin">Sign in</button>
      <button class="btn ghost sm" data-account="dismiss" aria-label="Not now">${icon('x')}</button></div>` : ''}
    <div class="grid g4">
      <button class="card kpi tone-green" data-nav="food" data-tool="food"><span class="ico">${icon('food')}</span><span class="num">${d.food.mealsLeft}${d.food.capped ? '+' : ''}</span><span class="lbl">meals left in stock</span></button>
      <button class="card kpi tone-warn" data-nav="food" data-tool="food"><span class="ico">${icon('clock')}</span><span class="num">${d.food.expiringSoon.length}</span><span class="lbl">to use in 3 days</span></button>
      <button class="card kpi tone-coral" data-nav="clothes" data-tool="clothes"><span class="ico">${icon('shirt')}</span><span class="num">${budget ? money(budget) : kidsNeeding}</span><span class="lbl">${budget ? 'kids\' clothes budget ahead' : (kidsNeeding === 1 ? 'child needs' : 'children need') + ' clothes'}</span></button>
      <button class="card kpi tone-blue" data-nav="shopping" data-tool="shopping"><span class="ico">${icon('cart')}</span><span class="num">${d.shoppingCount}</span><span class="lbl">on the shopping list</span></button>
    </div>

    ${d.reminders.length ? `<div class="card" style="margin-top:16px"><div class="card-head"><h2>🔔 Reminders</h2><span class="muted small">${plural(d.reminders.length, 'thing')} to know</span></div>${reminderList(d.reminders)}</div>` : ''}

    <div class="card" style="margin-top:16px" data-tool="food">
      <div class="card-head"><h2>This week's dinners</h2><span class="muted small" id="week-by">Planned from what's in, using food that goes off first</span></div>
      <div id="week-strip">${weekStrip(d.food.plan)}</div>
      <p style="margin-top:12px"><button class="btn" data-week-shop>${icon('cart')} Shop for the week</button> <span class="hint">Fills the gaps and adds what all 7 dinners need</span></p>
      ${balanceChips(d.food.balance)}
      ${d.food.expiringSoon.length ? `<div class="chips" style="margin-top:14px">${d.food.expiringSoon.map((e) =>
        `<span class="pill ${e.days < 0 ? 'bad' : 'warn'}">${foodCat(e.name).emoji} ${esc(e.name)} · ${e.days < 0 ? 'out of date' : e.days === 0 ? 'today' : 'in ' + plural(e.days, 'day')}</span>`).join('')}</div>` : ''}
    </div>

    ${d.handMeDowns.length ? `<div class="card" style="margin-top:16px" data-tool="clothes"><div class="card-head"><h2>♻️ Hand-me-downs</h2>${passAllButtons(d.handMeDowns) || '<span class="muted small">Outgrown clothes a sibling can use</span>'}</div>
      <ul class="list">${d.handMeDowns.slice(0, 5).map((h) => `<li class="row"><span class="emoji">${GARMENT[h.type] || '👕'}</span>
        <div class="grow"><div class="title">${esc(h.name)} <span class="pill plain">${esc(h.size)}</span></div><div class="sub">${esc(h.fromName)} → ${esc(h.toName)} · ${h.fitsNow ? 'fits now' : 'to grow into'}</div></div>
        <button class="btn sm" data-handdown="${esc(h.itemId)}" data-to="${esc(h.toChildId)}">Pass to ${esc(h.toName)}</button></li>`).join('')}</ul></div>` : ''}

    ${choresHomeCard(d.chores)}

    ${calendarHomeCard(d.calendar, d.trips)}

    <div class="card-head" style="margin:26px 0 12px" data-tool="clothes"><h2>Kids' clothes</h2><button class="btn sm" data-nav="clothes">Open wardrobes</button></div>
    ${d.clothes.length ? `<div class="grid g2" data-tool="clothes">${d.clothes.map((s, i) => kidCard(s, i)).join('')}</div>`
      : `<div class="card">${emptyState('👶', 'No children added yet.', '<button class="btn primary" data-nav="family">Add a child</button>')}</div>`}
  `;
  if (state.ai.suggestions) aiWeek(d.food.plan);
}

// The AI's week of dinners, with the rules' plan filling any day it left empty.
async function aiWeek(rulePlan) {
  $('#week-by').textContent = '✨ Asking the AI to plan the week…';
  const r = await aiSuggest('meals');
  if (!r || !$('#week-strip')) return;
  if (r.error || !r.week.some(Boolean)) {
    $('#week-by').textContent = "Planned from what's in, using food that goes off first";
    return;
  }
  $('#week-strip').innerHTML = weekStrip(r.week.map((m, i) => m || rulePlan[i] || null));
  $('#week-by').innerHTML = `✨ Planned by ${esc(r.by)} <button class="btn ghost sm" data-ai-refresh="meals">Ask again</button>`;
}

// ---------- AI suggestions ----------
// Every suggestion starts from the app's own rules and shows at once. When an AI is set up
// (and "Use AI for suggestions" is on), the page then asks the AI and swaps its answer in.
// If the AI can't help, the rules' suggestions stay, with a note saying so.
async function aiSuggest(area, params = {}, { refresh = false } = {}) {
  const ai = state.ai || (state.ai = await api('/ai/settings'));
  if (!ai.suggestions) return null;
  const page = state.page;
  try {
    const r = await api('/ai/suggest/' + area, { method: 'POST', body: { ...params, refresh } });
    return state.page === page ? r : null;
  } catch (e) {
    return state.page === page ? { error: e.message } : null;
  }
}
const aiByline = (r) => r && !r.error ? `<span class="pill blue" title="Suggested by ${esc(r.by)}">✨ AI</span>` : '';
const aiNote = (r, what) => r?.error ? `<p class="hint" style="margin-top:8px">The AI couldn't help just now (${esc(r.error)}), so these ${what} come from the app's own rules.</p>` : '';

// ---------- food ----------
async function renderFood() {
  const [items, meals, stats, recipes, ai] = await Promise.all([
    api('/food/items'), api('/food/meals'), api('/food/stats'), api('/food/recipes'), api('/ai/settings'),
  ]);
  state.ai = ai;
  const ready = meals.meals.filter((m) => m.status === 'ready').length;
  $('#page-sub').textContent = `${plural(stats.mealsLeft, 'meal')} left · ${ready} ready to cook · sized for ${plural(state.family.people, 'person', 'people')}` +
    (meals.dietary.length ? ` · ${meals.dietary.join(', ')}` : '');
  state.foodPeople = meals.people || [];
  const tabs = [['pantry', `What's in (${items.length})`], ['meals', `Meals (${ready + (meals.leftovers || []).length})`], ['lunchbox', 'Lunchboxes'], ['recipes', 'My recipes']];
  $('#page').innerHTML = `
    <div class="seg" style="margin-bottom:16px">${tabs.map(([k, l]) => `<button data-food-view="${esc(k)}" class="${state.foodView === k ? 'active' : ''}">${esc(l)}</button>`).join('')}</div>
    <div id="food-body"></div>`;
  const body = $('#food-body');
  if (state.foodView === 'pantry') body.innerHTML = pantryView(items, stats);
  else if (state.foodView === 'meals') {
    body.innerHTML = aiIdeasCard() + mealsView(meals.meals, null, meals.leftovers);
    if (ai.suggestions) {
      $('#meals-ai-status').innerHTML = '<p class="hint">✨ Asking the AI what to cook next…</p>';
      const r = await aiSuggest('meals');
      if (r && $('#food-body') && state.foodView === 'meals') body.innerHTML = aiIdeasCard() + mealsView(meals.meals, r, meals.leftovers);
    }
  }
  else if (state.foodView === 'lunchbox') {
    const plan = await api('/food/lunchbox');
    if (!$('#food-body') || state.foodView !== 'lunchbox') return;
    body.innerHTML = lunchboxView(plan);
    if (ai.suggestions && plan.children.length) {
      $('#lunch-ai-status').innerHTML = '<p class="hint">✨ Asking the AI to plan the lunchboxes…</p>';
      const r = await aiSuggest('lunchbox');
      if (r && $('#food-body') && state.foodView === 'lunchbox') body.innerHTML = lunchboxView(plan, r);
    }
  }
  else {
    state.recipeRatings = (await api('/food/ratings').catch(() => ({ recipes: {} }))).recipes;
    body.innerHTML = recipesView(recipes);
  }
}

// How long ago, in words: "today", "3 days ago", "3 weeks ago", "4 months ago".
function agoText(date) {
  const d = Math.max(0, Math.round((new Date(new Date().toISOString().slice(0, 10)) - new Date(date)) / 86400000));
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  return `${Math.round(d / 30.4)} months ago`;
}
const FREEZER_NUDGE_DAYS = 90;
const PANTRY_FILTERS = [['all', 'Everything'], ['fridge', '🥕 Fridge & cupboards'], ['freezer', '🧊 Freezer'], ['leftovers', '🍱 Leftovers']];

function pantryView(items, stats) {
  const unmatched = new Set(stats.unmatched);
  const today = new Date().toISOString().slice(0, 10);
  const f = state.pantryFilter || 'all';
  const counts = { all: items.length, fridge: items.filter((i) => !i.frozen && !i.leftover).length, freezer: items.filter((i) => i.frozen).length, leftovers: items.filter((i) => i.leftover).length };
  const all = items;
  items = items.filter((i) => f === 'all' ? true : f === 'freezer' ? i.frozen : f === 'leftovers' ? i.leftover : !i.frozen && !i.leftover);
  const groups = {};
  for (const it of items) (groups[it.leftover ? 'Leftovers' : foodCat(it.name).cat] ||= []).push(it);
  const order = [...FOOD_CATS.map((c) => c[0]), 'Other'];
  const days = (d) => Math.round((new Date(d) - new Date(today)) / 86400000);
  const filters = `<div class="chips" style="margin-bottom:12px">${PANTRY_FILTERS.map(([k, l]) => `<button class="chip ${f === k ? 'active' : ''}" data-pantry-filter="${esc(k)}">${esc(l)} <span class="muted">${esc(counts[k])}</span></button>`).join('')}</div>`;
  const list = items.length ? order.filter((g) => groups[g]).map((g) => `
    <div class="group-title">${esc(g)}</div>
    <ul class="list">${groups[g].map((it) => {
      const dl = it.expiry && !it.frozen ? days(it.expiry) : null;
      const exp = dl === null ? '' : dl < 0 ? '<span class="pill bad">Out of date</span>' : dl <= 3 ? `<span class="pill warn">${dl === 0 ? 'Use today' : 'Use in ' + esc(plural(dl, 'day'))}</span>` : '';
      const frozenFor = it.frozen ? -days(it.frozen) : 0;
      const frz = it.frozen ? `<span class="pill blue">🧊 Frozen ${esc(agoText(it.frozen))}</span>${frozenFor >= FREEZER_NUDGE_DAYS ? ' <span class="pill warn">Use soon</span>' : ''}` : '';
      const sub = it.frozen ? `In the freezer since ${esc(fmtDate(it.frozen))}`
        : it.expiry ? 'Use by ' + esc(fmtDate(it.expiry)) : 'No use-by date';
      const from = it.leftover ? ` · cooked ${esc(agoText(it.leftover.cookedAt || today))}` : '';
      return `
      <li class="row">
        <span class="emoji">${it.leftover ? '🍱' : foodCat(it.name).emoji}</span>
        <div class="grow">
          <div class="title">${esc(it.name)} ${exp}${frz}</div>
          <div class="sub">${sub}${from}${unmatched.has(it.name) && !it.leftover ? ' · not in any recipe yet' : ''}</div>
        </div>
        <button class="icon-btn" data-freeze="${esc(it.id)}" data-state="${it.frozen ? 'true' : 'false'}" aria-label="${it.frozen ? 'Take out of the freezer' : 'Put in the freezer'}: ${esc(it.name)}" title="${it.frozen ? 'Take out of the freezer' : 'Put in the freezer'}">${it.frozen ? '🔥' : '❄️'}</button>
        <div class="stepper">
          <button data-step="${esc(it.id)}" data-delta="-1" aria-label="Less">−</button>
          <input type="number" step="any" min="0" value="${esc(it.quantity)}" data-qty="${esc(it.id)}" aria-label="Quantity of ${esc(it.name)}">
          <button data-step="${esc(it.id)}" data-delta="1" aria-label="More">+</button>
        </div>
        <span class="small muted unit" style="width:30px">${esc(it.unit)}</span>
        <button class="icon-btn danger" data-del-food="${esc(it.id)}" aria-label="Remove ${esc(it.name)}">${icon('trash')}</button>
      </li>`;
    }).join('')}</ul>`).join('')
    : all.length ? emptyState(f === 'freezer' ? '🧊' : f === 'leftovers' ? '🍱' : '🥫', f === 'freezer' ? 'Nothing in the freezer. Tap ❄️ on anything you freeze.' : f === 'leftovers' ? 'No leftovers. After cooking, say how much is left and it shows up here.' : 'Nothing here.')
      : emptyState('🥫', 'Nothing in yet. Add items, scan a barcode, or snap a photo.');

  return `
    <div class="split">
      <div class="card">
        <div class="card-head"><h2>Add food</h2></div>
        <div class="grid g2" style="margin-bottom:14px">
          <button class="btn" data-barcode>${icon('barcode')} Scan barcode</button>
          <button class="btn" data-ai-scan="food">${icon('camera')} Photo or receipt</button>
        </div>
        <form id="food-form" class="stack">
          <label class="field">Item<input name="name" placeholder="e.g. Chicken breast" required list="food-names" autocomplete="off"></label>
          <div class="form-row" style="grid-template-columns:1fr 1fr">
            <label class="field">Amount<input name="quantity" type="number" step="any" min="0" placeholder="500"></label>
            <label class="field">Unit<select name="unit">${options(state.units, 'pcs')}</select></label>
          </div>
          <label class="field">Use by (optional)<input name="expiry" type="date"></label>
          <label class="chip" style="align-self:flex-start"><input type="checkbox" name="frozen" value="true" style="width:auto"> 🧊 It's going in the freezer</label>
          <button class="btn primary">${icon('plus')} Add to cupboard</button>
        </form>
        <datalist id="food-names">${QUICK_ADD.map(([n]) => `<option value="${esc(n)}">`).join('')}</datalist>
        <p class="hint" style="margin-top:12px">Use g/kg, ml/l, tin or pcs so meals can be counted properly.</p>
        <div class="group-title" style="margin-top:18px">Quick add</div>
        <div class="chips">${QUICK_ADD.map(([n], i) => `<button class="chip" data-quick="${i}">${foodCat(n).emoji} ${esc(n)}</button>`).join('')}</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>In the cupboards</h2><span class="muted small">${esc(plural(items.length, 'item'))}</span></div>
        ${filters}
        ${list}
      </div>
    </div>`;
}

const DIET_LABEL = { vegetarian: '🌱 Veggie', 'dairy-free': 'No dairy', 'gluten-free': 'No gluten', 'nut-free': 'Nut free' };

function aiIdeasCard() {
  const ai = state.ai;
  if (!ai || !ai.ready) {
    // The app is built to work fully without AI, so this stays a quiet, optional pointer.
    return `<p class="hint" style="margin-bottom:16px">Optional: add an AI in <button class="btn ghost sm" data-nav="settings">Settings</button> for meal ideas beyond your recipes and for reading photos. Everything else works without one.</p>`;
  }
  const ideas = state.aiIdeas;
  return `<div class="card" style="margin-bottom:16px">
    <div class="card-head"><h2>✨ Ideas from AI</h2><span class="muted small">Using ${esc(ai.model || ai.provider)}</span></div>
    <form id="ai-ideas-form" class="form-row" style="grid-template-columns:1fr auto">
      <input name="request" placeholder="Anything in mind? e.g. quick, no oven, something new for the kids">
      <button class="btn primary" ${state.aiBusy ? 'disabled' : ''}>${state.aiBusy ? 'Thinking…' : icon('sparkle') + ' Get ideas'}</button>
    </form>
    ${ideas ? `<div class="meal-grid" style="margin-top:14px">${ideas.map((idea, i) => `
      <div class="card meal-card" style="box-shadow:none">
        <div class="top"><span class="emoji">${MEAL_EMOJI(idea.name)}</span>
          <div style="flex:1;min-width:0"><div class="name">${esc(idea.name)}</div><div class="meta"><span>${icon('clock')} ${esc(idea.minutes)} min</span><span>Serves ${esc(idea.servings)}</span></div></div></div>
        <p class="small">${esc(idea.why)}</p>
        ${idea.missing.length ? `<div class="small">To buy: <strong>${idea.missing.map(esc).join(', ')}</strong></div>` : '<span class="pill" style="align-self:flex-start">Nothing to buy</span>'}
        <details><summary>Ingredients and method</summary>
          <ul>${idea.ingredients.map((g) => `<li>${fmtAmount({ amount: g.qty, unit: g.unit === 'kg' ? 'g' : g.unit === 'l' ? 'ml' : g.unit, ...(g.unit === 'kg' ? { amount: g.qty * 1000 } : g.unit === 'l' ? { amount: g.qty * 1000 } : {}) })} ${esc(g.name)}</li>`).join('')}</ul>
          <ol style="margin:8px 0 0;padding-left:18px;font-size:13px">${idea.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        </details>
        <div class="actions">
          <button class="btn primary sm" data-save-idea="${i}">${icon('book')} Save recipe</button>
          ${idea.missing.length ? `<button class="btn sm" data-shop-missing="${esc(JSON.stringify(idea.missing))}">${icon('cart')} Add to shopping</button>` : ''}
        </div>
      </div>`).join('')}</div>` : ''}
  </div>`;
}

// What the family thought of a meal: 👍 3 · 😐 1 · 👎 1, and who isn't keen.
function ratingChips(r) {
  if (!r || !(r.up + r.meh + r.down)) return '';
  const counts = [['👍', r.up], ['😐', r.meh], ['👎', r.down]].filter(([, n]) => n).map(([e, n]) => `${e} ${esc(n)}`).join(' · ');
  return `<span class="pill plain" title="What the family thought">${counts}</span>${notKeenPill(r)}`;
}
function notKeenPill(r) {
  const list = (r && r.notKeen) || [];
  if (!list.length) return '';
  const who = list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  return ` <span class="pill warn">${esc(who)} ${list.length === 1 ? "isn't" : "aren't"} keen</span>`;
}

function leftoverCards(leftovers) {
  if (!leftovers || !leftovers.length) return '';
  const today = new Date().toISOString().slice(0, 10);
  return leftovers.map((l) => {
    const dl = l.expiry ? Math.round((new Date(l.expiry) - new Date(today)) / 86400000) : null;
    const when = l.frozen ? `<span class="pill blue">🧊 Frozen ${esc(agoText(l.frozen))}</span>`
      : dl === null ? '' : dl < 0 ? '<span class="pill bad">Past its use-by</span>' : `<span class="pill warn">${dl === 0 ? 'Eat today' : dl === 1 ? 'Eat by tomorrow' : 'Eat in ' + esc(plural(dl, 'day'))}</span>`;
    return `
      <div class="card meal-card">
        <div class="top"><span class="emoji">🍱</span>
          <div class="grow" style="flex:1;min-width:0"><div class="name">${esc(l.name)}</div>
            <div class="meta"><span>${esc(l.portions ?? '?')} portion${Number(l.portions) === 1 ? '' : 's'}</span><span>Already cooked</span></div></div></div>
        <div class="chips"><span class="pill">Eat these first</span>${when}</div>
        <div class="actions">
          <button class="btn primary sm" data-eat-leftover="${esc(l.id)}">${icon('check')} We ate it</button>
          <button class="btn sm" data-freeze="${esc(l.id)}" data-state="${l.frozen ? 'true' : 'false'}">${l.frozen ? '🔥 Defrost' : '❄️ Freeze'}</button>
        </div>
      </div>`;
  }).join('');
}

function mealsView(meals, ai = null, leftovers = []) {
  // With AI picks, the AI's choices come first, each saying why.
  const picks = ai && !ai.error ? ai.picks : [];
  const why = new Map(picks.map((p) => [p.id, p.why]));
  if (picks.length) meals = [...picks.map((p) => meals.find((m) => m.id === p.id)).filter(Boolean), ...meals.filter((m) => !why.has(m.id))];
  const filters = [['all', 'All'], ['ready', 'Ready now'], ['favourites', '⭐ Favourites'], ['quick', 'Under 20 min'], ['vegetarian', 'Vegetarian'], ['expiring', 'Uses food going off']];
  const f = state.mealFilter;
  const shown = meals.filter((m) =>
    f === 'all' ? true : f === 'ready' ? m.status === 'ready' : f === 'quick' ? m.minutes <= 20
      : f === 'favourites' ? m.favourite : f === 'vegetarian' ? m.diet.includes('vegetarian') : m.usesExpiring);
  const card = (m) => {
    const tag = m.status === 'ready' ? `<span class="pill">${icon('check')} Ready</span>`
      : m.status === 'short' ? '<span class="pill warn">Not quite enough</span>'
        : `<span class="pill bad">Need ${m.missing.length}</span>`;
    const needs = [...m.missing, ...m.short.map((s) => s.name)];
    return `
      <div class="card meal-card">
        <div class="top">
          <span class="emoji">${MEAL_EMOJI(m.name)}</span>
          <div class="grow" style="flex:1;min-width:0"><div class="name">${esc(m.name)}</div>
            <div class="meta"><span>${icon('clock')} ${esc(m.minutes)} min</span><span>${m.tags.filter((t) => t !== 'vegetarian').map(esc).join(' · ')}</span></div></div>
          <button class="icon-btn star ${m.favourite ? 'on' : ''}" data-fav="${esc(m.id)}" data-state="${m.favourite}" aria-label="${m.favourite ? 'Remove from' : 'Add to'} favourites" title="Family favourite">${m.favourite ? '★' : '☆'}</button>
        </div>
        ${why.has(m.id) ? `<div class="small" style="color:var(--accent);font-weight:600">✨ ${esc(why.get(m.id))}</div>` : ''}
        <div class="chips">${why.has(m.id) ? '<span class="pill blue">✨ AI pick</span>' : ''}${tag}${m.usesExpiring ? '<span class="pill warn">Uses food going off</span>' : ''}${m.diet.filter((d) => d !== 'nut-free').map((d) => `<span class="pill plain">${esc(DIET_LABEL[d])}</span>`).join('')}${ratingChips(m.rating)}</div>
        ${m.missing.length ? `<div class="small">Missing: <strong>${m.missing.map(esc).join(', ')}</strong></div>` : ''}
        ${m.short.length ? `<div class="small">Short: ${m.short.map((s) => `${esc(s.name)} (${esc(s.have)}/${esc(s.need)} ${esc(s.unit)})`).join(', ')}</div>` : ''}
        <details><summary>Ingredients for your family</summary>
          <ul>${m.ingredients.map((i) => `<li>${fmtAmount(i)} ${esc(i.name)}${i.optional ? ' <span class="muted">(optional)</span>' : ''}</li>`).join('')}</ul>
        </details>
        <div class="actions">
          ${m.status === 'ready' ? `<button class="btn primary sm" data-cook="${esc(m.id)}">${icon('check')} Cooked it</button>` : ''}
          ${needs.length ? `<button class="btn sm" data-shop-missing="${esc(JSON.stringify(needs))}">${icon('cart')} Add to shopping</button>` : ''}
        </div>
      </div>`;
  };
  return `
    <div id="meals-ai-status">${picks.length ? `<p class="hint" style="margin-bottom:10px">✨ Ordered by ${esc(ai.by)}: what to cook next comes first. <button class="btn ghost sm" data-ai-refresh="meals">Ask again</button></p>` : aiNote(ai, 'meals')}</div>
    <div class="chips" style="margin-bottom:16px">${filters.map(([k, l]) => `<button class="chip ${f === k ? 'active' : ''}" data-meal-filter="${k}">${l}</button>`).join('')}</div>
    ${leftovers.length && ['all', 'ready'].includes(f) ? `<div class="group-title">Leftovers to eat first</div><div class="meal-grid" style="margin-bottom:16px">${leftoverCards(leftovers)}</div>` : ''}
    ${shown.length ? `<div class="meal-grid">${shown.map(card).join('')}</div>` : `<div class="card">${emptyState('🍽️', f === 'favourites' ? 'Tap the ☆ on a meal the kids love to make it a favourite.' : 'No meals match yet. Add more food to the cupboard.')}</div>`}`;
}

function recipesView(recipes) {
  const mine = recipes.filter((r) => !r.builtin);
  const units = state.units.filter((u) => u !== 'each' && u !== 'portion');
  const unitOpts = options(units, 'g');
  const draft = state.recipeDraft;
  const tag = draft ? (draft.tags || []).find((t) => ['dinner', 'lunch', 'breakfast'].includes(t)) || 'dinner' : 'dinner';
  const ingRow = (g) => `
            <div class="ing-row">
              <input name="ing-name" placeholder="Ingredient" required value="${esc(g.name)}" title="${esc(g.original || '')}">
              <input name="ing-qty" type="number" step="any" min="0" placeholder="Qty" required value="${esc(g.qty)}">
              <select name="ing-unit">${options(units, units.includes(g.unit) ? g.unit : 'pcs')}</select>
              <label class="small muted opt" style="display:flex;gap:4px;align-items:center"><input type="checkbox" name="ing-opt" style="width:auto" ${g.optional ? 'checked' : ''}> optional</label>
              <button type="button" class="icon-btn danger" data-del-ing aria-label="Remove ingredient">${icon('x')}</button>
            </div>`;
  let host = '';
  try { host = draft && draft.source ? new URL(draft.source).hostname : ''; } catch {}
  return `
    <div class="split">
      <div class="stack" style="gap:16px">
      ${draft ? '' : recipeLinkCard()}
      <div class="card" id="recipe-card">
        <div class="card-head"><h2>${draft ? 'Check the recipe' : 'Add a recipe'}</h2>${draft ? `<button type="button" class="btn ghost sm" data-recipe-draft-cancel>Cancel</button>` : ''}</div>
        ${draft ? `<p class="hint" style="margin-bottom:10px">${host ? `From ${esc(host)}. ` : ''}Check the amounts and names (they're matched to what's in your cupboards), then save.</p>` : ''}
        <form id="recipe-form" class="stack">
          <label class="field">Name<input name="name" required placeholder="e.g. Grandma's fish pie" value="${esc(draft ? draft.name : '')}"></label>
          <div class="form-row" style="grid-template-columns:1fr 1fr">
            <label class="field">Serves<input name="servings" type="number" min="1" value="${esc(draft ? draft.servings : 4)}"></label>
            <label class="field">Minutes<input name="minutes" type="number" min="1" value="${esc(draft ? draft.minutes : 30)}"></label>
          </div>
          <label class="field">Type
            <select name="tag">${options(['dinner', 'lunch', 'breakfast'], tag, { dinner: 'Dinner', lunch: 'Lunch', breakfast: 'Breakfast' })}</select></label>
          <label class="chip" style="align-self:flex-start"><input type="checkbox" name="vegetarian" style="width:auto" ${draft && (draft.tags || []).includes('vegetarian') ? 'checked' : ''}> Vegetarian</label>
          <div class="group-title">Ingredients</div>
          <div id="ing-rows" class="stack">${draft ? draft.ingredients.map(ingRow).join('') : ''}</div>
          <button type="button" class="btn sm" id="add-ing" style="align-self:flex-start">${icon('plus')} Add ingredient</button>
          <label class="field">Method (optional, one step per line)<textarea name="steps" rows="${draft && draft.steps.length ? Math.min(12, draft.steps.length + 1) : 3}" placeholder="Boil the pasta&#10;Fry the onion">${esc(draft ? draft.steps.join('\n') : '')}</textarea></label>
          ${draft && draft.source ? `<input type="hidden" name="source" value="${esc(draft.source)}">` : ''}
          <button class="btn primary">${icon('book')} Save recipe</button>
          <template id="ing-tpl">
            <div class="ing-row">
              <input name="ing-name" placeholder="Ingredient" required>
              <input name="ing-qty" type="number" step="any" min="0" placeholder="Qty" required>
              <select name="ing-unit">${unitOpts}</select>
              <label class="small muted opt" style="display:flex;gap:4px;align-items:center"><input type="checkbox" name="ing-opt" style="width:auto"> optional</label>
              <button type="button" class="icon-btn danger" data-del-ing aria-label="Remove ingredient">${icon('x')}</button>
            </div>
          </template>
        </form>
      </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Your recipes</h2><span class="muted small">Plus ${esc(recipes.length - mine.length)} built-in</span></div>
        ${mine.length ? `<ul class="list">${mine.map((r) => `
          <li class="row"><span class="emoji">${MEAL_EMOJI(r.name)}</span>
            <div class="grow"><div class="title">${esc(r.name)} ${ratingChips(state.recipeRatings && state.recipeRatings[r.id])}</div>
              <div class="sub">Serves ${esc(r.servings)} · ${esc(r.minutes)} min · ${r.ingredients.map((i) => esc(i.name)).join(', ')}</div></div>
            <button class="icon-btn danger" data-del-recipe="${esc(r.id)}" aria-label="Delete ${esc(r.name)}">${icon('trash')}</button>
          </li>`).join('')}</ul>` : emptyState('📖', 'Add your family favourites and they will show up in meal ideas.')}
        <div class="group-title" style="margin-top:20px">Built-in recipes</div>
        <div class="chips">${recipes.filter((r) => r.builtin).map((r) => `<span class="pill plain">${MEAL_EMOJI(r.name)} ${esc(r.name)}</span>${notKeenPill(state.recipeRatings && state.recipeRatings[r.id])}`).join('')}</div>
      </div>
    </div>`;
}

function addIngredientRow() {
  const tpl = $('#ing-tpl');
  if (tpl) $('#ing-rows').append(tpl.content.cloneNode(true));
}

// "81.3 g" reads oddly in a kitchen: round grams/ml to 5 (10 above 100) and drop "pcs".
const fmtAmount = (x) => esc(amountText(x));
function amountText({ amount, unit }) {
  unit = String(unit ?? '');
  if (unit === 'g' || unit === 'ml') {
    const step = amount >= 100 ? 10 : 5;
    const v = Math.max(step, Math.round(amount / step) * step);
    return v >= 1000 ? `${v / 1000} ${unit === 'g' ? 'kg' : 'l'}` : `${v} ${unit}`;
  }
  if (unit === 'pcs') return String(amount);
  if (unit === 'tsp') return amount >= 3 ? `${Math.round(amount / 3)} tbsp` : `${amount} tsp`;
  return `${amount} ${unit}${amount === 1 || unit.endsWith('s') ? '' : 's'}`;
}

// ---------- food: ratings, leftovers, lunchboxes, recipes from links ----------
// After "Cooked it": everyone gives the dinner a 👍 😐 👎, and any leftovers are saved
// (2 days in the fridge, or the freezer).
async function afterCook({ recipe, people = [] } = {}) {
  if (!recipe) return;
  const faces = [['1', '👍', 'Loved it'], ['0', '😐', 'It was OK'], ['-1', '👎', 'Not keen']];
  const rows = people.map((p) => `
    <div class="rate-row"><span class="who">${esc(p.name)}</span>
      <div class="rate-btns" role="radiogroup" aria-label="${esc(p.name)}">${faces.map(([v, e, l]) =>
        `<label title="${esc(l)}"><input type="radio" name="rate-${esc(p.id)}" value="${esc(v)}" aria-label="${esc(p.name)}: ${esc(l)}"><span>${e}</span></label>`).join('')}</div>
    </div>`).join('');
  const got = await ask({
    title: 'How was dinner?',
    ok: 'Save',
    body: `<p><strong>${esc(recipe.name)}</strong></p>
      ${people.length ? `<p class="muted small" style="margin:4px 0 8px">Everyone can tap a face. Meals the family likes come up more often.</p>${rows}` : ''}
      <div class="group-title" style="margin-top:14px">Save leftovers</div>
      <div class="form-row" style="grid-template-columns:1fr 1fr">
        <label class="field">Portions left<input name="portions" type="number" min="0" step="0.5" placeholder="0" inputmode="decimal"></label>
        <label class="field">Keep them in<select name="where"><option value="fridge">The fridge (2 days)</option><option value="freezer">The freezer</option></select></label>
      </div>`,
  });
  if (!got) return;
  const ratings = people.filter((p) => got['rate-' + p.id] !== undefined).map((p) => ({ personId: p.id, score: Number(got['rate-' + p.id]) }));
  const done = [];
  if (ratings.length) {
    await api('/food/ratings', { method: 'POST', body: { recipeId: recipe.id, ratings } });
    done.push('Thanks for the ratings');
  }
  if (Number(got.portions) > 0) {
    await api('/food/leftovers', { method: 'POST', body: { recipeId: recipe.id, portions: Number(got.portions), freeze: got.where === 'freezer' } });
    done.push(got.where === 'freezer' ? 'Leftovers are in the freezer' : 'Leftovers are in the fridge: eat them in the next 2 days');
  }
  if (done.length) {
    toast(done.join('. '));
    await renderFood();
  }
}

const LUNCH_SLOTS = [['main', '🥪', 'Main'], ['snack', '🍪', 'Snack'], ['fruit', '🍎', 'Fruit or veg'], ['drink', '🧃', 'Drink']];

// The week's lunchboxes: the rules' plan at once; the AI's answer, when there is one, fills
// each slot it planned, and the rules fill the rest.
function lunchboxView(plan, ai = null) {
  const useAi = ai && !ai.error;
  if (!plan.children.length) {
    const why = plan.notAtSchool.length ? `${plan.notAtSchool.join(' and ')} ${plan.notAtSchool.length === 1 ? "isn't" : "aren't"} at school yet, so there are no lunchboxes to plan.` : 'Add your children to plan their school lunchboxes.';
    return `<div class="card">${emptyState('🥪', esc(why), plan.notAtSchool.length ? '' : '<button class="btn primary" data-nav="family">Add a child</button>')}</div>`;
  }
  let gaps = false;
  const kids = plan.children.map((c) => {
    const a = useAi ? (ai.children || []).find((x) => x.childId === c.childId) : null;
    const days = c.days.map((d, i) => {
      const out = { ...d };
      for (const [k] of LUNCH_SLOTS) {
        if (a && a.days[i] && a.days[i][k]) out[k] = a.days[i][k];
        if (!out[k]) gaps = true;
      }
      return out;
    });
    return { ...c, days };
  });
  const rulesMissing = plan.missing.map((m) => m.name);
  const missing = useAi ? [...new Set([...(ai.toBuy || []), ...(gaps ? rulesMissing : [])])] : rulesMissing;
  const slot = (s, emoji, label) => `<div title="${esc(label)}">${emoji} ${s ? esc(s.name) : '<span class="muted">Nothing in for this</span>'}</div>`;
  const status = useAi
    ? `<p class="hint">✨ Planned by ${esc(ai.by)} from what's in. <button class="btn ghost sm" data-ai-refresh="lunchbox">Ask again</button></p>`
    : ai?.error ? aiNote(ai, 'lunchboxes') : '<p class="hint">Planned from what\'s in: a main, a snack, fruit or veg and a drink, varied through the week and leaving out what each child won\'t eat.</p>';
  return `
    <div id="lunch-ai-status" style="margin-bottom:12px">${status}</div>
    ${missing.length ? `<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>🛒 To fill every lunchbox</h2></div>
      <div class="chips" style="margin-bottom:12px">${missing.map((n) => `<span class="pill warn">${esc(n)}</span>`).join('')}</div>
      <button class="btn" data-shop-missing="${esc(JSON.stringify(missing))}">${icon('cart')} Add what's missing to the shopping list</button></div>` : ''}
    ${kids.map((c) => `
      <div class="card" style="margin-bottom:16px">
        <div class="card-head"><h2>🎒 ${esc(c.name)}</h2></div>
        <div class="lunch-grid">${c.days.map((d) => `
          <div class="lunch-day"><div class="dname">${esc(d.day)}</div>${LUNCH_SLOTS.map(([k, e, l]) => slot(d[k], e, l)).join('')}</div>`).join('')}</div>
        <form class="wont-eat-form form-row" data-child="${esc(c.childId)}" style="grid-template-columns:1fr auto;margin-top:12px">
          <label class="field">${esc(c.name)} won't eat<input name="foods" value="${esc((c.wontEat || []).join(', '))}" placeholder="e.g. tuna, tomatoes" ${NOFILL}></label>
          <button class="btn sm" style="align-self:end">Save</button>
        </form>
      </div>`).join('')}
    ${plan.notAtSchool.length ? `<p class="hint">${esc(plan.notAtSchool.join(' and '))} ${plan.notAtSchool.length === 1 ? "isn't" : "aren't"} at school yet, so ${plan.notAtSchool.length === 1 ? 'has' : 'have'} no lunchbox.</p>` : ''}
    <p class="hint">Dinners a child isn't keen on count too: their main ingredients are left out of that child's lunchbox.</p>`;
}

function recipeLinkCard() {
  return `<div class="card">
    <div class="card-head"><h2>🔗 Add from a link</h2></div>
    <form id="recipe-link-form" class="form-row" style="grid-template-columns:1fr auto">
      <input name="url" type="url" inputmode="url" required placeholder="Paste a recipe page's address" aria-label="Recipe page address" ${NOFILL}>
      <button class="btn primary" ${state.recipeLinkBusy ? 'disabled' : ''}>${state.recipeLinkBusy ? 'Reading…' : 'Get recipe'}</button>
    </form>
    ${state.recipePaste ? `<form id="recipe-paste-form" class="stack" style="margin-top:12px">
      <p class="hint">${esc(state.recipePaste)}</p>
      <textarea name="html" rows="7" required placeholder="Ingredients&#10;400g spaghetti&#10;1 onion, chopped&#10;&#10;Method&#10;Boil the pasta…" aria-label="Recipe text"></textarea>
      <button class="btn">${icon('book')} Read the recipe</button>
    </form>` : `<p class="hint" style="margin-top:8px">The recipe is read from the page, and you can check it before saving. <button type="button" class="btn ghost sm" data-recipe-paste>Paste it instead</button></p>`}
  </div>`;
}

async function recipeFromLink(body) {
  state.recipeLinkBusy = true;
  try {
    state.recipeDraft = await api('/food/recipes/from-link', { method: 'POST', body });
    state.recipePaste = null;
  } catch (e) {
    if (/paste the recipe page/i.test(e.message)) {
      state.recipePaste = "Recipe pages can't be opened from here, so paste the recipe instead: on the recipe page, select everything (or just the ingredients and method), copy it and paste it below.";
    } else {
      state.recipePaste = `${e.message}. You can paste the recipe here instead.`;
    }
  } finally {
    state.recipeLinkBusy = false;
  }
  await renderFood();
  if (state.recipeDraft) $('#recipe-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  else $('#recipe-paste-form textarea')?.focus();
}

document.addEventListener('click', guard(async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  const d = t.dataset;
  if (d.pantryFilter) { state.pantryFilter = d.pantryFilter; return renderFood(); }
  if (d.freeze) {
    const freeze = d.state !== 'true';
    await api('/food/items/' + d.freeze, { method: 'PUT', body: { frozen: freeze } });
    toast(freeze ? 'In the freezer' : 'Out of the freezer. Leftovers should be eaten within a day.');
    return renderFood();
  }
  if (d.eatLeftover) {
    const r = await api(`/food/leftovers/${d.eatLeftover}/eat`, { method: 'POST', body: {} });
    toast(r.left ? `${plural(r.left, 'portion')} still left` : 'All gone');
    return renderFood();
  }
  if (t.hasAttribute('data-recipe-paste')) {
    state.recipePaste = 'Copy the recipe from the page (or just its ingredients and method) and paste it here.';
    await renderFood();
    return $('#recipe-paste-form textarea')?.focus();
  }
  if (t.hasAttribute('data-recipe-draft-cancel')) {
    state.recipeDraft = null;
    return renderFood();
  }
}));

document.addEventListener('submit', guard(async (e) => {
  const form = e.target;
  if (!(form.id === 'recipe-link-form' || form.id === 'recipe-paste-form' || form.classList.contains('wont-eat-form'))) return;
  e.preventDefault();
  const body = formData(form);
  if (form.id === 'recipe-link-form') return recipeFromLink({ url: body.url });
  if (form.id === 'recipe-paste-form') return recipeFromLink({ html: body.html });
  const r = await api('/food/lunchbox/wont-eat', { method: 'PUT', body: { childId: form.dataset.child, foods: body.foods } });
  toast(r.foods.length ? `Saved. Leaving out ${r.foods.join(', ')}` : 'Saved');
  return renderFood();
}));

// ---------- clothes ----------
// Today's weather for the family's town, from Open-Meteo (free, no key). Cached for the day.
async function todaysWeather() {
  const loc = state.family.location;
  if (!loc) return null;
  const key = `${loc.lat},${loc.lon},${new Date().toISOString().slice(0, 10)}`;
  if (state.weather && state.weather.key === key) return state.weather;
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`);
    const j = await r.json();
    const max = j.daily.temperature_2m_max[0];
    const min = j.daily.temperature_2m_min[0];
    // Kids are out in the morning, so lean towards the cooler end of the day.
    state.weather = { key, tempC: Math.round((max * 2 + min) / 3), max: Math.round(max), min: Math.round(min), rain: (j.daily.precipitation_probability_max[0] ?? 0) >= 50, place: loc.name };
  } catch {
    state.weather = { key, tempC: null };
  }
  return state.weather;
}

async function renderClothes() {
  const kids = state.family.children;
  if (!kids.length) {
    $('#page').innerHTML = `<div class="card">${emptyState('👕', 'Add a child first, then their clothes.', '<button class="btn primary" data-nav="family">Add a child</button>')}</div>`;
    return;
  }
  const child = kids.find((c) => c.id === state.childId);
  const season = state.season || 'any';
  const weather = await todaysWeather();
  const wq = weather && weather.tempC !== null ? `&tempC=${weather.tempC}&rain=${weather.rain ? 1 : 0}` : '';
  const [items, outfits, stats, targets, ootd, hmd, swaps, cal] = await Promise.all([
    api('/clothes/items?childId=' + child.id),
    api(`/clothes/outfits/${child.id}?season=${season}&limit=60`),
    api('/clothes/stats'),
    api('/clothes/targets'),
    api(`/clothes/outfit-of-the-day/${child.id}?shuffle=${state.ootdIndex}${wq}`),
    api('/clothes/hand-me-downs'),
    api('/clothes/swap').catch(() => []),
    api('/calendar?days=2').catch(() => null),
  ]);
  state.targets = targets;
  const swap = swaps.find((x) => x.childId === child.id);
  // School and club kit today (PE, swimming), shown with the outfit.
  const kitToday = cal ? cal.upcoming.filter((e) => e.date === cal.today && e.kit.length && (!e.who.length || e.who.includes(child.id))) : [];
  const s = stats.find((x) => x.childId === child.id);
  $('#page-sub').textContent = `${plural(items.length, 'item')} for ${child.name} · ${plural(outfits.total, 'outfit')}`;
  const inWash = items.filter((i) => i.inWash).length;
  if (inWash) $('#page-actions').innerHTML = `<button class="btn" data-laundry-done="${esc(child.id)}">🧺 Laundry done (${esc(inWash)})</button>`;

  const sizeIdx = (x) => state.sizes.indexOf(x);
  const fitLabel = (it) => {
    if (it.wornOut) return '<span class="pill bad">Worn out</span>';
    const tags = [];
    if (it.inWash) tags.push('<span class="pill blue">In the wash</span>');
    if (it.uniform) tags.push('<span class="pill plain">Uniform</span>');
    if (it.stored) tags.push('<span class="pill plain">📦 Packed away</span>');
    if (it.type !== 'shoes' && child.clothingSize && sizeIdx(it.size) >= 0) {
      const d = sizeIdx(it.size) - sizeIdx(child.clothingSize);
      if (d < 0) tags.push('<span class="pill bad">Outgrown</span>');
      if (d > 0) tags.push('<span class="pill blue">Grow into</span>');
    }
    return tags.join(' ');
  };
  const wf = state.wardrobeFilter;
  const shownItems = items.filter((it) => wf === 'all' || (wf === 'wash' ? it.inWash : wf === 'uniform' ? it.uniform : wf === 'stored' ? it.stored : it.type === wf));
  const typesPresent = [...new Set(items.map((i) => i.type))];
  const extraFilters = [...(inWash ? [['wash', '🧺 In wash']] : []), ...(items.some((i) => i.uniform) ? [['uniform', '🎒 Uniform']] : []), ...(items.some((i) => i.stored) ? [['stored', '📦 Packed away']] : [])];

  // Outgrown things: pass to a sibling, or sell / give away.
  const passOn = hmd.filter((h) => h.fromChildId === child.id);
  const passIds = new Set(passOn.map((h) => h.itemId));
  const sellable = items.filter((it) => !it.wornOut && it.type !== 'shoes' && child.clothingSize && sizeIdx(it.size) >= 0 &&
    sizeIdx(it.size) < sizeIdx(child.clothingSize) && !passIds.has(it.id));

  const o = ootd.outfit;
  $('#page').innerHTML = `
    <div class="kid-tabs" style="margin-bottom:16px">${kids.map((c, i) =>
      `<button class="kid-tab ${c.id === child.id ? 'active' : ''}" data-kid="${esc(c.id)}">${avatar(c, i)}${esc(c.name)}</button>`).join('')}</div>

    <div class="grid g2">
      <div class="card ootd">
        <div>
          <div class="muted small" style="font-weight:700;text-transform:uppercase;letter-spacing:.06em">${icon('sparkle')} Outfit of the day</div>
          ${weather && weather.tempC !== null
            ? `<div class="small" style="margin-top:6px">${weather.rain ? '🌧️' : weather.tempC < 12 ? '🧣' : weather.tempC >= 20 ? '☀️' : '⛅'} ${weather.min}° to ${weather.max}°${weather.place ? ' in ' + esc(weather.place) : ''}. ${esc(ootd.weather || '')}</div>`
            : state.family.location ? `<div class="small muted" style="margin-top:6px">Couldn't get the weather for ${esc(state.family.location.name)} right now, so this ignores it.</div>`
            : `<div class="small muted" style="margin-top:6px"><button class="btn ghost sm" data-nav="settings" style="padding:0">Add your town</button> for weather-aware outfits.</div>`}
          ${kitToday.length ? `<div class="banner" style="margin-top:10px;background:var(--warn-soft);color:var(--warn)"><span style="font-size:20px">${esc(kitToday[0].emoji)}</span>
            <div class="grow">${esc(kitToday.map((e) => e.title).join(' and '))} today<div class="small" style="font-weight:400">Take: ${esc([...new Set(kitToday.flatMap((e) => e.kit))].join(', '))}</div></div></div>` : ''}
          <div id="ootd-body">${ootdBody(o)}</div>
        </div>
        <span id="ootd-shuffle">${o && ootd.choices > 1 ? `<button class="btn" data-shuffle>${icon('shuffle')} Shuffle</button>` : ''}</span>
      </div>
      ${kidCard(s, kids.indexOf(child))}
    </div>

    ${swap && (swap.due || swap.getOut.length || swap.outgrown.length) ? swapCard(swap) : ''}

    ${passOn.length || sellable.length ? `<div class="card" style="margin-top:16px">
      <div class="card-head"><h2>♻️ Outgrown</h2>${passAllButtons(passOn) || '<span class="muted small">Pass them on, sell or give away</span>'}</div>
      <ul class="list">
        ${passOn.map((h) => `<li class="row"><span class="emoji">${GARMENT[h.type] || '👕'}</span>
          <div class="grow"><div class="title">${esc(h.name)} <span class="pill plain">${esc(h.size)}</span></div><div class="sub">${esc(h.toName)} can ${h.fitsNow ? 'wear it now' : 'grow into it'}</div></div>
          <button class="btn sm primary" data-handdown="${esc(h.itemId)}" data-to="${esc(h.toChildId)}">Pass to ${esc(h.toName)}</button></li>`).join('')}
        ${sellable.map((it) => `<li class="row"><span class="emoji">${GARMENT[it.type] || '👕'}</span>
          <div class="grow"><div class="title">${esc(it.name)} <span class="pill plain">${esc(it.size)}</span></div><div class="sub">No sibling it fits</div></div>
          <button class="btn sm" data-sell="${esc(it.id)}">${icon('copy')} Copy listing</button>
          <button class="icon-btn danger" data-del-item="${esc(it.id)}" aria-label="Gone">${icon('trash')}</button></li>`).join('')}
      </ul></div>` : ''}

    <div class="split" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><h2>Add clothes</h2><button class="btn sm" data-ai-scan="clothes">${icon('camera')} From a photo</button></div>
        <form id="clothes-form" class="stack">
          <label class="field">Item<input name="name" placeholder="e.g. Blue jeans" required></label>
          <div class="form-row" style="grid-template-columns:1fr 1fr">
            <label class="field">Type<select name="type">${options(state.types, 'top')}</select></label>
            <label class="field">Colour<input name="colour" placeholder="e.g. navy" list="colour-names"></label>
          </div>
          <div class="form-row" style="grid-template-columns:1fr 1fr 1fr">
            <label class="field">Size<span id="size-slot"><select name="size">${options(state.sizes, child.clothingSize)}</select></span></label>
            <label class="field">Pattern<select name="pattern"><option value="plain">Plain</option><option value="patterned">Patterned</option></select></label>
            <label class="field">Season<select name="season"><option value="all">All year</option><option value="summer">Summer</option><option value="winter">Winter</option></select></label>
          </div>
          <label class="chip" style="align-self:flex-start"><input type="checkbox" name="uniform" style="width:auto"> School uniform</label>
          <button class="btn primary">${icon('plus')} Add to ${esc(child.name)}'s wardrobe</button>
        </form>
        <datalist id="colour-names">${['black', 'white', 'grey', 'navy', 'denim', 'blue', 'red', 'pink', 'green', 'yellow', 'orange', 'purple', 'brown', 'beige', 'cream', 'khaki', 'teal', 'lilac', 'mustard'].map((c) => `<option value="${c}">`).join('')}</datalist>
      </div>

      <div class="card">
        <div class="card-head"><h2>Wardrobe</h2>
          <div class="chips">${[['all', 'All'], ...typesPresent.map((t) => [t, GARMENT[t] + ' ' + cap(t)]), ...extraFilters].map(([k, l]) => `<button class="chip ${wf === k ? 'active' : ''}" data-wfilter="${esc(k)}">${esc(l)}</button>`).join('')}</div>
        </div>
        ${shownItems.length ? `<ul class="list">${shownItems.map((it) => `
          <li class="row">
            <span class="emoji" style="background:${esc(cssColour(it.colour))}">${GARMENT[it.type] || '👕'}</span>
            <div class="grow"><div class="title">${esc(it.name)} ${fitLabel(it)}</div>
              <div class="sub">${cap(esc(it.type))} · ${esc(it.size || 'no size')}${it.colour ? ' · ' + esc(it.colour) : ''}${it.pattern === 'patterned' ? ' · patterned' : ''}${it.season !== 'all' ? ' · ' + esc(it.season) : ''}</div></div>
            ${it.wornOut ? '' : `<button class="btn ghost sm" data-wash="${esc(it.id)}" data-state="${Boolean(it.inWash)}" title="${it.inWash ? 'Back in the drawer' : 'Put in the wash'}">${it.inWash ? 'Clean' : '🧺 Wash'}</button>`}
            ${it.season !== 'all' || it.stored ? `<button class="btn ghost sm" data-store="${esc(it.id)}" data-state="${Boolean(it.stored)}" title="${it.stored ? 'Get it out again' : 'Pack it away until its season'}">${it.stored ? 'Unpack' : '📦'}</button>` : ''}
            <button class="btn ghost sm" data-worn="${esc(it.id)}" data-state="${it.wornOut}">${it.wornOut ? 'Mark OK' : 'Worn out'}</button>
            <button class="icon-btn danger" data-del-item="${esc(it.id)}" aria-label="Remove ${esc(it.name)}">${icon('trash')}</button>
          </li>`).join('')}</ul>` : emptyState('🧺', 'No clothes here yet.')}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-head"><h2>All outfit ideas</h2>
        <div class="seg">${['any', 'summer', 'winter'].map((x) => `<button data-season="${x}" class="${season === x ? 'active' : ''}">${x === 'any' ? 'Any season' : cap(x)}</button>`).join('')}</div>
      </div>
      ${outfits.outfits.length ? `<ul class="list">${outfits.outfits.map((o) => {
        const tone = o.score >= 85 ? 'var(--accent-soft);color:var(--accent)' : o.score >= 70 ? 'var(--warn-soft);color:var(--warn)' : 'var(--bad-soft);color:var(--bad)';
        return `<li class="row">
          <span class="score" style="background:${tone}">${o.score}</span>
          <div class="grow"><div class="outfit-line">${o.items.map((i) => `<span>${swatch(i.colour)}${esc(i.name)}</span>`).join('')}</div>
            ${o.notes.length ? `<div class="sub">${o.notes.map(esc).join('; ')}</div>` : ''}</div>
        </li>`;
      }).join('')}${outfits.total > outfits.outfits.length ? `<li class="row muted">…and ${outfits.total - outfits.outfits.length} more</li>` : ''}</ul>`
        : emptyState('👗', 'No outfits yet for this season.')}
    </div>`;
  state.sellable = sellable;
  if ((state.ai = await api('/ai/settings')).suggestions && o) aiOutfit(child.id, weather);
}

// Spring and autumn: pack away last season's clothes and get the new season's out.
function swapCard(sw) {
  const away = sw.season === 'summer' ? 'winter' : 'summer';
  const names = (l) => l.slice(0, 6).map((i) => esc(i.name)).join(', ') + (l.length > 6 ? ` and ${l.length - 6} more` : '');
  return `<div class="card" id="swap-card" style="margin-top:16px">
    <div class="card-head"><h2>${sw.season === 'summer' ? '☀️' : '❄️'} Time for ${esc(sw.season)} clothes</h2>
      <button class="btn sm primary" data-swap="${esc(sw.childId)}">Do the swap</button></div>
    <ul class="list">
      ${sw.packAway.length ? `<li class="row"><span class="emoji">📦</span><div class="grow"><div class="title">Pack away ${plural(sw.packAway.length, `${away} thing`)}</div><div class="sub">${names(sw.packAway)}</div></div></li>` : ''}
      ${sw.getOut.length ? `<li class="row"><span class="emoji">👕</span><div class="grow"><div class="title">Get out ${plural(sw.getOut.length, `${sw.season} thing`)} that still fit</div><div class="sub">${names(sw.getOut)}</div></div></li>` : ''}
      ${sw.outgrown.length ? `<li class="row"><span class="emoji">♻️</span><div class="grow"><div class="title">${plural(sw.outgrown.length, 'packed-away thing')} now too small</div><div class="sub">${names(sw.outgrown)}. They'll show under Outgrown to pass on.</div></div></li>` : ''}
    </ul>
    ${sw.short ? `<p class="hint" style="margin-top:8px">${esc(sw.name)} doesn't have many ${esc(sw.season)} clothes that fit. Check the shopping suggestions.</p>` : ''}
    <p class="hint" style="margin-top:8px">Packed-away clothes stay in the wardrobe list but are left out of outfits.</p>
  </div>`;
}

function listingText(it) {
  const age = String(it.size || '').replace(/Y$/, ' years').replace(/M$/, ' months');
  return `${it.name} – age ${age}\n\nChildren's ${it.type} in size ${it.size}${it.colour ? `, ${it.colour}` : ''}${it.pattern === 'patterned' ? ', patterned' : ''}. ` +
    'Outgrown and ready for a new home. Happy to bundle with other items.';
}

// ---------- shopping ----------
async function renderShopping() {
  const [data, spend, month] = await Promise.all([api('/shopping'), api('/spending'), api('/money').catch(() => null)]);
  const children = state.family.children;
  state.shoppingCount = data.items.filter((i) => !i.done).length;
  $('#page-sub').textContent = `${plural(state.shoppingCount, 'thing')} to buy · tick "Bought" and it goes straight into the cupboard or wardrobe`;
  $('#page-actions').innerHTML = (data.items.some((i) => !i.done) ? `<button class="btn" data-copy-list>${icon('copy')} Copy</button>${navigator.share ? `<button class="btn" data-share-list>${icon('share')} Share</button>` : ''}` : '') +
    (data.items.some((i) => i.done) ? `<button class="btn primary" data-bought-ticked>${icon('bag')} Bought all ticked</button><button class="btn" data-clear-done>${icon('trash')} Clear ticked</button>` : '');
  state.usuals = data.usuals || [];
  state.people = data.people || {};
  const me = ACCOUNT?.status().email;
  const byOther = (it) => it.addedBy && it.addedBy !== me;
  const childName = (id) => children.find((c) => c.id === id)?.name;
  const groups = { food: [], clothes: [], other: [] };
  for (const it of data.items) groups[it.kind || 'other'].push(it);
  const label = { food: '🥕 Food', clothes: '👕 Clothes', other: '🛒 Other' };

  const row = (it) => `
    <li class="row ${it.done ? 'done' : ''}">
      <button class="check ${it.done ? 'on' : ''}" data-toggle="${esc(it.id)}" data-state="${it.done}" aria-label="Tick ${esc(it.name)}">${icon('check')}</button>
      <div class="grow"><div class="title">${it.quantity ? esc(it.quantity) + ' × ' : ''}${esc(cap(it.name))}${it.size ? ` <span class="pill plain">${esc(it.size)}</span>` : ''}</div>
        ${it.childId || it.note || byOther(it) ? `<div class="sub">${[it.childId && 'For ' + esc(childName(it.childId) || 'child'), it.note && esc(it.note), byOther(it) && `Added by ${esc(personName(it.addedBy, data.people))}`].filter(Boolean).join(' · ')}</div>` : ''}
        ${it.kind === 'food' && !it.done ? `<div class="sub shops">${SHOPS.map(([n, url]) => `<a href="${esc(url(it.name))}" target="_blank" rel="noopener">${esc(n)}</a>`).join(' · ')}</div>` : ''}</div>
      ${it.kind !== 'other' ? `<button class="btn sm" data-bought="${esc(it.id)}">${icon('bag')} Bought</button>` : ''}
      <button class="icon-btn danger" data-del-shop="${esc(it.id)}" aria-label="Remove ${esc(it.name)}">${icon('x')}</button>
    </li>`;

  $('#page').innerHTML = `
    <div class="split">
      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>Add to the list</h2></div>
          <form id="shop-form" class="stack">
            <label class="field">Item<input name="name" placeholder="e.g. Bananas" required></label>
            <div class="form-row" style="grid-template-columns:1fr 1fr">
              <label class="field">Kind<select name="kind"><option value="food">Food</option><option value="clothes">Clothes</option><option value="other">Other</option></select></label>
              <label class="field">How many<input name="quantity" type="number" min="0" step="any"></label>
            </div>
            <label class="field">For (clothes only)<select name="childId"><option value="">—</option>${children.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label>
            <button class="btn primary">${icon('plus')} Add</button>
          </form>
          ${quickAdd(data)}
        </div>
        ${suggestionsCard(data.suggestions)}
      </div>
      <div class="card" id="shop-list">
        <div class="card-head"><h2>Your list</h2></div>
        ${data.items.length ? Object.entries(groups).filter(([, v]) => v.length).map(([k, v]) =>
          `<div class="group-title">${label[k]}</div><ul class="list">${v.map(row).join('')}</ul>`).join('')
          : emptyState('🛒', 'Your list is empty. Add things, or use the suggestions.')}
      </div>
    </div>
    <div style="margin-top:16px">${spendingCard(spend, month)}</div>`;
  state.suggestions = data.suggestions;
  if ((state.ai = await api('/ai/settings')).suggestions) aiShopping();
}

// The name someone goes by on the shared list: the one they chose, or their email's first part.
function personName(email, people = state.people || {}) {
  if (people[email]) return people[email];
  const first = String(email).split('@')[0].split(/[._+-]/)[0].replace(/\d+$/, '');
  return cap(first || email);
}

const SPEND_CATS = [['food', '🛒', 'Food'], ['clothes', '👕', 'Clothes'], ['household', '🧽', 'Household'], ['activities', '⚽', 'Clubs and days out'], ['other', '💷', 'Other']];
function spendingCard(sp, m) {
  const vs = sp.lastMonth ? ` <span class="muted small">(last month ${moneyP(sp.lastMonth)})</span>` : '';
  const cat = (k) => SPEND_CATS.find((c) => c[0] === (k || 'food')) || SPEND_CATS[0];
  const pct = m && m.budget ? Math.min(100, Math.round((m.spent / m.budget) * 100)) : 0;
  const tone = m && (m.status === 'over' || m.status === 'heading-over') ? 'short' : '';
  const maxMonth = m ? Math.max(1, ...m.history.map((h) => h.total)) : 1;
  return `<div class="card" id="spending-card">
    <div class="card-head"><h2>💷 Spending</h2><button class="btn ghost sm" data-money-budget>${m && m.budget ? `Budget ${moneyP(m.budget)}` : 'Set a monthly budget'}</button></div>
    ${m && m.spent ? `<div id="money-month" style="margin-top:4px">
        <p><strong style="font-size:1.4rem">${moneyP(m.spent)}</strong> this month${m.budget ? ` of ${moneyP(m.budget)}` : ''}${m.lastMonth ? ` <span class="muted small">(last month ${moneyP(m.lastMonth)})</span>` : ''}</p>
        ${m.budget ? `<div class="bar ${tone}" style="margin-top:8px"><span style="width:${pct}%"></span></div>
          <p class="hint" style="margin-top:6px">${m.status === 'over' ? `Over budget by ${moneyP(-m.left)}.` : m.status === 'heading-over' ? `${moneyP(m.left)} left, but at this rate the month ends near ${moneyP(m.projected)}.` : `${moneyP(m.left)} left${m.isCurrent && m.projected > m.spent ? `, heading for about ${moneyP(m.projected)}` : ''}.`}</p>` : ''}
        <div class="chips" style="margin-top:10px">${m.categories.filter((c) => c.total).map((c) => `<span class="pill plain">${esc(c.emoji)} ${esc(c.label)} ${moneyP(c.total)}</span>`).join('')}${m.pocketMoney ? `<span class="pill plain">⭐ Pocket money ${moneyP(m.pocketMoney)}</span>` : ''}</div>
        <div class="money-history" style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px;align-items:end;height:64px;margin-top:12px">${m.history.map((h) => `<div title="${esc(h.month)}: ${moneyP(h.total)}" style="display:flex;flex-direction:column;align-items:center;gap:2px;height:100%;justify-content:flex-end">
          <span style="width:100%;border-radius:4px;background:${h.month === m.month ? 'var(--accent)' : 'var(--line)'};height:${Math.max(3, Math.round((h.total / maxMonth) * 44))}px"></span>
          <span class="small muted">${esc(new Date(h.month + '-01T12:00:00Z').toLocaleDateString(undefined, { month: 'short' }))}</span></div>`).join('')}</div>
        ${m.clothesAhead ? `<p class="hint" style="margin-top:8px">Coming up: about ${moneyP(m.clothesAhead)} of clothes the children need now.</p>` : ''}
      </div>` : ''}
    ${sp.entries.some((e) => !e.category) ? `<p style="margin-top:10px" class="small">Food: <strong>${moneyP(sp.thisMonth)}</strong> this month${vs}</p>
      <p class="hint" style="margin-top:4px">${[sp.perWeek != null && `About ${moneyP(sp.perWeek)} a week`, sp.perDinner != null && `roughly ${moneyP(sp.perDinner)} per dinner cooked (${sp.dinnersCooked} this month)`].filter(Boolean).join(', ') || 'Add a few shops to see a weekly average.'}</p>`
      : sp.entries.length ? '' : '<p class="hint">Add the total from each receipt to see what you spend each week and month, and what each dinner costs.</p>'}
    <form id="spend-form" class="form-row" style="grid-template-columns:1fr 1fr;margin-top:12px">
      <input name="amount" inputmode="decimal" placeholder="£ total" aria-label="Amount" required>
      <select name="category" aria-label="What for">${SPEND_CATS.map(([k, e, l]) => `<option value="${esc(k)}">${esc(e)} ${esc(l)}</option>`).join('')}</select>
      <input name="shop" placeholder="Shop" aria-label="Shop (optional)">
      <button class="btn">${icon('plus')} Add</button>
    </form>
    ${sp.entries.length ? `<ul class="list" style="margin-top:8px">${sp.entries.slice(0, 6).map((e) => `<li class="row">
      <span class="emoji">${esc(cat(e.category)[1])}</span>
      <div class="grow"><div class="title">${moneyP(e.amount)}${e.shop ? ` · ${esc(e.shop)}` : ''}</div><div class="sub">${esc(fmtDate(e.date))} · ${esc(cat(e.category)[2])}${e.addedBy && e.addedBy !== ACCOUNT?.status().email ? ` · ${esc(personName(e.addedBy))}` : ''}</div></div>
      <button class="icon-btn danger" data-del-spend="${esc(e.id)}" aria-label="Remove ${moneyP(e.amount)}">${icon('x')}</button></li>`).join('')}</ul>` : ''}
  </div>`;
}
const moneyP = (n) => '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Shop for the week: shows what's needed, then adds it all.
async function weekShop() {
  const r = await api('/food/week-shop', { method: 'POST', body: { week: state.week || [] } });
  if (!r.list.length) return toast('Nothing to buy: everything for the week is in.');
  const day = (d) => d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : new Date(Date.now() + d * 86400000).toLocaleDateString(undefined, { weekday: 'short' });
  const ok = await ask({
    title: 'Shop for the week',
    body: `<ul class="list small">${r.days.map((m, d) => m ? `<li class="row"><div class="grow"><strong>${day(d)}</strong> ${esc(m.name)}${m.buy.length ? ` <span class="muted">· buy ${esc(m.buy.join(', '))}</span>` : ''}</div></li>` : '').join('')}</ul>
      <p class="muted" style="margin-top:10px">Adds ${plural(r.list.length, 'thing')} to the shopping list (anything already on it is skipped):</p>
      <p class="small" style="margin-top:6px">${r.list.map((i) => esc(cap(i.name)) + (i.quantity ? ` <span class="muted">${esc(i.quantity)}${i.unit && i.unit !== 'pcs' ? ' ' + esc(i.unit) : ''}</span>` : '')).join(', ')}</p>`,
    ok: `Add ${r.list.length} to the list`,
  });
  if (!ok) return;
  const done = await api('/shopping/items/bulk', { method: 'POST', body: { items: r.list.map(({ name, quantity, unit }) => ({ kind: 'food', name, quantity, unit, note: 'For the week' })) } });
  toast(`Added ${plural(done.added, 'thing')} for the week${done.skipped ? ` (${done.skipped} already on the list)` : ''}`);
  refresh();
}

// One tap for the things you always buy, and the whole of your last shop again.
function quickAdd({ usuals = [], lastShop = null }) {
  if (!usuals.length && !lastShop) return '';
  return `<div id="quick-add" style="margin-top:14px">
    ${usuals.length ? `<div class="group-title" style="margin-top:0">Your usuals</div>
      <div class="chips">${usuals.map((u, i) => `<button class="chip" data-usual="${i}" title="Bought ${u.times} times lately">${icon('plus')} ${esc(cap(u.name))}${u.quantity ? ` <span class="muted">${esc(String(u.quantity))}${u.unit && u.unit !== 'pcs' ? ' ' + esc(u.unit) : ''}</span>` : ''}</button>`).join('')}</div>` : ''}
    ${lastShop ? `<p style="margin-top:12px">${lastShop.missing
      ? `<button class="btn" data-repeat-shop>🔁 Same as last shop</button> <span class="hint">${plural(lastShop.missing, 'thing')} from ${esc(fmtDate(lastShop.date))}</span>`
      : `<span class="hint">Everything from your last shop (${esc(fmtDate(lastShop.date))}) is on the list.</span>`}</p>` : ''}
  </div>`;
}

function suggestionsCard(list, ai = null) {
  const fromAi = ai && !ai.error;
  return `<div class="card" id="suggest-card">
    <div class="card-head"><h2>💡 Suggestions</h2>${aiByline(ai)}
      ${list.length ? `<button class="btn sm" data-add-all>Add all</button>` : ''}</div>
    <p class="hint">${fromAi
      ? `From ${esc(ai.by)}, looking at what you cook and buy, what's run out and what the kids need. <button class="btn ghost sm" data-ai-refresh="shopping">Ask again</button>`
      : 'From what runs out, what you buy regularly, the meals you cook most and your favourites. The more you add to the cupboard and tap "Cooked it", the better these get.'}</p>
    ${aiNote(ai, 'suggestions')}
    <div id="suggest-ai-status"></div>
    ${list.length ? `<ul class="list">${list.map((s, i) => `
      <li class="row">
        <span class="emoji">${s.kind === 'food' ? foodCat(s.name).emoji : GARMENT[s.type] || '👕'}</span>
        <div class="grow"><div class="title">${s.quantity ? esc(s.quantity) + ' × ' : ''}${esc(cap(s.name))}${s.size ? ` <span class="pill plain">${esc(s.size)}</span>` : ''}</div>
          <div class="sub">${s.source === 'ai' && s.childName ? `For ${esc(s.childName)} · ` : ''}${esc(s.reason)}</div></div>
        <button class="btn sm" data-suggest="${i}">${icon('plus')} Add</button>
        <button class="icon-btn" data-snooze="${i}" aria-label="Not now: ${esc(s.name)}" title="Not now">${icon('x')}</button>
      </li>`).join('')}</ul>` : emptyState('💡', 'Nothing to suggest right now.')}
  </div>`;
}

async function aiShopping(refresh = false) {
  const status = $('#suggest-ai-status');
  if (status) status.innerHTML = '<p class="hint">✨ Asking the AI what you might need…</p>';
  const r = await aiSuggest('shopping', {}, { refresh });
  if (!r || !$('#suggest-card')) return;
  if (r.error) return void ($('#suggest-ai-status').innerHTML = aiNote(r, 'suggestions'));
  state.suggestions = r.suggestions;
  $('#suggest-card').outerHTML = suggestionsCard(r.suggestions, r);
}

function ootdBody(o, ai = null) {
  return o ? `<div class="ootd-items">${o.items.map((i) => `
      <div class="garment"><div class="tile" style="background:${esc(cssColour(i.colour))}">${GARMENT[i.type] || '👕'}</div>${esc(i.name)}</div>`).join('')}</div>
      ${o.notes.length ? `<p class="small ${ai ? '' : 'muted'}" style="margin-top:8px${ai ? ';color:var(--accent);font-weight:600' : ''}">${ai ? '✨ ' : ''}${o.notes.map(esc).join('; ')}</p>` : ''}
      ${ai ? `<p class="hint" style="margin-top:4px">Picked by ${esc(ai.by)}</p>` : ''}`
    : '<p style="margin-top:12px">Add at least a top and a bottom (or a dress) that fit and are clean to get an outfit.</p>';
}

// The AI's outfits for today, cycling with Shuffle. The rules' outfit stays if it can't help.
async function aiOutfit(childId, weather) {
  const params = { childId };
  if (weather && weather.tempC !== null) Object.assign(params, { tempC: weather.tempC, rain: Boolean(weather.rain) });
  const r = await aiSuggest('outfits', params);
  if (!r || r.error || !r.outfits.length || state.childId !== childId || !$('#ootd-body')) return;
  const o = r.outfits[state.ootdIndex % r.outfits.length];
  $('#ootd-body').innerHTML = ootdBody(o, r);
  $('#ootd-shuffle').innerHTML = r.outfits.length > 1 ? `<button class="btn" data-shuffle>${icon('shuffle')} Shuffle</button>` : '';
}

// ---------- chores ----------
const EVERY = [[1, 'Every day'], [2, 'Every 2 days'], [3, 'Every 3 days'], [7, 'Every week'], [14, 'Every 2 weeks'], [30, 'Every month']];
const everyText = (n) => EVERY.find(([d]) => d === n)?.[1] || `Every ${n} days`;
const EFFORT = { 1: 'Quick', 2: 'Medium', 3: 'Big job' };
const dayName = (date, today) => {
  const d = Math.round((new Date(date) - new Date(today)) / 86400000);
  return d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : new Date(date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long' });
};

// The week's plans on Home: school and club days with their kit, birthdays, trips.
function calendarHomeCard(c, trips = []) {
  if (!c || (!c.week.length && !trips.length)) return '';
  const soonTrips = trips.filter((t) => t.start <= isoDay(Date.now() + 14 * 86400000));
  return `<div class="card" style="margin-top:16px" id="calendar-home" data-tool="calendar">
    <div class="card-head"><h2>📅 This week</h2><button class="btn sm" data-nav="calendar">Calendar</button></div>
    <ul class="list">${c.week.slice(0, 6).map((o) => `<li class="row"><span class="emoji">${esc(o.emoji)}</span>
      <div class="grow"><div class="title">${esc(o.title)}${o.time ? ` <span class="pill plain">${esc(o.time)}</span>` : ''}</div>
      <div class="sub">${esc(dayLabel(o.date, c.today))}${o.whoNames.length ? ` · ${esc(o.whoNames.join(', '))}` : ''}${o.kit.length ? ` · take ${esc(o.kit.join(', '))}` : ''}</div></div></li>`).join('')}
      ${soonTrips.map((t) => `<li class="row"><span class="emoji">🧳</span><div class="grow"><div class="title">${esc(t.name)}</div>
        <div class="sub">${esc(dayLabel(t.start, c.today))} · ${esc(t.packed)}/${esc(t.items)} packed</div></div>
        <button class="btn sm" data-nav="calendar" data-cal-trips>Packing list</button></li>`).join('')}</ul>
    ${c.week.length > 6 ? `<p class="hint" style="margin-top:8px">and ${c.week.length - 6} more this week</p>` : ''}
  </div>`;
}

function choresHomeCard(c) {
  if (!c || (!c.todayList.length && !c.doneToday)) return '';
  return `<div class="card" style="margin-top:16px" id="chores-home" data-tool="chores">
    <div class="card-head"><h2>🧹 Today's chores</h2><button class="btn sm" data-nav="chores">All chores</button></div>
    ${c.todayList.length ? `<ul class="list">${c.todayList.slice(0, 6).map((it) => choreRow(it)).join('')}</ul>${c.todayList.length > 6 ? `<p class="hint">+${c.todayList.length - 6} more on the Chores page</p>` : ''}`
      : `<p class="hint">All done for today. ${c.doneToday} chore${c.doneToday === 1 ? '' : 's'} ticked off.</p>`}
  </div>`;
}

function choreRow(it) {
  return `<li class="row">
    <span class="emoji">${esc(it.emoji || '🧹')}</span>
    <div class="grow"><div class="title">${esc(it.name)}${it.overdue ? ' <span class="pill bad">Overdue</span>' : ''}</div>
      <div class="sub">${it.whoName ? `<button class="btn ghost sm" style="padding:0" data-chore-by="${esc(it.choreId)}" title="Someone else did it?">${esc(it.whoName)}</button>` : 'Anyone'} · ${EFFORT[it.effort] || 'Quick'}</div></div>
    <button class="btn sm primary" data-chore-done="${esc(it.choreId)}" data-by="${esc(it.who)}">${icon('check')} Done</button>
    <button class="icon-btn" data-chore-skip="${esc(it.choreId)}" aria-label="Not today: ${esc(it.name)}" title="Not today">${icon('clock')}</button>
  </li>`;
}

function rotaStrip(rota, today) {
  return rota.slice(1).map((d) => `<div class="rota-day"><div class="group-title" style="margin-top:12px">${dayName(d.date, today)}</div>
    ${d.items.length ? d.items.map((it) => `<div class="small" style="margin-top:4px">${esc(it.emoji)} ${esc(it.name)}${it.whoName ? ` · <strong>${esc(it.whoName)}</strong>` : ''}</div>`).join('') : '<p class="hint">Nothing due</p>'}</div>`).join('');
}

function choreIdeas(list, ai = null) {
  return `<div class="card" id="chore-ideas" style="margin-top:16px">
    <div class="card-head"><h2>💡 Ideas</h2>${aiByline(ai)}</div>
    <p class="hint">${ai && !ai.error ? `From ${esc(ai.by)}, looking at your chores, who's done what and the children's ages.` : "From the children's ages and how often you really do each chore."}</p>
    ${aiNote(ai, 'ideas')}
    ${list.length ? `<ul class="list">${list.map((x, i) => `<li class="row">
      <span class="emoji">${esc(x.emoji || (x.kind === 'every' ? '🔁' : '✨'))}</span>
      <div class="grow"><div class="title">${x.kind === 'every' ? `${esc(x.name)}: ${esc(everyText(x.every).toLowerCase())}` : esc(x.name)}</div><div class="sub">${esc(x.reason)}</div></div>
      <button class="btn sm" data-chore-idea="${i}">${x.kind === 'every' ? 'Change' : `${icon('plus')} Add`}</button>
      <button class="icon-btn" data-chore-idea-no="${i}" aria-label="Not now" title="Not now">${icon('x')}</button></li>`).join('')}</ul>` : emptyState('💡', 'No ideas right now.')}
  </div>`;
}

async function renderChores() {
  const v = await api('/chores');
  state.chores = v;
  state.choreIdeas = v.suggestions;
  const s = v.stats;
  if (state.family.children.length) $('#page-actions').innerHTML = `<button class="btn" data-nav="kids">${icon('people')} Kids' view</button>`;
  $('#page-sub').textContent = s.dueToday ? `${plural(s.dueToday, 'chore')} to do today${s.overdue ? `, ${s.overdue} overdue` : ''}` : v.chores.length ? 'All done for today' : 'Share the housework out fairly';
  const today = v.rota[0];
  const doneToday = v.recent.filter((e) => e.at.slice(0, 10) === v.today);
  const nameOf = (id) => v.people.find((p) => p.id === id)?.name || 'Someone';
  const kidsMoney = v.totals.some((t) => t.money);
  $('#page').innerHTML = `
    <div class="split">
      <div class="stack">
        <div class="card" id="chores-today">
          <div class="card-head"><h2>Today</h2><span id="chores-by">${state.ai?.suggestions ? '' : '<span class="muted small">Shared out fairly by age and effort</span>'}</span></div>
          ${today.items.length ? `<ul class="list">${today.items.map(choreRow).join('')}</ul>` : v.chores.length ? emptyState('🎉', 'Nothing left to do today.') : emptyState('🧹', 'No chores yet. Add some below, or pick from the common ones.')}
          ${doneToday.length ? `<div class="group-title">Done today</div><ul class="list">${doneToday.map((e) => `<li class="row done"><span class="emoji">✅</span><div class="grow"><div class="title">${esc(e.name)}</div><div class="sub">${esc(nameOf(e.by))}</div></div><button class="btn ghost sm" data-chore-undo="${esc(e.id)}">Undo</button></li>`).join('')}</ul>` : ''}
        </div>
        <div class="card" id="chores-week">
          <div class="card-head"><h2>The week ahead</h2></div>
          <div id="rota-body">${v.chores.length ? rotaStrip(v.rota, v.today) : '<p class="hint">Add chores to see who does what each day.</p>'}</div>
        </div>
        ${choreIdeas(v.suggestions)}
      </div>
      <div class="stack">
        <div class="card" id="chores-points">
          <div class="card-head"><h2>⭐ This week</h2></div>
          <p class="hint">Points for each chore done: 1 quick, 2 medium, 3 for a big job.</p>
          <ul class="list">${v.totals.map((t) => `<li class="row"><div class="grow"><div class="title">${esc(t.name)}${t.adult ? ` <button class="btn ghost sm" data-chore-rename="${esc(t.id)}" style="padding:0 4px">${icon('edit')}</button>` : ''}</div><div class="sub">${plural(t.done, 'chore')} done</div></div>
            <strong>${plural(t.points, 'point')}</strong>${t.money != null ? ` <span class="pill">${moneyP(t.money)}</span>` : ''}</li>`).join('')}</ul>
          <form id="pocket-form" class="form-row" style="grid-template-columns:1fr auto;margin-top:10px">
            <label class="field">Pocket money per point (pence)<input name="perPoint" type="number" min="0" max="500" step="1" value="${esc(v.perPoint || '')}" placeholder="e.g. 20"></label>
            <button class="btn" style="align-self:end">Save</button>
          </form>
          ${!kidsMoney && !v.perPoint ? '<p class="hint" style="margin-top:6px">Leave empty for points only.</p>' : ''}
        </div>
        <div class="card">
          <div class="card-head"><h2>Add a chore</h2></div>
          ${v.starters.length ? `<div class="chips">${v.starters.slice(0, 14).map((st) => `<button class="chip" data-chore-starter="${st.key}">${esc(st.emoji)} ${esc(st.name)}</button>`).join('')}</div>` : ''}
          <form id="chore-form" class="stack" style="margin-top:12px">
            <label class="field">Chore<input name="name" placeholder="e.g. Clean the hamster cage" required></label>
            <div class="form-row" style="grid-template-columns:1fr 1fr">
              <label class="field">How often<select name="every">${EVERY.map(([d, l]) => `<option value="${d}" ${d === 7 ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
              <label class="field">Size<select name="effort"><option value="1">Quick</option><option value="2">Medium</option><option value="3">Big job</option></select></label>
            </div>
            <div class="form-row" style="grid-template-columns:1fr 1fr">
              <label class="field">Who<select name="who"><option value="">Share it out</option>${v.people.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>
              <label class="field">Youngest age<input name="minAge" type="number" min="0" max="18" value="0"></label>
            </div>
            <button class="btn primary">${icon('plus')} Add chore</button>
          </form>
        </div>
        ${v.chores.length ? `<div class="card" id="chores-all">
          <div class="card-head"><h2>All chores</h2><span class="muted small">${plural(v.chores.length, 'chore')}</span></div>
          <ul class="list">${v.chores.map((c) => `<li class="row ${c.paused ? 'done' : ''}">
            <span class="emoji">${esc(c.emoji || '🧹')}</span>
            <div class="grow"><div class="title">${esc(c.name)}${c.state === 'overdue' && !c.paused ? ' <span class="pill bad">Overdue</span>' : ''}</div>
              <div class="sub">${esc(everyText(c.every))} · ${c.whoName ? esc(c.whoName) : 'shared out'}${c.minAge ? ` · ${esc(c.minAge)}+` : ''} · ${c.paused ? 'paused' : `next ${esc(dayName(c.due < v.today ? v.today : c.due, v.today).toLowerCase())}`}</div></div>
            <button class="icon-btn" data-chore-edit="${esc(c.id)}" aria-label="Change ${esc(c.name)}">${icon('edit')}</button>
            <button class="icon-btn danger" data-chore-del="${esc(c.id)}" aria-label="Remove ${esc(c.name)}">${icon('trash')}</button></li>`).join('')}</ul>
        </div>` : ''}
      </div>
    </div>`;
  if ((state.ai = await api('/ai/settings')).suggestions && v.chores.length) aiChores();
}

// With an AI on: it decides who does what this week (the days stay the rules'), and adds ideas.
async function aiChores(refresh = false) {
  const by = $('#chores-by');
  if (by) by.innerHTML = '<span class="muted small">✨ Asking the AI to share out the chores…</span>';
  const r = await aiSuggest('chores', {}, { refresh });
  if (!r || !$('#chores-today')) return;
  if (r.error) {
    $('#chores-by').innerHTML = '<span class="muted small">Shared out fairly by age and effort</span>';
    $('#chore-ideas').outerHTML = choreIdeas(state.chores.suggestions, r);
    return;
  }
  state.chores.rota = r.rota;
  state.choreIdeas = r.suggestions;
  const today = r.rota[0];
  const list = $('#chores-today .list');
  if (list && today.items.length) list.innerHTML = today.items.map(choreRow).join('');
  $('#rota-body').innerHTML = rotaStrip(r.rota, state.chores.today);
  $('#chores-by').innerHTML = `${aiByline(r)} <button class="btn ghost sm" data-ai-refresh="chores">Ask again</button>`;
  $('#chore-ideas').outerHTML = choreIdeas(r.suggestions, r);
}

async function choreDone(id, by) {
  const v = state.chores || (await api('/chores'));
  if (!by) {
    const got = await ask({ title: 'Who did it?', body: v.people.map((p, i) => `<label class="field" style="margin-top:8px"><span><input type="radio" name="by" value="${esc(p.id)}" ${i === 0 ? 'checked' : ''} style="width:auto"> ${esc(p.name)}</span></label>`).join(''), ok: 'Done' });
    if (!got) return;
    by = got.by;
  }
  const r = await api(`/chores/${id}/done`, { method: 'POST', body: { by } });
  toast(`Well done${r.entry.by ? ', ' + (v.people.find((p) => p.id === r.entry.by)?.name || '') : ''}! ${r.entry.effort === 1 ? '1 point' : r.entry.effort + ' points'}`);
  refresh();
}

async function choreEdit(id) {
  const c = state.chores.chores.find((x) => x.id === id);
  const ps = state.chores.people;
  const everyOpts = [...EVERY, ...(EVERY.some(([d]) => d === c.every) ? [] : [[c.every, everyText(c.every)]])];
  const got = await ask({
    title: 'Change chore',
    body: field('name', 'Chore', 'text', c.name) +
      `<label class="field" style="margin-top:10px">How often<select name="every">${everyOpts.map(([d, l]) => `<option value="${esc(d)}" ${d === c.every ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label class="field" style="margin-top:10px">Size<select name="effort">${[1, 2, 3].map((n) => `<option value="${n}" ${n === c.effort ? 'selected' : ''}>${EFFORT[n]}</option>`).join('')}</select></label>
      <label class="field" style="margin-top:10px">Who<select name="who"><option value="">Share it out</option>${ps.map((p) => `<option value="${esc(p.id)}" ${p.id === c.who ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` +
      field('minAge', 'Youngest age', 'number', String(c.minAge || 0), 'min="0" max="18"') +
      `<label class="field" style="margin-top:10px"><span><input type="checkbox" name="paused" ${c.paused ? 'checked' : ''} style="width:auto"> Pause this chore</span></label>`,
    ok: 'Save',
  });
  if (!got) return;
  await api('/chores/' + id, { method: 'PUT', body: { name: got.name, every: Number(got.every), effort: Number(got.effort), who: got.who || null, minAge: Number(got.minAge || 0), paused: Boolean(got.paused) } });
  toast('Saved');
  refresh();
}

// ---------- family ----------
async function renderFamily() {
  const f = state.family;
  state.targets = await api('/clothes/targets');
  $('#page-sub').textContent = 'Everything else adjusts to these settings.';
  $('#page').innerHTML = `
    <div class="grid g2">
      <div class="card">
        <div class="card-head"><h2>Household</h2></div>
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
          <span style="font-weight:600">Adults</span>
          <div class="stepper"><button data-adults="-1" aria-label="One fewer adult">−</button><input id="adults" type="number" min="0" max="20" value="${esc(f.adults)}" aria-label="Adults"><button data-adults="1" aria-label="One more adult">+</button></div>
        </div>
        <div class="grid g2" style="margin-top:18px">
          <div class="forecast"><div class="k">People</div><div class="v" style="font-size:24px">${esc(f.people)}</div></div>
          <div class="forecast"><div class="k">Portions per meal</div><div class="v" style="font-size:24px">${esc(f.portions)}</div></div>
        </div>
        <p class="hint" style="margin-top:12px">Adults and over-11s eat a full portion, 4 to 10 year olds three quarters, under-4s a half, and babies none.</p>
      </div>
      <div class="card">
        <div class="card-head"><h2>Add a child</h2></div>
        <form id="child-form" class="stack">
          <label class="field">Name<input name="name" required></label>
          <label class="field">Birthday<input name="birthDate" type="date" required></label>
          <div class="form-row" style="grid-template-columns:1fr 1fr">
            <label class="field">Clothing size<select name="clothingSize"><option value="">Not sure</option>${options(state.sizes)}</select></label>
            <label class="field">Shoe size (UK)<input name="shoeSize" placeholder="e.g. 11 or 2 adult"></label>
          </div>
          <button class="btn primary">${icon('plus')} Add child</button>
        </form>
      </div>
    </div>

    <div class="card-head" style="margin:26px 0 12px"><h2>Children</h2></div>
    ${f.children.length ? `<div class="grid g2">${f.children.map((c, i) => `
      <form class="card child-edit stack" data-child="${esc(c.id)}">
        <div class="kid-head">${avatar(c, i)}<div style="flex:1"><h3>${esc(c.name)}</h3>
          <div class="small muted">${c.age != null ? Math.floor(c.age) + ' years old' : 'Age unknown'}${c.sizeRecordedAt ? ' · size updated ' + fmtShort(c.sizeRecordedAt) : ''}</div></div>
          <button type="button" class="icon-btn danger" data-del-child="${esc(c.id)}" aria-label="Remove ${esc(c.name)}">${icon('trash')}</button></div>
        <div class="form-row" style="grid-template-columns:1fr 1fr">
          <label class="field">Name<input name="name" value="${esc(c.name)}" required></label>
          <label class="field">Birthday<input name="birthDate" type="date" value="${esc(c.birthDate || '')}"></label>
          <label class="field">Clothing size<select name="clothingSize"><option value="">Not set</option>${options(state.sizes, c.clothingSize)}</select></label>
          <label class="field">Shoe size<input name="shoeSize" value="${esc(c.shoeSize || '')}"></label>
        </div>
        <button class="btn" style="align-self:flex-start">Save changes</button>
      </form>`).join('')}</div>` : `<div class="card">${emptyState('👶', 'No children added yet.')}</div>`}

    <div class="card" style="margin-top:16px">
      <div class="card-head"><h2>How many of each item a child should have</h2></div>
      <form id="targets-form">
        <div class="grid g4">${state.types.filter((t) => t !== 'other').map((t) =>
          `<label class="field">${GARMENT[t] || ''} ${esc(cap(t))}<input type="number" min="0" name="${esc(t)}" value="${esc(state.targets[t])}" placeholder="–"></label>`).join('')}</div>
        <button class="btn primary" style="margin-top:14px">Save</button>
      </form>
    </div>`;
}

// ---------- events (delegated, so re-rendering never loses handlers) ----------
document.addEventListener('click', guard(async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  const d = t.dataset;
  if (t.hasAttribute('data-cal-trips')) state.calView = 'trips';
  if (d.nav) return go(d.nav);
  if (d.foodView) { state.foodView = d.foodView; return renderFood(); }
  if (d.mealFilter) { state.mealFilter = d.mealFilter; return renderFood(); }
  if (d.wfilter) { state.wardrobeFilter = d.wfilter; return renderClothes(); }
  if (d.kid) { state.childId = d.kid; state.ootdIndex = 0; state.wardrobeFilter = 'all'; return renderClothes(); }
  if (d.season) { state.season = d.season; return renderClothes(); }
  if (t.hasAttribute('data-shuffle')) { state.ootdIndex++; return renderClothes(); }
  if (t.id === 'add-ing') return addIngredientRow();
  if (t.hasAttribute('data-del-ing')) return t.closest('.ing-row').remove();

  if (d.quick) {
    const [name, quantity, unit] = QUICK_ADD[Number(d.quick)];
    await api('/food/items', { method: 'POST', body: { name, quantity, unit } });
    toast(`Added ${name}`);
    return renderFood();
  }
  if (d.step) {
    const input = $(`[data-qty="${CSS.escape(d.step)}"]`);
    const unit = input.closest('.row').querySelector('.unit').textContent.trim();
    const stepBy = ['g', 'ml'].includes(unit) ? 100 : 1;
    const value = Math.max(0, (Number(input.value) || 0) + Number(d.delta) * stepBy);
    await api('/food/items/' + d.step, { method: 'PUT', body: { quantity: value } });
    return renderFood();
  }
  if (d.delFood) { await api('/food/items/' + d.delFood, { method: 'DELETE' }); return renderFood(); }
  if (d.cook) {
    const cooked = await api(`/food/meals/${d.cook}/cook`, { method: 'POST' });
    toast('Enjoy! Ingredients taken out of the cupboard.');
    await renderFood();
    return afterCook(cooked);
  }
  if (d.shopMissing) {
    for (const name of JSON.parse(d.shopMissing)) await api('/shopping/items', { method: 'POST', body: { name, kind: 'food' } });
    toast('Added to the shopping list');
    state.shoppingCount += JSON.parse(d.shopMissing).length;
    return renderNav();
  }
  if (d.delRecipe) {
    if (!(await ask({ title: 'Delete this recipe?', ok: 'Delete', danger: true }))) return;
    await api('/food/recipes/' + d.delRecipe, { method: 'DELETE' });
    return renderFood();
  }
  if (d.delItem) { await api('/clothes/items/' + d.delItem, { method: 'DELETE' }); return renderClothes(); }
  if (d.worn) {
    await api('/clothes/items/' + d.worn, { method: 'PUT', body: { wornOut: d.state !== 'true' } });
    return renderClothes();
  }
  if (d.delChild) {
    if (!(await ask({ title: 'Remove this child?', body: '<p class="muted">Their clothes will be removed too.</p>', ok: 'Remove', danger: true }))) return;
    await api('/family/children/' + d.delChild, { method: 'DELETE' });
    return refresh();
  }
  if (d.adults) {
    const input = $('#adults');
    const n = Math.max(0, Math.min(20, Number(input.value) + Number(d.adults)));
    await api('/family', { method: 'PUT', body: { adults: n } });
    return refresh();
  }
  if (d.toggle) {
    await api('/shopping/items/' + d.toggle, { method: 'PUT', body: { done: d.state !== 'true' } });
    return refresh();
  }
  if (d.delShop) { await api('/shopping/items/' + d.delShop, { method: 'DELETE' }); return refresh(); }
  if (d.usual) {
    const u = state.usuals[Number(d.usual)];
    await api('/shopping/items', { method: 'POST', body: { kind: 'food', name: u.name, quantity: u.quantity, unit: u.unit } });
    toast(`Added ${cap(u.name)}`);
    return refresh();
  }
  if (t.hasAttribute('data-week-shop')) return weekShop();
  if (d.choreDone) return choreDone(d.choreDone, d.by || null);
  if (d.choreBy) return choreDone(d.choreBy, null);
  if (d.choreSkip) {
    await api(`/chores/${d.choreSkip}/skip`, { method: 'POST', body: {} });
    toast('Moved to tomorrow');
    return refresh();
  }
  if (d.choreUndo) {
    await api('/chores/log/' + d.choreUndo, { method: 'DELETE' });
    return refresh();
  }
  if (d.choreStarter) {
    const r = await api('/chores', { method: 'POST', body: { starter: d.choreStarter } });
    toast(r.added ? `Added ${plural(r.added.length, 'chore')}` : `Added ${r.name}`);
    return refresh();
  }
  if (d.choreEdit) return choreEdit(d.choreEdit);
  if (d.choreDel) {
    const c = state.chores.chores.find((x) => x.id === d.choreDel);
    if (!await ask({ title: 'Remove this chore?', body: `<p class="muted">${esc(c.name)} will no longer come up. What's been done stays in the points.</p>`, ok: 'Remove', danger: true })) return;
    await api('/chores/' + d.choreDel, { method: 'DELETE' });
    return refresh();
  }
  if (d.choreRename) {
    const p = state.chores.people.find((x) => x.id === d.choreRename);
    const got = await ask({ title: 'Name', body: field('name', 'Name', 'text', p.name), ok: 'Save' });
    if (!got || !got.name) return;
    await api('/chores/people', { method: 'PUT', body: { adults: [{ id: p.id, name: got.name }] } });
    return refresh();
  }
  if (d.choreIdea !== undefined || d.choreIdeaNo !== undefined) {
    const x = state.choreIdeas[Number(d.choreIdea ?? d.choreIdeaNo)];
    if (d.choreIdeaNo !== undefined) {
      if (x.starter || x.choreId) await api('/chores/suggestions/dismiss', { method: 'POST', body: { key: x.starter || x.choreId } });
      state.choreIdeas = state.choreIdeas.filter((y) => y !== x);
      $('#chore-ideas').outerHTML = choreIdeas(state.choreIdeas);
      return;
    }
    if (x.kind === 'every') await api('/chores/' + x.choreId, { method: 'PUT', body: { every: x.every } });
    else await api('/chores', { method: 'POST', body: x.starter ? { starter: x.starter } : { name: x.name, every: x.every } });
    toast(x.kind === 'every' ? `${x.name}: ${everyText(x.every).toLowerCase()}` : `Added ${x.name}`);
    return refresh();
  }
  if (d.passAll) {
    const r = await api('/clothes/hand-down-all', { method: 'POST', body: { toChildId: d.passAll, fromChildId: d.from || null } });
    toast(`Passed on ${plural(r.moved, 'thing')}`);
    return refresh();
  }
  if (d.calView) { state.calView = d.calView; return renderCalendar(); }
  if (t.hasAttribute('data-cal-more')) { state.calDays = 42; return renderCalendarList(); }
  if (d.calStarter) return calendarStarter(d.calStarter);
  if (d.calEdit) return calendarEdit(d.calEdit);
  if (d.calDel) {
    const e = state.calendar.events.find((x) => x.id === d.calDel);
    if (!(await ask({ title: `Remove ${e ? e.title : 'this'}?`, body: e && e.repeat !== 'none' ? '<p class="muted">Every date of it goes. To miss just one, use Skip in Coming up.</p>' : '', ok: 'Remove', danger: true }))) return;
    await api('/calendar/events/' + encodeURIComponent(d.calDel), { method: 'DELETE' });
    toast('Removed');
    return renderCalendarList();
  }
  if (d.calSkip) {
    await api(`/calendar/events/${encodeURIComponent(d.calSkip)}/skip`, { method: 'POST', body: { date: d.date } });
    toast('Skipped that one');
    return renderCalendarList();
  }
  if (d.trip) { state.tripId = d.trip; return renderTrips(); }
  if (d.packToggle) {
    await api(`/packing/trips/${encodeURIComponent(state.tripId)}/items/${encodeURIComponent(d.packToggle)}`, { method: 'PUT', body: { packed: d.state !== 'true' } });
    return renderTrips();
  }
  if (d.packDel) {
    await api(`/packing/trips/${encodeURIComponent(state.tripId)}/items/${encodeURIComponent(d.packDel)}`, { method: 'DELETE' });
    return renderTrips();
  }
  if (t.hasAttribute('data-trip-rebuild')) {
    t.disabled = true;
    if (!(await aiPacking(state.tripId, true))) await api(`/packing/trips/${encodeURIComponent(state.tripId)}/rebuild`, { method: 'POST', body: {} });
    toast('List made again. Ticked things stay ticked.');
    return renderTrips();
  }
  if (t.hasAttribute('data-trip-reset')) {
    await api(`/packing/trips/${encodeURIComponent(state.tripId)}/reset`, { method: 'POST', body: {} });
    return renderTrips();
  }
  if (d.tripDel) {
    if (!(await ask({ title: 'Delete this trip?', body: '<p class="muted">Its packing list goes too.</p>', ok: 'Delete', danger: true }))) return;
    await api('/packing/trips/' + encodeURIComponent(d.tripDel), { method: 'DELETE' });
    state.tripId = null;
    return renderTrips();
  }
  if (d.kidView !== undefined) { state.kidView = d.kidView || null; return renderKids(); }
  if (d.kidDone) {
    const r = await api(`/chores/${encodeURIComponent(d.kidDone)}/done`, { method: 'POST', body: { by: state.kidView } });
    toast(`Well done! ${r.entry.effort === 1 ? '1 point' : r.entry.effort + ' points'} ⭐`);
    return renderKids();
  }
  if (d.swap) {
    const r = await api('/clothes/swap/' + encodeURIComponent(d.swap), { method: 'POST', body: {} });
    toast(`Swapped. ${cap(r.season)} clothes are out.`);
    return renderClothes();
  }
  if (d.store) {
    await api('/clothes/items/' + encodeURIComponent(d.store), { method: 'PUT', body: { stored: d.state !== 'true' } });
    toast(d.state === 'true' ? 'Back in the wardrobe' : 'Packed away');
    return renderClothes();
  }
  if (t.hasAttribute('data-money-budget')) {
    const m = await api('/money');
    const got = await ask({ title: 'Monthly budget', body: '<p class="muted">Everything you record here, plus pocket money. The app warns you when the month is heading over. Leave empty for no budget.</p>' +
      field('budget', 'Budget each month (£)', 'text', m.budget ? String(m.budget) : '', 'inputmode="decimal" placeholder="e.g. 700"'), ok: 'Save' });
    if (!got) return;
    await api('/money/budget', { method: 'PUT', body: { budget: got.budget || 0 } });
    toast(Number(got.budget) ? 'Budget saved' : 'No budget');
    return refresh();
  }
  if (d.delSpend) {
    await api('/spending/' + d.delSpend, { method: 'DELETE' });
    return refresh();
  }
  if (t.hasAttribute('data-repeat-shop')) {
    const r = await api('/shopping/repeat-last-shop', { method: 'POST' });
    toast(`Added ${plural(r.added, 'thing')} from your last shop`);
    return refresh();
  }
  if (t.hasAttribute('data-bought-ticked')) {
    const r = await api('/shopping/bought-ticked', { method: 'POST' });
    const where = [r.food && `${plural(r.food, 'thing')} in the cupboard`, r.clothes && `${plural(r.clothes, 'item')} in the wardrobe`].filter(Boolean).join(' and ');
    toast(where ? `Put away: ${where}` : 'Cleared the ticked items');
    await refresh();
    // Back from the shops: a good moment to note what it cost (optional).
    if (r.food) {
      const got = await ask({ title: 'How much was the shop?', body: '<p class="muted">Optional. Adds it to your food spending.</p>' + field('amount', 'Total (£)', 'text', '', 'inputmode="decimal" placeholder="e.g. 64.20"') + field('shop', 'Shop (optional)'), ok: 'Add' });
      if (got && got.amount) {
        await api('/spending', { method: 'POST', body: got }).then(() => toast('Added to food spending'), (e) => toast(e.message));
        return refresh();
      }
    }
    return;
  }
  if (t.hasAttribute('data-clear-done')) { await api('/shopping/clear-done', { method: 'POST' }); return refresh(); }
  if (d.aiRefresh) {
    if (d.aiRefresh === 'shopping') return aiShopping(true);
    if (d.aiRefresh === 'chores') return aiChores(true);
    await api('/ai/suggest/' + d.aiRefresh, { method: 'POST', body: { refresh: true } }).catch((e) => toast(e.message));
    return refresh();
  }
  if (d.snooze) {
    const s = state.suggestions[Number(d.snooze)];
    await api('/shopping/suggestions/dismiss', { method: 'POST', body: { key: s.key } });
    toast(`Hidden for 2 weeks: ${cap(s.name)}`);
    return refresh();
  }
  if (d.suggest || t.hasAttribute('data-add-all')) {
    const list = d.suggest ? [state.suggestions[Number(d.suggest)]] : state.suggestions;
    for (const s of list) {
      await api('/shopping/items', { method: 'POST', body: { name: s.name, kind: s.kind, quantity: s.quantity ?? null, childId: s.childId ?? null, size: s.size ?? null, type: s.type ?? null, note: s.reason } });
    }
    toast(list.length === 1 ? 'Added' : `Added ${list.length} items`);
    return refresh();
  }
  if (d.bought) return bought(d.bought);
}));

async function bought(id) {
  const { items } = await api('/shopping');
  const it = items.find((x) => x.id === id);
  let body = {};
  if (it.kind === 'food') {
    const res = await ask({
      title: `Bought ${it.name}`,
      ok: 'Put in cupboard',
      body: `<div class="form-row" style="grid-template-columns:1fr 1fr">
          <label class="field">Amount<input name="quantity" type="number" step="any" min="0" value="${esc(it.quantity)}"></label>
          <label class="field">Unit<select name="unit">${options(state.units, it.unit || 'pcs')}</select></label></div>
        <label class="field" style="margin-top:10px">Use by (optional)<input name="expiry" type="date"></label>`,
    });
    if (!res) return;
    body = res;
  } else if (it.kind === 'clothes') {
    const res = await ask({
      title: `Bought ${it.name}`,
      ok: 'Add to wardrobe',
      body: `<label class="field">How many<input name="count" type="number" min="1" max="20" value="${esc(it.quantity || 1)}"></label>
        <label class="field" style="margin-top:10px">Name<input name="name" value="New ${esc(it.type || it.name)}"></label>
        <label class="field" style="margin-top:10px">Colour<input name="colour" placeholder="optional"></label>`,
    });
    if (!res) return;
    body = res;
  }
  await api(`/shopping/items/${id}/bought`, { method: 'POST', body });
  toast(it.kind === 'food' ? 'In the cupboard' : 'In the wardrobe');
  await refresh();
}

document.addEventListener('change', guard(async (e) => {
  const el = e.target;
  if (el.dataset.qty) {
    await api('/food/items/' + el.dataset.qty, { method: 'PUT', body: { quantity: el.value } });
    return renderFood();
  }
  if (el.id === 'adults') {
    await api('/family', { method: 'PUT', body: { adults: Number(el.value) } });
    return refresh();
  }
  if (el.name === 'type' && el.form?.id === 'clothes-form') {
    // Shoes use a shoe size, not an age band.
    const child = state.family.children.find((c) => c.id === state.childId);
    $('#size-slot').innerHTML = el.value === 'shoes'
      ? `<input name="size" placeholder="Shoe size" value="${esc(child?.shoeSize || '')}">`
      : `<select name="size">${options(state.sizes, child?.clothingSize)}</select>`;
  }
}));

document.addEventListener('submit', guard(async (e) => {
  const form = e.target;
  if (form.id === 'dialog-form') return;
  e.preventDefault();
  const body = formData(form);
  if (form.id === 'feedback-form') {
    if (!String(body.text || '').trim()) return toast('Write something first');
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await ACCOUNT.feedback(body.text, state.page);
    } finally {
      btn.disabled = false;
    }
    form.reset();
    return toast('Thanks! Your feedback has been sent.');
  }
  if (form.id === 'food-form') {
    await api('/food/items', { method: 'POST', body });
    toast(`Added ${body.name}`);
    await renderFood();
    $('#food-form input[name=name]')?.focus();
  } else if (form.id === 'recipe-form') {
    const ingredients = [...form.querySelectorAll('.ing-row')].map((r) => ({
      name: r.querySelector('[name=ing-name]').value,
      qty: r.querySelector('[name=ing-qty]').value,
      unit: r.querySelector('[name=ing-unit]').value,
      optional: r.querySelector('[name=ing-opt]').checked,
    }));
    if (!ingredients.length) throw new Error('Add at least one ingredient');
    const steps = String(body.steps || '').split('\n').map((s) => s.trim()).filter(Boolean);
    await api('/food/recipes', {
      method: 'POST',
      body: { name: body.name, servings: body.servings, minutes: body.minutes, tags: [body.tag, ...(body.vegetarian ? ['vegetarian'] : [])], ingredients, steps, ...(body.source ? { source: body.source } : {}) },
    });
    state.recipeDraft = null;
    toast('Recipe saved. It will show up in meal ideas.');
    await renderFood();
  } else if (form.id === 'clothes-form') {
    await api('/clothes/items', { method: 'POST', body: { ...body, childId: state.childId } });
    toast(`Added ${body.name}`);
    const keepType = body.type;
    await renderClothes();
    const f = $('#clothes-form');
    f.elements.type.value = keepType;
    f.elements.type.dispatchEvent(new Event('change', { bubbles: true }));
    f.elements.name.focus();
  } else if (form.id === 'chore-form') {
    await api('/chores', { method: 'POST', body: { name: body.name, every: Number(body.every), effort: Number(body.effort), who: body.who || null, minAge: Number(body.minAge || 0) } });
    toast(`Added ${body.name}`);
    await refresh();
  } else if (form.id === 'pocket-form') {
    await api('/chores/settings', { method: 'PUT', body: { perPoint: Number(body.perPoint || 0) } });
    toast(Number(body.perPoint) ? `${body.perPoint}p a point` : 'Points only, no pocket money');
    await refresh();
  } else if (form.id === 'cal-form') {
    await api('/calendar/events', { method: 'POST', body: { ...body, who: checked(form, 'who'), time: body.time || null } });
    toast('Added to the calendar');
    await renderCalendarList();
  } else if (form.id === 'trip-form') {
    const btn = form.querySelector('button.primary');
    btn.disabled = true;
    try {
      const forecast = body.feel ? null : await tripWeather(body.destination, body.start, body.end);
      const weather = forecast ? { ...forecast, rain: forecast.rain || Boolean(body.rain) } : { feel: body.feel || null, rain: Boolean(body.rain) };
      const trip = await api('/packing/trips', { method: 'POST', body: { name: body.name, destination: body.destination, start: body.start, end: body.end, who: checked(form, 'who'), abroad: Boolean(body.abroad), weather } });
      state.tripId = trip.id;
      await renderTrips();
      if (await aiPacking(trip.id)) await renderTrips();
      toast('Packing list ready');
    } finally {
      btn.disabled = false;
    }
  } else if (form.id === 'pack-form') {
    await api(`/packing/trips/${encodeURIComponent(state.tripId)}/items`, { method: 'POST', body });
    await renderTrips();
    $('#pack-form input[name=name]')?.focus();
  } else if (form.id === 'spend-form') {
    await api('/spending', { method: 'POST', body });
    toast(body.category && body.category !== 'food' ? 'Added to spending' : 'Added to food spending');
    await refresh();
  } else if (form.id === 'shop-form') {
    await api('/shopping/items', { method: 'POST', body: { ...body, childId: body.childId || null } });
    await refresh();
    $('#shop-form input[name=name]')?.focus();
  } else if (form.id === 'child-form') {
    const c = await api('/family/children', { method: 'POST', body });
    state.childId = c.id;
    toast(`${c.name} added`);
    await refresh();
  } else if (form.classList.contains('child-edit')) {
    await api('/family/children/' + form.dataset.child, { method: 'PUT', body });
    toast('Saved');
    await refresh();
  } else if (form.id === 'targets-form') {
    const t = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== ''));
    await api('/clothes/targets', { method: 'PUT', body: t });
    toast('Saved');
    await refresh();
  }
}));

// The recipe form starts with three ingredient rows.
new MutationObserver(() => {
  const rows = $('#ing-rows');
  if (rows && !rows.children.length) for (let i = 0; i < 3; i++) addIngredientRow();
}).observe($('#page'), { childList: true, subtree: true });

// ---------- settings ----------
const IS_APP = Boolean(window.FamilyPlannerNative);

// ---------- account (signing in and saving online) ----------
// Only the home screen and iPhone versions provide window.FamilyPlannerAccount.
const ACCOUNT = window.FamilyPlannerAccount || null;
let household = null; // who's in the household, as last fetched (each person has their own login)

const prettyCode = (c) => `${c.slice(0, 4)}-${c.slice(4)}`;

function householdBlock() {
  if (!ACCOUNT.household) return '';
  if (!household) return '<p class="hint" style="margin-top:10px" id="household-line">Checking who is in your household…</p>';
  const names = household.members.map((m) => `<li>${esc(m.email)}${m.you ? ' <span class="muted">(you)</span>' : ''}</li>`).join('');
  return `
    <div id="household-line" style="margin-top:12px">
      <strong>${household.shared ? 'Your household' : 'Just you so far'}</strong>
      <ul class="small" style="margin:6px 0 0 18px">${names}</ul>
      <p class="hint" style="margin-top:6px">${household.shared ? 'Everyone here signs in with their own email and sees the same lists.' : 'Invite your partner or anyone else who helps, so they can sign in with their own email and share the same lists.'}</p>
      ${household.shared ? `<p class="small" style="margin-top:8px">On the shopping list you show as <strong>${esc(personName(ACCOUNT.status().email))}</strong> <button class="btn ghost sm" data-account="name">Change</button></p>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn sm" data-account="invite">${icon('plus')} Invite someone</button>
        <button class="btn sm ghost" data-account="join">Join a household</button>
        ${household.joined ? '<button class="btn sm ghost" data-account="leave">Leave household</button>' : ''}
      </div>
    </div>`;
}

async function loadHousehold() {
  if (!ACCOUNT?.household || !ACCOUNT.status().signedIn) return;
  try {
    household = await ACCOUNT.household();
    state.people = (await api('/shopping')).people || {};
  } catch {
    household = null;
    const line = $('#household-line');
    if (line) line.textContent = "Couldn't check who is in your household. Try again when you're online.";
    return;
  }
  const card = $('#account-card');
  if (card) card.outerHTML = accountCard();
}

function accountCard() {
  if (!ACCOUNT) return '';
  if (state.demo?.on) {
    return `
    <div class="card" id="account-card" style="margin-bottom:16px">
      <div class="card-head"><h2>☁️ Account</h2><span class="pill plain">Paused for the demo</span></div>
      <p class="hint" style="margin-top:8px">Nothing is saved online while the demo is on, and the sample family never leaves this device. Leave the demo to get back to your own lists.</p>
    </div>`;
  }
  const s = ACCOUNT.status();
  const saved = s.savedAt ? `Last saved online ${new Date(s.savedAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.` : '';
  return `
    <div class="card" id="account-card" style="margin-bottom:16px">
      <div class="card-head"><h2>☁️ Account</h2>${s.signedIn ? (s.error ? '<span class="pill warn">Not saved</span>' : s.syncing || s.pending ? '<span class="pill plain">Saving…</span>' : `<span class="pill">${icon('check')} Saved online</span>`) : '<span class="pill plain">Only on this device</span>'}</div>
      ${s.signedIn ? `
        <p style="margin-top:8px">Signed in as <strong>${esc(s.email)}</strong>. Changes save online by themselves, and show up on your other devices when you open the app there.</p>
        <p class="hint" style="margin-top:6px">${s.error ? esc(s.error) + ' ' : ''}${esc(saved)} Your AI key stays on each device.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn" data-account="sync">${icon('upload')} Save now</button>
          <button class="btn ghost" data-account="signout">Sign out</button>
        </div>
        ${householdBlock()}
        <p class="small" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)"><button class="btn ghost sm" data-account="delete" style="color:var(--coral)">Delete my account</button></p>` : `
        <p class="hint" style="margin-top:8px">Sign in to save your family's data online, so it's safe and the same on your iPhone and iPad. Everyone in the family can have their own login and share one household.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn primary" data-account="signin">Sign in</button>
          <button class="btn" data-account="signup">Create account</button>
        </div>`}
    </div>`;
}

const field = (name, label, type = 'text', value = '', extra = '') =>
  `<label class="field" style="margin-top:10px">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const emailField = (v) => field('email', 'Email', 'email', v, 'autocomplete="username" autocapitalize="off" spellcheck="false"');
const codeField = () => field('code', 'Code from the email', 'text', '', 'autocomplete="one-time-code" inputmode="numeric"');

// Shows a form in the dialog until the step succeeds or the person cancels.
async function accountStep({ title, intro = '', fields, ok, run, danger = false }) {
  let values = {};
  let error = '';
  for (;;) {
    const body = `${intro ? `<p class="muted">${intro}</p>` : ''}${fields(values)}${error ? `<p class="small" style="color:var(--coral);margin-top:10px">${esc(error)}</p>` : ''}`;
    const got = await ask({ title, body, ok, danger });
    if (!got) return null;
    values = got;
    try {
      return (await run(got)) || got;
    } catch (e) {
      error = e.message;
    }
  }
}

async function accountSignIn(email = '') {
  let choose = null;
  const done = await accountStep({
    title: 'Sign in',
    fields: (v) => emailField(v.email || email) + field('password', 'Password', 'password', '', 'autocomplete="current-password"') +
      '<p class="small" style="margin-top:10px"><button type="button" class="btn ghost sm" data-account="forgot">Forgot password?</button></p>' +
      '<p class="hint" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">New to Family Planner? <button type="button" class="btn sm" data-account="to-signup">Create an account</button></p>',
    ok: 'Sign in',
    run: async (v) => {
      if (!v.email || !v.password) throw new Error('Enter your email and password.');
      const r = await ACCOUNT.signIn(v.email, v.password);
      if (r.choose) choose = r;
      return r;
    },
  });
  if (!done) return;
  if (choose) {
    const keep = await ask({
      title: 'Which data should this device use?',
      body: `<p class="muted">Your account already has saved data${choose.savedAt ? ` from ${esc(fmtDate(choose.savedAt))}` : ''}, and this device has its own. Choose which to keep. The other is replaced.</p>
        <label class="field" style="margin-top:12px"><span><input type="radio" name="keep" value="account" checked style="width:auto"> The account's saved data (recommended)</span></label>
        <label class="field" style="margin-top:8px"><span><input type="radio" name="keep" value="device" style="width:auto"> This device's data</span></label>`,
      ok: 'Continue',
    });
    await ACCOUNT.choose(keep?.keep === 'device' ? 'device' : 'account');
  }
  toast('Signed in. Your data is saved online.');
  await refresh();
}

async function accountSignUp(email = '') {
  const created = await accountStep({
    title: 'Create an account',
    intro: 'This is your own login. To share lists with someone, one of you invites the other from Settings once you are signed in. <a href="/privacy.html">How your data is kept</a>',
    fields: (v) => emailField(v.email || email) + field('password', 'Password (8 or more characters, with a number)', 'password', '', 'autocomplete="new-password"') +
      '<p class="hint" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">Already have an account? <button type="button" class="btn sm" data-account="to-signin">Sign in</button></p>',
    ok: 'Create account',
    run: async (v) => {
      if (!v.email || !v.password) throw new Error('Enter an email and a password.');
      await ACCOUNT.signUp(v.email, v.password);
    },
  });
  if (!created) return;
  const confirmed = await accountStep({
    title: 'Check your email',
    intro: `We sent a code to ${esc(created.email)}. It can take a minute, and may land in junk mail.`,
    fields: codeField,
    ok: 'Confirm',
    run: async (v) => {
      await ACCOUNT.confirm(created.email, v.code);
      await ACCOUNT.signIn(created.email, created.password);
    },
  });
  if (!confirmed) return;
  toast('Account created. Your data is saved online.');
  await refresh();
}

async function accountForgot(email = '') {
  const asked = await accountStep({
    title: 'Reset your password',
    intro: "We'll email you a code.",
    fields: (v) => emailField(v.email || email),
    ok: 'Send code',
    run: (v) => ACCOUNT.forgotPassword(v.email),
  });
  if (!asked) return;
  const reset = await accountStep({
    title: 'Choose a new password',
    intro: `Enter the code we sent to ${esc(asked.email)}.`,
    fields: () => codeField() + field('password', 'New password', 'password', '', 'autocomplete="new-password"'),
    ok: 'Save password',
    run: async (v) => {
      await ACCOUNT.resetPassword(asked.email, v.code, v.password);
      await ACCOUNT.signIn(asked.email, v.password);
    },
  });
  if (!reset) return;
  toast('Password changed. You are signed in.');
  await refresh();
}

async function accountInvite() {
  let r;
  try {
    r = await ACCOUNT.invite();
  } catch (e) {
    return toast(e.message);
  }
  await ask({
    title: 'Invite someone',
    body: `<p class="muted">Give them this code. They create their own account in Family Planner, then go to Settings, tap <strong>Join a household</strong> and enter it.</p>
      <p style="font-size:1.8rem;font-weight:700;letter-spacing:.12em;text-align:center;margin:16px 0" id="invite-code">${esc(prettyCode(r.code))}</p>
      <p class="hint">The code lets one person join and works for ${esc(r.days || 7)} days. Make a new one for each person, and only share it with family.</p>`,
    ok: 'Done',
  });
  loadHousehold();
}

async function accountJoin() {
  const joined = await accountStep({
    title: 'Join a household',
    intro: "Enter the code from the person who invited you. This device switches to that household's lists, and what's only on this device is replaced.",
    fields: (v) => field('code', 'Invite code', 'text', v.code || '', 'autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABCD-2345"'),
    ok: 'Join',
    run: async (v) => {
      if (!String(v.code || '').trim()) throw new Error('Enter the invite code.');
      return ACCOUNT.join(v.code);
    },
  });
  if (!joined) return;
  toast(joined.invitedBy ? `You've joined ${joined.invitedBy}'s household` : "You're in that household already");
  household = null;
  await refresh();
  loadHousehold();
}

async function accountLeave() {
  if (!await ask({ title: 'Leave this household?', body: "<p class=\"muted\">You'll go back to your own lists, starting with a copy of what's here now. The others keep the household.</p>", ok: 'Leave', danger: true })) return;
  try {
    await ACCOUNT.leave();
  } catch (e) {
    return toast(e.message);
  }
  toast('You left the household');
  household = null;
  await refresh();
  loadHousehold();
}

// Only with an online account: the message is emailed to whoever runs the app.
function feedbackCard() {
  if (!ACCOUNT?.feedback || state.demo?.on) return '';
  const signedIn = ACCOUNT.status().signedIn;
  return `<div class="card" id="feedback-card">
        <div class="card-head"><h2>💬 Send feedback</h2></div>
        ${signedIn ? `<p class="hint">Something confusing, broken or missing? Tell us here. It's sent with your email so we can reply.</p>
        <form id="feedback-form" style="margin-top:10px">
          <textarea name="text" rows="3" maxlength="2000" placeholder="What would make the app better for your family?" style="width:100%"></textarea>
          <button class="btn primary" style="margin-top:8px">${icon('check')} Send</button>
        </form>` : '<p class="hint">Sign in (in Account above) to send feedback.</p>'}
      </div>`;
}

async function accountDelete() {
  const shared = household?.shared;
  const done = await accountStep({
    title: 'Delete your account?',
    intro: `This deletes your login and can't be undone. ${shared
      ? 'The others in your household keep its lists, with your email taken off everything.'
      : 'Your saved lists are deleted from online storage too.'}`,
    fields: () => field('password', 'Type your password to confirm', 'password', '', 'autocomplete="current-password"') +
      `<label class="field" style="margin-top:12px"><span><input type="checkbox" name="clear" value="yes" checked style="width:auto"> Also clear everything on this device</span></label>`,
    ok: 'Delete account',
    danger: true,
    run: async (v) => {
      if (!v.password) throw new Error('Type your password to confirm.');
      await ACCOUNT.deleteAccount(v.password, { clearDevice: v.clear === 'yes' });
    },
  });
  if (!done) return;
  household = null;
  toast('Your account has been deleted');
  if (done.clear === 'yes') location.reload();
  else await refresh();
}

async function accountAction(what) {
  if (what === 'delete') return accountDelete();
  if (what === 'invite') return accountInvite();
  if (what === 'name') {
    const got = await ask({ title: 'Your name on the list', body: '<p class="muted">Shown next to things you add, so everyone knows who asked for what.</p>' + field('name', 'Name', 'text', personName(ACCOUNT.status().email), 'autocomplete="given-name"'), ok: 'Save' });
    if (!got) return;
    await api('/shopping/people/me', { method: 'PUT', body: { name: got.name } });
    state.people = (await api('/shopping')).people;
    const card = $('#account-card');
    if (card) card.outerHTML = accountCard();
    return toast('Saved');
  }
  if (what === 'join') return accountJoin();
  if (what === 'leave') return accountLeave();
  if (what === 'signin') return accountSignIn();
  if (what === 'signup') return accountSignUp();
  if (['forgot', 'to-signup', 'to-signin'].includes(what)) {
    const email = $('#dialog-form input[name=email]')?.value || '';
    const dlg = $('#dialog');
    // Let this dialog finish closing before the next one opens in its place.
    await new Promise((resolve) => { dlg.addEventListener('close', () => setTimeout(resolve), { once: true }); dlg.close('cancel'); });
    return what === 'forgot' ? accountForgot(email) : what === 'to-signup' ? accountSignUp(email) : accountSignIn(email);
  }
  if (what === 'dismiss') {
    try { localStorage.setItem('fp-account-nudge', 'no'); } catch {}
    return refresh();
  }
  if (what === 'sync') {
    const s = await ACCOUNT.syncNow();
    return toast(s.error || 'Saved online');
  }
  if (what === 'signout') {
    if (!await ask({ title: 'Sign out?', body: '<p class="muted">Your data stays on this device, but changes here stop being saved online until you sign in again.</p>', ok: 'Sign out' })) return;
    await ACCOUNT.signOut();
    household = null;
    toast('Signed out');
    return refresh();
  }
}

if (ACCOUNT) {
  window.addEventListener('familyplanner:account', () => {
    const card = $('#account-card');
    if (card) card.outerHTML = accountCard();
  });
  // Another device saved changes: show them.
  window.addEventListener('familyplanner:datachanged', (e) => {
    if ($('#dialog').open) return;
    const reason = e.detail?.reason;
    if (reason === 'deleted') return; // the account was just deleted; accountDelete takes it from here
    // Live updates while the app is open are quiet, and wait while someone is typing.
    if (reason === 'live' || reason === 'merged') {
      if (document.activeElement?.closest?.('#page form')) return;
      if (reason === 'merged') toast('Combined your changes with ones saved at the same time on another device');
      return refresh();
    }
    toast(reason === 'conflict' ? 'Your other device saved changes first, so this shows its latest data.' : 'Updated with changes from your other device');
    refresh();
  });
}

// ---------- notifications and Siri (with an online account) ----------
// Notifications: the home screen version gets reminders by Web Push, sent by the account's
// server (the iPhone app makes its own). iPhones only allow it once the app is on the Home Screen.
const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const localFlag = (key, value) => {
  try {
    if (value === undefined) return localStorage.getItem(key) === 'on';
    if (value) localStorage.setItem(key, 'on');
    else localStorage.removeItem(key);
  } catch {}
  return false;
};
const redrawCard = (id, html) => {
  const card = $(id);
  if (card) card.outerHTML = html;
};

function pushCard() {
  if (!ACCOUNT?.pushSubscribe || IS_APP || state.demo?.on) return '';
  const can = 'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator;
  const on = can && localFlag('fp-push') && Notification.permission === 'granted';
  let body;
  if (!ACCOUNT.status().signedIn) body = '<p class="hint">Sign in to get reminders on this phone.</p>';
  else if (IS_IOS && !navigator.standalone) body = '<p class="hint">Add the app to your Home Screen first (Share &gt; Add to Home Screen), then open it from there and turn notifications on here.</p>';
  else if (!can) body = "<p class=\"hint\">This browser can't show notifications from the app.</p>";
  else if (Notification.permission === 'denied') {
    body = `<p class="hint">Notifications are blocked for this app. To allow them on an iPhone, open the Settings app, tap <strong>Notifications</strong>, then <strong>Family</strong>, and turn on <strong>Allow Notifications</strong>. Then come back here.</p>`;
  } else if (on) {
    body = `<p style="margin-top:4px">Notifications are on for this phone.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn" data-push="test">Send a test</button>
          <button class="btn ghost" data-push="off">Turn off</button>
        </div>`;
  } else {
    body = '<div style="margin-top:12px"><button class="btn primary" data-push="on">Turn on notifications</button></div>';
  }
  return `<div class="card" id="push-card">
        <div class="card-head"><h2>🔔 Notifications</h2>${on ? '<span class="pill">On</span>' : ''}</div>
        <p class="hint">Reminders arrive at 5pm the day before: food about to go off, school uniform to buy, a child short of clothes and more.</p>
        ${body}
      </div>`;
}

// The server's key as bytes, for pushManager.subscribe.
const keyBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));

async function pushAction(what) {
  if (what === 'on') {
    // iPhones only ask when this comes straight from the tap, so it goes first.
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      redrawCard('#push-card', pushCard());
      return toast(perm === 'denied' ? 'Notifications are blocked. See Settings for how to allow them.' : 'Notifications are still off');
    }
    const key = await ACCOUNT.pushKey();
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
    await ACCOUNT.pushSubscribe(sub.toJSON());
    localFlag('fp-push', true);
    window.dispatchEvent(new Event('familyplanner:push')); // main.js uploads the reminders
    await ACCOUNT.pushTest().catch(() => {});
    redrawCard('#push-card', pushCard());
    return toast("Notifications are on. We've sent a test one to this phone.");
  }
  if (what === 'test') {
    await ACCOUNT.pushTest();
    return toast('Sent. It should arrive in a few seconds.');
  }
  if (what === 'off') {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await ACCOUNT.pushUnsubscribe(sub.endpoint);
      await sub.unsubscribe().catch(() => {});
    }
    localFlag('fp-push', false);
    window.dispatchEvent(new Event('familyplanner:push'));
    redrawCard('#push-card', pushCard());
    return toast('Notifications are off for this phone');
  }
}

// "Hey Siri, add to shopping": a Shortcut on the iPhone sends what was said to the account's
// server with a key made here (infra/lambda/index.js POST /shortcut/add).
function siriCard() {
  if (!ACCOUNT?.shortcutKey || state.demo?.on) return '';
  const signedIn = ACCOUNT.status().signedIn;
  const on = signedIn && localFlag('fp-siri');
  return `<div class="card" id="siri-card">
        <div class="card-head"><h2>🎙️ Siri</h2>${on ? '<span class="pill">Set up</span>' : ''}</div>
        ${signedIn ? `<p class="hint">Say "Hey Siri, add to shopping", then what you need, like "milk and eggs". It goes straight on the household's shopping list. A second shortcut, "Tell Family Planner", takes whole sentences like "we need milk and Leo did the bins": the shopping, chores and spending happen straight away, and anything else waits in Ask for the next time you open the app. You make the shortcuts on your iPhone once to set them up.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn ${on ? '' : 'primary'}" data-siri="setup">${on ? 'Set it up again' : 'Set up Hey Siri'}</button>
          ${on ? '<button class="btn ghost" data-siri="off">Turn off Siri key</button>' : ''}
        </div>` : '<p class="hint">Sign in (in Account above) to add things to the shopping list with Siri.</p>'}
      </div>`;
}

const copyField = (id, label, value) => `<label class="field" style="margin-top:12px">${label}
        <span style="display:flex;gap:8px"><input id="${id}" readonly value="${esc(value)}" ${NOFILL}><button type="button" class="btn sm" data-copy="#${id}">Copy</button></span></label>`;

async function siriAction(what) {
  if (what === 'off') {
    if (!await ask({ title: 'Turn off the Siri key?', body: '<p class="muted">The "Add to shopping" shortcut stops working. You can set it up again at any time.</p>', ok: 'Turn off', danger: true })) return;
    await ACCOUNT.shortcutRevoke();
    localFlag('fp-siri', false);
    redrawCard('#siri-card', siriCard());
    return toast('Siri key turned off');
  }
  if (localFlag('fp-siri') && !await ask({ title: 'Make a new Siri key?', body: '<p class="muted">The old key stops working, so put the new one in your shortcut.</p>', ok: 'Make a new key' })) return;
  const key = await ACCOUNT.shortcutKey();
  localFlag('fp-siri', true);
  redrawCard('#siri-card', siriCard());
  await ask({
    title: 'Set up Hey Siri',
    body: `<p class="muted">On your iPhone, open the <strong>Shortcuts</strong> app and make this shortcut. You only do it once.</p>
      <ol class="small" style="margin:10px 0 0 20px;line-height:1.6">
        <li>Tap <strong>+</strong> to make a new shortcut.</li>
        <li>Add the action <strong>Dictate Text</strong>.</li>
        <li>Add <strong>Get Contents of URL</strong> and paste the address below as its URL. Tap the arrow to see more, set <strong>Method</strong> to <strong>POST</strong> and <strong>Request Body</strong> to <strong>JSON</strong>.</li>
        <li>Add two Text fields to the body: <strong>key</strong>, with the key below pasted in, and <strong>item</strong>, set to <strong>Dictated Text</strong> (pick it from the suggestions above the keyboard).</li>
        <li>Add <strong>Get Dictionary Value</strong>, and set it to get the value for <strong>message</strong> in <strong>Contents of URL</strong>.</li>
        <li>Add <strong>Speak Text</strong>, so Siri tells you what was added.</li>
        <li>Name the shortcut <strong>Add to shopping</strong>. Now say "Hey Siri, add to shopping".</li>
      </ol>
      <p class="muted" style="margin-top:12px">For whole sentences, duplicate that shortcut, change the body field <strong>item</strong> to <strong>text</strong>, and name it <strong>Tell Family Planner</strong>. Then say "Hey Siri, tell Family Planner", and say what's happened, like "we need milk and Leo did the bins".</p>
      ${copyField('siri-url', 'Address', `${ACCOUNT.apiUrl}/shortcut/add`)}
      ${copyField('siri-key', 'Key', key)}
      <p class="hint" style="margin-top:10px">Keep the key private: anyone who has it can add things to your shopping list. It's only shown now. If it gets out, make a new one here or turn it off.</p>`,
    ok: 'Done',
  });
}

document.addEventListener('click', guard(async (e) => {
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    const input = $(copy.dataset.copy);
    try {
      await navigator.clipboard.writeText(input.value);
      copy.textContent = 'Copied';
    } catch {
      input.select(); // the person can copy it themselves
    }
    return;
  }
  const t = e.target.closest('[data-push],[data-siri]');
  if (!t || !ACCOUNT) return;
  return t.dataset.push ? pushAction(t.dataset.push) : siriAction(t.dataset.siri);
}));

async function renderSettings() {
  const [ai, providers, prices] = await Promise.all([api('/ai/settings'), api('/ai/providers'), api('/clothes/prices')]);
  state.ai = ai;
  state.providers = providers;
  const f = state.family;
  $('#page-sub').textContent = ACCOUNT ? 'Account, diet, weather, AI and backups.' : 'Diet, weather, AI and backups.';
  const shownProviders = providers.filter((p) => p.id === ai.provider || !(IS_APP && ['ollama', 'custom'].includes(p.id)));
  const preset = providers.find((p) => p.id === ai.provider);
  const diets = ['vegetarian', 'dairy-free', 'gluten-free', 'nut-free'];
  const onDeviceOn = ai.onDeviceAvailable && ai.onDevice;

  $('#page').innerHTML = `
    ${accountCard()}
    <div class="grid g2">
      <div class="card">
        <div class="card-head"><h2>🥗 Diet</h2></div>
        <p class="hint">Meal ideas and the weekly plan only use recipes that suit everyone.</p>
        <div class="chips" style="margin-top:12px">${diets.map((d) => `<button class="chip ${f.dietary.includes(d) ? 'active' : ''}" data-diet="${d}">${f.dietary.includes(d) ? icon('check') : ''} ${cap(d)}</button>`).join('')}</div>
      </div>

      <div class="card">
        <div class="card-head"><h2>🌦️ Your town</h2></div>
        <p class="hint">Used for weather-aware outfits. Only the town's position is saved.</p>
        ${f.location ? `<p style="margin-top:10px"><strong>${esc(f.location.name || 'Saved location')}</strong> <button class="btn ghost sm" data-clear-location>Remove</button></p>` : ''}
        <form id="town-form" class="form-row" style="grid-template-columns:1fr auto;margin-top:10px">
          <input name="town" placeholder="Town or postcode area, e.g. Leeds">
          <button class="btn">Find</button>
        </form>
        <div id="town-results" class="chips" style="margin-top:10px"></div>
        ${navigator.geolocation ? '<button class="btn ghost sm" data-geolocate style="margin-top:6px">📍 Use my location</button>' : ''}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-head"><h2>✨ AI helper</h2>${ai.ready ? '<span class="pill">Ready</span>' : '<span class="pill plain">Off</span>'}</div>
      <p class="hint">AI is optional. Without one, the app's own rules make every suggestion. With one, it also suggests new meals and reads photos of food, receipts and clothes.</p>
      ${ai.ready ? `<label class="banner" style="margin-top:12px;background:var(--accent-soft);color:var(--accent);cursor:pointer">
        <input type="checkbox" data-ai-suggestions ${ai.useForSuggestions !== false ? 'checked' : ''} style="width:auto">
        <div class="grow"><div>Use AI for suggestions</div>
          <div class="small" style="font-weight:500">The shopping suggestions, what to cook next, the week's dinners and outfits come from the AI. Turn off to use the app's own rules.</div></div>
      </label>` : ''}
      ${'onDeviceAvailable' in ai ? `
        <div class="banner" style="margin-top:12px;background:var(--accent-soft);color:var(--accent)">
          <span style="font-size:22px">📱</span>
          <div class="grow"><div>iPhone on-device AI</div>
            <div class="small" style="font-weight:500">${ai.onDeviceAvailable ? 'Private and free: runs on this phone, nothing leaves it.' : esc(ai.onDeviceReason || 'Not available on this phone.')}</div></div>
          ${ai.onDeviceAvailable ? `<label class="chip"><input type="checkbox" data-ondevice ${ai.onDevice ? 'checked' : ''} style="width:auto"> Use it</label>` : ''}
        </div>` : ''}
      <form id="ai-form" class="stack" style="margin-top:14px" autocomplete="off">
        <div class="form-row" style="grid-template-columns:1fr 1fr">
          <label class="field">${onDeviceOn ? 'Extra AI (used when on-device can\'t)' : 'AI to use'}
            <select name="provider"><option value="none">None</option>${shownProviders.map((p) => `<option value="${p.id}" ${p.id === ai.provider ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
          <label class="field">Model
            ${preset && preset.models.length
              ? `<select name="model">${options(preset.models, ai.model || preset.models[0])}</select>`
              : `<input name="model" ${NOFILL} value="${esc(ai.model)}" placeholder="${preset ? 'Model name' : '—'}" ${preset ? '' : 'disabled'}>`}</label>
        </div>
        ${preset ? `
        ${preset.note ? `<p class="hint">${esc(preset.note)}</p>` : ''}
        <div class="form-row" style="grid-template-columns:1fr 1fr">
          <label class="field">API key ${ai.hasKey ? `<span class="muted">(saved${ai.apiKeyHint ? ' ' + esc(ai.apiKeyHint) : ''})</span>` : ''}
            <input name="apiKey" type="text" class="secret" ${NOFILL} placeholder="${ai.hasKey ? 'Leave blank to keep' : preset.needsKey ? 'Paste your key' : 'Not needed'}"></label>
          <label class="field">Server address
            <input name="baseUrl" ${NOFILL} value="${esc(ai.baseUrl)}" placeholder="${esc(preset.baseUrl || 'https://…')}"></label>
        </div>
        <div class="form-row" style="grid-template-columns:1fr 2fr">
          <label class="field">Monthly limit<input name="monthlyLimit" type="number" min="0" value="${esc(ai.monthlyLimit)}"></label>
          <p class="hint" style="align-self:center">${ai.usage && ai.usage.month ? `Used ${esc(ai.usage.count)} this month.` : 'Not used yet this month.'} 0 means no limit.</p>
        </div>
        <div class="form-row" style="grid-template-columns:1fr 2fr">
          <label class="field">Chat messages a month<input name="chatLimit" type="number" min="0" value="${esc(ai.chatLimit ?? 300)}"></label>
          <p class="hint" style="align-self:center">${ai.chatUsage && ai.chatUsage.month === new Date().toISOString().slice(0, 7) ? `${esc(ai.chatUsage.count)} sent this month.` : 'No chat messages this month.'} The chat has its own limit, so it can't use up the suggestions.</p>
        </div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn primary">Save</button>
          ${ai.ready ? `<button type="button" class="btn" data-ai-test>Test it</button>` : ''}
        </div>
      </form>
      <p class="hint" style="margin-top:12px">Your key is stored with your family's data on this ${IS_APP ? 'phone' : 'computer'} and is never included in backups.</p>
    </div>

    <div class="grid g2" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><h2>💷 Clothes prices</h2></div>
        <p class="hint">Typical prices used for the clothes budget.</p>
        <form id="prices-form" style="margin-top:12px">
          <div class="grid g4">${state.types.map((t) => `<label class="field">${GARMENT[t] || ''} ${esc(cap(t))}<input type="number" min="0" step="0.5" name="${esc(t)}" value="${esc(prices[t])}"></label>`).join('')}</div>
          <button class="btn primary" style="margin-top:12px">Save prices</button>
        </form>
      </div>
      ${customiseCard()}
      ${kitchenCard()}
      ${demoCard()}
      ${feedbackCard()}
      ${pushCard()}${siriCard()}
      <div class="card">
        <div class="card-head"><h2>💾 Backup</h2></div>
        <p class="hint">Download everything as a file, or restore from one. Restoring replaces what's here now.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn primary" data-export>${icon('download')} Download backup</button>
          <button class="btn" data-import>${icon('upload')} Restore from file</button>
        </div>
      </div>
    </div>
    <p class="muted small" id="about-line" style="text-align:center;margin:24px 0 8px;user-select:none">Family Planner</p>
    <p class="small" style="text-align:center;margin:0 0 8px"><a href="/privacy.html" id="privacy-link">Privacy: how your family's data is kept</a></p>`;
  if (!household) loadHousehold();
}

// ---------- customise ----------
// The household's name is shared; colours, text size, tabs and the kitchen screen are set
// on each device, so the kitchen tablet can look different from a phone.
function customiseCard() {
  const f = state.family;
  const theme = document.documentElement.dataset.theme || 'auto';
  const seg = (name, value, opts) => `<div class="seg" role="group">${opts.map(([v, l]) =>
    `<button type="button" data-look-${name}="${v}" class="${value === v ? 'active' : ''}">${l}</button>`).join('')}</div>`;
  return `
      <div class="card" id="customise-card">
        <div class="card-head"><h2>🎨 Customise</h2></div>
        <form id="household-name-form" class="stack" style="margin-top:4px">
          <label class="field">Household name <span class="muted small">(everyone sees this)</span>
            <span style="display:flex;gap:8px"><input name="name" maxlength="40" value="${esc(f.name || '')}" placeholder="e.g. The Schofields"><button class="btn">Save</button></span></label>
        </form>
        <div class="field" style="margin-top:14px">Colour
          <div class="swatches">${ACCENTS.map(([id, label, hex]) =>
    `<button type="button" class="swatch ${look.accent === id ? 'active' : ''}" data-look-accent="${id}" style="background:${hex}" aria-label="${label}" title="${label}">${look.accent === id ? icon('check') : ''}</button>`).join('')}</div></div>
        <div class="field" style="margin-top:14px">Light or dark ${seg('theme', theme, [['auto', 'Match the device'], ['light', 'Light'], ['dark', 'Dark']])}</div>
        <div class="field" style="margin-top:14px">Text size ${seg('size', look.size, [['normal', 'Normal'], ['large', 'Large'], ['xl', 'Extra large']])}</div>
        <div class="field" style="margin-top:14px">Tabs to show
          <div class="chips" style="margin-top:6px">${TOOLS.map((t) => {
    const pg = PAGES.find((p) => p.id === t);
    return `<label class="chip check-chip"><input type="checkbox" data-look-tab="${t}" ${look.hidden.includes(t) ? '' : 'checked'}> ${pg.label === 'Shop' ? 'Shopping' : pg.label}</label>`;
  }).join('')}</div>
          <span class="hint">Hidden tools also leave the Home page. Nothing is deleted.</span></div>
        <div class="field" style="margin-top:14px">On a phone, along the bottom
          <div class="chips" style="margin-top:6px" id="bottom-tabs">${PAGES.filter((p) => !p.hidden && p.id !== 'home').map((p) =>
    `<label class="chip check-chip"><input type="checkbox" data-look-bottom="${p.id}" ${(look.tabs || []).includes(p.id) ? 'checked' : ''} ${look.hidden.includes(p.id) ? 'disabled' : ''}> ${p.label === 'Shop' ? 'Shopping' : esc(p.label)}</label>`).join('')}</div>
          <span class="hint">Pick ${BOTTOM_TABS}. Home is always there, and everything else is under More.</span></div>
        <label class="field" style="margin-top:14px">Open the app on
          <select data-look-start>${PAGES.filter((p) => p.id !== 'settings').map((p) =>
    `<option value="${p.id}" ${look.start === p.id ? 'selected' : ''}>${p.id === 'kitchen' ? 'Kitchen screen' : p.title}</option>`).join('')}</select></label>
      </div>`;
}

function kitchenCard() {
  const k = look.kitchen;
  return `
      <div class="card" id="kitchen-card">
        <div class="card-head"><h2>📺 Kitchen screen</h2></div>
        <p class="hint">A big, glanceable page for a tablet or screen on the wall: the time, weather, tonight's dinner, today's chores and the shopping list. It updates by itself, and chores and shopping can be ticked off from it.</p>
        <div class="field" style="margin-top:12px">Show
          <div class="chips" style="margin-top:6px">${KITCHEN_PANELS.map(([id, label]) =>
    `<label class="chip check-chip"><input type="checkbox" data-look-panel="${id}" ${k.panels.includes(id) ? 'checked' : ''}> ${label}</label>`).join('')}</div></div>
        <label class="check-row" style="margin-top:10px"><input type="checkbox" data-look-awake ${k.awake ? 'checked' : ''}> Keep the screen on while it's showing</label>
        <label class="check-row"><input type="checkbox" data-look-dim ${k.dim ? 'checked' : ''}> Dim it at night (10pm to 6am)</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn primary" data-nav="kitchen">${icon('home')} Open kitchen screen</button>
        </div>
        <p class="hint" style="margin-top:8px">For a tablet that's always the kitchen screen, set <strong>Open the app on</strong> to Kitchen screen in Customise on that tablet, then add the app to its home screen.</p>
      </div>`;
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-look-accent],[data-look-theme],[data-look-size]');
  if (!t) return;
  const d = t.dataset;
  if (d.lookAccent) look.accent = d.lookAccent;
  if (d.lookSize) look.size = d.lookSize;
  if (d.lookTheme) {
    if (d.lookTheme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = d.lookTheme;
    try {
      if (d.lookTheme === 'auto') localStorage.removeItem('fp-theme');
      else localStorage.setItem('fp-theme', d.lookTheme);
    } catch {}
  }
  saveLook();
  renderNav();
  // Show the choice in place (re-drawing the page would lose anything half-typed).
  const attr = Object.keys(d).find((k) => k.startsWith('look'));
  const name = 'data-' + attr.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
  for (const b of document.querySelectorAll(`[${name}]`)) {
    b.classList.toggle('active', b === t);
    if (b.classList.contains('swatch')) b.innerHTML = b === t ? icon('check') : '';
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  const d = t.dataset || {};
  if (d.lookTab) {
    look.hidden = t.checked ? look.hidden.filter((x) => x !== d.lookTab) : [...new Set([...look.hidden, d.lookTab])];
    if (look.hidden.includes(look.start)) {
      look.start = 'home';
      if ($('[data-look-start]')) $('[data-look-start]').value = 'home';
    }
  } else if (d.lookBottom) {
    const on = (look.tabs || []).filter((x) => x !== d.lookBottom);
    if (t.checked) on.push(d.lookBottom);
    if (on.length > BOTTOM_TABS) {
      t.checked = false;
      return toast(`Up to ${BOTTOM_TABS}: untick one first`);
    }
    look.tabs = on;
  } else if (d.lookStart !== undefined) look.start = t.value;
  else if (d.lookPanel) {
    const on = new Set(look.kitchen.panels);
    if (t.checked) on.add(d.lookPanel); else on.delete(d.lookPanel);
    look.kitchen.panels = KITCHEN_PANELS.map(([id]) => id).filter((id) => on.has(id));
  } else if (d.lookAwake !== undefined) look.kitchen.awake = t.checked;
  else if (d.lookDim !== undefined) look.kitchen.dim = t.checked;
  else return;
  saveLook();
  renderNav();
});

document.addEventListener('submit', guard(async (e) => {
  if (e.target.id !== 'household-name-form') return;
  e.preventDefault();
  const { name } = formData(e.target);
  state.family = await api('/family', { method: 'PUT', body: { name: name || '' } });
  $('.brand-name').textContent = state.family.name || 'Family Planner';
  toast(state.family.name ? `Saved: ${state.family.name}` : 'Name cleared');
}));

// ---------- calendar and trips ----------
// School and club days (with the kit to pack), birthdays, one-off events and trips away.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const REPEAT_LABEL = { none: 'Once', weekly: 'Every week', yearly: 'Every year' };
const isoDay = (d = new Date()) => new Date(d).toISOString().slice(0, 10);
const dayLabel = (date, today) => {
  const n = Math.round((new Date(date + 'T12:00:00Z') - new Date(today + 'T12:00:00Z')) / 86400000);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  return new Date(date + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: n < 7 ? 'long' : 'short', day: 'numeric', month: 'short' });
};
const kidChecks = (selected = []) => state.family.children.length
  ? `<div class="field" style="margin-top:10px">Who<div class="chips" style="margin-top:4px">${state.family.children.map((c) =>
    `<label class="chip"><input type="checkbox" name="who" value="${esc(c.id)}" ${selected.includes(c.id) ? 'checked' : ''} style="width:auto"> ${esc(c.name)}</label>`).join('')}</div>
    <span class="hint">Leave empty for the whole family.</span></div>` : '';
const dayChecks = (selected = []) => `<div class="field" style="margin-top:10px">Which days<div class="chips" style="margin-top:4px">${[1, 2, 3, 4, 5, 6, 0].map((d) =>
  `<label class="chip"><input type="checkbox" name="days" value="${d}" ${selected.includes(d) ? 'checked' : ''} style="width:auto"> ${WEEKDAYS[d]}</label>`).join('')}</div></div>`;
// formData keeps only the last of several boxes with one name, so read checkboxes directly.
const checked = (root, name) => [...root.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);

async function renderCalendar() {
  const view = state.calView || 'calendar';
  $('#page').innerHTML = `
    <div class="seg" style="margin-bottom:16px">${[['calendar', '📅 Calendar'], ['trips', '🧳 Trips']].map(([k, l]) =>
      `<button data-cal-view="${k}" class="${view === k ? 'active' : ''}">${l}</button>`).join('')}</div>
    <div id="cal-body"></div>`;
  return view === 'trips' ? renderTrips() : renderCalendarList();
}

async function renderCalendarList() {
  const days = state.calDays || 14;
  const c = await api('/calendar?days=' + days);
  state.calendar = c;
  const kitCount = c.kitTomorrow.reduce((n, g) => n + g.items.length, 0);
  $('#page-sub').textContent = c.upcoming.length ? `${plural(c.upcoming.filter((o) => o.date <= isoDay(Date.now() + 6 * 86400000)).length, 'thing')} this week` : 'School days, clubs, birthdays and plans';
  const byDay = new Map();
  for (const o of c.upcoming) byDay.set(o.date, [...(byDay.get(o.date) || []), o]);
  const ev = (id) => c.events.find((e) => e.id === id);
  $('#cal-body').innerHTML = `
    <div class="split">
      <div class="stack">
        <div class="card" id="cal-upcoming">
          <div class="card-head"><h2>Coming up</h2><span class="muted small">Next ${days === 14 ? 'two' : 'six'} weeks</span></div>
          ${byDay.size ? [...byDay].map(([date, list]) => `<div class="group-title">${esc(dayLabel(date, c.today))}</div>
            <ul class="list">${list.map((o) => `<li class="row">
              <span class="emoji">${esc(o.emoji)}</span>
              <div class="grow"><div class="title">${esc(o.title)}${o.time ? ` <span class="pill plain">${esc(o.time)}</span>` : ''}</div>
                <div class="sub">${[o.whoNames.join(', '), o.kit.length ? `Take: ${o.kit.join(', ')}` : '', o.notes || ''].filter(Boolean).map(esc).join(' · ')}</div></div>
              ${o.eventId && ev(o.eventId)?.repeat === 'weekly' ? `<button class="btn ghost sm" data-cal-skip="${esc(o.eventId)}" data-date="${esc(o.date)}" title="Not happening this time">Skip</button>` : ''}
            </li>`).join('')}</ul>`).join('')
            + (days === 14 && c.upcoming.length ? '<p style="margin-top:10px"><button class="btn sm" data-cal-more>Show the next six weeks</button></p>' : '')
            : emptyState('📅', 'Nothing coming up yet. Add school and club days, or anything else, and the app reminds you the day before.')}
        </div>
      </div>
      <div class="stack">
        <div class="card" id="cal-kit">
          <div class="card-head"><h2>🎒 Bags for tomorrow</h2>${kitCount ? `<span class="muted small">${plural(kitCount, 'thing')}</span>` : ''}</div>
          ${c.kitTomorrow.length ? `<ul class="list">${c.kitTomorrow.map((g) => `<li class="row"><div class="grow"><div class="title">${esc(g.name)} · ${esc(g.events.join(', '))}</div><div class="sub">${esc(g.items.join(', '))}</div></div></li>`).join('')}</ul>`
            : '<p class="hint">Nothing special to pack for tomorrow.</p>'}
        </div>
        <div class="card">
          <div class="card-head"><h2>Add a school or club day</h2></div>
          <p class="hint">Pick one, then choose the day and who it's for. The kit list can be changed.</p>
          <div class="chips" style="margin-top:8px">${c.starters.map((s) => `<button class="chip" data-cal-starter="${esc(s.key)}">${esc(s.emoji)} ${esc(s.title)}</button>`).join('')}</div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Add something else</h2></div>
          <form id="cal-form" class="stack">
            <label class="field">What<input name="title" placeholder="e.g. Parents' evening" required></label>
            <div class="form-row" style="grid-template-columns:1fr 1fr 1fr">
              <label class="field">Date<input name="date" type="date" value="${esc(c.today)}" required></label>
              <label class="field">Time<input name="time" type="time"></label>
              <label class="field">Repeats<select name="repeat">${Object.entries(REPEAT_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
            </div>
            ${kidChecks()}
            <label class="field">Things to take<input name="kit" placeholder="e.g. Costume, packed lunch (optional)"></label>
            <button class="btn primary">${icon('plus')} Add to the calendar</button>
          </form>
        </div>
        ${c.events.length ? `<div class="card" id="cal-events">
          <div class="card-head"><h2>Everything you've added</h2><span class="muted small">${plural(c.events.length, 'event')}</span></div>
          <ul class="list">${c.events.map((e) => `<li class="row ${e.paused ? 'done' : ''}">
            <span class="emoji">${esc(e.emoji || '📅')}</span>
            <div class="grow"><div class="title">${esc(e.title)}</div>
              <div class="sub">${esc(e.repeat === 'weekly' ? `Every ${e.days.map((d) => WEEKDAYS[d]).join(', ')}` : e.repeat === 'yearly' ? `Every year on ${fmtShort(e.date)}` : fmtDate(e.date))}${e.time ? ` at ${esc(e.time)}` : ''}${e.who.length ? ` · ${esc(e.who.map((id) => state.family.children.find((k) => k.id === id)?.name).filter(Boolean).join(', '))}` : ''}${e.paused ? ' · paused' : ''}</div></div>
            <button class="icon-btn" data-cal-edit="${esc(e.id)}" aria-label="Change ${esc(e.title)}">${icon('edit')}</button>
            <button class="icon-btn danger" data-cal-del="${esc(e.id)}" aria-label="Remove ${esc(e.title)}">${icon('trash')}</button></li>`).join('')}</ul>
          <p class="hint" style="margin-top:8px">Birthdays come from each child's birth date on the Family page.</p>
        </div>` : ''}
      </div>
    </div>`;
}

async function calendarStarter(key) {
  const s = state.calendar.starters.find((x) => x.key === key);
  const got = await ask({
    title: `${s.emoji} ${s.title}`,
    body: (s.repeat === 'weekly' ? dayChecks([new Date().getDay() || 1]) : field('date', 'Date', 'date', isoDay())) + kidChecks() +
      field('kit', 'Things to take', 'text', s.kit.join(', ')) + field('time', 'Time (optional)', 'time', ''),
    ok: 'Add',
  });
  if (!got) return;
  const form = $('#dialog-form');
  const body = { starter: key, who: checked(form, 'who'), kit: got.kit, time: got.time || null };
  if (s.repeat === 'weekly') {
    body.days = checked(form, 'days').map(Number);
    if (!body.days.length) return toast('Pick at least one day');
  } else body.date = got.date;
  await api('/calendar/events', { method: 'POST', body });
  toast(`${s.title} added`);
  renderCalendarList();
}

async function calendarEdit(id) {
  const e = state.calendar.events.find((x) => x.id === id);
  const got = await ask({
    title: 'Change event',
    body: field('title', 'What', 'text', e.title) +
      (e.repeat === 'weekly' ? dayChecks(e.days) : field('date', 'Date', 'date', e.date)) +
      field('time', 'Time', 'time', e.time || '') + kidChecks(e.who) + field('kit', 'Things to take', 'text', e.kit.join(', ')) +
      (e.repeat === 'weekly' ? field('until', 'Stops after (optional)', 'date', e.until || '') : '') +
      `<label class="field" style="margin-top:10px"><span><input type="checkbox" name="paused" ${e.paused ? 'checked' : ''} style="width:auto"> Pause it for now</span></label>`,
    ok: 'Save',
  });
  if (!got) return;
  const form = $('#dialog-form');
  const body = { title: got.title, time: got.time || null, who: checked(form, 'who'), kit: got.kit, paused: Boolean(got.paused) };
  if (e.repeat === 'weekly') Object.assign(body, { days: checked(form, 'days').map(Number), until: got.until || null });
  else body.date = got.date;
  await api('/calendar/events/' + encodeURIComponent(id), { method: 'PUT', body });
  toast('Saved');
  renderCalendarList();
}

// ---------- trips and packing ----------
async function renderTrips() {
  const { trips } = await api('/packing');
  state.trips = trips;
  const today = isoDay();
  const upcoming = trips.filter((t) => t.end >= today);
  const past = trips.filter((t) => t.end < today);
  if (!trips.some((t) => t.id === state.tripId)) state.tripId = upcoming[0]?.id || null;
  const trip = trips.find((t) => t.id === state.tripId);
  $('#page-sub').textContent = upcoming.length ? `${plural(upcoming.length, 'trip')} coming up` : 'Packing lists for trips away';
  $('#cal-body').innerHTML = `
    <div class="split">
      <div class="stack">${trip ? tripCard(trip) : `<div class="card">${emptyState('🧳', 'No trips planned. Add one and the app writes the packing list for everyone going, from the weather and each child\'s own clothes.')}</div>`}</div>
      <div class="stack">
        ${trips.length ? `<div class="card"><div class="card-head"><h2>Trips</h2></div><ul class="list">${[...upcoming, ...past].map((t) => `<li class="row ${t.end < today ? 'done' : ''}">
          <span class="emoji">🧳</span>
          <div class="grow"><div class="title">${esc(t.name)}</div><div class="sub">${esc(fmtShort(t.start))} to ${esc(fmtShort(t.end))} · ${esc(t.packedCount)}/${esc(t.items.length)} packed</div></div>
          ${t.id === state.tripId ? '<span class="pill">Showing</span>' : `<button class="btn ghost sm" data-trip="${esc(t.id)}">Open</button>`}</li>`).join('')}</ul></div>` : ''}
        <div class="card">
          <div class="card-head"><h2>Plan a trip</h2></div>
          <form id="trip-form" class="stack">
            <label class="field">Name<input name="name" placeholder="e.g. Half term in Cornwall" required></label>
            <label class="field">Where to (optional)<input name="destination" placeholder="e.g. St Ives"></label>
            <div class="form-row" style="grid-template-columns:1fr 1fr">
              <label class="field">Going<input name="start" type="date" value="${esc(today)}" required></label>
              <label class="field">Coming back<input name="end" type="date" value="${esc(isoDay(Date.now() + 2 * 86400000))}" required></label>
            </div>
            ${kidChecks(state.family.children.map((c) => c.id))}
            <div class="form-row" style="grid-template-columns:1fr 1fr">
              <label class="field">Weather<select name="feel"><option value="">Work it out</option><option value="hot">Hot</option><option value="mild">Mild</option><option value="cold">Cold</option></select></label>
              <div class="field">&nbsp;<div class="chips"><label class="chip"><input type="checkbox" name="rain" style="width:auto"> Rain likely</label><label class="chip"><input type="checkbox" name="abroad" style="width:auto"> Abroad</label></div></div>
            </div>
            <p class="hint">"Work it out" checks the forecast for where you're going when the trip is within two weeks, and otherwise guesses from the time of year.</p>
            <button class="btn primary">${icon('plus')} Make the packing list</button>
          </form>
        </div>
      </div>
    </div>`;
}

function tripCard(t) {
  const groups = new Map();
  for (const it of t.items) groups.set(it.group, [...(groups.get(it.group) || []), it]);
  const w = t.weatherUsed;
  const pct = t.items.length ? Math.round((t.packedCount / t.items.length) * 100) : 0;
  return `<div class="card" id="trip-card">
    <div class="card-head"><h2>🧳 ${esc(t.name)}</h2><span id="trip-by">${t.by ? `<span class="pill blue">✨ ${esc(t.by)}</span>` : ''}</span></div>
    <p class="muted small">${esc(fmtDate(t.start))} to ${esc(fmtDate(t.end))} · ${plural(t.nights, 'night')}${t.destination ? ` · ${esc(t.destination)}` : ''} ·
      ${w.feel === 'hot' ? '☀️ hot' : w.feel === 'cold' ? '🧣 cold' : '⛅ mild'}${w.tempC != null ? ` (about ${esc(w.tempC)}°)` : ''}${w.rain ? ', rain likely' : ''}${w.guessed ? ' (a guess from the time of year)' : ''}</p>
    <div class="bar" style="margin-top:10px"><span style="width:${pct}%"></span></div>
    <p class="hint" style="margin-top:4px">${esc(t.packedCount)} of ${esc(t.items.length)} packed</p>
    ${[...groups].map(([g, list]) => `<div class="group-title">${esc(g)}</div><ul class="list">${list.map((it) => `<li class="row ${it.packed ? 'done' : ''}">
      <button class="check ${it.packed ? 'on' : ''}" data-pack-toggle="${esc(it.id)}" data-state="${it.packed}" aria-label="${it.packed ? 'Unpack' : 'Packed'} ${esc(it.name)}">${icon('check')}</button>
      <div class="grow"><div class="title">${it.qty > 1 ? `${esc(it.qty)} × ` : ''}${esc(it.name)}</div>${it.detail ? `<div class="sub">${esc(it.detail)}</div>` : ''}</div>
      <button class="icon-btn danger" data-pack-del="${esc(it.id)}" aria-label="Remove ${esc(it.name)}">${icon('x')}</button></li>`).join('')}</ul>`).join('')}
    <form id="pack-form" class="form-row" style="grid-template-columns:2fr 1fr auto;margin-top:12px">
      <input name="name" placeholder="Add something" aria-label="Item" required>
      <select name="group" aria-label="For">${[...new Set(['Everyone', ...groups.keys()])].map((g) => `<option>${esc(g)}</option>`).join('')}</select>
      <button class="btn">${icon('plus')}</button>
    </form>
    <p style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn sm" data-trip-rebuild>${state.ai?.suggestions ? '✨ Ask the AI again' : 'Start the list again'}</button>
      ${t.packedCount ? '<button class="btn sm" data-trip-reset>Untick all (for the way home)</button>' : ''}
      <button class="btn sm ghost danger" data-trip-del="${esc(t.id)}">Delete trip</button>
    </p>
  </div>`;
}

// The forecast for a destination, when the trip starts within the forecast's two weeks.
async function tripWeather(place, start, end) {
  const days = Math.round((new Date(start + 'T12:00:00Z') - new Date(isoDay() + 'T12:00:00Z')) / 86400000);
  if (!place || days < 0 || days > 13) return null;
  try {
    const g = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`).then((x) => x.json());
    const loc = g.results && g.results[0];
    if (!loc) return null;
    const j = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=temperature_2m_max,precipitation_probability_max&timezone=auto&start_date=${start}&end_date=${end < isoDay(Date.now() + 15 * 86400000) ? end : isoDay(Date.now() + 15 * 86400000)}`).then((x) => x.json());
    const max = j.daily.temperature_2m_max.filter((n) => n != null);
    if (!max.length) return null;
    const avg = Math.round(max.reduce((a, b) => a + b, 0) / max.length);
    const rain = j.daily.precipitation_probability_max.some((p) => p >= 50);
    return { feel: avg >= 20 ? 'hot' : avg < 12 ? 'cold' : 'mild', tempC: avg, rain };
  } catch {
    return null;
  }
}

// With an AI on, it writes the trip's list; what's already ticked stays ticked.
async function aiPacking(tripId, refresh = false) {
  if (!(state.ai || (state.ai = await api('/ai/settings'))).suggestions) return false;
  const by = $('#trip-by');
  if (by) by.innerHTML = '<span class="muted small">✨ Asking the AI to write the list…</span>';
  const r = await aiSuggest('packing', { tripId }, { refresh });
  if (!r || r.error || !r.items?.length) {
    if (by) by.innerHTML = r?.error ? `<span class="muted small">The AI couldn't help just now, so this list comes from the app's own rules.</span>` : '';
    return false;
  }
  await api(`/packing/trips/${encodeURIComponent(tripId)}/rebuild`, { method: 'POST', body: { items: r.items, by: r.by } });
  return true;
}

// ---------- kids' own view ----------
// Big buttons for children: their chores today, points, what to take, tonight's dinner.
async function renderKids() {
  const [cv, cal, d] = await Promise.all([api('/chores'), api('/calendar?days=2'), api('/dashboard')]);
  state.chores = cv;
  const kids = state.family.children;
  document.body.classList.add('kids-mode');
  if (!kids.length) {
    $('#page').innerHTML = `<div class="card">${emptyState('👶', 'Add the children on the Family page first.', '<button class="btn primary" data-nav="family">Family</button>')}</div>`;
    return;
  }
  if (!kids.some((c) => c.id === state.kidView)) state.kidView = null;
  const pick = !state.kidView;
  const child = kids.find((c) => c.id === state.kidView);
  const exit = `<button class="btn" data-nav="${look.start === 'kids' ? 'settings' : 'chores'}">${icon('x')} ${look.start === 'kids' ? 'Settings' : 'Grown-ups'}</button>`;
  if (pick) {
    $('#page').innerHTML = `<div class="kids-head"><h1>Who's this?</h1>${exit}</div>
      <div class="kids-pick">${kids.map((c, i) => `<button class="kids-who" data-kid-view="${esc(c.id)}">${avatar(c, i)}<span>${esc(c.name)}</span></button>`).join('')}</div>`;
    return;
  }
  const i = kids.indexOf(child);
  const mine = cv.rota[0].items.filter((it) => it.who === child.id);
  const doneToday = cv.recent.filter((e) => e.at.slice(0, 10) === cv.today && e.by === child.id);
  const tot = cv.totals.find((t) => t.id === child.id) || { points: 0, done: 0 };
  const kit = cal.upcoming.filter((o) => o.kit.length && (!o.who.length || o.who.includes(child.id)) && o.date <= isoDay(Date.now() + 86400000));
  const birthday = cal.upcoming.find((o) => o.kind === 'birthday' && o.who.includes(child.id) && o.date === cal.today);
  const tonight = d.food.plan[0];
  $('#page').innerHTML = `
    <div class="kids-head">
      <h1>${avatar(child, i)} Hi ${esc(child.name)}!${birthday ? ' 🎂 Happy birthday!' : ''}</h1>
      <div style="display:flex;gap:8px"><button class="btn" data-kid-view="">Switch</button>${exit}</div>
    </div>
    <div class="kids-grid">
      <section class="card kids-card">
        <h2>🧹 Your jobs today</h2>
        ${mine.length ? mine.map((it) => `<button class="kids-job" data-kid-done="${esc(it.choreId)}">
          <span class="kids-job-emoji">${esc(it.emoji || '🧹')}</span><span class="grow">${esc(it.name)}</span><span class="kids-tick">${icon('check')} Done!</span></button>`).join('')
          : `<p class="kids-big">${doneToday.length ? '🎉 All done. Brilliant!' : 'No jobs today. 😎'}</p>`}
        ${doneToday.length && mine.length ? `<p class="muted" style="margin-top:8px">Done already: ${esc(doneToday.map((e) => e.name).join(', '))}</p>` : ''}
      </section>
      <section class="card kids-card">
        <h2>⭐ This week</h2>
        <p class="kids-points">${esc(tot.points)}<span> point${tot.points === 1 ? '' : 's'}</span></p>
        ${tot.money != null ? `<p class="kids-big">💰 ${moneyP(tot.money)} pocket money</p>` : ''}
        <p class="muted">${plural(tot.done, 'job')} done this week</p>
      </section>
      ${kit.length ? `<section class="card kids-card"><h2>🎒 Remember</h2>${kit.map((o) => `<p class="kids-big">${esc(o.emoji)} ${esc(o.title)} ${o.date === cal.today ? 'today' : 'tomorrow'}</p><p class="muted">${esc(o.kit.join(', '))}</p>`).join('')}</section>` : ''}
      ${tonight && !look.hidden.includes('food') ? `<section class="card kids-card"><h2>🍽️ Tonight's dinner</h2><p class="kids-big">${MEAL_EMOJI(tonight.name)} ${esc(tonight.name)}</p></section>` : ''}
    </div>`;
}

// ---------- kitchen screen ----------
// Full screen, big text, no tabs. Refreshes itself every minute (and straight away when
// someone else changes something); a tap ticks off a chore or a shopping item.
const kitchen = { wake: null, timer: null, clock: null };

async function renderKitchen() {
  state.ai = await api('/ai/settings');
  const k = look.kitchen;
  const want = (id) => k.panels.includes(id);
  const [d, shop, weather] = await Promise.all([api('/dashboard'), want('shopping') ? api('/shopping') : null, todaysWeather()]);
  state.shoppingCount = d.shoppingCount;
  const kids = d.family.children;
  const wq = weather && weather.tempC !== null ? `?tempC=${weather.tempC}&rain=${weather.rain ? 1 : 0}` : '';
  const outfits = want('outfits') && !look.hidden.includes('clothes')
    ? await Promise.all(kids.map((c) => api(`/clothes/outfit-of-the-day/${encodeURIComponent(c.id)}${wq}`).catch(() => null)))
    : [];
  const off = (tool) => look.hidden.includes(tool);
  const panel = (id, title, body, extra = '') => `<section class="card k-panel" id="k-${id}"><div class="card-head"><h2>${title}</h2>${extra}</div>${body}</section>`;
  const tonight = d.food.plan[0];
  const panels = {
    dinner: () => off('food') ? '' : panel('dinner', "🍽️ Tonight's dinner", tonight
      ? `<div class="k-dinner"><span class="k-dinner-emoji">${MEAL_EMOJI(tonight.name)}</span><div><div class="k-big" id="k-dinner-name">${esc(tonight.name)}</div>
          <div class="muted">${[d.food.plan[1] && `Tomorrow: ${esc(d.food.plan[1].name)}`, d.food.plan[2] && `then ${esc(d.food.plan[2].name)}`].filter(Boolean).join(' · ')}</div></div></div>`
      : '<p class="k-empty">Nothing planned: something needs buying first.</p>'),
    chores: () => off('chores') ? '' : panel('chores', "🧹 Today's chores", d.chores.todayList.length
      ? `<ul class="list">${d.chores.todayList.slice(0, 8).map(choreRow).join('')}</ul>${d.chores.todayList.length > 8 ? `<p class="hint">+${d.chores.todayList.length - 8} more</p>` : ''}`
      : `<p class="k-empty">🎉 All done for today${d.chores.doneToday ? ` (${plural(d.chores.doneToday, 'chore')})` : ''}.</p>`,
      d.chores.totals?.some((t) => t.points) ? `<span class="muted small">${d.chores.totals.filter((t) => t.points).sort((a, b) => b.points - a.points).slice(0, 3).map((t) => `${esc(t.name)} ${esc(t.points)}`).join(' · ')} pts</span>` : ''),
    shopping: () => off('shopping') || !shop ? '' : (() => {
      const open = shop.items.filter((i) => !i.done);
      return panel('shopping', '🛒 Shopping list', open.length
        ? `<ul class="list k-shop">${open.slice(0, 12).map((it) => `<li class="row"><button class="check" data-toggle="${esc(it.id)}" data-state="false" aria-label="Tick ${esc(it.name)}">${icon('check')}</button>
            <div class="grow title">${it.quantity ? esc(it.quantity) + ' × ' : ''}${esc(cap(it.name))}${it.size ? ` <span class="pill plain">${esc(it.size)}</span>` : ''}</div></li>`).join('')}</ul>${open.length > 12 ? `<p class="hint">+${open.length - 12} more</p>` : ''}`
        : '<p class="k-empty">Nothing on the list.</p>', `<span class="muted small">${plural(open.length, 'thing')}</span>`);
    })(),
    food: () => off('food') || !d.food.expiringSoon.length ? '' : panel('food', '⏰ Use soon', `<div class="chips">${d.food.expiringSoon.map((e) =>
      `<span class="pill k-pill ${e.days < 0 ? 'bad' : 'warn'}">${foodCat(e.name).emoji} ${esc(e.name)} · ${e.days < 0 ? 'out of date' : e.days === 0 ? 'today' : e.days === 1 ? 'tomorrow' : 'in ' + plural(e.days, 'day')}</span>`).join('')}</div>`),
    outfits: () => !outfits.length ? '' : panel('outfits', '👕 Wear today', `<div class="k-outfits">${kids.map((c, i) => {
      const o = outfits[i]?.outfit;
      return `<div class="k-kid" data-kid-outfit="${esc(c.id)}"><div class="k-kid-name">${avatar(c, i)} ${esc(c.name)}</div>${o
        ? `<div class="k-garments">${o.items.map((g) => `<span class="k-garment" title="${esc(g.name)}"><span class="tile" style="background:${esc(cssColour(g.colour))}">${GARMENT[g.type] || '👕'}</span>${esc(g.name)}</span>`).join('')}</div>`
        : '<p class="muted small">No clean outfit that fits.</p>'}</div>`;
    }).join('')}</div>`),
    calendar: () => off('calendar') || !(d.calendar.todayList.length || d.calendar.tomorrowList.length) ? '' : panel('calendar', '📅 Today and tomorrow',
      `<ul class="list">${[...d.calendar.todayList, ...d.calendar.tomorrowList].slice(0, 8).map((o) => `<li class="row"><span class="emoji">${esc(o.emoji)}</span>
        <div class="grow"><div class="title">${esc(o.title)}${o.time ? ` · ${esc(o.time)}` : ''}</div><div class="sub">${esc(o.date === d.calendar.today ? 'Today' : 'Tomorrow')}${o.whoNames.length ? ` · ${esc(o.whoNames.join(', '))}` : ''}${o.kit.length ? ` · take ${esc(o.kit.join(', '))}` : ''}</div></div></li>`).join('')}</ul>`),
    reminders: () => !d.reminders.length ? '' : panel('reminders', '🔔 Reminders', reminderList(d.reminders, 4)),
    week: () => off('food') ? '' : panel('week', "📅 The week's dinners", weekStrip(d.food.plan)),
  };
  const now = new Date();
  const body = k.panels.map((id) => panels[id]?.() || '').join('');
  $('#page').innerHTML = `
    <div class="k-head">
      <div><div class="k-clock" id="k-clock">${kitchenTime(now)}</div><div class="k-date">${now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
      <div class="k-title">${esc(d.family.name || 'Family Planner')}${weather && weather.tempC !== null ? `<div class="k-weather">${weather.rain ? '🌧️' : weather.tempC < 12 ? '🧣' : weather.tempC >= 20 ? '☀️' : '⛅'} ${esc(weather.min)}° to ${esc(weather.max)}°${weather.rain ? ' · rain likely' : ''}</div>` : ''}</div>
      <div class="k-actions">
        <button class="btn primary k-ask" data-ask-open>${icon('chat')} Ask</button>
        ${document.fullscreenEnabled ? `<button class="btn" data-k-full aria-label="Full screen">${icon('upload')} Full screen</button>` : ''}
        <button class="btn" data-nav="${look.start === 'kitchen' ? 'settings' : 'home'}">${icon('x')} ${look.start === 'kitchen' ? 'Settings' : 'Exit'}</button>
      </div>
    </div>
    <div class="k-grid">${body || '<section class="card k-panel"><p class="k-empty">Pick what to show in Settings > Kitchen screen.</p></section>'}</div>`;
  kitchenOn();
  // With an AI on, tonight's dinner comes from the AI's week, like on Home.
  if (want('dinner') && !off('food') && state.ai.suggestions) {
    const r = await aiSuggest('meals');
    const m = r && !r.error && r.week?.[0];
    if (m && $('#k-dinner-name')) $('#k-dinner-name').innerHTML = `${esc(m.name)} <span class="pill blue">✨ AI</span>`;
  }
}

const kitchenTime = (d) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function kitchenOn() {
  const k = look.kitchen;
  const night = () => { const h = new Date().getHours(); return k.dim && (h >= 22 || h < 6); };
  document.body.classList.toggle('kitchen-night', night());
  clearInterval(kitchen.clock);
  kitchen.clock = setInterval(() => {
    const c = $('#k-clock');
    if (c) c.textContent = kitchenTime(new Date());
    document.body.classList.toggle('kitchen-night', night());
  }, 10000);
  clearInterval(kitchen.timer);
  kitchen.timer = setInterval(() => {
    if (state.page === 'kitchen' && !$('#dialog').open && document.visibilityState === 'visible') refresh();
  }, 60000);
  if (k.awake && 'wakeLock' in navigator && !kitchen.wake) {
    navigator.wakeLock.request('screen').then((w) => {
      kitchen.wake = w;
      w.addEventListener('release', () => { kitchen.wake = null; });
    }).catch(() => {});
  }
}

function kitchenOff() {
  clearInterval(kitchen.clock);
  clearInterval(kitchen.timer);
  kitchen.clock = kitchen.timer = null;
  document.body.classList.remove('kitchen-night');
  kitchen.wake?.release().catch(() => {});
  kitchen.wake = null;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

// The screen lock is dropped when the tab is hidden; take it again on return.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.page === 'kitchen') kitchenOn();
});
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-k-full]')) document.documentElement.requestFullscreen?.().catch(() => {});
});

// ---------- demo ----------
// A made-up family (the Parkers) to show the app off as if it were in daily use. Hidden:
// tap "Family Planner" at the bottom of Settings five times. While it's on, a banner shows
// on every page, and the household's own data waits, untouched, until the demo ends.
function demoBanner() {
  const b = $('#demo-banner');
  if (!b) return;
  b.hidden = !state.demo?.on;
  b.innerHTML = state.demo?.on ? `<span>🎬 <strong>Demo</strong>: showing a sample family. Your own data is safe.</span> <button class="btn sm" data-demo="stop">Leave demo</button>` : '';
}

function demoCard() {
  const on = state.demo?.on;
  return `
      <div class="card" id="demo-card" ${on || state.demoUnlocked ? '' : 'hidden'}>
        <div class="card-head"><h2>🎬 Demo</h2>${on ? '<span class="pill warn">On</span>' : ''}</div>
        <p class="hint">${on
    ? 'The app is showing the Parker family: three children, a stocked kitchen, wardrobes, a shopping list, chores and a few weeks of history. Change anything you like; none of it is kept.'
    : 'Fill the app with a sample family to show how it looks in daily use. Your own data is put aside and comes back exactly as it was when you leave the demo.'}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          ${on
    ? `<button class="btn primary" data-demo="stop">Leave demo</button><button class="btn" data-demo="start">Start the demo again</button>`
    : `<button class="btn primary" data-demo="start">Show the demo</button>`}
        </div>
      </div>`;
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#about-line')) aboutTapped();
});

function aboutTapped() {
  const now = Date.now();
  state.aboutTaps = (state.aboutTaps || []).filter((t) => now - t < 3000).concat(now);
  if (state.aboutTaps.length < 5 || state.demoUnlocked) return;
  state.demoUnlocked = true;
  const card = $('#demo-card');
  if (card) {
    card.hidden = false;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

async function demoAction(what) {
  if (what === 'start') {
    if (!state.demo?.on && !(await ask({
      title: 'Show the demo?',
      body: '<p class="muted">The app will show a sample family instead of yours. Your own data is put aside, nothing is saved online while the demo is on, and everything comes back when you tap <strong>Leave demo</strong>.</p>',
      ok: 'Show the demo',
    }))) return;
    await api('/demo/start', { method: 'POST' });
    state.weather = null;
    toast(state.demo?.on ? 'Demo started again' : 'Demo on: meet the Parkers');
    return go('home');
  }
  await api('/demo/stop', { method: 'POST' });
  state.demoUnlocked = false;
  state.weather = null;
  toast('Demo off: your own data is back');
  if (ACCOUNT) ACCOUNT.syncNow?.().catch?.(() => {});
  return go(state.page === 'settings' ? 'settings' : 'home');
}

// ---------- photos, barcodes, AI ----------
function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files[0] || null), { once: true });
    input.click();
  });
}

// Shrink a phone photo before sending it: smaller, faster and cheaper for the AI.
async function photoToDataUrl(file, max = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function aiScan(kind) {
  const ai = state.ai || await api('/ai/settings');
  if (!ai.ready) {
    if (await ask({ title: 'Set up an AI first', body: '<p class="muted">Photo scanning needs an AI. You can pick one in Settings.</p>', ok: 'Open Settings' })) go('settings');
    return;
  }
  const file = await pickFile('image/*');
  if (!file) return;
  toast('Reading the photo…');
  const image = await photoToDataUrl(file);
  const { items } = await api('/ai/scan', { method: 'POST', body: { kind, image } });
  if (!items.length) return toast('Nothing recognised in that photo');
  const child = state.family.children.find((c) => c.id === state.childId);
  const rows = items.map((it, i) => kind === 'food'
    ? `<div class="ing-row" style="grid-template-columns:auto 1fr 80px 80px">
        <input type="checkbox" name="keep-${i}" checked style="width:auto">
        <input name="name-${i}" value="${esc(it.name)}">
        <input name="quantity-${i}" type="number" step="any" min="0" value="${esc(it.quantity)}" placeholder="?">
        <select name="unit-${i}">${options(state.units, it.unit)}</select></div>`
    : `<div class="ing-row" style="grid-template-columns:auto 1fr auto">
        <input type="checkbox" name="keep-${i}" checked style="width:auto">
        <input name="name-${i}" value="${esc(it.name)}">
        <span class="small muted">${GARMENT[it.type] || ''} ${esc(it.colour)}</span></div>`).join('');
  const res = await ask({
    title: kind === 'food' ? `Found ${plural(items.length, 'item')}` : `Add to ${child.name}'s wardrobe?`,
    body: `<div class="stack">${rows}</div>${kind === 'clothes' ? `<p class="hint" style="margin-top:10px">They'll be added in size ${esc(child.clothingSize || '?')}. You can change it after.</p>` : ''}`,
    ok: 'Add these',
  });
  if (!res) return;
  const picked = items.map((it, i) => ({ it, i })).filter(({ i }) => res[`keep-${i}`]);
  if (!picked.length) return;
  if (kind === 'food') {
    await api('/food/items/bulk', { method: 'POST', body: { items: picked.map(({ i }) => ({ name: res[`name-${i}`], quantity: res[`quantity-${i}`], unit: res[`unit-${i}`] })) } });
  } else {
    await api('/clothes/items/bulk', { method: 'POST', body: { items: picked.map(({ it, i }) => ({ ...it, name: res[`name-${i}`], childId: child.id, size: child.clothingSize })) } });
  }
  toast(`Added ${plural(picked.length, 'item')}`);
  await refresh();
}

// Camera scanning where the browser supports it (Chrome on Android, the iPhone app),
// typing the number everywhere else.
async function scanBarcode() {
  const canScan = 'BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia;
  let stream = null;
  let stop = false;
  const dlg = $('#dialog');
  const done = ask({
    title: 'Scan a barcode',
    ok: 'Look up',
    body: `${canScan ? '<video id="bc-video" playsinline muted style="width:100%;border-radius:12px;background:#000;aspect-ratio:4/3;object-fit:cover"></video>' : ''}
      <label class="field" style="margin-top:10px">${canScan ? 'Or type the number' : 'Barcode number (under the stripes)'}<input name="code" inputmode="numeric" pattern="[0-9]*" autocomplete="off"></label>`,
  });
  if (canScan) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const video = $('#bc-video');
      video.srcObject = stream;
      await video.play();
      const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      (async function loop() {
        if (stop || !dlg.open) return;
        const codes = await detector.detect(video).catch(() => []);
        if (codes.length) {
          $('#dialog-form [name=code]').value = codes[0].rawValue;
          dlg.close('ok');
          return;
        }
        setTimeout(loop, 250);
      })();
    } catch {
      $('#bc-video')?.remove();
    }
  }
  const res = await done;
  stop = true;
  stream?.getTracks().forEach((t) => t.stop());
  const code = res && String(res.code || '').trim();
  if (!code) return;
  let product;
  try {
    product = await api('/food/barcode/' + encodeURIComponent(code));
  } catch (e) {
    toast(e.message === 'Product not found' ? 'Not found. Add it by name instead.' : e.message);
    return;
  }
  const add = await ask({
    title: product.name,
    ok: 'Add to cupboard',
    body: `${product.brand ? `<p class="muted">${esc(product.brand)}${product.packSize ? ' · ' + esc(product.packSize) : ''}</p>` : ''}
      <label class="field" style="margin-top:10px">Name<input name="name" value="${esc(product.name)}"></label>
      <div class="form-row" style="grid-template-columns:1fr 1fr;margin-top:10px">
        <label class="field">Amount<input name="quantity" type="number" step="any" min="0" value="${esc(product.quantity)}"></label>
        <label class="field">Unit<select name="unit">${options(state.units, product.unit)}</select></label></div>
      <label class="field" style="margin-top:10px">Use by (optional)<input name="expiry" type="date"></label>`,
  });
  if (!add) return;
  await api('/food/items', { method: 'POST', body: add });
  toast(`Added ${add.name}`);
  await refresh();
}

async function getIdeas(request) {
  state.aiBusy = true;
  await renderFood();
  try {
    const r = await api('/ai/meal-ideas', { method: 'POST', body: { request } });
    state.aiIdeas = r.ideas;
    if (!r.ideas.length) toast('No ideas came back. Try again.');
  } finally {
    state.aiBusy = false;
    await renderFood();
  }
}

function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch {
    await ask({ title: 'Copy this', body: `<textarea rows="8" style="width:100%">${esc(text)}</textarea>`, ok: 'Done' });
  }
}

// Second click/change/submit handlers for the newer features.
document.addEventListener('click', guard(async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  const d = t.dataset;
  if (t.hasAttribute('data-barcode')) return scanBarcode();
  if (d.aiScan) return aiScan(d.aiScan);
  if (d.fav) {
    await api(`/food/recipes/${d.fav}/favourite`, { method: 'PUT', body: { favourite: d.state !== 'true' } });
    return renderFood();
  }
  if (d.saveIdea) {
    const idea = state.aiIdeas[Number(d.saveIdea)];
    await api('/ai/meal-ideas/save', { method: 'POST', body: { idea } });
    toast(`Saved ${idea.name} to your recipes`);
    t.disabled = true;
    return;
  }
  if (d.wash) {
    await api('/clothes/items/' + d.wash, { method: 'PUT', body: { inWash: d.state !== 'true' } });
    return renderClothes();
  }
  if (d.laundryDone) {
    const r = await api('/clothes/laundry/done', { method: 'POST', body: { childId: d.laundryDone } });
    toast(`${plural(r.cleaned, 'item')} back in the drawer`);
    return renderClothes();
  }
  if (d.handdown) {
    await api(`/clothes/items/${d.handdown}/hand-down`, { method: 'POST', body: { childId: d.to } });
    toast('Passed on');
    return refresh();
  }
  if (d.sell) {
    const it = state.sellable.find((x) => x.id === d.sell);
    return copyText(listingText(it));
  }
  if (d.diet) {
    const cur = new Set(state.family.dietary);
    cur.has(d.diet) ? cur.delete(d.diet) : cur.add(d.diet);
    await api('/family', { method: 'PUT', body: { dietary: [...cur] } });
    return refresh();
  }
  if (d.place) {
    const p = state.places[Number(d.place)];
    await api('/family', { method: 'PUT', body: { location: { name: p.name, lat: p.latitude, lon: p.longitude } } });
    state.weather = null;
    toast(`Weather from ${p.name}`);
    return refresh();
  }
  if (t.hasAttribute('data-clear-location')) {
    await api('/family', { method: 'PUT', body: { location: null } });
    return refresh();
  }
  if (t.hasAttribute('data-geolocate')) {
    const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000 }))
      .catch(() => { throw new Error('Could not get your location'); });
    // Rounded to about 1 km: plenty for a forecast, less precise than a home address.
    const lat = Math.round(pos.coords.latitude * 100) / 100;
    const lon = Math.round(pos.coords.longitude * 100) / 100;
    await api('/family', { method: 'PUT', body: { location: { name: 'Near you', lat, lon } } });
    state.weather = null;
    return refresh();
  }
  if (t.hasAttribute('data-ai-test')) {
    const r = await api('/ai/test', { method: 'POST' });
    return toast(r.ok ? `It works${r.by ? ` (${r.by})` : ''}` : 'Got a reply, but not the expected one');
  }
  if (t.hasAttribute('data-export')) {
    const backup = await api('/export');
    return download(`family-planner-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 2));
  }
  if (t.hasAttribute('data-import')) {
    const file = await pickFile('application/json,.json');
    if (!file) return;
    let backup;
    try { backup = JSON.parse(await file.text()); } catch { throw new Error('That file is not a backup'); }
    if (!(await ask({ title: 'Restore this backup?', body: `<p class="muted">Made ${backup.exportedAt ? fmtDate(backup.exportedAt) : 'at an unknown date'}. It replaces everything here now.</p>`, ok: 'Restore', danger: true }))) return;
    await api('/import', { method: 'POST', body: backup });
    toast('Restored');
    return refresh();
  }
  if (t.dataset.guide === 'skip') {
    setGuide('skip');
    toast('No problem. Add things whenever you like from each tab.');
    return refresh();
  }
  if (t.hasAttribute('data-account')) return accountAction(t.dataset.account);
  if (t.hasAttribute('data-demo')) return demoAction(t.dataset.demo);
  if (t.hasAttribute('data-copy-list') || t.hasAttribute('data-share-list')) {
    const { items } = await api('/shopping');
    const text = shoppingText(items);
    if (t.hasAttribute('data-share-list') && navigator.share) return navigator.share({ title: 'Shopping list', text }).catch(() => {});
    return copyText(text);
  }
}));

document.addEventListener('change', guard(async (e) => {
  const el = e.target;
  if (el.matches('[data-ai-suggestions]')) {
    await api('/ai/settings', { method: 'PUT', body: { useForSuggestions: el.checked } });
    state.ai = null;
    toast(el.checked ? 'Suggestions now come from the AI' : "Suggestions now come from the app's own rules");
    return renderSettings();
  }
  if (el.matches('[data-ondevice]')) {
    await api('/ai/settings', { method: 'PUT', body: { onDevice: el.checked } });
    return renderSettings();
  }
  if (el.form?.id === 'ai-form' && el.name === 'provider') {
    await api('/ai/settings', { method: 'PUT', body: { provider: el.value } });
    return renderSettings();
  }
}));

document.addEventListener('submit', guard(async (e) => {
  const form = e.target;
  if (!['ai-ideas-form', 'town-form', 'ai-form', 'prices-form'].includes(form.id)) return;
  e.preventDefault();
  const body = formData(form);
  if (form.id === 'ai-ideas-form') return getIdeas(body.request);
  if (form.id === 'town-form') {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(body.town)}&count=5&language=en&format=json`).then((x) => x.json());
    state.places = r.results || [];
    $('#town-results').innerHTML = state.places.length
      ? state.places.map((p, i) => `<button type="button" class="chip" data-place="${i}">${esc(p.name)}${p.admin1 ? ', ' + esc(p.admin1) : ''}${p.country_code ? ' ' + esc(p.country_code) : ''}</button>`).join('')
      : '<span class="hint">No places found</span>';
    return;
  }
  if (form.id === 'ai-form') {
    // In case a browser still fills in the sign-in details here.
    if (/@/.test(body.model || '')) throw new Error("That's an email address, not a model name. Clear the Model box and try again.");
    if (body.apiKey && /@/.test(body.apiKey) && !/^sk-/.test(body.apiKey)) throw new Error("That's not an API key. Clear the API key box and paste your key.");
    const send = { model: body.model, baseUrl: body.baseUrl, monthlyLimit: body.monthlyLimit, chatLimit: body.chatLimit };
    if (body.apiKey) send.apiKey = body.apiKey;
    for (const k of Object.keys(send)) if (send[k] === undefined) delete send[k];
    await api('/ai/settings', { method: 'PUT', body: send });
    toast('AI settings saved');
    return renderSettings();
  }
  if (form.id === 'prices-form') {
    await api('/clothes/prices', { method: 'PUT', body: Object.fromEntries(Object.entries(body).filter(([, v]) => v !== '')) });
    toast('Prices saved');
    return renderSettings();
  }
}));

function shoppingText(items) {
  const open = items.filter((i) => !i.done);
  const names = Object.fromEntries(state.family.children.map((c) => [c.id, c.name]));
  const line = (i) => `• ${i.quantity ? i.quantity + ' × ' : ''}${cap(i.name)}${i.size ? ` (${i.size})` : ''}${i.childId && names[i.childId] ? ` for ${names[i.childId]}` : ''}`;
  const part = (kind, title) => {
    const list = open.filter((i) => (i.kind || 'other') === kind);
    return list.length ? `${title}\n${list.map(line).join('\n')}` : '';
  };
  return [part('food', 'Food'), part('clothes', 'Clothes'), part('other', 'Other')].filter(Boolean).join('\n\n') || 'Nothing on the list';
}

const SHOPS = [
  ['Tesco', (q) => `https://www.tesco.com/groceries/en-GB/search?query=${encodeURIComponent(q)}`],
  ["Sainsbury's", (q) => `https://www.sainsburys.co.uk/gol-ui/SearchResults/${encodeURIComponent(q)}`],
  ['Ocado', (q) => `https://www.ocado.com/search?entry=${encodeURIComponent(q)}`],
];

// ---------- Ask (the chat) ----------
// A panel that slides up over any page. Type (or dictate, or send a photo) and it changes the
// lists for you through /api/v1/chat, or answers from the family's data. Each change shows as
// a card with Undo; deletes wait for Yes. The conversation stays on this device for 7 days
// ('fp-chat' in localStorage) and never goes into the household's shared data.
const CHAT_KEY = 'fp-chat';
const CHAT_DAYS = 7;
const chat = { open: false, busy: false, messages: [], queue: [], info: null, inbox: [] };
(function chatLoad() {
  try {
    const v = JSON.parse(localStorage.getItem(CHAT_KEY) || '{}') || {};
    const since = Date.now() - CHAT_DAYS * 86400000;
    chat.messages = (Array.isArray(v.messages) ? v.messages : []).filter((m) => m && new Date(m.at).getTime() > since);
    chat.queue = Array.isArray(v.queue) ? v.queue : [];
  } catch {}
})();
function chatSave() {
  try { localStorage.setItem(CHAT_KEY, JSON.stringify({ messages: chat.messages.slice(-80), queue: chat.queue.slice(-20) })); } catch {}
}
const chatAllowed = () => !['kids'].includes(state.page);
const chatId = () => Math.random().toString(36).slice(2, 10);

// Ideas to tap when the box is empty, for the time of day.
function chatStarters() {
  const h = new Date().getHours();
  const list = [];
  if (h < 10) list.push("What's on today?", 'What should the kids wear?');
  else if (h >= 15 && h < 19) list.push("What's for dinner?", 'Is anything going off?');
  else if (h >= 19) list.push("What's on tomorrow?", 'Plan dinners for the week');
  else list.push("What's on this week?", "What's for dinner?");
  if ((state.shoppingCount || 0) < 3) list.push('Add to shopping: ');
  else list.push("What's on the list?");
  if (state.family?.children?.length) list.push(`${state.family.children[0].name} did their chores`);
  list.push('How do I invite someone?');
  return list.slice(0, 5);
}

function renderChatShell() {
  if ($('#ask-panel')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <button id="ask-fab" class="ask-fab" type="button" data-ask-open aria-label="Ask" hidden>${icon('chat')}<span>Ask</span><i class="ask-dot" hidden></i></button>
    <section id="ask-panel" class="ask-panel" role="dialog" aria-modal="false" aria-labelledby="ask-title" hidden>
      <header class="ask-head">
        <div><h2 id="ask-title">Ask</h2><div class="ask-mode muted small" id="ask-mode"></div></div>
        <div class="ask-head-actions">
          <button class="btn sm ghost" type="button" data-ask-clear>Clear</button>
          <button class="btn sm ghost" type="button" data-ask-close aria-label="Close">${icon('x')}</button>
        </div>
      </header>
      <div class="ask-log" id="ask-log" aria-live="polite"></div>
      <form class="ask-form" id="ask-form" autocomplete="off">
        <button class="ask-tool" type="button" data-ask-photo aria-label="Send a photo of a receipt or the fridge" title="Photo of a receipt or the fridge">${icon('camera')}</button>
        <textarea id="ask-input" rows="1" maxlength="2000" placeholder="Ask or tell me…" enterkeyhint="send" aria-label="Message"></textarea>
        <button class="ask-tool" type="button" data-ask-mic aria-label="Talk" title="Talk" hidden>${icon('mic')}</button>
        <button class="ask-send" type="submit" aria-label="Send">${icon('send')}</button>
      </form>
      <p class="ask-hint" id="ask-hint"></p>
    </section>`);
  $('#ask-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const box = $('#ask-input');
    const text = box.value;
    box.value = '';
    chatGrow();
    chatSend(text);
  });
  $('#ask-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $('#ask-form').requestSubmit();
    }
  });
  $('#ask-input').addEventListener('input', chatGrow);
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  // On an iPhone home screen app the browser's own speech recognition is unreliable, so the
  // keyboard's dictation mic is the way to talk there.
  const standaloneIOS = /iPhone|iPad/.test(navigator.userAgent) && (navigator.standalone || matchMedia('(display-mode: standalone)').matches);
  if (Speech && !standaloneIOS) $('[data-ask-mic]').hidden = false;
  $('#ask-hint').textContent = matchMedia('(pointer: coarse)').matches ? 'To talk, tap the microphone on your keyboard.' : '';
}
function chatGrow() {
  const box = $('#ask-input');
  if (!box) return;
  box.style.height = 'auto';
  box.style.height = Math.min(box.scrollHeight, 140) + 'px';
}

function chatShowFab() {
  renderChatShell();
  const fab = $('#ask-fab');
  fab.hidden = !chatAllowed() || state.page === 'kitchen' || chat.open;
  fab.querySelector('.ask-dot').hidden = !chat.inbox.length && !chat.queue.length;
}

async function chatOpen() {
  renderChatShell();
  if (!chatAllowed()) return;
  chat.open = true;
  setMore(false);
  $('#ask-panel').hidden = false;
  document.body.classList.add('ask-open');
  chatShowFab();
  chat.info = await api('/chat').catch(() => null);
  chatRender();
  chatGrow();
  if (!matchMedia('(pointer: coarse)').matches) $('#ask-input').focus();
  await chatFlush();
}
function chatClose() {
  chat.open = false;
  if ($('#ask-panel')) $('#ask-panel').hidden = true;
  document.body.classList.remove('ask-open');
  chatShowFab();
}

function chatMode() {
  const i = chat.info;
  if (!i) return '';
  if (i.ai) return `✨ ${esc(i.model || 'AI')}${i.limit ? ` · ${esc(i.used)} of ${esc(i.limit)} this month` : ''}`;
  return i.ready ? 'Using the app’s own rules (AI suggestions are off in Settings)' : 'Using the app’s own rules · <button class="linkish" data-nav="settings">Add an AI</button> for anything else';
}

function chatRender() {
  if (!$('#ask-log')) return;
  $('#ask-mode').innerHTML = chatMode();
  const log = $('#ask-log');
  if (!chat.messages.length) {
    log.innerHTML = `<div class="ask-empty">
      <p class="muted">Tell me what you need, like “we’re out of milk and eggs”, “Leo did the bins” or “Mia has a party Saturday at 2”. Or ask “what’s on today?”.</p>
      <div class="chips">${chatStarters().map((s) => `<button class="chip" type="button" data-ask-say="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`;
  } else {
    log.innerHTML = chat.messages.map(chatBubble).join('') + (chat.busy ? '<div class="ask-msg helper"><div class="ask-bubble ask-typing" aria-label="Thinking"><i></i><i></i><i></i></div></div>' : '');
  }
  log.scrollTop = log.scrollHeight;
  chatShowFab();
}

function chatBubble(m) {
  if (m.role === 'me') return `<div class="ask-msg me"><div class="ask-bubble">${m.siri ? '<span class="pill plain">Siri</span> ' : ''}${esc(m.text)}${m.queued ? '<div class="small muted">Waiting for the internet</div>' : ''}</div></div>`;
  const changes = m.changes || [];
  const live = changes.filter((c) => !c.undone && c.undo && c.undo.length);
  return `<div class="ask-msg helper">
    <div class="ask-bubble">${esc(m.text)}</div>
    ${(m.pending || []).map((p, i) => `<div class="ask-card ask-confirm"><span class="emoji">❓</span><div class="grow">${esc(p.text)}</div>
      ${p.answer ? `<span class="muted small">${p.answer === 'yes' ? 'Done' : 'Left as it was'}</span>` : `<button class="btn sm coral" type="button" data-ask-yes="${esc(m.id)}:${i}">Yes</button><button class="btn sm ghost" type="button" data-ask-no="${esc(m.id)}:${i}">No</button>`}</div>`).join('')}
    ${changes.map((c, i) => `<div class="ask-card ${c.undone ? 'undone' : ''}"><span class="emoji">${esc(c.icon || '✓')}</span><div class="grow">${esc(c.text)}</div>
      ${c.undone ? '<span class="muted small">Undone</span>' : c.undo && c.undo.length ? `<button class="btn sm ghost" type="button" data-ask-undo="${esc(m.id)}:${i}">Undo</button>` : ''}</div>`).join('')}
    ${live.length > 1 ? `<div class="ask-row"><button class="btn sm ghost" type="button" data-ask-undo-all="${esc(m.id)}">Undo all ${live.length}</button></div>` : ''}
    ${m.check ? chatCheck(m) : ''}
    ${(m.failed || []).map((f) => `<div class="ask-card ask-failed"><span class="emoji">⚠️</span><div class="grow">${esc(f)}</div></div>`).join('')}
    ${(m.offers || []).length || (m.links || []).length ? `<div class="chips ask-row">${(m.offers || []).map((o) => `<button class="chip" type="button" data-ask-say="${esc(o)}">${esc(o)}</button>`).join('')}${(m.links || []).map((l) => `<button class="chip" type="button" data-ask-nav="${esc(l.page)}">${esc(l.label)} →</button>`).join('')}</div>` : ''}
    <div class="ask-by">${m.by === 'ai' ? `✨ AI${m.model ? ' · ' + esc(m.model) : ''}` : m.by === 'rules' ? 'Rules' : ''}</div>
  </div>`;
}

// A photo's items to check before adding: untick anything the AI got wrong.
function chatCheck(m) {
  const c = m.check;
  if (c.done) return `<div class="ask-card"><span class="emoji">✓</span><div class="grow">${esc(c.done)}</div></div>`;
  return `<div class="ask-check" data-check="${esc(m.id)}">
    <ul class="list">${c.items.map((it, i) => `<li class="row"><label class="grow"><input type="checkbox" data-check-item="${i}" checked> ${esc(it.name)}${it.quantity ? ` <span class="muted">${esc(it.quantity)}${it.unit && it.unit !== 'pcs' ? ' ' + esc(it.unit) : ''}</span>` : it.type ? ` <span class="muted">${esc(it.type)}${it.colour ? ', ' + esc(it.colour) : ''}</span>` : ''}</label></li>`).join('')}</ul>
    <div class="ask-row">${c.choices.map((ch, i) => `<button class="btn sm ${i ? '' : 'primary'}" type="button" data-ask-check="${esc(m.id)}:${i}">${esc(ch.label)}</button>`).join(' ')}</div></div>`;
}

const chatFind = (id) => chat.messages.find((m) => m.id === id);
// The undo list of the newest reply that still has something to undo ("undo that").
function chatLastUndo() {
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const m = chat.messages[i];
    const live = (m.changes || []).filter((c) => !c.undone && c.undo && c.undo.length);
    if (live.length) return { m, list: live.flatMap((c) => c.undo), live };
  }
  return null;
}

async function chatSend(text, extra = {}) {
  const msg = String(text || '').trim();
  if ((!msg && !extra.image) || chat.busy) return;
  const mine = { id: chatId(), role: 'me', text: extra.image ? (msg || '📷 Photo') : msg, at: new Date().toISOString(), ...(extra.siri ? { siri: true } : {}) };
  chat.messages.push(mine);
  chat.busy = true;
  chatRender();
  const history = chat.messages.slice(0, -1).slice(-8).map((m) => ({ role: m.role, text: m.text }));
  const last = chatLastUndo();
  try {
    const weather = state.family?.location ? await todaysWeather().catch(() => null) : null;
    const r = await api('/chat', { method: 'POST', body: {
      message: msg, history,
      ...(last ? { lastUndo: last.list } : {}),
      ...(weather && weather.tempC !== null ? { weather: { tempC: weather.tempC, rain: weather.rain } } : {}),
      ...(extra.image ? { image: extra.image, imageKind: extra.imageKind } : {}),
      ...(extra.mode ? { mode: extra.mode } : {}),
    } });
    // "Undo that" used the last reply's undo list: show those as undone.
    if (last && (r.changes || []).some((c) => c.icon === '↩️')) for (const c of last.live) c.undone = true;
    if (r.queued) {
      mine.queued = true;
      chat.queue.push({ id: mine.id, text: msg, at: mine.at });
    }
    chat.messages.push({ id: chatId(), role: 'helper', at: new Date().toISOString(), text: r.reply, by: r.by, model: r.model, changes: r.changes, pending: r.pending, failed: r.failed, offers: r.offers, links: r.links, check: r.check });
    if ((r.changes || []).length) chatChanged();
  } catch (e) {
    chat.messages.push({ id: chatId(), role: 'helper', at: new Date().toISOString(), text: e.message || 'Something went wrong. Try again?', failed: [] });
  } finally {
    chat.busy = false;
    chatSave();
    chatRender();
    if (chat.open) chat.info = await api('/chat').catch(() => chat.info);
    $('#ask-mode') && ($('#ask-mode').innerHTML = chatMode());
  }
}

// The page underneath shows the change straight away (when no dialog is open over it).
function chatChanged() {
  if (!$('#dialog').open) refresh().catch(() => {});
}

// Messages kept for the AI while offline, and sentences said to Siri, get sent now.
async function chatFlush() {
  if (navigator.onLine === false || chat.busy) return;
  if (chat.queue.length && chat.info?.ai) {
    const list = chat.queue.splice(0);
    chatSave();
    for (const q of list) {
      const m = chatFind(q.id);
      if (m) m.queued = false;
      await chatSend(q.text);
    }
  }
  if (!window.FamilyPlannerAccount?.status().email) return;
  const inbox = (await api('/chat/inbox').catch(() => ({ items: [] }))).items;
  if (!inbox.length) return;
  await api('/chat/inbox/done', { method: 'POST', body: { ids: inbox.map((m) => m.id) } }).catch(() => {});
  chat.inbox = [];
  for (const m of inbox) await chatSend(m.text, { siri: true });
}
async function chatCheckInbox() {
  if (!window.FamilyPlannerAccount?.status().email || state.demo?.on) return;
  chat.inbox = (await api('/chat/inbox').catch(() => ({ items: [] }))).items;
  chatShowFab();
}
window.addEventListener('online', () => { if (chat.open) chatFlush(); else chatShowFab(); });

async function chatUndo(changes) {
  const r = await api('/chat/undo', { method: 'POST', body: { changes } });
  if (r.kept) toast(`Undone, except ${plural(r.kept, 'thing')} someone has changed since`);
  chatChanged();
  return r;
}

async function chatPhoto() {
  const ai = state.ai || await api('/ai/settings');
  if (!ai.ready) return chatSend('read a photo', { mode: 'rules' }).then(() => toast('Reading photos needs an AI. Choose one in Settings.'));
  const file = await pickFile('image/*');
  if (!file) return;
  const kind = await ask({ title: 'What is the photo of?', body: `<div class="choices">
    <label><input type="radio" name="kind" value="food" checked> Food: a receipt, the fridge or shopping</label>
    <label><input type="radio" name="kind" value="clothes"> Clothes</label></div>`, ok: 'Send' });
  if (!kind) return;
  chatSend('', { image: await photoToDataUrl(file), imageKind: kind.kind });
}

document.addEventListener('click', guard(async (e) => {
  const t = e.target.closest('[data-ask-open],[data-ask-close],[data-ask-clear],[data-ask-say],[data-ask-nav],[data-ask-undo],[data-ask-undo-all],[data-ask-yes],[data-ask-no],[data-ask-check],[data-ask-photo],[data-ask-mic]');
  if (!t) return;
  if (t.matches('[data-ask-open]')) return chatOpen();
  if (t.matches('[data-ask-close]')) return chatClose();
  if (t.matches('[data-ask-clear]')) {
    chat.messages = [];
    chat.queue = [];
    chatSave();
    return chatRender();
  }
  if (t.matches('[data-ask-say]')) {
    const s = t.dataset.askSay;
    if (/:\s*$/.test(s)) {
      $('#ask-input').value = s;
      return $('#ask-input').focus();
    }
    return chatSend(s);
  }
  if (t.matches('[data-ask-nav]')) {
    chatClose();
    return go(t.dataset.askNav);
  }
  if (t.matches('[data-ask-undo]')) {
    const [id, i] = t.dataset.askUndo.split(':');
    const c = chatFind(id)?.changes?.[Number(i)];
    if (!c || c.undone) return;
    await chatUndo(c.undo);
    c.undone = true;
    chatSave();
    return chatRender();
  }
  if (t.matches('[data-ask-undo-all]')) {
    const m = chatFind(t.dataset.askUndoAll);
    const live = (m?.changes || []).filter((c) => !c.undone && c.undo && c.undo.length);
    await chatUndo(live.flatMap((c) => c.undo));
    for (const c of live) c.undone = true;
    chatSave();
    return chatRender();
  }
  if (t.matches('[data-ask-yes],[data-ask-no]')) {
    const yes = t.matches('[data-ask-yes]');
    const [id, i] = (yes ? t.dataset.askYes : t.dataset.askNo).split(':');
    const m = chatFind(id);
    const p = m?.pending?.[Number(i)];
    if (!p || p.answer) return;
    if (yes) {
      const r = await api('/chat/confirm', { method: 'POST', body: { actions: [p.action] } });
      m.changes = [...(m.changes || []), ...r.changes];
      m.failed = [...(m.failed || []), ...r.failed];
      chatChanged();
    }
    p.answer = yes ? 'yes' : 'no';
    chatSave();
    return chatRender();
  }
  if (t.matches('[data-ask-check]')) {
    const [id, i] = t.dataset.askCheck.split(':');
    const m = chatFind(id);
    const choice = m?.check?.choices?.[Number(i)];
    if (!choice) return;
    const box = t.closest('.ask-check');
    const items = m.check.items.filter((_, j) => box.querySelector(`[data-check-item="${j}"]`)?.checked);
    if (!items.length) return toast('Tick at least one thing');
    const args = choice.action === 'clothes.add' ? { childId: choice.childId, items } : { items: items.map((x) => ({ ...x, kind: 'food' })) };
    const r = await api('/chat/confirm', { method: 'POST', body: { actions: [{ name: choice.action, args }] } });
    m.changes = [...(m.changes || []), ...r.changes];
    m.failed = [...(m.failed || []), ...r.failed];
    m.check.done = r.changes.length ? `${choice.label}: ${plural(items.length, 'thing')}` : 'Not added';
    chatChanged();
    chatSave();
    return chatRender();
  }
  if (t.matches('[data-ask-photo]')) return chatPhoto();
  if (t.matches('[data-ask-mic]')) {
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new Speech();
    rec.lang = 'en-GB';
    rec.interimResults = false;
    t.classList.add('listening');
    rec.onresult = (ev) => {
      const said = ev.results[0][0].transcript;
      $('#ask-input').value = ($('#ask-input').value + ' ' + said).trim();
      chatGrow();
    };
    rec.onend = () => t.classList.remove('listening');
    rec.onerror = () => { t.classList.remove('listening'); toast('I couldn’t hear that. Try the keyboard’s microphone.'); };
    rec.start();
  }
}));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && chat.open && !$('#dialog').open) chatClose(); });
// On a phone, tapping the dimmed page above the panel closes it.
document.addEventListener('click', (e) => { if (chat.open && e.target === document.body) chatClose(); });

// ---------- start ----------
(async () => {
  const [cm, fm] = await Promise.all([api('/clothes/meta'), api('/food/meta')]);
  state.sizes = cm.sizes;
  state.types = cm.types;
  state.units = fm.units;
  go(location.hash.slice(1) || look.start || 'home');
})();

if ('serviceWorker' in navigator && !window.FamilyPlannerNative) navigator.serviceWorker.register('/sw.js').catch(() => {});
