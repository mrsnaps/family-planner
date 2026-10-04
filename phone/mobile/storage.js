// Saves the household data on the phone (iOS UserDefaults via Capacitor Preferences;
// localStorage when run in a desktop browser for testing).
import { Preferences } from '@capacitor/preferences';

const DB_KEY = 'fp-db';

export async function loadData() {
  const { value } = await Preferences.get({ key: DB_KEY });
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

// Writes are chained so a burst of changes always ends with the latest data saved.
let pending = null;
let writing = Promise.resolve();
export function saveData(data) {
  pending = JSON.stringify(data);
  writing = writing.then(async () => {
    if (pending === null) return;
    const value = pending;
    pending = null;
    await Preferences.set({ key: DB_KEY, value });
  });
  return writing;
}
