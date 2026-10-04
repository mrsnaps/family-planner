// Stand-in for the household account services in infra/cloud.yaml: the Cognito calls the
// app makes, GET/PUT /data with the same "only if unchanged" rule as the real API, and the
// household routes (invite codes, joining and leaving) from infra/lambda/index.js, plus
// the Web Push and Siri key routes (recorded, nothing is really sent).
import http from 'node:http';
import crypto from 'node:crypto';

export async function startMockCloud(port) {
  const users = new Map(); // email -> { password, confirmed }
  const files = new Map(); // household -> { body, rev }
  const memberOf = new Map(); // email -> household (people who joined someone else's)
  const people = new Map(); // household -> [email]
  const invites = new Map(); // code -> { household, by }
  const home = (email) => memberOf.get(email) || email;
  const leave = (email) => {
    const h = home(email);
    if (people.has(h)) people.set(h, people.get(h).filter((e) => e !== email));
    memberOf.delete(email);
  };
  const calls = [];
  const feedback = [];
  const push = { publicKey: crypto.createECDH('prime256v1').generateKeys().toString('base64url'), subs: [], schedules: [], tests: 0 };
  const shortcut = { key: null };
  let n = 0;
  const CODE = '123456';

  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,PUT,POST' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const fail = (res, type, message) => send(res, 400, { __type: type, message });
  const tokens = (email) => ({ AuthenticationResult: { IdToken: `id:${email}`, RefreshToken: `refresh:${email}`, ExpiresIn: 3600 } });

  const cognito = {
    SignUp(b, res) {
      if (users.has(b.Username)) return fail(res, 'UsernameExistsException');
      if (!/\d/.test(b.Password) || b.Password.length < 8) return fail(res, 'InvalidPasswordException', 'Password did not conform with policy');
      users.set(b.Username, { password: b.Password, confirmed: false });
      send(res, 200, { UserConfirmed: false });
    },
    ConfirmSignUp(b, res) {
      if (b.ConfirmationCode !== CODE) return fail(res, 'CodeMismatchException');
      users.get(b.Username).confirmed = true;
      send(res, 200, {});
    },
    ResendConfirmationCode: (b, res) => send(res, 200, {}),
    ForgotPassword: (b, res) => send(res, 200, {}),
    ConfirmForgotPassword(b, res) {
      if (b.ConfirmationCode !== CODE) return fail(res, 'CodeMismatchException');
      users.get(b.Username).password = b.Password;
      send(res, 200, {});
    },
    InitiateAuth(b, res) {
      if (b.AuthFlow === 'REFRESH_TOKEN_AUTH') {
        const email = String(b.AuthParameters.REFRESH_TOKEN).replace('refresh:', '');
        return users.has(email) ? send(res, 200, { AuthenticationResult: { ...tokens(email).AuthenticationResult, RefreshToken: undefined } }) : fail(res, 'NotAuthorizedException');
      }
      const u = users.get(b.AuthParameters.USERNAME);
      if (!u || u.password !== b.AuthParameters.PASSWORD) return fail(res, 'NotAuthorizedException', 'Incorrect username or password.');
      if (!u.confirmed) return fail(res, 'UserNotConfirmedException');
      send(res, 200, tokens(b.AuthParameters.USERNAME));
    },
    RevokeToken: (b, res) => send(res, 200, {}),
  };

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.method === 'OPTIONS') return send(res, 204);
      if (req.url === '/' && req.method === 'POST') {
        const action = String(req.headers['x-amz-target']).split('.').pop();
        calls.push(action);
        return cognito[action] ? cognito[action](JSON.parse(raw), res) : fail(res, 'InvalidAction');
      }
      const email = String(req.headers.authorization || '').replace('Bearer id:', '');
      if (!users.has(email)) return send(res, 401, { message: 'Unauthorized' });
      calls.push(`${req.method} ${req.url}`);
      const hid = home(email);
      const list = () => people.get(hid)?.length ? people.get(hid) : [email];
      if (req.url === '/household') return send(res, 200, { shared: list().length > 1, joined: hid !== email, members: list().map((e) => ({ email: e, you: e === email })) });
      if (req.url === '/invite') {
        if (!people.has(hid)) people.set(hid, [email]);
        const code = `CODE${String(++n).padStart(4, '0')}`;
        invites.set(code, { household: hid, by: email });
        return send(res, 200, { code, days: 7 });
      }
      if (req.url === '/join') {
        const inv = invites.get(String(JSON.parse(raw).code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
        if (!inv) return send(res, 404, { error: "That code isn't right or has expired. Ask for a new one." });
        if (inv.household === hid) return send(res, 200, { ok: true, already: true });
        leave(email);
        memberOf.set(email, inv.household);
        people.get(inv.household).push(email);
        return send(res, 200, { ok: true, invitedBy: inv.by });
      }
      if (req.url === '/feedback') {
        const text = String(JSON.parse(raw).text || '').trim();
        if (!text) return send(res, 400, { error: 'Write something first.' });
        feedback.push({ from: email, ...JSON.parse(raw) });
        return send(res, 200, { ok: true });
      }
      if (req.url === '/fetch-page') {
        const { url } = JSON.parse(raw);
        if (!/^https?:\/\//.test(url)) return send(res, 400, { error: 'Use a link starting with http:// or https://' });
        return send(res, 200, { html: `<html><script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', name: 'Mock flapjacks', recipeYield: '12', totalTime: 'PT35M', recipeIngredient: ['250g oats', '125g butter', '100g golden syrup'], recipeInstructions: [{ '@type': 'HowToStep', text: 'Melt, stir and bake.' }] })}</script></html>` });
      }
      if (req.url === '/push/key') return send(res, 200, { publicKey: push.publicKey });
      if (req.url.startsWith('/push/')) {
        const b = raw ? JSON.parse(raw) : {};
        if (req.url === '/push/subscribe') {
          if (!/^https:\/\/web\.push\.apple\.com\//.test(b.subscription?.endpoint || '')) return send(res, 400, { error: "That isn't a push address this app can use." });
          push.subs = [...push.subs.filter((x) => x.endpoint !== b.subscription.endpoint), { ...b.subscription, email }];
        }
        if (req.url === '/push/unsubscribe') push.subs = push.subs.filter((x) => x.endpoint !== b.endpoint);
        if (req.url === '/push/schedule') push.schedules.push({ email, items: b.items });
        if (req.url === '/push/test') {
          if (!push.subs.some((x) => x.email === email)) return send(res, 400, { error: 'Turn notifications on first.' });
          push.tests += 1;
        }
        return send(res, 200, { ok: true });
      }
      if (req.url === '/shortcut/key') return send(res, 200, { key: (shortcut.key = crypto.randomBytes(32).toString('base64url')) });
      if (req.url === '/shortcut/key/revoke') {
        shortcut.key = null;
        return send(res, 200, { ok: true });
      }
      if (req.url === '/delete-account') {
        leave(email);
        if (!people.get(email)?.length) files.delete(email);
        users.delete(email);
        return send(res, 200, { ok: true });
      }
      if (req.url === '/leave') {
        if (hid === email) return send(res, 400, { error: "You're not in anyone else's household." });
        leave(email);
        return send(res, 200, { ok: true });
      }
      const file = files.get(hid);
      if (req.url === '/rev') return send(res, 200, { rev: file ? file.rev : null });
      if (req.url !== '/data') return send(res, 404, { error: 'Not found' });
      if (req.method === 'GET') return send(res, 200, file ? { data: JSON.parse(file.body), rev: file.rev, savedAt: new Date().toISOString() } : { data: null, rev: null });
      const body = JSON.parse(raw);
      if (body.baseRev ? file?.rev !== body.baseRev : file) return send(res, 409, { error: 'Changed on another device', data: JSON.parse(file.body), rev: file.rev });
      const rev = `"r${++n}"`;
      files.set(hid, { body: JSON.stringify(body.data), rev });
      send(res, 200, { rev });
    });
  });
  await new Promise((r) => server.listen(port, r));
  return {
    url: `http://localhost:${port}`,
    calls,
    hasUser: (email) => users.has(email),
    feedback,
    push,
    shortcut,
    data: (email) => (files.get(home(email)) ? JSON.parse(files.get(home(email)).body) : null),
    close: () => server.close(),
  };
}
