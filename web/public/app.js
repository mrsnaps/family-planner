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
const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`;
const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtShort = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
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
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6"/>',
};
const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// ---------- food emoji & categories ----------
const FOOD_CATS = [
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
  { id: 'shopping', label: 'Shopping', icon: 'cart', title: 'Shopping list', render: renderShopping },
  { id: 'family', label: 'Family', icon: 'people', title: 'Family', render: renderFamily },
  { id: 'settings', label: 'Settings', icon: 'gear', title: 'Settings', render: renderSettings },
];

function renderNav() {
  const btn = (p, mobile) => `
    <button data-nav="${p.id}" class="${state.page === p.id ? 'active' : ''}" aria-current="${state.page === p.id ? 'page' : 'false'}">
      ${icon(p.icon)}<span>${p.label}</span>
      ${p.id === 'shopping' && state.shoppingCount ? `<span class="count">${state.shoppingCount}</span>` : ''}
    </button>`;
  $('#nav').innerHTML = PAGES.map((p) => btn(p)).join('');
  $('#tabbar').innerHTML = PAGES.map((p) => btn(p, true)).join('');
  const dark = currentTheme() === 'dark';
  $('#theme-btn').innerHTML = `${icon(dark ? 'sun' : 'moon')}<span>${dark ? 'Light mode' : 'Dark mode'}</span>`;
}

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
  history.replaceState(null, '', '#' + state.page);
  window.scrollTo(0, 0);
  refresh();
}

async function refresh() {
  state.family = await api('/family');
  if (!state.family.children.some((c) => c.id === state.childId)) state.childId = state.family.children[0]?.id || null;
  const page = PAGES.find((p) => p.id === state.page);
  $('#page-title').textContent = page.title;
  $('#page-sub').textContent = '';
  $('#page-actions').innerHTML = '';
  $('#brand-sub').textContent = `${plural(state.family.people, 'person', 'people')} at home`;
  await guard(page.render)();
  $('#page').classList.remove('fade-in');
  void $('#page').offsetWidth;
  $('#page').classList.add('fade-in');
  renderNav();
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

function kidCard(s, i, { compact = false } = {}) {
  const child = state.family.children.find((c) => c.id === s.childId) || { name: s.name };
  const rows = Object.entries(state.targets).map(([t, want]) => {
    let have = s.fitting[t] || 0;
    if (t === 'top' || t === 'bottom') have += s.fitting.dress + s.fitting.onesie;
    const pct = want ? Math.min(100, (have / want) * 100) : 100;
    return `<span class="lbl">${esc(t)}</span><div class="bar ${have < want ? 'short' : ''}"><span style="width:${pct}%"></span></div><span class="val">${have}/${want}</span>`;
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
  const icon_ = { food: '🥕', clothes: '👕', laundry: '🧺', shopping: '🛒' };
  return `<ul class="list">${list.slice(0, limit).map((r) => `
    <li class="row">
      <span class="emoji">${icon_[r.kind] || '🔔'}</span>
      <div class="grow"><div class="title">${esc(r.title)}</div>${r.detail ? `<div class="sub">${esc(r.detail)}</div>` : ''}</div>
      <span class="pill ${r.level === 'urgent' ? 'bad' : r.level === 'warn' ? 'warn' : 'plain'}">${r.level === 'urgent' ? 'Now' : r.level === 'warn' ? 'Soon' : 'FYI'}</span>
    </li>`).join('')}</ul>${list.length > limit ? `<p class="hint" style="margin-top:8px">and ${list.length - limit} more</p>` : ''}`;
}

function weekStrip(plan) {
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
async function renderHome() {
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
  const signedOut = ACCOUNT && !ACCOUNT.status().signedIn;
  let nudge = signedOut && !firstRun;
  try { nudge = nudge && !localStorage.getItem('fp-account-nudge'); } catch {}
  $('#page').innerHTML = `
    ${firstRun ? `<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Welcome! Let's set things up</h2></div>
      ${signedOut ? `<p class="hint" style="margin-bottom:10px">Already set up on another device? <button class="btn sm" data-account="signin">Sign in</button></p>` : ''}
      <div class="chips">
        <button class="chip" data-nav="family">${icon('people')} 1. Add your family</button>
        <button class="chip" data-nav="food">${icon('food')} 2. Add what's in the cupboards</button>
        <button class="chip" data-nav="clothes">${icon('shirt')} 3. Add the kids' clothes</button>
        <button class="chip" data-nav="settings">${icon('sparkle')} 4. Pick an AI (optional)</button>
      </div></div>` : ''}
    ${nudge ? `<div class="banner" style="margin-bottom:16px;background:var(--accent-soft);color:var(--accent)"><span style="font-size:22px">☁️</span>
      <div class="grow">Save your data online and use it on all your devices.</div>
      <button class="btn sm primary" data-account="signup">Create account</button><button class="btn sm" data-account="signin">Sign in</button>
      <button class="btn ghost sm" data-account="dismiss" aria-label="Not now">${icon('x')}</button></div>` : ''}
    <div class="grid g4">
      <button class="card kpi tone-green" data-nav="food"><span class="ico">${icon('food')}</span><span class="num">${d.food.mealsLeft}${d.food.capped ? '+' : ''}</span><span class="lbl">meals left in stock</span></button>
      <button class="card kpi tone-warn" data-nav="food"><span class="ico">${icon('clock')}</span><span class="num">${d.food.expiringSoon.length}</span><span class="lbl">to use in 3 days</span></button>
      <button class="card kpi tone-coral" data-nav="clothes"><span class="ico">${icon('shirt')}</span><span class="num">${budget ? money(budget) : kidsNeeding}</span><span class="lbl">${budget ? 'kids\' clothes budget ahead' : (kidsNeeding === 1 ? 'child needs' : 'children need') + ' clothes'}</span></button>
      <button class="card kpi tone-blue" data-nav="shopping"><span class="ico">${icon('cart')}</span><span class="num">${d.shoppingCount}</span><span class="lbl">on the shopping list</span></button>
    </div>

    ${d.reminders.length ? `<div class="card" style="margin-top:16px"><div class="card-head"><h2>🔔 Reminders</h2><span class="muted small">${plural(d.reminders.length, 'thing')} to know</span></div>${reminderList(d.reminders)}</div>` : ''}

    <div class="card" style="margin-top:16px">
      <div class="card-head"><h2>This week's dinners</h2><span class="muted small">Planned from what's in, using food that goes off first</span></div>
      ${weekStrip(d.food.plan)}
      ${balanceChips(d.food.balance)}
      ${d.food.expiringSoon.length ? `<div class="chips" style="margin-top:14px">${d.food.expiringSoon.map((e) =>
        `<span class="pill ${e.days < 0 ? 'bad' : 'warn'}">${foodCat(e.name).emoji} ${esc(e.name)} · ${e.days < 0 ? 'out of date' : e.days === 0 ? 'today' : 'in ' + plural(e.days, 'day')}</span>`).join('')}</div>` : ''}
    </div>

    ${d.handMeDowns.length ? `<div class="card" style="margin-top:16px"><div class="card-head"><h2>♻️ Hand-me-downs</h2><span class="muted small">Outgrown clothes a sibling can use</span></div>
      <ul class="list">${d.handMeDowns.slice(0, 5).map((h) => `<li class="row"><span class="emoji">${GARMENT[h.type] || '👕'}</span>
        <div class="grow"><div class="title">${esc(h.name)} <span class="pill plain">${esc(h.size)}</span></div><div class="sub">${esc(h.fromName)} → ${esc(h.toName)} · ${h.fitsNow ? 'fits now' : 'to grow into'}</div></div>
        <button class="btn sm" data-handdown="${h.itemId}" data-to="${h.toChildId}">Pass to ${esc(h.toName)}</button></li>`).join('')}</ul></div>` : ''}

    <div class="card-head" style="margin:26px 0 12px"><h2>Kids' clothes</h2><button class="btn sm" data-nav="clothes">Open wardrobes</button></div>
    ${d.clothes.length ? `<div class="grid g2">${d.clothes.map((s, i) => kidCard(s, i)).join('')}</div>`
      : `<div class="card">${emptyState('👶', 'No children added yet.', '<button class="btn primary" data-nav="family">Add a child</button>')}</div>`}
  `;
}

// ---------- food ----------
async function renderFood() {
  const [items, meals, stats, recipes, ai] = await Promise.all([
    api('/food/items'), api('/food/meals'), api('/food/stats'), api('/food/recipes'), api('/ai/settings'),
  ]);
  state.ai = ai;
  const ready = meals.meals.filter((m) => m.status === 'ready').length;
  $('#page-sub').textContent = `${plural(stats.mealsLeft, 'meal')} left · ${ready} ready to cook · sized for ${plural(state.family.people, 'person', 'people')}` +
    (meals.dietary.length ? ` · ${meals.dietary.join(', ')}` : '');
  const tabs = [['pantry', `What's in (${items.length})`], ['meals', `Meals (${ready})`], ['recipes', 'My recipes']];
  $('#page').innerHTML = `
    <div class="seg" style="margin-bottom:16px">${tabs.map(([k, l]) => `<button data-food-view="${k}" class="${state.foodView === k ? 'active' : ''}">${l}</button>`).join('')}</div>
    <div id="food-body"></div>`;
  const body = $('#food-body');
  if (state.foodView === 'pantry') body.innerHTML = pantryView(items, stats);
  else if (state.foodView === 'meals') body.innerHTML = aiIdeasCard() + mealsView(meals.meals);
  else body.innerHTML = recipesView(recipes);
}

function pantryView(items, stats) {
  const unmatched = new Set(stats.unmatched);
  const today = new Date().toISOString().slice(0, 10);
  const groups = {};
  for (const it of items) (groups[foodCat(it.name).cat] ||= []).push(it);
  const order = [...FOOD_CATS.map((c) => c[0]), 'Other'];
  const days = (d) => Math.round((new Date(d) - new Date(today)) / 86400000);
  const list = items.length ? order.filter((g) => groups[g]).map((g) => `
    <div class="group-title">${g}</div>
    <ul class="list">${groups[g].map((it) => {
      const dl = it.expiry ? days(it.expiry) : null;
      const exp = dl === null ? '' : dl < 0 ? '<span class="pill bad">Out of date</span>' : dl <= 3 ? `<span class="pill warn">${dl === 0 ? 'Use today' : 'Use in ' + plural(dl, 'day')}</span>` : '';
      return `
      <li class="row">
        <span class="emoji">${foodCat(it.name).emoji}</span>
        <div class="grow">
          <div class="title">${esc(it.name)} ${exp}</div>
          <div class="sub">${it.expiry ? 'Use by ' + fmtDate(it.expiry) : 'No use-by date'}${unmatched.has(it.name) ? ' · not in any recipe yet' : ''}</div>
        </div>
        <div class="stepper">
          <button data-step="${it.id}" data-delta="-1" aria-label="Less">−</button>
          <input type="number" step="any" min="0" value="${it.quantity ?? ''}" data-qty="${it.id}" aria-label="Quantity of ${esc(it.name)}">
          <button data-step="${it.id}" data-delta="1" aria-label="More">+</button>
        </div>
        <span class="small muted unit" style="width:30px">${esc(it.unit)}</span>
        <button class="icon-btn danger" data-del-food="${it.id}" aria-label="Remove ${esc(it.name)}">${icon('trash')}</button>
      </li>`;
    }).join('')}</ul>`).join('') : emptyState('🥫', 'Nothing in yet. Add items, scan a barcode, or snap a photo.');

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
          <button class="btn primary">${icon('plus')} Add to cupboard</button>
        </form>
        <datalist id="food-names">${QUICK_ADD.map(([n]) => `<option value="${esc(n)}">`).join('')}</datalist>
        <p class="hint" style="margin-top:12px">Use g/kg, ml/l, tin or pcs so meals can be counted properly.</p>
        <div class="group-title" style="margin-top:18px">Quick add</div>
        <div class="chips">${QUICK_ADD.map(([n], i) => `<button class="chip" data-quick="${i}">${foodCat(n).emoji} ${esc(n)}</button>`).join('')}</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>In the cupboards</h2><span class="muted small">${plural(items.length, 'item')}</span></div>
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
          <div style="flex:1;min-width:0"><div class="name">${esc(idea.name)}</div><div class="meta"><span>${icon('clock')} ${idea.minutes} min</span><span>Serves ${idea.servings}</span></div></div></div>
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

function mealsView(meals) {
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
            <div class="meta"><span>${icon('clock')} ${m.minutes} min</span><span>${m.tags.filter((t) => t !== 'vegetarian').map(esc).join(' · ')}</span></div></div>
          <button class="icon-btn star ${m.favourite ? 'on' : ''}" data-fav="${m.id}" data-state="${m.favourite}" aria-label="${m.favourite ? 'Remove from' : 'Add to'} favourites" title="Family favourite">${m.favourite ? '★' : '☆'}</button>
        </div>
        <div class="chips">${tag}${m.usesExpiring ? '<span class="pill warn">Uses food going off</span>' : ''}${m.diet.filter((d) => d !== 'nut-free').map((d) => `<span class="pill plain">${DIET_LABEL[d]}</span>`).join('')}</div>
        ${m.missing.length ? `<div class="small">Missing: <strong>${m.missing.map(esc).join(', ')}</strong></div>` : ''}
        ${m.short.length ? `<div class="small">Short: ${m.short.map((s) => `${esc(s.name)} (${s.have}/${s.need} ${s.unit})`).join(', ')}</div>` : ''}
        <details><summary>Ingredients for your family</summary>
          <ul>${m.ingredients.map((i) => `<li>${fmtAmount(i)} ${esc(i.name)}${i.optional ? ' <span class="muted">(optional)</span>' : ''}</li>`).join('')}</ul>
        </details>
        <div class="actions">
          ${m.status === 'ready' ? `<button class="btn primary sm" data-cook="${m.id}">${icon('check')} Cooked it</button>` : ''}
          ${needs.length ? `<button class="btn sm" data-shop-missing="${esc(JSON.stringify(needs))}">${icon('cart')} Add to shopping</button>` : ''}
        </div>
      </div>`;
  };
  return `
    <div class="chips" style="margin-bottom:16px">${filters.map(([k, l]) => `<button class="chip ${f === k ? 'active' : ''}" data-meal-filter="${k}">${l}</button>`).join('')}</div>
    ${shown.length ? `<div class="meal-grid">${shown.map(card).join('')}</div>` : `<div class="card">${emptyState('🍽️', f === 'favourites' ? 'Tap the ☆ on a meal the kids love to make it a favourite.' : 'No meals match yet. Add more food to the cupboard.')}</div>`}`;
}

function recipesView(recipes) {
  const mine = recipes.filter((r) => !r.builtin);
  const unitOpts = options(state.units.filter((u) => u !== 'each'), 'g');
  return `
    <div class="split">
      <div class="card">
        <div class="card-head"><h2>Add a recipe</h2></div>
        <form id="recipe-form" class="stack">
          <label class="field">Name<input name="name" required placeholder="e.g. Grandma's fish pie"></label>
          <div class="form-row" style="grid-template-columns:1fr 1fr">
            <label class="field">Serves<input name="servings" type="number" min="1" value="4"></label>
            <label class="field">Minutes<input name="minutes" type="number" min="1" value="30"></label>
          </div>
          <label class="field">Type
            <select name="tag"><option value="dinner">Dinner</option><option value="lunch">Lunch</option><option value="breakfast">Breakfast</option></select></label>
          <label class="chip" style="align-self:flex-start"><input type="checkbox" name="vegetarian" style="width:auto"> Vegetarian</label>
          <div class="group-title">Ingredients</div>
          <div id="ing-rows" class="stack"></div>
          <button type="button" class="btn sm" id="add-ing" style="align-self:flex-start">${icon('plus')} Add ingredient</button>
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
      <div class="card">
        <div class="card-head"><h2>Your recipes</h2><span class="muted small">Plus ${recipes.length - mine.length} built-in</span></div>
        ${mine.length ? `<ul class="list">${mine.map((r) => `
          <li class="row"><span class="emoji">${MEAL_EMOJI(r.name)}</span>
            <div class="grow"><div class="title">${esc(r.name)}</div>
              <div class="sub">Serves ${r.servings} · ${r.minutes} min · ${r.ingredients.map((i) => esc(i.name)).join(', ')}</div></div>
            <button class="icon-btn danger" data-del-recipe="${r.id}" aria-label="Delete ${esc(r.name)}">${icon('trash')}</button>
          </li>`).join('')}</ul>` : emptyState('📖', 'Add your family favourites and they will show up in meal ideas.')}
        <div class="group-title" style="margin-top:20px">Built-in recipes</div>
        <div class="chips">${recipes.filter((r) => r.builtin).map((r) => `<span class="pill plain">${MEAL_EMOJI(r.name)} ${esc(r.name)}</span>`).join('')}</div>
      </div>
    </div>`;
}

function addIngredientRow() {
  const tpl = $('#ing-tpl');
  if (tpl) $('#ing-rows').append(tpl.content.cloneNode(true));
}

// "81.3 g" reads oddly in a kitchen: round grams/ml to 5 (10 above 100) and drop "pcs".
function fmtAmount({ amount, unit }) {
  if (unit === 'g' || unit === 'ml') {
    const step = amount >= 100 ? 10 : 5;
    const v = Math.max(step, Math.round(amount / step) * step);
    return v >= 1000 ? `${v / 1000} ${unit === 'g' ? 'kg' : 'l'}` : `${v} ${unit}`;
  }
  if (unit === 'pcs') return String(amount);
  if (unit === 'tsp') return amount >= 3 ? `${Math.round(amount / 3)} tbsp` : `${amount} tsp`;
  return `${amount} ${unit}${amount === 1 || unit.endsWith('s') ? '' : 's'}`;
}

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
  const [items, outfits, stats, targets, ootd, hmd] = await Promise.all([
    api('/clothes/items?childId=' + child.id),
    api(`/clothes/outfits/${child.id}?season=${season}&limit=60`),
    api('/clothes/stats'),
    api('/clothes/targets'),
    api(`/clothes/outfit-of-the-day/${child.id}?shuffle=${state.ootdIndex}${wq}`),
    api('/clothes/hand-me-downs'),
  ]);
  state.targets = targets;
  const s = stats.find((x) => x.childId === child.id);
  $('#page-sub').textContent = `${plural(items.length, 'item')} for ${child.name} · ${plural(outfits.total, 'outfit')}`;
  const inWash = items.filter((i) => i.inWash).length;
  if (inWash) $('#page-actions').innerHTML = `<button class="btn" data-laundry-done="${child.id}">🧺 Laundry done (${inWash})</button>`;

  const sizeIdx = (x) => state.sizes.indexOf(x);
  const fitLabel = (it) => {
    if (it.wornOut) return '<span class="pill bad">Worn out</span>';
    const tags = [];
    if (it.inWash) tags.push('<span class="pill blue">In the wash</span>');
    if (it.uniform) tags.push('<span class="pill plain">Uniform</span>');
    if (it.type !== 'shoes' && child.clothingSize && sizeIdx(it.size) >= 0) {
      const d = sizeIdx(it.size) - sizeIdx(child.clothingSize);
      if (d < 0) tags.push('<span class="pill bad">Outgrown</span>');
      if (d > 0) tags.push('<span class="pill blue">Grow into</span>');
    }
    return tags.join(' ');
  };
  const wf = state.wardrobeFilter;
  const shownItems = items.filter((it) => wf === 'all' || (wf === 'wash' ? it.inWash : wf === 'uniform' ? it.uniform : it.type === wf));
  const typesPresent = [...new Set(items.map((i) => i.type))];
  const extraFilters = [...(inWash ? [['wash', '🧺 In wash']] : []), ...(items.some((i) => i.uniform) ? [['uniform', '🎒 Uniform']] : [])];

  // Outgrown things: pass to a sibling, or sell / give away.
  const passOn = hmd.filter((h) => h.fromChildId === child.id);
  const passIds = new Set(passOn.map((h) => h.itemId));
  const sellable = items.filter((it) => !it.wornOut && it.type !== 'shoes' && child.clothingSize && sizeIdx(it.size) >= 0 &&
    sizeIdx(it.size) < sizeIdx(child.clothingSize) && !passIds.has(it.id));

  const o = ootd.outfit;
  $('#page').innerHTML = `
    <div class="kid-tabs" style="margin-bottom:16px">${kids.map((c, i) =>
      `<button class="kid-tab ${c.id === child.id ? 'active' : ''}" data-kid="${c.id}">${avatar(c, i)}${esc(c.name)}</button>`).join('')}</div>

    <div class="grid g2">
      <div class="card ootd">
        <div>
          <div class="muted small" style="font-weight:700;text-transform:uppercase;letter-spacing:.06em">${icon('sparkle')} Outfit of the day</div>
          ${weather && weather.tempC !== null
            ? `<div class="small" style="margin-top:6px">${weather.rain ? '🌧️' : weather.tempC < 12 ? '🧣' : weather.tempC >= 20 ? '☀️' : '⛅'} ${weather.min}° to ${weather.max}°${weather.place ? ' in ' + esc(weather.place) : ''}. ${esc(ootd.weather || '')}</div>`
            : state.family.location ? `<div class="small muted" style="margin-top:6px">Couldn't get the weather for ${esc(state.family.location.name)} right now, so this ignores it.</div>`
            : `<div class="small muted" style="margin-top:6px"><button class="btn ghost sm" data-nav="settings" style="padding:0">Add your town</button> for weather-aware outfits.</div>`}
          ${o ? `<div class="ootd-items">${o.items.map((i) => `
              <div class="garment"><div class="tile" style="background:${esc(cssColour(i.colour))}">${GARMENT[i.type] || '👕'}</div>${esc(i.name)}</div>`).join('')}</div>
              ${o.notes.length ? `<p class="small muted" style="margin-top:8px">${o.notes.map(esc).join('; ')}</p>` : ''}`
            : '<p style="margin-top:12px">Add at least a top and a bottom (or a dress) that fit and are clean to get an outfit.</p>'}
        </div>
        ${o && ootd.choices > 1 ? `<button class="btn" data-shuffle>${icon('shuffle')} Shuffle</button>` : ''}
      </div>
      ${kidCard(s, kids.indexOf(child))}
    </div>

    ${passOn.length || sellable.length ? `<div class="card" style="margin-top:16px">
      <div class="card-head"><h2>♻️ Outgrown</h2><span class="muted small">Pass them on, sell or give away</span></div>
      <ul class="list">
        ${passOn.map((h) => `<li class="row"><span class="emoji">${GARMENT[h.type] || '👕'}</span>
          <div class="grow"><div class="title">${esc(h.name)} <span class="pill plain">${esc(h.size)}</span></div><div class="sub">${esc(h.toName)} can ${h.fitsNow ? 'wear it now' : 'grow into it'}</div></div>
          <button class="btn sm primary" data-handdown="${h.itemId}" data-to="${h.toChildId}">Pass to ${esc(h.toName)}</button></li>`).join('')}
        ${sellable.map((it) => `<li class="row"><span class="emoji">${GARMENT[it.type] || '👕'}</span>
          <div class="grow"><div class="title">${esc(it.name)} <span class="pill plain">${esc(it.size)}</span></div><div class="sub">No sibling it fits</div></div>
          <button class="btn sm" data-sell="${it.id}">${icon('copy')} Copy listing</button>
          <button class="icon-btn danger" data-del-item="${it.id}" aria-label="Gone">${icon('trash')}</button></li>`).join('')}
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
          <div class="chips">${[['all', 'All'], ...typesPresent.map((t) => [t, GARMENT[t] + ' ' + cap(t)]), ...extraFilters].map(([k, l]) => `<button class="chip ${wf === k ? 'active' : ''}" data-wfilter="${k}">${l}</button>`).join('')}</div>
        </div>
        ${shownItems.length ? `<ul class="list">${shownItems.map((it) => `
          <li class="row">
            <span class="emoji" style="background:${esc(cssColour(it.colour))}">${GARMENT[it.type] || '👕'}</span>
            <div class="grow"><div class="title">${esc(it.name)} ${fitLabel(it)}</div>
              <div class="sub">${cap(esc(it.type))} · ${esc(it.size || 'no size')}${it.colour ? ' · ' + esc(it.colour) : ''}${it.pattern === 'patterned' ? ' · patterned' : ''}${it.season !== 'all' ? ' · ' + esc(it.season) : ''}</div></div>
            ${it.wornOut ? '' : `<button class="btn ghost sm" data-wash="${it.id}" data-state="${Boolean(it.inWash)}" title="${it.inWash ? 'Back in the drawer' : 'Put in the wash'}">${it.inWash ? 'Clean' : '🧺 Wash'}</button>`}
            <button class="btn ghost sm" data-worn="${it.id}" data-state="${it.wornOut}">${it.wornOut ? 'Mark OK' : 'Worn out'}</button>
            <button class="icon-btn danger" data-del-item="${it.id}" aria-label="Remove ${esc(it.name)}">${icon('trash')}</button>
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
}

function listingText(it) {
  const age = String(it.size || '').replace(/Y$/, ' years').replace(/M$/, ' months');
  return `${it.name} – age ${age}\n\nChildren's ${it.type} in size ${it.size}${it.colour ? `, ${it.colour}` : ''}${it.pattern === 'patterned' ? ', patterned' : ''}. ` +
    'Outgrown and ready for a new home. Happy to bundle with other items.';
}

// ---------- shopping ----------
async function renderShopping() {
  const data = await api('/shopping');
  const children = state.family.children;
  state.shoppingCount = data.items.filter((i) => !i.done).length;
  $('#page-sub').textContent = `${plural(state.shoppingCount, 'thing')} to buy · tick "Bought" and it goes straight into the cupboard or wardrobe`;
  $('#page-actions').innerHTML = (data.items.some((i) => !i.done) ? `<button class="btn" data-copy-list>${icon('copy')} Copy</button>${navigator.share ? `<button class="btn" data-share-list>${icon('share')} Share</button>` : ''}` : '') +
    (data.items.some((i) => i.done) ? `<button class="btn" data-clear-done>${icon('trash')} Clear ticked</button>` : '');
  const childName = (id) => children.find((c) => c.id === id)?.name;
  const groups = { food: [], clothes: [], other: [] };
  for (const it of data.items) groups[it.kind || 'other'].push(it);
  const label = { food: '🥕 Food', clothes: '👕 Clothes', other: '🛒 Other' };

  const row = (it) => `
    <li class="row ${it.done ? 'done' : ''}">
      <button class="check ${it.done ? 'on' : ''}" data-toggle="${it.id}" data-state="${it.done}" aria-label="Tick ${esc(it.name)}">${icon('check')}</button>
      <div class="grow"><div class="title">${it.quantity ? it.quantity + ' × ' : ''}${esc(cap(it.name))}${it.size ? ` <span class="pill plain">${esc(it.size)}</span>` : ''}</div>
        ${it.childId || it.note ? `<div class="sub">${it.childId ? 'For ' + esc(childName(it.childId) || 'child') : ''}${it.note ? (it.childId ? ' · ' : '') + esc(it.note) : ''}</div>` : ''}
        ${it.kind === 'food' && !it.done ? `<div class="sub shops">${SHOPS.map(([n, url]) => `<a href="${esc(url(it.name))}" target="_blank" rel="noopener">${esc(n)}</a>`).join(' · ')}</div>` : ''}</div>
      ${it.kind !== 'other' ? `<button class="btn sm" data-bought="${it.id}">${icon('bag')} Bought</button>` : ''}
      <button class="icon-btn danger" data-del-shop="${it.id}" aria-label="Remove ${esc(it.name)}">${icon('x')}</button>
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
            <label class="field">For (clothes only)<select name="childId"><option value="">—</option>${children.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
            <button class="btn primary">${icon('plus')} Add</button>
          </form>
        </div>
        <div class="card">
          <div class="card-head"><h2>💡 Suggestions</h2>
            ${data.suggestions.length ? `<button class="btn sm" data-add-all>Add all</button>` : ''}</div>
          <p class="hint">From what runs out, what you buy regularly, the meals you cook most and your favourites. The more you add to the cupboard and tap "Cooked it", the better these get.</p>
          ${data.suggestions.length ? `<ul class="list">${data.suggestions.map((s, i) => `
            <li class="row">
              <span class="emoji">${s.kind === 'food' ? foodCat(s.name).emoji : GARMENT[s.type] || '👕'}</span>
              <div class="grow"><div class="title">${s.quantity ? s.quantity + ' × ' : ''}${esc(cap(s.name))}${s.size ? ` <span class="pill plain">${esc(s.size)}</span>` : ''}</div>
                <div class="sub">${esc(s.reason)}</div></div>
              <button class="btn sm" data-suggest="${i}">${icon('plus')} Add</button>
              <button class="icon-btn" data-snooze="${i}" aria-label="Not now: ${esc(s.name)}" title="Not now">${icon('x')}</button>
            </li>`).join('')}</ul>` : emptyState('💡', 'Nothing to suggest right now.')}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Your list</h2></div>
        ${data.items.length ? Object.entries(groups).filter(([, v]) => v.length).map(([k, v]) =>
          `<div class="group-title">${label[k]}</div><ul class="list">${v.map(row).join('')}</ul>`).join('')
          : emptyState('🛒', 'Your list is empty. Add things, or use the suggestions.')}
      </div>
    </div>`;
  state.suggestions = data.suggestions;
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
          <div class="stepper"><button data-adults="-1" aria-label="One fewer adult">−</button><input id="adults" type="number" min="0" max="20" value="${f.adults}" aria-label="Adults"><button data-adults="1" aria-label="One more adult">+</button></div>
        </div>
        <div class="grid g2" style="margin-top:18px">
          <div class="forecast"><div class="k">People</div><div class="v" style="font-size:24px">${f.people}</div></div>
          <div class="forecast"><div class="k">Portions per meal</div><div class="v" style="font-size:24px">${f.portions}</div></div>
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
      <form class="card child-edit stack" data-child="${c.id}">
        <div class="kid-head">${avatar(c, i)}<div style="flex:1"><h3>${esc(c.name)}</h3>
          <div class="small muted">${c.age != null ? Math.floor(c.age) + ' years old' : 'Age unknown'}${c.sizeRecordedAt ? ' · size updated ' + fmtShort(c.sizeRecordedAt) : ''}</div></div>
          <button type="button" class="icon-btn danger" data-del-child="${c.id}" aria-label="Remove ${esc(c.name)}">${icon('trash')}</button></div>
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
          `<label class="field">${GARMENT[t]} ${cap(t)}<input type="number" min="0" name="${t}" value="${state.targets[t] ?? ''}" placeholder="–"></label>`).join('')}</div>
        <button class="btn primary" style="margin-top:14px">Save</button>
      </form>
    </div>`;
}

// ---------- events (delegated, so re-rendering never loses handlers) ----------
document.addEventListener('click', guard(async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  const d = t.dataset;
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
    const input = $(`[data-qty="${d.step}"]`);
    const unit = input.closest('.row').querySelector('.unit').textContent.trim();
    const stepBy = ['g', 'ml'].includes(unit) ? 100 : 1;
    const value = Math.max(0, (Number(input.value) || 0) + Number(d.delta) * stepBy);
    await api('/food/items/' + d.step, { method: 'PUT', body: { quantity: value } });
    return renderFood();
  }
  if (d.delFood) { await api('/food/items/' + d.delFood, { method: 'DELETE' }); return renderFood(); }
  if (d.cook) {
    await api(`/food/meals/${d.cook}/cook`, { method: 'POST' });
    toast('Enjoy! Ingredients taken out of the cupboard.');
    return renderFood();
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
  if (t.hasAttribute('data-clear-done')) { await api('/shopping/clear-done', { method: 'POST' }); return refresh(); }
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
          <label class="field">Amount<input name="quantity" type="number" step="any" min="0" value="${it.quantity ?? ''}"></label>
          <label class="field">Unit<select name="unit">${options(state.units, it.unit || 'pcs')}</select></label></div>
        <label class="field" style="margin-top:10px">Use by (optional)<input name="expiry" type="date"></label>`,
    });
    if (!res) return;
    body = res;
  } else if (it.kind === 'clothes') {
    const res = await ask({
      title: `Bought ${it.name}`,
      ok: 'Add to wardrobe',
      body: `<label class="field">How many<input name="count" type="number" min="1" max="20" value="${it.quantity || 1}"></label>
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
    await api('/food/recipes', {
      method: 'POST',
      body: { name: body.name, servings: body.servings, minutes: body.minutes, tags: [body.tag, ...(body.vegetarian ? ['vegetarian'] : [])], ingredients },
    });
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

function accountCard() {
  if (!ACCOUNT) return '';
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
        </div>` : `
        <p class="hint" style="margin-top:8px">Sign in to save your family's data online, so it's safe and the same on your iPhone and iPad. Use one account for the household and sign in with it on each device.</p>
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
async function accountStep({ title, intro = '', fields, ok, run }) {
  let values = {};
  let error = '';
  for (;;) {
    const body = `${intro ? `<p class="muted">${intro}</p>` : ''}${fields(values)}${error ? `<p class="small" style="color:var(--coral);margin-top:10px">${esc(error)}</p>` : ''}`;
    const got = await ask({ title, body, ok });
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
      '<p class="small" style="margin-top:10px"><button type="button" class="btn ghost sm" data-account="forgot">Forgot password?</button></p>',
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

async function accountSignUp() {
  const created = await accountStep({
    title: 'Create an account',
    intro: 'One account for the household. Use it to sign in on each of your devices.',
    fields: (v) => emailField(v.email) + field('password', 'Password (8 or more characters, with a number)', 'password', '', 'autocomplete="new-password"'),
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

async function accountAction(what) {
  if (what === 'signin') return accountSignIn();
  if (what === 'signup') return accountSignUp();
  if (what === 'forgot') {
    const email = $('#dialog-form input[name=email]')?.value || '';
    const dlg = $('#dialog');
    // Let the sign-in dialog finish closing before the next one opens in its place.
    await new Promise((resolve) => { dlg.addEventListener('close', () => setTimeout(resolve), { once: true }); dlg.close('cancel'); });
    return accountForgot(email);
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
    toast(e.detail?.reason === 'conflict' ? 'Your other device saved changes first, so this shows its latest data.' : 'Updated with changes from your other device');
    refresh();
  });
}

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
      <p class="hint">AI is optional. It suggests new meals and reads photos of food, receipts and clothes. Everything else works without it.</p>
      ${'onDeviceAvailable' in ai ? `
        <div class="banner" style="margin-top:12px;background:var(--accent-soft);color:var(--accent)">
          <span style="font-size:22px">📱</span>
          <div class="grow"><div>iPhone on-device AI</div>
            <div class="small" style="font-weight:500">${ai.onDeviceAvailable ? 'Private and free: runs on this phone, nothing leaves it.' : esc(ai.onDeviceReason || 'Not available on this phone.')}</div></div>
          ${ai.onDeviceAvailable ? `<label class="chip"><input type="checkbox" data-ondevice ${ai.onDevice ? 'checked' : ''} style="width:auto"> Use it</label>` : ''}
        </div>` : ''}
      <form id="ai-form" class="stack" style="margin-top:14px">
        <div class="form-row" style="grid-template-columns:1fr 1fr">
          <label class="field">${onDeviceOn ? 'Extra AI (used when on-device can\'t)' : 'AI to use'}
            <select name="provider"><option value="none">None</option>${shownProviders.map((p) => `<option value="${p.id}" ${p.id === ai.provider ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
          <label class="field">Model
            ${preset && preset.models.length
              ? `<select name="model">${options(preset.models, ai.model || preset.models[0])}</select>`
              : `<input name="model" value="${esc(ai.model)}" placeholder="${preset ? 'Model name' : '—'}" ${preset ? '' : 'disabled'}>`}</label>
        </div>
        ${preset ? `
        ${preset.note ? `<p class="hint">${esc(preset.note)}</p>` : ''}
        <div class="form-row" style="grid-template-columns:1fr 1fr">
          <label class="field">API key ${ai.hasKey ? `<span class="muted">(saved${ai.apiKeyHint ? ' ' + esc(ai.apiKeyHint) : ''})</span>` : ''}
            <input name="apiKey" type="password" autocomplete="off" placeholder="${ai.hasKey ? 'Leave blank to keep' : preset.needsKey ? 'Paste your key' : 'Not needed'}"></label>
          <label class="field">Server address
            <input name="baseUrl" value="${esc(ai.baseUrl)}" placeholder="${esc(preset.baseUrl || 'https://…')}"></label>
        </div>
        <div class="form-row" style="grid-template-columns:1fr 2fr">
          <label class="field">Monthly limit<input name="monthlyLimit" type="number" min="0" value="${ai.monthlyLimit}"></label>
          <p class="hint" style="align-self:center">${ai.usage && ai.usage.month ? `Used ${ai.usage.count} this month.` : 'Not used yet this month.'} 0 means no limit.</p>
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
          <div class="grid g4">${state.types.map((t) => `<label class="field">${GARMENT[t]} ${cap(t)}<input type="number" min="0" step="0.5" name="${t}" value="${prices[t] ?? ''}"></label>`).join('')}</div>
          <button class="btn primary" style="margin-top:12px">Save prices</button>
        </form>
      </div>
      <div class="card">
        <div class="card-head"><h2>💾 Backup</h2></div>
        <p class="hint">Download everything as a file, or restore from one. Restoring replaces what's here now.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn primary" data-export>${icon('download')} Download backup</button>
          <button class="btn" data-import>${icon('upload')} Restore from file</button>
        </div>
      </div>
    </div>`;
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
        <input name="quantity-${i}" type="number" step="any" min="0" value="${it.quantity ?? ''}" placeholder="?">
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
        <label class="field">Amount<input name="quantity" type="number" step="any" min="0" value="${product.quantity ?? ''}"></label>
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
  if (t.hasAttribute('data-account')) return accountAction(t.dataset.account);
  if (t.hasAttribute('data-copy-list') || t.hasAttribute('data-share-list')) {
    const { items } = await api('/shopping');
    const text = shoppingText(items);
    if (t.hasAttribute('data-share-list') && navigator.share) return navigator.share({ title: 'Shopping list', text }).catch(() => {});
    return copyText(text);
  }
}));

document.addEventListener('change', guard(async (e) => {
  const el = e.target;
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
    const send = { model: body.model, baseUrl: body.baseUrl, monthlyLimit: body.monthlyLimit };
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

// ---------- start ----------
(async () => {
  const [cm, fm] = await Promise.all([api('/clothes/meta'), api('/food/meta')]);
  state.sizes = cm.sizes;
  state.types = cm.types;
  state.units = fm.units;
  go(location.hash.slice(1) || 'home');
})();

if ('serviceWorker' in navigator && !window.FamilyPlannerNative) navigator.serviceWorker.register('/sw.js').catch(() => {});
