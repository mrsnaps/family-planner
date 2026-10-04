// Renders the app icon and splash screen for Xcode from the web app's icon.svg.
// Run after `npx cap add ios`: npm run ios:assets
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = fs.readFileSync(path.join(ROOT, 'www', 'icon.svg'), 'utf8');
const assets = path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets');
const BG = '#f7f4ee';

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(file, size, iconSize, background) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;overflow:hidden;position:relative;width:${size}px;height:${size}px;background:${background}">
    <div style="position:absolute;left:${(size - iconSize) / 2}px;top:${(size - iconSize) / 2}px;width:${iconSize}px;height:${iconSize}px">${svg.replace('<svg', `<svg width="${iconSize}" height="${iconSize}"`)}</div></body></html>`);
  await page.screenshot({ path: file, omitBackground: false });
}
// App icons must be square with no transparency; iOS rounds the corners itself, so the
// corners are filled with the icon's own green (scaled up slightly to hide its rounding).
await render(path.join(assets, 'AppIcon.appiconset', 'AppIcon-512@2x.png'), 1024, 1200, '#2e6b57');
for (const f of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  await render(path.join(assets, 'Splash.imageset', f), 2732, 520, BG);
}
await browser.close();
console.log('Wrote the app icon and splash screen.');
