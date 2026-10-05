// Household account: sign in with AWS Cognito and keep the household's data saved online
// (infra/cloud.yaml), so the iPhone, iPad and home screen version all share one copy.
// The web UI drives it through window.FamilyPlannerAccount (see the Account card in Settings).
// The AI key and AI usage stay on each device and are never uploaded.
import { Preferences } from '@capacitor/preferences';
import CONFIG from './cloud-config.js';
import { saveData } from './storage.js';
import { merge3 } from './merge.js';

const SESSION_KEY = 'fp-account';
const SYNC_KEY = 'fp-sync';
const BASE_KEY = 'fp-sync-base'; // the copy last saved or fetched, for merging two people's changes
const PUSH_KEY = 'fp-push'; // 'on' once notifications are turned on for this phone (localStorage)
const cfg = () => globalThis.__fpCloudConfig || CONFIG;

const MESSAGES = {
  UsernameExistsException: 'There is already an account with that email. Sign in instead.',
  NotAuthorizedException: 'Wrong email or password.',
  UserNotFoundException: 'Wrong email or password.',
  CodeMismatchException: "That code isn't right. Check the email and try again.",
  ExpiredCodeException: 'That code has expired. Ask for a new one.',
  InvalidPasswordException: 'Passwords need at least 8 characters, including a number.',
  LimitExceededException: 'Too many tries. Please wait a few minutes.',
  TooManyRequestsException: 'Too many tries. Please wait a few minutes.',
  TooManyFailedAttemptsException: 'Too many tries. Please wait a few minutes.',
};

export class AccountError extends Error {
  constructor(code, message) {
    super(MESSAGES[code] || message || 'Something went wrong. Please try again.');
    this.code = code;
  }
}

async function call(url, init) {
  try {
    return await fetch(url, init);
  } catch {
    throw new AccountError('Offline', 'No internet connection. Try again when you are online.');
  }
}

async function cognito(action, body) {
  const { region, clientId, cognitoUrl } = cfg();
  const res = await call(cognitoUrl || `https://cognito-idp.${region}.amazonaws.com/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `AWSCognitoIdentityProviderService.${action}` },
    body: JSON.stringify({ ClientId: clientId, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AccountError(String(data.__type || '').split('#').pop(), data.message);
  return data;
}

// What gets uploaded: everything except this device's AI key (and which server it's for) and usage count.
export function shareable(data) {
  const out = { ...data };
  delete out.demo;
  delete out.demoSaved;
  if (out.ai) {
    const { apiKey, keyFor, usage, chatUsage, ...rest } = out.ai;
    out.ai = rest;
  }
  return out;
}

// Take the account's copy, keeping this device's AI key and usage.
export function merged(remote, local) {
  const out = { ...remote };
  if (remote.ai || local.ai) out.ai = { ...(local.ai || {}), ...(remote.ai || {}), apiKey: local.ai?.apiKey || '', keyFor: local.ai?.keyFor, usage: local.ai?.usage, chatUsage: local.ai?.chatUsage };
  for (const k of ['keyFor', 'usage', 'chatUsage']) if (out.ai && out.ai[k] === undefined) delete out.ai[k];
  return out;
}

export function hasContent(d) {
  return Boolean(
    d.family?.children?.length || d.food?.pantry?.length || d.food?.recipes?.length ||
    d.clothes?.items?.length || d.shopping?.items?.length
  );
}

async function loadJson(key) {
  const { value } = await Preferences.get({ key });
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}
const saveJson = (key, v) => (v ? Preferences.set({ key, value: JSON.stringify(v) }) : Preferences.remove({ key }));

export function createAccount(store) {
  let session = null; // { email, refreshToken }
  let idToken = null;
  let idExpires = 0;
  let sync = { rev: null, dirty: false, savedAt: null };
  let busy = null;
  let timer = null;
  let error = null;
  let pendingChoice = null;
  let changes = 0; // counts saves, so a change made while uploading isn't marked as saved
  let base = null;
  // Demo mode (Settings): the sample family stays on this device only.
  const inDemo = () => Boolean(store.data.demo);
  const notInDemo = () => {
    if (inDemo()) throw new AccountError('Demo', 'Leave the demo first (Settings > Demo).');
  };

  const keepBase = (v) => {
    base = v && JSON.parse(JSON.stringify(v)); // a copy: the app keeps changing its own data in place
    return saveJson(BASE_KEY, v);
  };

  const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
  const changed = () => emit('familyplanner:account', status());
  const keepSync = () => saveJson(SYNC_KEY, sync);
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(syncNow, 1500);
  };

  function status() {
    return {
      available: true,
      signedIn: Boolean(session),
      email: session?.email || null,
      savedAt: sync.savedAt,
      pending: sync.dirty,
      syncing: Boolean(busy),
      demo: inDemo(),
      error,
    };
  }

  function useTokens(r) {
    idToken = r.IdToken;
    idExpires = Date.now() + (r.ExpiresIn || 3600) * 1000;
    if (r.RefreshToken) session.refreshToken = r.RefreshToken;
  }

  async function token() {
    if (idToken && idExpires - 60_000 > Date.now()) return idToken;
    try {
      useTokens((await cognito('InitiateAuth', { AuthFlow: 'REFRESH_TOKEN_AUTH', AuthParameters: { REFRESH_TOKEN: session.refreshToken } })).AuthenticationResult);
    } catch (e) {
      if (e.code === 'NotAuthorizedException') {
        await forget();
        throw new AccountError('SignedOut', 'You have been signed out. Please sign in again.');
      }
      throw e;
    }
    return idToken;
  }

  async function api(method, body, path = '/data') {
    const res = await call(cfg().apiUrl + path, {
      method,
      headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && !(res.status === 409 && path === '/data')) throw new AccountError('Api', data.error || data.message || `Saving online failed (${res.status})`);
    return { status: res.status, ...data };
  }

  function replaceLocal(remote) {
    const next = merged(remote, store.data);
    for (const k of Object.keys(store.data)) delete store.data[k];
    Object.assign(store.data, next);
    return saveData(store.data);
  }

  // Replace what's on this device with the account's copy.
  async function adopt(remote, rev, reason = 'remote') {
    await replaceLocal(remote);
    sync = { rev, dirty: false, savedAt: new Date().toISOString() };
    await Promise.all([keepSync(), keepBase(remote)]);
    if (reason) emit('familyplanner:datachanged', { reason });
  }

  async function upload(baseRev, tries = 0) {
    const sent = changes;
    const data = shareable(store.data);
    const r = await api('PUT', { data, baseRev });
    if (r.status === 409) {
      const theirs = r.data || {};
      // Someone else saved first. Merge both sets of changes and save again; if that keeps
      // clashing (or there's nothing to merge from), theirs wins and the UI says so.
      if (base && tries < 3) {
        const both = merge3(base, data, theirs);
        await replaceLocal(both);
        await keepBase(theirs);
        sync.rev = r.rev;
        emit('familyplanner:datachanged', { reason: 'merged' });
        if (JSON.stringify(both) === JSON.stringify(theirs)) {
          sync = { rev: r.rev, dirty: changes !== sent, savedAt: new Date().toISOString() };
          await keepSync();
          return true;
        }
        return upload(r.rev, tries + 1);
      }
      await adopt(theirs, r.rev, 'conflict');
      return false;
    }
    sync = { rev: r.rev, dirty: changes !== sent, savedAt: new Date().toISOString() };
    await Promise.all([keepSync(), keepBase(data)]);
    if (sync.dirty) schedule();
    return true;
  }

  // Quick check for changes saved by someone else (only the version, not the data).
  async function check() {
    if (!session || busy || sync.dirty || inDemo()) return status();
    try {
      const r = await api('GET', null, '/rev');
      if (r.rev && r.rev !== sync.rev) return syncNow('live');
    } catch {
      // Offline or signed out: the next full sync reports it.
    }
    return status();
  }

  // One sync at a time; pushes local changes first, then picks up other devices' changes.
  function syncNow(reason = 'remote') {
    if (!session || inDemo()) return Promise.resolve(status());
    if (busy) return busy.then(() => (sync.dirty ? syncNow(reason) : status()));
    busy = (async () => {
      changed();
      try {
        if (sync.dirty) await upload(sync.rev);
        else {
          const r = await api('GET');
          if (!r.data) await upload(null);
          else if (r.rev !== sync.rev) await adopt(r.data, r.rev, reason);
          else {
            sync.savedAt = new Date().toISOString();
            await keepSync();
          }
        }
        error = null;
      } catch (e) {
        error = e.message;
      }
    })().finally(() => {
      busy = null;
      changed();
    });
    return busy.then(status);
  }

  // This phone's Web Push subscription (Settings > Notifications, home screen version only).
  async function pushOff() {
    try {
      if (localStorage.getItem(PUSH_KEY) !== 'on') return;
      localStorage.removeItem(PUSH_KEY);
    } catch {
      return;
    }
    const reg = await navigator.serviceWorker?.getRegistration?.().catch(() => null);
    const sub = await reg?.pushManager?.getSubscription().catch(() => null);
    if (!sub) return;
    if (session) await api('POST', { endpoint: sub.endpoint }, '/push/unsubscribe').catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }

  async function forget() {
    session = null;
    idToken = null;
    sync = { rev: null, dirty: false, savedAt: null };
    base = null;
    try { localStorage.removeItem(PUSH_KEY); } catch {}
    await Promise.all([saveJson(SESSION_KEY, null), saveJson(SYNC_KEY, null), saveJson(BASE_KEY, null)]);
    changed();
  }

  async function signIn(email, password) {
    notInDemo();
    email = String(email || '').trim().toLowerCase();
    const r = await cognito('InitiateAuth', { AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: email, PASSWORD: password } });
    if (!r.AuthenticationResult) throw new AccountError(r.ChallengeName, 'This account needs setting up again. Please contact support.');
    session = { email };
    useTokens(r.AuthenticationResult);
    await saveJson(SESSION_KEY, session);
    const remote = await api('GET');
    if (!remote.data) {
      await upload(null);
      changed();
      return { done: true, uploaded: true };
    }
    if (hasContent(store.data) && hasContent(remote.data) && JSON.stringify(shareable(store.data)) !== JSON.stringify(shareable(merged(remote.data, store.data)))) {
      pendingChoice = remote;
      changed();
      return { choose: true, savedAt: remote.savedAt };
    }
    await adopt(remote.data, remote.rev);
    changed();
    return { done: true };
  }

  // Household: each person has their own login; invite codes let them share one household.
  const signedIn = () => {
    if (!session) throw new AccountError('SignedOut', 'Sign in first.');
    notInDemo();
  };
  const settle = () => (busy ? busy.catch(() => {}) : Promise.resolve());

  async function household() {
    signedIn();
    return api('GET', null, '/household');
  }
  async function invite() {
    signedIn();
    return api('POST', {}, '/invite');
  }
  // Joining swaps this device over to the other household's data.
  async function join(code) {
    signedIn();
    await settle();
    if (sync.dirty) await syncNow(); // save this household's last changes before switching
    const r = await api('POST', { code }, '/join');
    const remote = await api('GET');
    if (remote.data) await adopt(remote.data, remote.rev);
    else await upload(null);
    error = null;
    changed();
    return r;
  }
  // Leaving goes back to your own household, starting from a copy of what's on this device.
  async function leave() {
    signedIn();
    await settle();
    await api('POST', {}, '/leave');
    const own = await api('GET');
    await upload(own.rev || null);
    error = null;
    changed();
    return status();
  }

  // Deletes the login and the online data only this person can see (infra/lambda/index.js
  // POST /delete-account). The password is asked again so a phone left unlocked can't do it.
  async function deleteAccount(password, { clearDevice = true } = {}) {
    signedIn();
    let r;
    try {
      r = await cognito('InitiateAuth', { AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: session.email, PASSWORD: String(password || '') } });
    } catch (e) {
      throw e.code === 'NotAuthorizedException' ? new AccountError('Password', "That password isn't right.") : e;
    }
    if (!r.AuthenticationResult) throw new AccountError(r.ChallengeName);
    useTokens(r.AuthenticationResult);
    await settle();
    clearTimeout(timer);
    await pushOff();
    await api('POST', {}, '/delete-account');
    await forget();
    if (clearDevice) {
      for (const k of Object.keys(store.data)) delete store.data[k];
      await saveData(store.data);
      emit('familyplanner:datachanged', { reason: 'deleted' });
    }
    return status();
  }

  return {
    status,
    syncNow: () => syncNow(),
    deleteAccount,
    // Emails a message to whoever runs the app (infra/lambda/index.js POST /feedback).
    async feedback(text, page) {
      signedIn();
      return api('POST', { text, page }, '/feedback');
    },
    check,
    // Recipe from a link: the server opens the page, since a browser can't open another site's.
    async fetchPage(url) {
      signedIn();
      return (await api('POST', { url }, '/fetch-page')).html;
    },
    // Web Push for the home screen version (infra/lambda/index.js /push/*). Settings subscribes
    // with the browser's pushManager; main.js uploads the reminders when they change.
    async pushKey() {
      signedIn();
      return (await api('GET', null, '/push/key')).publicKey;
    },
    async pushSubscribe(subscription) {
      signedIn();
      return api('POST', { subscription }, '/push/subscribe');
    },
    async pushUnsubscribe(endpoint) {
      signedIn();
      return api('POST', { endpoint }, '/push/unsubscribe');
    },
    async pushSchedule(items) {
      signedIn();
      return api('POST', { items }, '/push/schedule');
    },
    async pushTest() {
      signedIn();
      return api('POST', {}, '/push/test');
    },
    // "Hey Siri, add milk": a key for the iPhone Shortcut, which calls apiUrl + /shortcut/add.
    get apiUrl() {
      return cfg().apiUrl;
    },
    async shortcutKey() {
      signedIn();
      return (await api('POST', {}, '/shortcut/key')).key;
    },
    async shortcutRevoke() {
      signedIn();
      return api('POST', {}, '/shortcut/key/revoke');
    },
    household,
    invite,
    join,
    leave,
    // Called by main.js whenever the app saves.
    noteChange() {
      // The demo's sample family is never saved online, and online changes wait until it ends.
      if (!session || inDemo()) return;
      changes += 1;
      sync.dirty = true;
      keepSync();
      schedule();
    },
    async restore() {
      session = await loadJson(SESSION_KEY);
      sync = { ...sync, ...(await loadJson(SYNC_KEY)) };
      base = await loadJson(BASE_KEY);
    },
    signIn,
    // Both devices had data: keep the account's copy or replace it with this device's.
    async choose(which) {
      const remote = pendingChoice;
      pendingChoice = null;
      if (!remote) return status();
      if (which === 'device') await upload(remote.rev);
      else await adopt(remote.data, remote.rev);
      changed();
      return status();
    },
    async signUp(email, password) {
      email = String(email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AccountError('Email', 'Please enter a valid email address.');
      await cognito('SignUp', { Username: email, Password: password, UserAttributes: [{ Name: 'email', Value: email }] });
      return { confirm: true };
    },
    async confirm(email, code) {
      await cognito('ConfirmSignUp', { Username: String(email).trim().toLowerCase(), ConfirmationCode: String(code).trim() });
    },
    async resendCode(email) {
      await cognito('ResendConfirmationCode', { Username: String(email).trim().toLowerCase() });
    },
    async forgotPassword(email) {
      await cognito('ForgotPassword', { Username: String(email).trim().toLowerCase() });
    },
    async resetPassword(email, code, password) {
      await cognito('ConfirmForgotPassword', { Username: String(email).trim().toLowerCase(), ConfirmationCode: String(code).trim(), Password: password });
    },
    // Signing out keeps the data on this device, but stops saving it online.
    async signOut() {
      if (sync.dirty) await syncNow().catch(() => {});
      await pushOff(); // reminders for this account stop coming to this phone
      const refreshToken = session?.refreshToken;
      await forget();
      if (refreshToken) cognito('RevokeToken', { Token: refreshToken }).catch(() => {});
    },
  };
}
