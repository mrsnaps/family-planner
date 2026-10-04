// Stand-in for the household account services in infra/cloud.yaml: the Cognito calls the
// app makes, GET/PUT /data with the same "only if unchanged" rule as the real API, and the
// household routes (invite codes, joining and leaving) from infra/lambda/index.js.
import http from 'node:http';

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
      if (req.url === '/leave') {
        if (hid === email) return send(res, 400, { error: "You're not in anyone else's household." });
        leave(email);
        return send(res, 200, { ok: true });
      }
      if (req.url !== '/data') return send(res, 404, { error: 'Not found' });
      const file = files.get(hid);
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
    data: (email) => (files.get(home(email)) ? JSON.parse(files.get(home(email)).body) : null),
    close: () => server.close(),
  };
}
