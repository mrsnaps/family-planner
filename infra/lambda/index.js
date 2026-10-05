// Household data API behind Cognito sign-in. Deployed inline by infra/cloud.yaml: run
// `node infra/build.mjs` after editing to copy this file into the template.
//   GET  /data       the household's saved data       PUT /data { data, baseRev }
//   GET  /rev        just the saved version, for a cheap "anything new?" check
//   GET  /household  who's in the household           POST /invite -> { code }
//   POST /join { code }  join another household       POST /leave
//   POST /delete-account  removes the login and everything only this person can see
//   POST /feedback { text, page }  emails the app's owner (FEEDBACK_TOPIC), up to 10 a day each
//   GET  /push/key, POST /push/subscribe|unsubscribe|schedule|test  reminders on a home screen
//        app (Web Push), sent by the same function every 15 minutes (EventBridge)
//   POST /shortcut/key, /shortcut/key/revoke  a key for the "Hey Siri" Shortcut, which calls
//   POST /shortcut/add { key, item } or { key, text }  without signing in (its own route in cloud.yaml)
//   POST /fetch-page { url }  opens a recipe page for "Recipe from a link" (a browser can't, because
//        of CORS); public addresses only, 2 MB and 10 seconds at most, 40 a day each
// Each person signs in with their own email. Someone who hasn't joined a household has
// their own, under their user id, so accounts made before households existed keep working.
const { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectVersionsCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { CognitoIdentityProviderClient, AdminDeleteUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const crypto = require('crypto');
const dns = require('dns');
// Shared with the self-hosted server; infra/build.mjs copies it in here for the template.
const { makeFetchPage } = require('../../web/modules/food/fetch-page'); // @inline
const { parse: parseChat, clauses: chatClauses } = require('../../web/modules/chat/parse'); // @inline
const s3 = new S3Client({});
const cognito = new CognitoIdentityProviderClient({});
const sns = new SNSClient({});
const FEEDBACK_PER_DAY = 10;
const PAGES_PER_DAY = 40;
const Bucket = process.env.BUCKET;
const ORIGINS = process.env.ORIGINS.split(' ');
const MAX = 2 * 1024 * 1024; // a busy household's data is well under this
const INVITE_DAYS = 7;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I mix-ups

let cors = {};
const reply = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json', ...cors }, body: JSON.stringify(body) });
const fail = (statusCode, error) => Object.assign(new Error(error), { statusCode });

async function getJson(Key) {
  try {
    const o = await s3.send(new GetObjectCommand({ Bucket, Key }));
    return { value: JSON.parse(await o.Body.transformToString()), rev: o.ETag, savedAt: o.LastModified };
  } catch (e) {
    if (e.name === 'NoSuchKey') return { value: null, rev: null };
    throw e;
  }
}
const putJson = (Key, value, extra = {}) => s3.send(new PutObjectCommand({ Bucket, Key, Body: JSON.stringify(value), ContentType: 'application/json', ...extra }));
// Read, change and save a file, trying again if something else saved it in between.
// change() returns the new value, or undefined to leave the file as it is.
async function update(Key, change) {
  for (let tries = 0; ; tries++) {
    const r = await getJson(Key);
    const next = await change(r.value);
    if (next === undefined) return r.value;
    try {
      await putJson(Key, next, r.rev ? { IfMatch: r.rev } : { IfNoneMatch: '*' });
      return next;
    } catch (e) {
      const status = e.$metadata && e.$metadata.httpStatusCode;
      if ((status !== 412 && status !== 409) || tries >= 2) throw e;
    }
  }
}

const memberKey = (sub) => `members/${sub}.json`;
const dataKey = (hid) => `households/${hid}.json`;
const peopleKey = (hid) => `households/${hid}.members.json`;
const inviteKey = (code) => `invites/${code}.json`;
const feedbackKey = (sub) => `members/${sub}.feedback.json`;
const pagesKey = (sub) => `members/${sub}.pages.json`;
const pushKey = (sub) => `members/${sub}.push.json`;
const shortcutKey = (sub) => `members/${sub}.shortcut.json`;
const lookupKey = (hash) => `shortcuts/${hash}.json`;

async function householdOf(sub) {
  const m = await getJson(memberKey(sub));
  return (m.value && m.value.householdId) || sub;
}
async function people(hid, me) {
  const p = (await getJson(peopleKey(hid))).value;
  return p && p.length ? p : [{ sub: me.sub, email: me.email, joinedAt: null }];
}
// Invites are only made by someone already on the list, so the list exists by the time anyone joins.
async function addPerson(hid, person) {
  const list = ((await getJson(peopleKey(hid))).value || []).filter((x) => x.sub !== person.sub);
  list.push({ sub: person.sub, email: person.email, joinedAt: new Date().toISOString() });
  await putJson(peopleKey(hid), list);
}

const routes = {
  async 'GET /data'(me) {
    const r = await getJson(dataKey(await householdOf(me.sub)));
    return { data: r.value, rev: r.rev, savedAt: r.savedAt };
  },
  async 'GET /rev'(me) {
    try {
      const o = await s3.send(new HeadObjectCommand({ Bucket, Key: dataKey(await householdOf(me.sub)) }));
      return { rev: o.ETag };
    } catch (e) {
      if (e.name === 'NotFound' || (e.$metadata && e.$metadata.httpStatusCode === 404)) return { rev: null };
      throw e;
    }
  },
  async 'PUT /data'(me, body) {
    if (!body || !body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw fail(400, 'Nothing to save');
    const Key = dataKey(await householdOf(me.sub));
    const condition = body.baseRev ? { IfMatch: body.baseRev } : { IfNoneMatch: '*' };
    try {
      const o = await putJson(Key, body.data, condition);
      return { rev: o.ETag };
    } catch (e) {
      const status = e.$metadata && e.$metadata.httpStatusCode;
      if (status !== 412 && status !== 409) throw e;
      const r = await getJson(Key);
      return Object.assign(reply(409, { error: 'Changed on another device', data: r.value, rev: r.rev, savedAt: r.savedAt }), { raw: true });
    }
  },
  async 'GET /household'(me) {
    const hid = await householdOf(me.sub);
    const list = await people(hid, me);
    return {
      shared: list.length > 1,
      joined: hid !== me.sub,
      members: list.map((p) => ({ email: p.sub === me.sub ? me.email : p.email || 'The person who set it up', you: p.sub === me.sub })),
    };
  },
  async 'POST /invite'(me) {
    const hid = await householdOf(me.sub);
    // Whoever set the household up goes on the list before anyone joins.
    if (!(await getJson(peopleKey(hid))).value) await putJson(peopleKey(hid), [{ sub: me.sub, email: me.email, joinedAt: new Date().toISOString() }]);
    const code = Array.from(crypto.randomBytes(8), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
    const expires = new Date(Date.now() + INVITE_DAYS * 86400000).toISOString();
    await putJson(inviteKey(code), { householdId: hid, by: me.email, bySub: me.sub, expires });
    return { code, expires, days: INVITE_DAYS };
  },
  async 'POST /join'(me, body) {
    const code = String((body && body.code) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 8) throw fail(400, 'Invite codes are 8 letters and numbers.');
    const inv = (await getJson(inviteKey(code))).value;
    const gone = () => fail(404, "That code isn't right or has expired. Ask for a new one.");
    if (!inv || !(new Date(inv.expires) > new Date())) throw gone();
    if (inv.householdId === (await householdOf(me.sub))) return { ok: true, already: true };
    // The code only works while the person who made it is still in that household.
    if (inv.bySub) {
      const list = (await getJson(peopleKey(inv.householdId))).value || [];
      if (!list.some((p) => p.sub === inv.bySub)) {
        await s3.send(new DeleteObjectCommand({ Bucket, Key: inviteKey(code) }));
        throw gone();
      }
    }
    // Each code lets one person in, so a code that gets passed around can't be reused.
    await s3.send(new DeleteObjectCommand({ Bucket, Key: inviteKey(code) }));
    await leave(me);
    await putJson(memberKey(me.sub), { householdId: inv.householdId, joinedAt: new Date().toISOString() });
    await addPerson(inv.householdId, me);
    return { ok: true, invitedBy: inv.by };
  },
  async 'POST /leave'(me) {
    if ((await householdOf(me.sub)) === me.sub) throw fail(400, "You're not in anyone else's household.");
    await leave(me);
    return { ok: true };
  },
};

// Takes this person off their current household's list. Someone who joined goes back to their
// own household; the person who set one up stays in it (and is just taken off the list if
// they're joining someone else's).
async function leave(me) {
  const hid = await householdOf(me.sub);
  const list = (await getJson(peopleKey(hid))).value;
  if (list) await putJson(peopleKey(hid), list.filter((p) => p.sub !== me.sub));
  if (hid !== me.sub) await s3.send(new DeleteObjectCommand({ Bucket, Key: memberKey(me.sub) }));
}

// Removes a file and every earlier copy of it the bucket keeps (versioning), so deleted data
// can't be brought back.
async function purge(Key, keepCurrent = false) {
  const r = await s3.send(new ListObjectVersionsCommand({ Bucket, Prefix: Key }));
  const all = [...(r.Versions || []), ...(r.DeleteMarkers || [])].filter((v) => v.Key === Key && !(keepCurrent && v.IsLatest));
  for (const v of all) await s3.send(new DeleteObjectCommand({ Bucket, Key, VersionId: v.VersionId }));
}

// Takes an email out of shared data: values equal to it (like "added by") and keys named after it
// (like the shopping list's names). The rest of the household's data is left alone.
function scrub(v, email) {
  if (Array.isArray(v)) return v.map((x) => scrub(x, email));
  if (!v || typeof v !== 'object') return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (k.toLowerCase() === email || (typeof x === 'string' && x.toLowerCase() === email)) continue;
    out[k] = scrub(x, email);
  }
  return out;
}

// For each household this person belongs to (their own, and one they joined): if nobody else is
// left, its data goes; otherwise the others keep it, with this person's email taken out.
async function forgetHousehold(hid, me) {
  const list = ((await getJson(peopleKey(hid))).value || []).filter((p) => p.sub !== me.sub);
  if (!list.length) {
    await purge(dataKey(hid));
    await purge(peopleKey(hid));
    return;
  }
  await putJson(peopleKey(hid), list);
  await purge(peopleKey(hid), true);
  if (me.ownEmail) {
    for (let tries = 0; tries < 3; tries++) {
      const r = await getJson(dataKey(hid));
      if (!r.value) break;
      try {
        await putJson(dataKey(hid), scrub(r.value, me.ownEmail.toLowerCase()), { IfMatch: r.rev });
        break;
      } catch (e) {
        if (!e.$metadata || e.$metadata.httpStatusCode !== 412) throw e;
      }
    }
    await purge(dataKey(hid), true);
  }
}

routes['POST /feedback'] = async (me, body) => {
  const text = String((body && body.text) || '').trim().slice(0, 2000);
  if (!text) throw fail(400, 'Write something first.');
  if (!process.env.FEEDBACK_TOPIC) throw fail(503, "Feedback isn't set up yet.");
  const today = new Date().toISOString().slice(0, 10);
  const sent = (await getJson(feedbackKey(me.sub))).value;
  const count = sent && sent.day === today ? sent.count : 0;
  if (count >= FEEDBACK_PER_DAY) throw fail(429, "That's a lot of feedback for one day. Thank you! Try again tomorrow.");
  await putJson(feedbackKey(me.sub), { day: today, count: count + 1 });
  const page = String((body && body.page) || '').replace(/[^\w -]/g, '').slice(0, 30);
  await sns.send(new PublishCommand({
    TopicArn: process.env.FEEDBACK_TOPIC,
    Subject: 'Family Planner feedback',
    Message: `From: ${me.ownEmail || 'someone signed in'}\nPage: ${page || 'not given'}\n\n${text}`,
  }));
  return { ok: true };
};

// Recipe from a link: the app can't open other sites' pages itself, so this opens one for it.
let fetchPage = null;
routes['POST /fetch-page'] = async (me, body) => {
  const url = String((body && body.url) || '').trim();
  if (!/^https?:\/\//i.test(url) || url.length > 2000) throw fail(400, 'Use a link starting with http:// or https://');
  const today = new Date().toISOString().slice(0, 10);
  const used = (await getJson(pagesKey(me.sub))).value;
  const count = used && used.day === today ? used.count : 0;
  if (count >= PAGES_PER_DAY) throw fail(429, "That's a lot of recipe links for one day. Paste the recipe instead, or try again tomorrow.");
  await putJson(pagesKey(me.sub), { day: today, count: count + 1 });
  fetchPage ||= makeFetchPage({ lookup: (host) => dns.promises.lookup(host, { all: true, verbatim: true }) });
  try {
    return { html: await fetchPage(url) };
  } catch (e) {
    throw fail(e.status || 502, e.message || "Couldn't open that page");
  }
};

routes['POST /delete-account'] = async (me) => {
  const hid = await householdOf(me.sub);
  for (const h of new Set([hid, me.sub])) await forgetHousehold(h, me);
  await purge(memberKey(me.sub));
  await purge(feedbackKey(me.sub));
  await purge(pagesKey(me.sub));
  await purge(pushKey(me.sub));
  const siri = (await getJson(shortcutKey(me.sub))).value;
  if (siri) await purge(lookupKey(siri.hash));
  await purge(shortcutKey(me.sub));
  // Invite codes this person made (they'd stop working anyway, but they hold their email).
  const inv = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: 'invites/' }));
  for (const o of inv.Contents || []) {
    const i = (await getJson(o.Key)).value;
    if (i && i.bySub === me.sub) await purge(o.Key);
  }
  await cognito.send(new AdminDeleteUserCommand({ UserPoolId: process.env.USER_POOL_ID, Username: me.username }));
  return { ok: true };
};

// ---------- Web Push: reminders on a home screen app ----------
// iPhones (iOS 16.4+) show notifications from web apps added to the home screen. Each phone
// gives us a subscription (an address at Apple's, Google's, Microsoft's or Mozilla's push
// service, plus keys); the phone uploads its reminders for the next few days, and every 15
// minutes this function sends the ones that are due. Only Node's crypto is needed:
// VAPID (RFC 8292) says who is sending, and RFC 8291 encrypts the message for that phone.
const PUSH_HOSTS = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /\.notify\.windows\.com$/, /^updates\.push\.services\.mozilla\.com$/];
const MAX_SCHEDULE = 40;
const MAX_SUBS = 10; // phones and browsers per person
const LATE = 6 * 3600000; // a reminder more than 6 hours late isn't sent
const KEEP_SENT = 30 * 86400000;
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const unb64 = (s) => Buffer.from(String(s || ''), 'base64url');
const clip = (v, max) => String(v ?? '').trim().slice(0, max);

let vapidKey = null;
function vapid() {
  const pub = unb64(process.env.VAPID_PUBLIC);
  const d = unb64(process.env.VAPID_PRIVATE);
  if (pub.length !== 65 || d.length !== 32) throw fail(503, "Notifications aren't set up yet.");
  vapidKey ||= crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: b64(d), x: b64(pub.subarray(1, 33)), y: b64(pub.subarray(33)) }, format: 'jwk' });
  return { key: vapidKey, publicKey: process.env.VAPID_PUBLIC };
}

// The Authorization header: a short-lived token signed with our private key (ES256).
function vapidAuth(endpoint) {
  const { key, publicKey } = vapid();
  const header = b64(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: process.env.VAPID_SUBJECT || 'https://main.d3ofenwxb2m5fu.amplifyapp.com' }));
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64(sig)}, k=${publicKey}`;
}

// RFC 8291: encrypts the message so only the phone that subscribed can read it (aes128gcm).
function encrypt(sub, text) {
  const uaPublic = unb64(sub.keys.p256dh);
  const auth = unb64(sub.keys.auth);
  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));
  const ikm = hkdf(auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const salt = crypto.randomBytes(16);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(text), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

// Sends one notification. Returns the push service's status: 201 is delivered, 404 or 410
// means the phone has turned notifications off (or the app was removed).
async function push(sub, message) {
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: vapidAuth(sub.endpoint), TTL: '86400', Urgency: 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream' },
    body: encrypt(sub, JSON.stringify(message)),
  });
  return res.status;
}
const delivered = (status) => status >= 200 && status < 300;
const gone = (status) => status === 404 || status === 410;

function checkSubscription(s) {
  let url;
  try { url = new URL(s.endpoint); } catch { url = null; }
  if (!url || url.protocol !== 'https:' || String(s.endpoint).length > 1000 || !PUSH_HOSTS.some((re) => re.test(url.hostname))) throw fail(400, "That isn't a push address this app can use.");
  if (unb64(s.keys && s.keys.p256dh).length !== 65 || unb64(s.keys && s.keys.auth).length !== 16) throw fail(400, 'The notification keys are missing.');
  return { endpoint: url.href, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, addedAt: new Date().toISOString() };
}

// Reminders already sent are remembered for 30 days, so the same one isn't sent twice.
function tidy(p) {
  const old = Date.now() - KEEP_SENT;
  const sent = {};
  for (const [id, at] of Object.entries((p && p.sent) || {})) if (new Date(at) > old) sent[id] = at;
  return { subs: (p && p.subs) || [], schedule: (p && p.schedule) || [], sent };
}
const withoutSubs = (p, endpoints) => {
  const next = tidy(p);
  next.subs = next.subs.filter((s) => !endpoints.includes(s.endpoint));
  return next;
};

routes['GET /push/key'] = async () => ({ publicKey: vapid().publicKey });

routes['POST /push/subscribe'] = async (me, body) => {
  const sub = checkSubscription((body && body.subscription) || {});
  await update(pushKey(me.sub), (p) => {
    const next = withoutSubs(p, [sub.endpoint]);
    next.subs = [...next.subs, sub].slice(-MAX_SUBS);
    return next;
  });
  return { ok: true };
};

routes['POST /push/unsubscribe'] = async (me, body) => {
  const endpoint = String((body && body.endpoint) || '');
  await update(pushKey(me.sub), (p) => (p ? withoutSubs(p, [endpoint]) : undefined));
  return { ok: true };
};

routes['POST /push/schedule'] = async (me, body) => {
  if (!body || !Array.isArray(body.items)) throw fail(400, 'Send a list of reminders.');
  const schedule = [];
  for (const i of body.items.slice(0, MAX_SCHEDULE)) {
    const at = new Date(i && i.at);
    const id = clip(i && i.id, 100);
    if (!id || isNaN(at)) continue;
    schedule.push({ id, at: at.toISOString(), title: clip(i.title, 100), body: clip(i.body, 300) });
  }
  await update(pushKey(me.sub), (p) => ({ ...tidy(p), schedule }));
  return { ok: true, count: schedule.length };
};

routes['POST /push/test'] = async (me) => {
  const p = (await getJson(pushKey(me.sub))).value;
  if (!p || !p.subs || !p.subs.length) throw fail(400, 'Turn notifications on first.');
  const results = await Promise.all(p.subs.map((s) => push(s, { title: 'Family Planner', body: 'Notifications are on', tag: 'test' }).catch(() => 0)));
  const dead = p.subs.filter((s, i) => gone(results[i])).map((s) => s.endpoint);
  if (dead.length) await update(pushKey(me.sub), (q) => (q ? withoutSubs(q, dead) : undefined));
  return { ok: true, sent: results.filter(delivered).length };
};

// Every 15 minutes: send each person's reminders that are due (and no more than 6 hours late).
async function sendDue(now = Date.now()) {
  const keys = [];
  let ContinuationToken;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: 'members/', ContinuationToken }));
    for (const o of r.Contents || []) if (o.Key.endsWith('.push.json')) keys.push(o.Key);
    ContinuationToken = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (ContinuationToken);
  let sent = 0;
  for (const Key of keys) {
    const p = (await getJson(Key)).value;
    if (!p || !p.subs || !p.subs.length) continue;
    const due = (p.schedule || []).filter((i) => {
      const at = new Date(i.at).getTime();
      return at <= now && at > now - LATE && (p.sent || {})[i.id] !== i.at;
    });
    if (!due.length) continue;
    const dead = [];
    const done = [];
    for (const item of due) {
      const subs = p.subs.filter((s) => !dead.includes(s.endpoint));
      const results = await Promise.all(subs.map((s) => push(s, { title: 'Family Planner', body: item.body, tag: item.id }).catch(() => 0)));
      subs.forEach((s, i) => gone(results[i]) && dead.push(s.endpoint));
      // If a push service was having trouble, it's tried again next time.
      if (results.every((r) => delivered(r) || gone(r))) done.push(item);
      sent += results.filter(delivered).length;
    }
    await update(Key, (q) => {
      if (!q) return undefined;
      const next = withoutSubs(q, dead);
      for (const item of done) next.sent[item.id] = item.at;
      return next;
    });
  }
  return { checked: keys.length, sent };
}

// ---------- "Hey Siri, add milk" ----------
// A Shortcut on the iPhone sends { key, item } to POST /shortcut/add. The key is made here and
// shown once in Settings. Only its sha256 is kept, in members/<sub>.shortcut.json, with
// shortcuts/<sha256>.json saying whose it is.
const SIRI_PER_DAY = 60;
const WRONG_KEY = "That Siri key isn't right. Set it up again in Settings.";
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
// Matches names the way the shopping list does (web/modules/shopping/habits.js norm).
const sameName = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/(es|s)$/, '');

async function revokeShortcut(sub) {
  const old = (await getJson(shortcutKey(sub))).value;
  if (old) await s3.send(new DeleteObjectCommand({ Bucket, Key: lookupKey(old.hash) }));
  await s3.send(new DeleteObjectCommand({ Bucket, Key: shortcutKey(sub) }));
}

// Making a new key turns the old one off.
routes['POST /shortcut/key'] = async (me) => {
  await revokeShortcut(me.sub);
  const key = crypto.randomBytes(32).toString('base64url');
  const hash = sha256(key);
  await putJson(lookupKey(hash), { sub: me.sub });
  await putJson(shortcutKey(me.sub), { hash, createdAt: new Date().toISOString(), email: me.email });
  return { key };
};

routes['POST /shortcut/key/revoke'] = async (me) => {
  await revokeShortcut(me.sub);
  return { ok: true };
};

// "milk and eggs" or "Milk, eggs." -> ['milk', 'eggs'], up to 10 things.
function splitItems(text) {
  return String(text || '').split(/\s*(?:,|;|\n|&|\band\b)\s*/i)
    .map((s) => s.replace(/^[\s.!?]+|[\s.!?]+$/g, '').slice(0, 80))
    .filter(Boolean)
    .slice(0, 10);
}
const listed = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]);

// No sign-in here: the key is the password. The Shortcut reads "message" out loud.
async function shortcutAdd(body) {
  const answer = (status, message, extra = {}) => reply(status, { ok: status === 200, message, ...(status === 200 ? {} : { error: message }), ...extra });
  const key = String((body && body.key) || '');
  if (!/^[\w-]{43}$/.test(key)) return answer(403, WRONG_KEY);
  const lookup = await getJson(lookupKey(sha256(key)));
  if (!lookup.value) return answer(403, WRONG_KEY);
  const said = typeof (body && body.text) === 'string' ? body.text.trim().slice(0, 400) : null;
  const item = String((body && body.item) || '');
  const names = item.length <= 400 ? splitItems(item) : [];
  if (said === null ? !names.length : !said) return answer(400, "I didn't catch what to add. Try again.");
  const today = new Date().toISOString().slice(0, 10);
  const count = lookup.value.day === today ? lookup.value.count || 0 : 0;
  if (count >= SIRI_PER_DAY) return answer(429, "That's a lot for one day. Add the rest in the app.");
  await putJson(lookupKey(sha256(key)), { ...lookup.value, day: today, count: count + 1 });
  const { sub } = lookup.value;
  const owner = (await getJson(shortcutKey(sub))).value || {};
  if (said !== null) return shortcutSay(said, sub, owner, answer);
  let added = [];
  let already = [];
  await update(dataKey(await householdOf(sub)), (data) => {
    added = [];
    already = [];
    const next = data || {};
    next.shopping ||= { items: [] };
    next.shopping.items ||= [];
    const have = new Set(next.shopping.items.filter((i) => !i.done).map((i) => sameName(i.name)));
    for (const name of names) {
      if (have.has(sameName(name))) {
        already.push(name);
        continue;
      }
      have.add(sameName(name));
      // The same shape as food added in the app (web/modules/shopping/index.js newItem).
      next.shopping.items.push({ id: crypto.randomUUID(), addedAt: new Date().toISOString(), name, kind: 'food', done: false, ...(owner.email ? { addedBy: owner.email } : {}) });
      added.push(name);
    }
    return added.length ? next : undefined;
  });
  const message = [
    added.length && `Added ${listed(added)} to the shopping list`,
    already.length && `${listed(already)} ${already.length > 1 ? 'were' : 'was'} already on it`,
  ].filter(Boolean).join('. ');
  return answer(200, message, { added });
}

// "Hey Siri, tell Family Planner we need milk and Leo did the bins": a whole sentence, { key, text }.
// The chat's rules (web/modules/chat/parse.js, copied in by infra/build.mjs) do what they can here:
// shopping, chores done and spending. Anything else (a question, a Diary event, or something the
// rules don't follow) waits in the household's chat inbox for the person's own app, which hands it
// to their chat (and their AI, whose key never leaves their phone) next time it opens.
async function shortcutSay(text, sub, owner, answer) {
  const lines = [];
  let later = false;
  const now = new Date().toISOString();
  await update(dataKey(await householdOf(sub)), (data) => {
    lines.length = 0;
    later = false;
    const next = data || {};
    next.shopping ||= { items: [] };
    next.shopping.items ||= [];
    const family = next.family || {};
    const children = Array.isArray(family.children) ? family.children : [];
    const chores = next.chores && Array.isArray(next.chores.list) ? next.chores : null;
    const people = [...(chores && Array.isArray(chores.adults) ? chores.adults : []), ...children];
    const ctx = {
      today: now.slice(0, 10),
      people,
      children,
      shopping: next.shopping.items,
      pantry: next.food && Array.isArray(next.food.pantry) ? next.food.pantry : [],
      chores: chores ? chores.list : [],
      events: next.calendar && Array.isArray(next.calendar.events) ? next.calendar.events : [],
    };
    // One part of the sentence at a time, so only the parts not done here go to the app.
    const rest = [];
    const doable = new Set(['shopping.add', 'chores.done', 'money.spend']);
    const actions = [];
    for (const part of chatClauses(text, ctx)) {
      const r = parseChat(part, ctx);
      if (r.actions.length && !r.unknown.length && r.actions.every((a) => doable.has(a.name) && (a.name !== 'chores.done' || chores) && (a.name !== 'money.spend' || (a.args.amount > 0 && a.args.amount <= 5000)))) actions.push(...r.actions);
      else rest.push(part);
    }
    for (const a of actions) {
      if (a.name === 'shopping.add') {
        const have = new Set(next.shopping.items.filter((i) => !i.done).map((i) => sameName(i.name)));
        const added = [];
        for (const it of a.args.items.slice(0, 20)) {
          if (have.has(sameName(it.name))) continue;
          have.add(sameName(it.name));
          next.shopping.items.push({ id: crypto.randomUUID(), addedAt: now, name: it.name, kind: it.kind || 'food', done: false, ...(it.quantity ? { quantity: it.quantity } : {}), ...(it.unit ? { unit: it.unit } : {}), ...(owner.email ? { addedBy: owner.email } : {}) });
          added.push(it.name);
        }
        lines.push(added.length ? `Added ${listed(added)} to the shopping list` : `${listed(a.args.items.map((i) => i.name))} ${a.args.items.length > 1 ? 'were' : 'was'} already on the list`);
      } else if (a.name === 'chores.done' && chores) {
        const c = chores.list.find((x) => x.id === a.args.choreId);
        const by = people.find((p) => p.id === a.args.by);
        if (!c) continue;
        // The same shape as a tick in the app (web/modules/chores/index.js).
        chores.log ||= [];
        chores.log.push({ id: crypto.randomUUID(), choreId: c.id, name: c.name, by: by ? by.id : c.who || null, effort: c.effort || 1, at: now, before: c.lastDone || null, ...(owner.email ? { tickedBy: owner.email } : {}) });
        if (chores.log.length > 600) chores.log.splice(0, chores.log.length - 600);
        c.lastDone = now;
        delete c.snoozedUntil;
        lines.push(`${by ? by.name + ' did' : 'Done:'} ${c.name.charAt(0).toLowerCase()}${c.name.slice(1)}`);
      } else if (a.name === 'money.spend' && a.args.amount > 0 && a.args.amount <= 5000) {
        next.shopping.spending ||= [];
        const amount = Math.round(a.args.amount * 100) / 100;
        next.shopping.spending.push({ id: crypto.randomUUID(), amount, date: now.slice(0, 10), shop: a.args.shop ? String(a.args.shop).slice(0, 40) : null, ...(a.args.category && a.args.category !== 'food' ? { category: a.args.category } : {}), ...(owner.email ? { addedBy: owner.email } : {}) });
        lines.push(`Recorded £${amount.toFixed(2)}${a.args.shop ? ' at ' + a.args.shop : ''}`);
      }
    }
    if (rest.length && owner.email) {
      next.chat ||= {};
      next.chat.inbox = (Array.isArray(next.chat.inbox) ? next.chat.inbox : []).slice(-49);
      next.chat.inbox.push({ id: crypto.randomUUID(), text: rest.join('. '), at: now, by: owner.email });
      later = true;
    }
    return lines.length || later ? next : undefined;
  });
  if (!lines.length && !later) return answer(200, "I couldn't do that from Siri. Try it in the app's chat.", { done: [] });
  const message = [lines.join('. '), later && (lines.length ? "I'll do the rest when you next open the app" : "I'll do that when you next open the app")].filter(Boolean).join('. ');
  return answer(200, message, { done: lines, later });
}

exports.handler = async (event) => {
  // EventBridge's 15-minute schedule (PushSchedule in infra/cloud.yaml).
  if (event.source === 'aws.events' || !event.requestContext) return sendDue();
  const origin = event.headers && event.headers.origin;
  cors = ORIGINS.includes(origin) ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,PUT,POST', 'access-control-max-age': '3600', vary: 'origin' } : {};
  const method = event.requestContext.http.method;
  if (method === 'OPTIONS') return { statusCode: 204, headers: cors };
  const route = routes[`${method} ${event.rawPath}`];
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : event.body || '';
  // The Siri Shortcut's route has no sign-in (see shortcutAdd).
  if (`${method} ${event.rawPath}` === 'POST /shortcut/add') {
    if (raw.length > 4000) return reply(413, { error: 'Too long', message: "That's too much to add at once." });
    let body;
    try { body = JSON.parse(raw || '{}'); } catch { return reply(400, { error: 'Not JSON', message: "The Shortcut isn't set up right. Set it up again in Settings." }); }
    return shortcutAdd(body);
  }
  if (!route) return reply(404, { error: 'Not found' });
  const auth = event.requestContext.authorizer;
  const claims = auth && auth.jwt && auth.jwt.claims;
  if (!claims || !claims.sub) return reply(401, { error: 'Sign in first' });
  // An email that hasn't been confirmed isn't shown to the household as who someone is.
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  const me = { sub: claims.sub, email: (verified && claims.email) || null, username: claims['cognito:username'] || claims.sub, ownEmail: claims.email || null };
  if (raw.length > MAX) return reply(413, { error: 'Too much data to save' });
  let body = null;
  if (raw) {
    try { body = JSON.parse(raw); } catch { return reply(400, { error: 'Not JSON' }); }
  }
  try {
    const out = await route(me, body);
    return out && out.raw ? (delete out.raw, out) : reply(200, out);
  } catch (e) {
    if (e.statusCode) return reply(e.statusCode, { error: e.message });
    throw e;
  }
};
