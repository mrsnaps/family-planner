// Small fixes so the shared web UI behaves inside the iPhone app's web view.
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { OnDeviceAI, isNative } from './native.js';

// Outgoing requests leave from the phone, so: Claude needs its browser-access header,
// and User-Agent can't be set from a web page (it would only trigger a CORS preflight).
export function wrapNetwork(fetchFn) {
  return (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!/^https?:/i.test(url)) return fetchFn(input, init);
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    headers.delete('User-Agent');
    if (new URL(url).hostname === 'api.anthropic.com') headers.set('anthropic-dangerous-direct-browser-access', 'true');
    return fetchFn(input, { ...init, headers });
  };
}

// iOS WebKit has no BarcodeDetector; provide one backed by Apple's Vision framework.
export function installBarcodeDetector() {
  if (!isNative() || 'BarcodeDetector' in window) return;
  class VisionBarcodeDetector {
    static async getSupportedFormats() {
      return ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];
    }
    async detect(source) {
      const base64 = await toBase64(source);
      const { barcodes = [] } = await OnDeviceAI.scanImage({ base64, only: 'barcodes' });
      return barcodes.map((rawValue) => ({ rawValue, format: 'unknown', boundingBox: null, cornerPoints: [] }));
    }
  }
  window.BarcodeDetector = VisionBarcodeDetector;
}

async function toBase64(source) {
  if (source instanceof Blob) {
    const buf = new Uint8Array(await source.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const w = source.videoWidth || source.naturalWidth || source.width;
  const h = source.videoHeight || source.naturalHeight || source.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (source instanceof ImageData) ctx.putImageData(source, 0, 0);
  else ctx.drawImage(source, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
}

// <a download> does nothing in an iOS web view, so open those files in the share sheet
// (Save to Files, AirDrop, Mail...).
export function installDownloads() {
  if (!isNative()) return;
  document.addEventListener('click', async (e) => {
    const a = e.target.closest && e.target.closest('a[download]');
    if (!a || !/^(blob|data):/.test(a.href)) return;
    e.preventDefault();
    const name = (a.getAttribute('download') || 'family-planner.json').replace(/[^\w.\- ]/g, '_');
    const text = await (await fetch(a.href)).text();
    const { uri } = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: name, files: [uri] });
  }, true);
}
