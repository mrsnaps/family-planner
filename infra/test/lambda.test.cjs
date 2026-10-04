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
  S3Client: class {
    async send(cmd) {
      const { Key } = cmd.input;
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
const load = Module._load;
Module._load = function (req, ...rest) { return req === '@aws-sdk/client-s3' ? fakeS3 : load.call(this, req, ...rest); };
process.env.BUCKET = 'test';
process.env.ORIGINS = 'https://app.example';
const { handler } = require('../lambda/index.js');

const call = async (who, method, path, body) => {
  const r = await handler({
    headers: { origin: 'https://app.example' },
    rawPath: path,
    body: body && JSON.stringify(body),
    requestContext: { http: { method }, authorizer: { jwt: { claims: { sub: who, email: `${who}@example.com` } } } },
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
  assert.deepEqual((await call('gran', 'POST', '/join', { code: inv.body.code })).body, { ok: true, already: true });
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
