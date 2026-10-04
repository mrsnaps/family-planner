// Turns the app's reminders (GET /api/v1/reminders) into iPhone notifications:
// dated ones at 5pm the day before (or that day if it's sooner), undated urgent ones
// at the next 5pm. Rescheduled whenever the data changes.
import { LocalNotifications } from '@capacitor/local-notifications';
import { isNative } from './native.js';

const HOUR = 17;
const FIRST_ID = 5000;
const MAX = 40;

// Notification ids must be numbers; reminder ids are strings, so hash them.
function numericId(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return FIRST_ID + (Math.abs(h) % 1_000_000);
}

function at5pm(date) {
  const d = new Date(date);
  d.setHours(HOUR, 0, 0, 0);
  return d;
}

// Each notification keeps the reminder's own id as `key` (the home screen version's Web Push
// schedule uses it; iPhone notifications need the numeric id).
export function plan(reminders, now = new Date()) {
  const next5pm = at5pm(now) > now ? at5pm(now) : at5pm(new Date(now.getTime() + 86400000));
  const out = [];
  for (const r of reminders) {
    let at;
    if (r.date) {
      const dayBefore = at5pm(new Date(`${r.date}T12:00:00`));
      dayBefore.setDate(dayBefore.getDate() - 1);
      at = dayBefore > now ? dayBefore : next5pm;
      if (new Date(`${r.date}T23:59:59`) < now && r.kind !== 'food') continue;
    } else if (r.level === 'urgent' || r.level === 'warn') {
      at = next5pm;
    } else {
      continue;
    }
    out.push({ id: numericId(r.id), key: String(r.id), title: 'Family Planner', body: r.detail ? `${r.title}. ${r.detail}` : r.title, schedule: { at } });
    if (out.length >= MAX) break;
  }
  return out;
}

async function remindersFrom(localFetch) {
  const res = await localFetch('/api/v1/reminders');
  if (!res.ok) return null;
  const body = await res.json();
  return Array.isArray(body) ? body : body.reminders || [];
}

// Home screen version: the same reminders, sent by the household account's server as Web Push
// (infra/lambda/index.js POST /push/schedule). Only uploaded when the list has changed.
export const pushItems = (reminders, now) => plan(reminders, now).map((n) => ({ id: n.key, at: n.schedule.at.toISOString(), title: n.title, body: n.body }));
let uploaded = null;
export async function uploadWebPush(localFetch, account, { force = false } = {}) {
  if (force) uploaded = null;
  let on = false;
  try { on = localStorage.getItem('fp-push') === 'on'; } catch {}
  if (isNative() || !on || !account?.pushSchedule || !account.status().signedIn) {
    uploaded = null;
    return null;
  }
  const reminders = await remindersFrom(localFetch);
  if (!reminders) return null;
  const items = pushItems(reminders);
  const json = JSON.stringify(items);
  if (json === uploaded) return null;
  await account.pushSchedule(items);
  uploaded = json;
  return items;
}

let asked = false;
export async function scheduleFromReminders(localFetch) {
  if (!isNative()) return [];
  const reminders = await remindersFrom(localFetch);
  if (!reminders) return [];

  let perm = await LocalNotifications.checkPermissions();
  // Ask the first time there's actually something to remind about.
  if (perm.display === 'prompt' && reminders.length && !asked) {
    asked = true;
    perm = await LocalNotifications.requestPermissions();
  }
  if (perm.display !== 'granted') return [];

  const pending = await LocalNotifications.getPending();
  const ours = pending.notifications.filter((n) => n.id >= FIRST_ID);
  if (ours.length) await LocalNotifications.cancel({ notifications: ours.map((n) => ({ id: n.id })) });
  const list = plan(reminders).map(({ key, ...n }) => n);
  if (list.length) await LocalNotifications.schedule({ notifications: list });
  return list;
}
