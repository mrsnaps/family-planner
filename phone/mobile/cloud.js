// Household account: sign in with AWS Cognito and keep the household's data saved online
// (infra/cloud.yaml), so the iPhone, iPad and home screen version all share one copy.
// The web UI drives it through window.FamilyPlannerAccount (see the Account card in Settings).
// The AI key and AI usage stay on each device and are never uploaded.
import { Preferences } from '@capacitor/preferences';
import CONFIG from './cloud-config.js';
import { saveData } from './storage.js';

const SESSION_KEY = 'fp-account';
const SYNC_KEY = 'fp-sync';
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

// What gets uploaded: everything except this device's AI key and usage count.
export function shareable(data) {
  const out = { ...data };
  if (out.ai) {
    const { apiKey, usage, ...rest } = out.ai;
    out.ai = rest;
  }
  return out;
}

// Take the account's copy, keeping this device's AI key and usage.
export function merged(remote, local) {
  const out = { ...remote };
  if (remote.ai || local.ai) out.ai = { ...(local.ai || {}), ...(remote.ai || {}), apiKey: local.ai?.apiKey || '', usage: local.ai?.usage };
  if (out.ai && out.ai.usage === undefined) delete out.ai.usage;
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

  // Replace what's on this device with the account's copy.
  async function adopt(remote, rev, quiet = false) {
    const next = merged(remote, store.data);
    for (const k of Object.keys(store.data)) delete store.data[k];
    Object.assign(store.data, next);
    await saveData(store.data);
    sync = { rev, dirty: false, savedAt: new Date().toISOString() };
    await keepSync();
    if (!quiet) emit('familyplanner:datachanged', { reason: 'remote' });
  }

  async function upload(baseRev) {
    const sent = changes;
    const r = await api('PUT', { data: shareable(store.data), baseRev });
    if (r.status === 409) {
      // Someone saved from another device first: theirs wins, and the UI says so.
      await adopt(r.data || {}, r.rev);
      emit('familyplanner:datachanged', { reason: 'conflict' });
      return false;
    }
    sync = { rev: r.rev, dirty: changes !== sent, savedAt: new Date().toISOString() };
    await keepSync();
    if (sync.dirty) schedule();
    return true;
  }

  // One sync at a time; pushes local changes first, then picks up other devices' changes.
  function syncNow() {
    if (!session) return Promise.resolve(status());
    if (busy) return busy.then(() => (sync.dirty ? syncNow() : status()));
    busy = (async () => {
      changed();
      try {
        if (sync.dirty) await upload(sync.rev);
        else {
          const r = await api('GET');
          if (!r.data) await upload(null);
          else if (r.rev !== sync.rev) await adopt(r.data, r.rev);
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

  async function forget() {
    session = null;
    idToken = null;
    sync = { rev: null, dirty: false, savedAt: null };
    await Promise.all([saveJson(SESSION_KEY, null), saveJson(SYNC_KEY, null)]);
    changed();
  }

  async function signIn(email, password) {
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

  return {
    status,
    syncNow,
    household,
    invite,
    join,
    leave,
    // Called by main.js whenever the app saves.
    noteChange() {
      if (!session) return;
      changes += 1;
      sync.dirty = true;
      keepSync();
      schedule();
    },
    async restore() {
      session = await loadJson(SESSION_KEY);
      sync = { ...sync, ...(await loadJson(SYNC_KEY)) };
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
      const refreshToken = session?.refreshToken;
      await forget();
      if (refreshToken) cognito('RevokeToken', { Token: refreshToken }).catch(() => {});
    },
  };
}
