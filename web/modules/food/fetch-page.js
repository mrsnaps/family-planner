// Fetching a recipe page for "Recipe from a link".
//
// The food module never fetches by itself: it's handed a fetcher, `async (url) => html string`.
//  - On the Node server, server.js hands it nodeFetchPage(): the global fetch, with a 10 second
//    timeout and a 2 MB cap, http and https only, and never to a private or loopback address
//    (checked again after every redirect), so a link can't be used to reach the home network.
//  - In the browser build (the hosted app), a page on another site can't be fetched directly
//    (CORS), so the route uses globalThis.FamilyPlannerFetchPage when something sets it (a cloud
//    proxy, with the same contract: async (url) => html string, throwing an Error with a
//    `status` and a friendly `message` when it can't). Without one, the route answers 409 and the
//    page offers a box to paste the recipe instead.
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10000;

const fail = (status, message) => Object.assign(new Error(message), { status });

function v4Private(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // not a normal address: refuse
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local (and cloud metadata)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && p[2] === 0) ||
    (a === 198 && (b === 18 || b === 19));
}

// True for any address that isn't on the public internet.
function isPrivateAddress(addr) {
  let ip = String(addr || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return v4Private(ip);
  if (!ip.includes(':')) return true;
  // IPv4 inside IPv6: ::ffff:1.2.3.4, ::ffff:7f00:1, 64:ff9b::1.2.3.4
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (dotted) return v4Private(dotted[1]);
  const mapped = /^(?:0*:)*:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (mapped) {
    const hi = parseInt(mapped[1], 16);
    const lo = parseInt(mapped[2], 16);
    return v4Private(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (ip === '::' || ip === '::1' || /^0*(:0*)*:0*1?$/.test(ip)) return true;
  const first = parseInt(ip.split(':')[0] || '0', 16);
  return (first & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (first & 0xffc0) === 0xfe80 || // link-local
    (first & 0xff00) === 0xff00 || // multicast
    first === 0x2002 || first === 0x64; // 6to4 and NAT64 can hide a private IPv4
}

async function checkUrl(raw, lookup) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    throw fail(400, "That doesn't look like a web address");
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw fail(400, 'Only http and https links can be opened');
  if (u.username || u.password) throw fail(400, "Links with a password in them can't be opened");
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || /\.(localhost|local|internal|home|lan)$/i.test(host)) throw fail(400, "That address is on a private network, so it can't be opened");
  let addresses;
  try {
    addresses = await lookup(host);
  } catch {
    throw fail(502, "Couldn't find that website");
  }
  const list = [].concat(addresses || []).map((a) => (typeof a === 'string' ? a : a && a.address));
  if (!list.length || list.some(isPrivateAddress)) throw fail(400, "That address is on a private network, so it can't be opened");
  return u;
}

async function readCapped(res, maxBytes) {
  const type = res.headers.get('content-type') || '';
  const charset = (/charset=([\w-]+)/i.exec(type) || [])[1] || 'utf-8';
  let decoder;
  try {
    decoder = new TextDecoder(charset);
  } catch {
    decoder = new TextDecoder('utf-8');
  }
  if (!res.body || typeof res.body.getReader !== 'function') {
    const text = await res.text();
    if (text.length > maxBytes) throw fail(413, 'That page is too big to read');
    return text;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      reader.cancel().catch(() => {});
      throw fail(413, 'That page is too big to read');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return decoder.decode(all);
}

// lookup: async (hostname) => [addresses]; fetch: the WHATWG fetch to use.
function makeFetchPage({ lookup, fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES, maxRedirects = 5 }) {
  return async function fetchPage(url) {
    const signal = AbortSignal.timeout(timeoutMs);
    let current = url;
    try {
      for (let hop = 0; hop <= maxRedirects; hop++) {
        const u = await checkUrl(current, lookup);
        const res = await fetch(u.href, {
          redirect: 'manual',
          signal,
          headers: { 'User-Agent': 'FamilyPlanner/0.2 (recipe import; home use)', Accept: 'text/html,application/xhtml+xml,application/ld+json;q=0.9,text/plain;q=0.8' },
        });
        const next = res.status >= 300 && res.status < 400 && res.headers.get('location');
        if (next) {
          current = new URL(next, u).href;
          continue;
        }
        if (!res.ok) throw fail(502, `That page didn't open (it said ${res.status})`);
        const type = res.headers.get('content-type') || '';
        if (type && !/html|json|text\/plain|xml/i.test(type)) throw fail(415, "That link isn't a web page");
        if (Number(res.headers.get('content-length')) > maxBytes) throw fail(413, 'That page is too big to read');
        return await readCapped(res, maxBytes);
      }
    } catch (e) {
      if (e && e.status) throw e;
      if (signal.aborted || (e && /abort|timeout/i.test(e.name || ''))) throw fail(504, 'That page took too long to open');
      throw fail(502, "Couldn't open that page");
    }
    throw fail(502, 'That link redirects too many times');
  };
}

// The Node server's fetcher, or null where Node isn't available (the browser build).
function nodeFetchPage(opts = {}) {
  const proc = typeof process !== 'undefined' ? process : null;
  if (!proc || typeof proc.getBuiltinModule !== 'function' || typeof globalThis.fetch !== 'function') return null;
  const dns = proc.getBuiltinModule('node:dns');
  if (!dns || !dns.promises) return null;
  return makeFetchPage({ lookup: (host) => dns.promises.lookup(host, { all: true, verbatim: true }), ...opts });
}

module.exports = { makeFetchPage, nodeFetchPage, isPrivateAddress, MAX_BYTES, TIMEOUT_MS };
