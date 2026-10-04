// Household data API behind Cognito sign-in. Deployed inline by infra/cloud.yaml: run
// `node infra/build.mjs` after editing to copy this file into the template.
//   GET  /data       the household's saved data       PUT /data { data, baseRev }
//   GET  /household  who's in the household           POST /invite -> { code }
//   POST /join { code }  join another household       POST /leave
// Each person signs in with their own email. Someone who hasn't joined a household has
// their own, under their user id, so accounts made before households existed keep working.
const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const s3 = new S3Client({});
const Bucket = process.env.BUCKET;
const ORIGINS = process.env.ORIGINS.split(' ');
const MAX = 5 * 1024 * 1024;
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

const memberKey = (sub) => `members/${sub}.json`;
const dataKey = (hid) => `households/${hid}.json`;
const peopleKey = (hid) => `households/${hid}.members.json`;
const inviteKey = (code) => `invites/${code}.json`;

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
    await putJson(inviteKey(code), { householdId: hid, by: me.email, expires });
    return { code, expires, days: INVITE_DAYS };
  },
  async 'POST /join'(me, body) {
    const code = String((body && body.code) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 8) throw fail(400, 'Invite codes are 8 letters and numbers.');
    const inv = (await getJson(inviteKey(code))).value;
    if (!inv || new Date(inv.expires) < new Date()) throw fail(404, "That code isn't right or has expired. Ask for a new one.");
    if (inv.householdId === (await householdOf(me.sub))) return { ok: true, already: true };
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

exports.handler = async (event) => {
  const origin = event.headers && event.headers.origin;
  cors = ORIGINS.includes(origin) ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,PUT,POST', 'access-control-max-age': '3600', vary: 'origin' } : {};
  const method = event.requestContext.http.method;
  if (method === 'OPTIONS') return { statusCode: 204, headers: cors };
  const route = routes[`${method} ${event.rawPath}`];
  if (!route) return reply(404, { error: 'Not found' });
  const claims = event.requestContext.authorizer.jwt.claims;
  const me = { sub: claims.sub, email: claims.email || null };
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : event.body || '';
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
