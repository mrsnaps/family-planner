// Phone app entry: load saved data, run the web app's API inside the app, then start
// the web app's own UI. Nothing needs a server; AI and lookups go straight from the phone.
import { createApp } from '@app/server';
import { Store, setPersist } from './browser-store.js';
import { loadData, saveData } from './storage.js';
import { localFetcher, installFetch } from './local-api.js';
import { withOnDevice } from './on-device.js';
import { wrapNetwork, installBarcodeDetector, installDownloads } from './ios-shims.js';
import { scheduleFromReminders } from './notifications.js';
import { isNative } from './native.js';
import { createAccount } from './cloud.js';
import CLOUD from './cloud-config.js';

async function start() {
  // Tells the web UI it's inside the iPhone app (the home screen version is plain web).
  if (isNative()) window.FamilyPlannerNative = { platform: 'ios' };
  const store = new Store(await loadData());
  const localFetch = localFetcher(createApp(store));

  let timer;
  const reschedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => scheduleFromReminders(localFetch).catch(() => {}), 3000);
  };
  // Household account: when signed in, pick up the latest saved copy before the UI starts
  // (but don't keep the app waiting when offline), and save each change online.
  const account = (globalThis.__fpCloudConfig || CLOUD).clientId ? createAccount(store) : null;
  if (account) {
    await account.restore();
    if (account.status().signedIn) await Promise.race([account.syncNow(), new Promise((r) => setTimeout(r, 4000))]);
    window.FamilyPlannerAccount = account;
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && account.syncNow());
    window.addEventListener('online', () => account.syncNow());
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
