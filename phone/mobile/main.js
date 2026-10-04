// Phone app entry: load saved data, run the web app's API inside the app, then start
// the web app's own UI. Nothing needs a server; AI and lookups go straight from the phone.
import { createApp } from '@app/server';
import { Store, setPersist } from './browser-store.js';
import { loadData, saveData } from './storage.js';
import { localFetcher, installFetch } from './local-api.js';
import { withOnDevice } from './on-device.js';
import { wrapNetwork, installBarcodeDetector, installDownloads } from './ios-shims.js';
import { scheduleFromReminders, uploadWebPush } from './notifications.js';
import { isNative } from './native.js';
import { createAccount } from './cloud.js';
import CLOUD from './cloud-config.js';

async function start() {
  // Tells the web UI it's inside the iPhone app (the home screen version is plain web).
  if (isNative()) window.FamilyPlannerNative = { platform: 'ios' };
  const store = new Store(await loadData());
  const localFetch = localFetcher(createApp(store));

  let timer;
  let account = null;
  let forcePush = false;
  const reschedule = () => {
    clearTimeout(timer);
    // No phone reminders about the demo's made-up family.
    if (store.data.demo) return;
    timer = setTimeout(() => {
      scheduleFromReminders(localFetch).catch(() => {});
      // Home screen version, with notifications turned on in Settings: the account's server sends them.
      uploadWebPush(localFetch, account, { force: forcePush }).then(() => (forcePush = false), () => {});
    }, 3000);
  };
  // Settings turned notifications on (or off) on this phone.
  window.addEventListener('familyplanner:push', () => {
    forcePush = true;
    reschedule();
  });
  // Household account: when signed in, pick up the latest saved copy before the UI starts
  // (but don't keep the app waiting when offline), and save each change online.
  account = (globalThis.__fpCloudConfig || CLOUD).clientId ? createAccount(store) : null;
  if (account) {
    await account.restore();
    if (account.status().signedIn) await Promise.race([account.syncNow(), new Promise((r) => setTimeout(r, 4000))]);
    window.FamilyPlannerAccount = account;
    // "Recipe from a link" (web/modules/food/fetch-page.js): opened by the server when signed in;
    // otherwise the page offers to paste the recipe instead.
    globalThis.FamilyPlannerFetchPage = async (url) => {
      if (!account.status().signedIn) throw Object.assign(new Error("Sign in to open recipe links, or paste the recipe page's text instead"), { status: 409 });
      return account.fetchPage(url);
    };
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && account.syncNow());
    window.addEventListener('online', () => account.syncNow());
    // While the app is open, look for other people's changes every few seconds, so a list
    // two people are shopping from stays up to date on both phones.
    setInterval(() => document.visibilityState === 'visible' && account.check(), globalThis.__fpPollMs || 8000);
  }
  setPersist((data) => {
    saveData(data);
    account?.noteChange();
    reschedule();
  });
  window.addEventListener('familyplanner:datachanged', () => reschedule());

  const original = installFetch(withOnDevice(localFetch));
  // Requests to the internet (AI, Open Food Facts) go through the fixes in ios-shims.
  const net = wrapNetwork(original);
  const shimmed = window.fetch;
  window.fetch = (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return new URL(raw, location.href).origin === location.origin ? shimmed(input, init) : net(input, init);
  };
  installBarcodeDetector();
  installDownloads();

  const script = document.createElement('script');
  script.src = '/app.js';
  document.body.append(script);
  reschedule();
  if (!isNative()) webExtras();
}

// Home screen version: work offline, and ask Safari not to clear the saved data.
function webExtras() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  navigator.storage?.persist?.().catch(() => {});
}

start().catch((err) => {
  document.body.textContent = `Family Planner couldn't start: ${err.message}`;
});
