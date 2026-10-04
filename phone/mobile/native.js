// The app's own iOS plugin (plugins/on-device-ai): Apple's on-device language model
// and Vision photo reading. In a desktop browser it reports itself unavailable.
import { registerPlugin, Capacitor } from '@capacitor/core';

const notOnIPhone = () => Promise.reject(new Error('Only available in the iPhone app'));

// Tests can stand in for the iPhone by setting globalThis.__fpOnDeviceMock before load.
export const OnDeviceAI = globalThis.__fpOnDeviceMock || registerPlugin('OnDeviceAI', {
  web: {
    availability: async () => ({ available: false, reason: 'notIPhone' }),
    generate: notOnIPhone,
    scanImage: notOnIPhone,
  },
});

export const isNative = () => Capacitor.isNativePlatform();

export const REASONS = {
  available: 'Ready. Nothing leaves your phone.',
  deviceNotEligible: 'This iPhone doesn’t support Apple Intelligence (iPhone 15 Pro or newer).',
  appleIntelligenceNotEnabled: 'Turn on Apple Intelligence in the iPhone’s Settings to use it.',
  modelNotReady: 'Apple Intelligence is still downloading. Try again later.',
  osTooOld: 'Needs iOS 26 or newer.',
  notIPhone: 'Only available in the iPhone app.',
  unknown: 'Not available on this device.',
};

let cached;
export async function onDeviceStatus({ refresh = false } = {}) {
  if (!cached || refresh) {
    cached = await OnDeviceAI.availability().catch(() => ({ available: false, reason: 'unknown' }));
  }
  return cached;
}
