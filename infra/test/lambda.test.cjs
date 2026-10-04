// Runs the household Lambda against an in-memory S3: separate logins sharing one household.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const files = new Map();
let tag = 0;
class Cmd { constructor(input) { this.input = input; } }
const fakeS3 = {
  GetObjectCommand: class extends Cmd {},
  HeadObjectCommand: class extends Cmd {},
  PutObjectCommand: class extends Cmd {},
  DeleteObjectCommand: class extends Cmd {},
  ListObjectVersionsCommand: class extends Cmd {},
  ListObjectsV2Command: class extends Cmd {},
  S3Client: class {
    async send(cmd) {
      const { Key } = cmd.input;
      // One version per file here: the current one.
      if (cmd instanceof fakeS3.ListObjectVersionsCommand) {
        return { Versions: [...files.keys()].filter((k) => k.startsWith(cmd.input.Prefix)).map((k) => ({ Key: k, VersionId: 'now', IsLatest: true })) };
      }
      if (cmd instanceof fakeS3.ListObjectsV2Command) return { Contents: [...files.keys()].filter((k) => k.startsWith(cmd.input.Prefix)).map((k) => ({ Key: k })) };
      const f = files.get(Key);
      if (cmd instanceof fakeS3.GetObjectCommand) {
        if (!f) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
        return { Body: { transformToString: async () => f.body }, ETag: f.etag, LastModified: new Date() };
      }
      if (cmd instanceof fakeS3.HeadObjectCommand) {
        if (!f) throw Object.assign(new Error('missing'), { name: 'NotFound' });
        return { ETag: f.etag };
      }
      if (cmd instanceof fakeS3.PutObjectCommand) {
        if ((cmd.input.IfNoneMatch && f) || (cmd.input.IfMatch && (!f || f.etag !== cmd.input.IfMatch))) throw Object.assign(new Error('precondition'), { $metadata: { httpStatusCode: 412 } });
        const etag = `"${++tag}"`;
        files.set(Key, { body: cmd.input.Body, etag });
        return { ETag: etag };
      }
      files.delete(Key);
      return {};
    }
  },
};
const deletedUsers = [];
const fakeCognito = {
  AdminDeleteUserCommand: class extends Cmd {},
  CognitoIdentityProviderClient: class { async send(cmd) { deletedUsers.push(cmd.input); return {}; } },
};
const published = [];
const fakeSns = {
  PublishCommand: class extends Cmd {},
  SNSClient: class { async send(cmd) { published.push(cmd.input); return {}; } },
};
const load = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@aws-sdk/client-s3') return fakeS3;
  if (req === '@aws-sdk/client-cognito-identity-provider') return fakeCognito;
  if (req === '@aws-sdk/client-sns') return fakeSns;
  return load.call(this, req, ...rest);
};
process.env.BUCKET = 'test';
process.env.USER_POOL_ID = 'pool';
process.env.FEEDBACK_TOPIC = 'topic';
process.env.ORIGINS = 'https://app.example';
const { handler } = require('../lambda/index.js');

const call = async (who, method, path, body) => {
  const r = await handler({
    headers: { origin: 'https://app.example' },
    rawPath: path,
    body: body && JSON.stringify(body),
    requestContext: { http: { method }, authorizer: { jwt: { claims: { sub: who, email: `${who}@example.com`, email_verified: 'true' } } } },
  });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null, headers: r.headers };
};
const save = async (who, data) => {
  const cur = await call(who, 'GET', '/data');
  return call(who, 'PUT', '/data', { data, baseRev: cur.body.rev });
};

test('existing single-login accounts keep their data', async () => {
  assert.equal((await call('mum', 'PUT', '/data', { data: { pantry: ['pasta'] } })).status, 200);
  assert.deepEqual((await call('mum', 'GET', '/data')).body.data, { pantry: ['pasta'] });
  const h = await call('mum', 'GET', '/household');
  assert.deepEqual(h.body, { shared: false, joined: false, members: [{ email: 'mum@example.com', you: true }] });
});

test('a second person joins with an invite code and shares the data', async () => {
  await call('dad', 'PUT', '/data', { data: { pantry: ['dad old stuff'] } });
  const inv = await call('mum', 'POST', '/invite');
  assert.equal(inv.status, 200);
  assert.match(inv.body.code, /^[A-HJ-NP-Z2-9]{8}$/);
  const bad = await call('dad', 'POST', '/join', { code: 'ZZZZZZZZ' });
  assert.equal(bad.status, 404);
  const pretty = inv.body.code.slice(0, 4).toLowerCase() + '-' + inv.body.code.slice(4);
  const join = await call('dad', 'POST', '/join', { code: pretty });
  assert.deepEqual(join.body, { ok: true, invitedBy: 'mum@example.com' });
  assert.deepEqual((await call('dad', 'GET', '/data')).body.data, { pantry: ['pasta'] });
  const h = await call('mum', 'GET', '/household');
  assert.deepEqual(h.body.members.map((m) => m.email), ['mum@example.com', 'dad@example.com']);
  assert.equal(h.body.shared, true);
  assert.equal((await call('dad', 'GET', '/household')).body.joined, true);
});

test('either person saving changes the one household file, and clashes still 409', async () => {
  assert.equal((await save('dad', { pantry: ['pasta', 'rice'] })).status, 200);
  assert.deepEqual((await call('mum', 'GET', '/data')).body.data, { pantry: ['pasta', 'rice'] });
  const stale = (await call('mum', 'GET', '/data')).body.rev;
  await save('dad', { pantry: ['rice'] });
  const clash = await call('mum', 'PUT', '/data', { data: { pantry: [] }, baseRev: stale });
  assert.equal(clash.status, 409);
  assert.deepEqual(clash.body.data, { pantry: ['rice'] });
});

test('the version check matches the saved data, for whoever asks in the household', async () => {
  const data = await call('dad', 'GET', '/data');
  assert.deepStrictEqual((await call('mum', 'GET', '/rev')).body, { rev: data.body.rev });
  assert.deepStrictEqual((await call('nobody', 'GET', '/rev')).body, { rev: null });
});

test('a third person can be invited by someone who joined', async () => {
  const inv = await call('dad', 'POST', '/invite');
  await call('gran', 'POST', '/join', { code: inv.body.code });
  assert.deepEqual((await call('gran', 'GET', '/data')).body.data, { pantry: ['rice'] });
  assert.equal((await call('mum', 'GET', '/household')).body.members.length, 3);
  // Each code lets one person in.
  assert.equal((await call('stranger', 'POST', '/join', { code: inv.body.code })).status, 404);
  assert.deepEqual((await call('stranger', 'GET', '/data')).body.data, null);
});

test("a code stops working once the person who made it has left that household", async () => {
  const inv = await call('gran', 'POST', '/invite');
  const mumsHousehold = (await call('gran', 'GET', '/data')).body.data;
  assert.equal((await call('gran', 'POST', '/leave')).status, 200);
  assert.equal((await call('stranger', 'POST', '/join', { code: inv.body.code })).status, 404);
  assert.notDeepEqual((await call('stranger', 'GET', '/data')).body.data, mumsHousehold);
  await call('gran', 'POST', '/join', { code: (await call('mum', 'POST', '/invite')).body.code });
});

test('an email address that has not been confirmed is not shown to the household', async () => {
  const r = await handler({
    headers: {},
    rawPath: '/household',
    requestContext: { http: { method: 'GET' }, authorizer: { jwt: { claims: { sub: 'unconfirmed', email: 'mum@example.com', email_verified: 'false' } } } },
  });
  assert.deepEqual(JSON.parse(r.body).members, [{ email: null, you: true }]);
});

test('leaving goes back to your own household; the founder cannot leave their own', async () => {
  assert.equal((await call('mum', 'POST', '/leave')).status, 400);
  assert.equal((await call('dad', 'POST', '/leave')).status, 200);
  assert.deepEqual((await call('dad', 'GET', '/data')).body.data, { pantry: ['dad old stuff'] });
  assert.deepEqual((await call('mum', 'GET', '/household')).body.members.map((m) => m.email), ['mum@example.com', 'gran@example.com']);
  assert.deepEqual((await call('dad', 'GET', '/household')).body.members, [{ email: 'dad@example.com', you: true }]);
});

test('CORS, unknown routes and bad bodies', async () => {
  const pre = await handler({ headers: { origin: 'https://app.example' }, rawPath: '/join', requestContext: { http: { method: 'OPTIONS' } } });
  assert.equal(pre.statusCode, 204);
  assert.match(pre.headers['access-control-allow-methods'], /POST/);
  assert.equal((await call('mum', 'GET', '/nope')).status, 404);
  assert.equal((await call('mum', 'PUT', '/data', [])).status, 400);
  assert.equal((await call('mum', 'POST', '/join', { code: 'abc' })).status, 400);
});

test('deleting an account takes the person out and leaves the others their data', async () => {
  // Mum set up the household; gran is in it too. Gran's name is on things she added.
  await save('mum', { shopping: { items: [{ name: 'tea', addedBy: 'gran@example.com' }, { name: 'milk', addedBy: 'mum@example.com' }], people: { 'gran@example.com': 'Gran' } } });
  const inv = await call('gran', 'POST', '/invite');
  assert.equal((await call('gran', 'POST', '/delete-account')).status, 200);
  assert.deepEqual(deletedUsers.at(-1), { UserPoolId: 'pool', Username: 'gran' });
  assert.deepEqual((await call('mum', 'GET', '/household')).body.members.map((m) => m.email), ['mum@example.com']);
  const left = (await call('mum', 'GET', '/data')).body.data;
  assert.deepEqual(left.shopping, { items: [{ name: 'tea' }, { name: 'milk', addedBy: 'mum@example.com' }], people: {} });
  assert.equal(JSON.stringify([...files.values()]).includes('gran@'), false);
  assert.equal(files.has(`invites/${inv.body.code}.json`), false);
  assert.equal([...files.keys()].some((k) => k.includes('gran')), false);
});

test('deleting the last person in a household removes its data', async () => {
  await call('solo', 'PUT', '/data', { data: { pantry: ['beans'] } });
  await call('solo', 'POST', '/invite');
  assert.equal((await call('solo', 'POST', '/delete-account')).status, 200);
  assert.equal([...files.keys()].some((k) => k.includes('solo')), false);
  assert.equal(JSON.stringify([...files.values()]).includes('solo@'), false);
  assert.deepEqual((await call('solo', 'GET', '/data')).body.data, null);
});

test('when the person who set up a household deletes their account, the others keep it', async () => {
  await call('dad', 'POST', '/join', { code: (await call('mum', 'POST', '/invite')).body.code });
  const before = (await call('dad', 'GET', '/data')).body.data;
  assert.equal((await call('mum', 'POST', '/delete-account')).status, 200);
  assert.deepEqual((await call('dad', 'GET', '/data')).body.data.shopping.items.map((i) => i.name), before.shopping.items.map((i) => i.name));
  assert.deepEqual((await call('dad', 'GET', '/household')).body.members, [{ email: 'dad@example.com', you: true }]);
  assert.equal(JSON.stringify([...files.values()]).includes('mum@'), false);
  // Dad can still save, and can still invite someone new.
  assert.equal((await save('dad', { pantry: ['eggs'] })).status, 200);
  assert.equal((await call('dad', 'POST', '/invite')).status, 200);
});

test('feedback is emailed to the owner with who sent it, up to 10 a day each', async () => {
  assert.equal((await call('fan', 'POST', '/feedback', { text: '   ' })).status, 400);
  const r = await call('fan', 'POST', '/feedback', { text: 'Love the kitchen screen', page: 'kitchen<script>' });
  assert.equal(r.status, 200);
  assert.equal(published.at(-1).TopicArn, 'topic');
  assert.equal(published.at(-1).Message, 'From: fan@example.com\nPage: kitchenscript\n\nLove the kitchen screen');
  for (let i = 0; i < 9; i++) await call('fan', 'POST', '/feedback', { text: 'again' });
  assert.equal((await call('fan', 'POST', '/feedback', { text: 'one more' })).status, 429);
  assert.equal((await call('other', 'POST', '/feedback', { text: 'hi' })).status, 200);
  await call('fan', 'POST', '/delete-account');
  assert.equal([...files.keys()].some((k) => k.includes('fan')), false);
});

test('recipe pages: only public web addresses, and 40 a day each', async () => {
  assert.equal((await call('cook', 'POST', '/fetch-page', { url: 'ftp://example.com/x' })).status, 400);
  const local = await call('cook', 'POST', '/fetch-page', { url: 'http://127.0.0.1/admin' });
  assert.equal(local.status, 400);
  assert.match(local.body.error, /private network/);
  assert.equal((await call('cook', 'POST', '/fetch-page', { url: 'http://169.254.169.254/latest/meta-data' })).status, 400);
  for (let i = 0; i < 38; i++) await call('cook', 'POST', '/fetch-page', { url: 'http://10.0.0.1/' });
  assert.equal((await call('cook', 'POST', '/fetch-page', { url: 'http://10.0.0.1/' })).status, 429);
  await call('cook', 'POST', '/delete-account');
  assert.equal([...files.keys()].some((k) => k.includes('cook')), false);
});

// ---------- Web Push ----------
const crypto = require('node:crypto');
const b64 = (b) => Buffer.from(b).toString('base64url');
// A phone's side of Web Push: its own keys, and decrypting what the push service delivers (RFC 8291).
function phone() {
  const ecdh = crypto.createECDH('prime256v1');
  const pub = ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    sub: (endpoint) => ({ endpoint, keys: { p256dh: b64(pub), auth: b64(auth) } }),
    read(body) {
      const salt = body.subarray(0, 16);
      assert.equal(body.readUInt32BE(16), 4096);
      const idlen = body[20];
      const asPublic = body.subarray(21, 21 + idlen);
      const hkdf = (s, ikm, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, s, info, len));
      const ikm = hkdf(auth, ecdh.computeSecret(asPublic), Buffer.concat([Buffer.from('WebPush: info\0'), pub, asPublic]), 32);
      const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
      const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
      const data = body.subarray(21 + idlen);
      const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
      d.setAuthTag(data.subarray(-16));
      const plain = Buffer.concat([d.update(data.subarray(0, -16)), d.final()]);
      assert.equal(plain.at(-1), 2, 'the last record ends with the 0x02 delimiter');
      return JSON.parse(plain.subarray(0, -1).toString());
    },
  };
}
const vapidPair = crypto.createECDH('prime256v1');
do vapidPair.generateKeys(); while (vapidPair.getPrivateKey().length !== 32);
process.env.VAPID_PUBLIC = b64(vapidPair.getPublicKey());
process.env.VAPID_PRIVATE = b64(vapidPair.getPrivateKey());
process.env.VAPID_SUBJECT = 'https://app.example';
function verifyVapid(header, endpoint) {
  const m = header.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/);
  assert.ok(m, header);
  assert.equal(m[4], process.env.VAPID_PUBLIC);
  const pub = Buffer.from(m[4], 'base64url');
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64(pub.subarray(1, 33)), y: b64(pub.subarray(33)) }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')), 'the VAPID token is signed with our key');
  assert.deepEqual(JSON.parse(Buffer.from(m[1], 'base64url')), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(Buffer.from(m[2], 'base64url'));
  assert.equal(claims.aud, new URL(endpoint).origin);
  assert.equal(claims.sub, 'https://app.example');
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600);
}
// The push services: records what was sent, and answers 410 for phones that have gone.
const pushed = [];
const goneEndpoints = new Set();
global.fetch = async (url, init) => {
  verifyVapid(init.headers.Authorization, url);
  assert.equal(init.headers['Content-Encoding'], 'aes128gcm');
  assert.ok(Number(init.headers.TTL) > 0);
  pushed.push({ url, body: Buffer.from(init.body) });
  return { status: goneEndpoints.has(url) ? 410 : 201 };
};
const pushFile = (who) => JSON.parse(files.get(`members/${who}.push.json`).body);

test('push subscriptions are checked and kept per person', async () => {
  assert.equal((await call('ann', 'GET', '/push/key')).body.publicKey, process.env.VAPID_PUBLIC);
  const p = phone();
  for (const bad of ['http://web.push.apple.com/x', 'https://evil.example/x', 'https://push.apple.com.evil.example/x', 'not a url']) {
    assert.equal((await call('ann', 'POST', '/push/subscribe', { subscription: p.sub(bad) })).status, 400, bad);
  }
  assert.equal((await call('ann', 'POST', '/push/subscribe', { subscription: { endpoint: 'https://web.push.apple.com/a', keys: { p256dh: 'x', auth: 'y' } } })).status, 400);
  assert.equal((await call('ann', 'POST', '/push/subscribe', { subscription: p.sub('https://web.push.apple.com/ann-phone') })).status, 200);
  assert.equal((await call('ann', 'POST', '/push/subscribe', { subscription: p.sub('https://fcm.googleapis.com/fcm/send/ann-laptop') })).status, 200);
  assert.equal((await call('ann', 'POST', '/push/subscribe', { subscription: p.sub('https://web.push.apple.com/ann-phone') })).status, 200);
  assert.deepEqual(pushFile('ann').subs.map((s) => s.endpoint), ['https://fcm.googleapis.com/fcm/send/ann-laptop', 'https://web.push.apple.com/ann-phone']);
  await call('ann', 'POST', '/push/unsubscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/ann-laptop' });
  assert.deepEqual(pushFile('ann').subs.map((s) => s.endpoint), ['https://web.push.apple.com/ann-phone']);
});

test('a test notification is encrypted for the phone and signed with VAPID', async () => {
  const p = phone();
  assert.equal((await call('ben', 'POST', '/push/test')).status, 400);
  await call('ben', 'POST', '/push/subscribe', { subscription: p.sub('https://web.push.apple.com/ben') });
  const r = await call('ben', 'POST', '/push/test');
  assert.deepEqual(r.body, { ok: true, sent: 1 });
  assert.equal(pushed.at(-1).url, 'https://web.push.apple.com/ben');
  assert.deepEqual(p.read(pushed.at(-1).body), { title: 'Family Planner', body: 'Notifications are on', tag: 'test' });
});

test('the schedule is checked and capped', async () => {
  assert.equal((await call('ann', 'POST', '/push/schedule', { items: 'no' })).status, 400);
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `r${i}`, at: new Date(Date.now() + 86400000).toISOString(), title: 'Family Planner', body: 'x'.repeat(500) }));
  const r = await call('ann', 'POST', '/push/schedule', { items: [{ id: '', at: 'soon' }, { id: 'bad-date', at: 'whenever' }, ...many] });
  assert.equal(r.body.count, 38);
  assert.equal(pushFile('ann').schedule[0].body.length, 300);
  assert.equal(pushFile('ann').subs.length, 1, 'uploading the schedule keeps the subscriptions');
});

test('every 15 minutes, due reminders are sent once and gone phones are dropped', async () => {
  const p = phone();
  const old = phone();
  await call('cat', 'POST', '/push/subscribe', { subscription: p.sub('https://web.push.apple.com/cat') });
  await call('cat', 'POST', '/push/subscribe', { subscription: old.sub('https://web.push.apple.com/cat-old') });
  goneEndpoints.add('https://web.push.apple.com/cat-old');
  const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
  await call('cat', 'POST', '/push/schedule', { items: [
    { id: 'milk', at: ago(0.1), title: 'Family Planner', body: 'Milk goes off tomorrow' },
    { id: 'stale', at: ago(7), title: 'Family Planner', body: 'Too late to bother' },
    { id: 'later', at: ago(-5), title: 'Family Planner', body: 'Not yet' },
  ] });
  pushed.length = 0;
  await handler({ source: 'aws.events', 'detail-type': 'Scheduled Event' });
  const toCat = pushed.filter((x) => x.url === 'https://web.push.apple.com/cat');
  assert.equal(toCat.length, 1);
  assert.deepEqual(p.read(toCat[0].body), { title: 'Family Planner', body: 'Milk goes off tomorrow', tag: 'milk' });
  assert.deepEqual(pushFile('cat').subs.map((s) => s.endpoint), ['https://web.push.apple.com/cat'], 'the 410 phone is dropped');
  assert.ok(pushFile('cat').sent.milk);
  // Ann's reminders are all for tomorrow: nothing for her yet.
  assert.equal(pushed.some((x) => x.url.includes('ann')), false);
  pushed.length = 0;
  await handler({ source: 'aws.events' });
  assert.equal(pushed.length, 0, 'nothing is sent twice');
  // The same reminder moved to a new time is sent again then.
  await call('cat', 'POST', '/push/schedule', { items: [{ id: 'milk', at: ago(0.05), title: 'Family Planner', body: 'Milk goes off today' }] });
  await handler({});
  assert.equal(pushed.length, 1);
  assert.equal(p.read(pushed[0].body).body, 'Milk goes off today');
});

// ---------- "Hey Siri, add milk" ----------
const siri = async (key, item) => {
  const r = await handler({ headers: {}, rawPath: '/shortcut/add', body: JSON.stringify({ key, item }), requestContext: { http: { method: 'POST' } } });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};
const shopping = async (who) => (await call(who, 'GET', '/data')).body.data.shopping.items;

test('Siri adds to the household shopping list with its own key', async () => {
  await call('sid', 'PUT', '/data', { data: { shopping: { items: [{ id: 'a', name: 'Bananas', kind: 'food', done: false }] } } });
  const { key } = (await call('sid', 'POST', '/shortcut/key')).body;
  assert.match(key, /^[\w-]{43}$/);
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  assert.deepEqual(JSON.parse(files.get(`shortcuts/${hash}.json`).body), { sub: 'sid' });
  assert.equal(JSON.stringify([...files.values()]).includes(key), false, 'only the hash is kept');
  const r = await siri(key, 'Milk.');
  assert.deepEqual(r, { status: 200, body: { ok: true, message: 'Added Milk to the shopping list', added: ['Milk'] } });
  const milk = (await shopping('sid')).at(-1);
  assert.deepEqual(Object.keys(milk).sort(), ['addedAt', 'addedBy', 'done', 'id', 'kind', 'name']);
  assert.match(milk.id, /^[0-9a-f-]{36}$/);
  assert.equal(milk.addedBy, 'sid@example.com');
  assert.equal(milk.kind, 'food');
  // Several at once, leaving out what's already on the list.
  const more = await siri(key, 'eggs, banana and bread');
  assert.equal(more.body.message, 'Added eggs and bread to the shopping list. banana was already on it');
  assert.deepEqual((await shopping('sid')).map((i) => i.name), ['Bananas', 'Milk', 'eggs', 'bread']);
  assert.equal((await siri(key, '   ')).status, 400);
});

test('a wrong or turned-off Siri key is refused', async () => {
  const bad = await siri('x'.repeat(43), 'milk');
  assert.equal(bad.status, 403);
  assert.equal(bad.body.message, "That Siri key isn't right. Set it up again in Settings.");
  assert.equal((await siri(undefined, 'milk')).status, 403);
  const first = (await call('sid', 'POST', '/shortcut/key')).body.key;
  const second = (await call('sid', 'POST', '/shortcut/key')).body.key;
  assert.equal((await siri(first, 'jam')).status, 403, 'a new key replaces the old one');
  assert.equal((await siri(second, 'jam')).status, 200);
  await call('sid', 'POST', '/shortcut/key/revoke');
  assert.equal((await siri(second, 'tea')).status, 403);
  assert.equal([...files.keys()].some((k) => k.startsWith('shortcuts/') || k === 'members/sid.shortcut.json'), false);
});

test('Siri adds go to a household someone joined, up to 60 a day', async () => {
  await call('tom', 'POST', '/join', { code: (await call('sid', 'POST', '/invite')).body.code });
  const { key } = (await call('tom', 'POST', '/shortcut/key')).body;
  await siri(key, 'cheese');
  assert.equal((await shopping('sid')).at(-1).addedBy, 'tom@example.com');
  for (let i = 1; i < 60; i++) await siri(key, `thing ${i}`);
  const r = await siri(key, 'one too many');
  assert.equal(r.status, 429);
  assert.match(r.body.message, /a lot for one day/);
});

test('deleting an account removes its notification and Siri files', async () => {
  await call('tom', 'POST', '/push/subscribe', { subscription: phone().sub('https://web.push.apple.com/tom') });
  const { key } = (await call('tom', 'POST', '/shortcut/key')).body;
  assert.equal((await call('tom', 'POST', '/delete-account')).status, 200);
  assert.equal([...files.keys()].some((k) => k.includes('tom') || k.startsWith('shortcuts/')), false);
  assert.equal((await siri(key, 'milk')).status, 403);
  // Every other route still needs signing in.
  assert.equal((await handler({ headers: {}, rawPath: '/push/key', requestContext: { http: { method: 'GET' } } })).statusCode, 401);
});
