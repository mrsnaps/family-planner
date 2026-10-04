// Builds the home screen version: the same app as the iPhone build, as a static site
// you can host anywhere free (Netlify, Cloudflare Pages) and add to the home screen
// from Safari. Output: dist-web/ (and family-planner-home-screen.zip with --zip).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WWW = path.join(ROOT, 'www');
const OUT = path.join(ROOT, 'dist-web');

execFileSync('node', [path.join(ROOT, 'scripts', 'build.mjs')], { stdio: 'inherit' });
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(WWW, OUT, { recursive: true });
// Replaces the web app's sw.js: this one also caches the bundled API in mobile/.
fs.copyFileSync(path.join(ROOT, 'mobile', 'sw.js'), path.join(OUT, 'sw.js'));
// Any address opens the app (Netlify and Cloudflare Pages both read this file).
fs.writeFileSync(path.join(OUT, '_redirects'), '/* /index.html 200\n');

// iOS uses a PNG for the home screen icon. assets/apple-touch-icon.png is kept in the
// repository so hosted builds (Amplify) don't need a browser; delete it to redraw it.
const savedIcon = path.join(ROOT, 'assets', 'apple-touch-icon.png');
if (fs.existsSync(savedIcon)) {
  fs.copyFileSync(savedIcon, path.join(OUT, 'apple-touch-icon.png'));
} else {
  const { chromium } = await import('playwright');
  const svg = fs.readFileSync(path.join(OUT, 'icon.svg'), 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 180, height: 180 } });
  await page.setContent(`<html><body style="margin:0;overflow:hidden;position:relative;width:180px;height:180px;background:#2e6b57">
    <div style="position:absolute;left:-15px;top:-15px">${svg.replace('<svg', '<svg width="210" height="210"')}</div></body></html>`);
  await page.screenshot({ path: savedIcon });
  await browser.close();
  fs.copyFileSync(savedIcon, path.join(OUT, 'apple-touch-icon.png'));
}

const indexFile = path.join(OUT, 'index.html');
fs.writeFileSync(indexFile, fs.readFileSync(indexFile, 'utf8').replace('</head>', [
  '  <link rel="apple-touch-icon" href="/apple-touch-icon.png">',
  '  <meta name="apple-mobile-web-app-capable" content="yes">',
  '  <meta name="mobile-web-app-capable" content="yes">',
  '  <meta name="apple-mobile-web-app-title" content="Family">',
  '  <meta name="apple-mobile-web-app-status-bar-style" content="default">',
  '</head>',
].join('\n')));

if (process.argv.includes('--zip')) {
  const zip = path.join(ROOT, 'family-planner-home-screen.zip');
  fs.rmSync(zip, { force: true });
  execFileSync('python3', ['-c', `
import os, zipfile, sys
out, root = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for d, _, files in os.walk(root):
        for f in files:
            p = os.path.join(d, f)
            z.write(p, os.path.relpath(p, root))
`, zip, OUT]);
}
console.log('Built dist-web/');
