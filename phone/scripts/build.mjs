// Builds www/ for the iPhone app: the shared web app from ../web,
// with its API running inside the app (no server) plus the phone extras in mobile/.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The web app: ../web in the GitHub repository, or ../family-planner next to this folder.
const APP = path.resolve(
  process.env.FAMILY_PLANNER_DIR ||
    [path.join(ROOT, '..', 'web'), path.join(ROOT, '..', 'family-planner')].find((d) => fs.existsSync(path.join(d, 'server.js'))) ||
    path.join(ROOT, '..', 'web')
);
const WWW = path.join(ROOT, 'www');
const inApp = (file) => [APP, fs.existsSync(APP) ? fs.realpathSync(APP) : APP].some((d) => file.startsWith(d + path.sep));

if (!fs.existsSync(path.join(APP, 'server.js'))) {
  console.error(`Can't find the web app at ${APP}. Set FAMILY_PLANNER_DIR to its folder.`);
  process.exit(1);
}

fs.rmSync(WWW, { recursive: true, force: true });
fs.cpSync(path.join(APP, 'public'), WWW, { recursive: true });

// The app's modules only touch Node through lib/store.js and server.js's static-file
// branch, so swap the store for a browser one and stub the Node built-ins.
const appModules = {
  name: 'app-modules',
  setup(b) {
    b.onResolve({ filter: /^@app\/server$/ }, () => ({ path: path.join(APP, 'server.js') }));
    b.onResolve({ filter: /lib\/store(\.js)?$/ }, (args) =>
      inApp(args.importer) ? { path: path.join(ROOT, 'mobile', 'browser-store.js') } : undefined
    );
    b.onResolve({ filter: /^(node:)?(http|fs|path|crypto)$/ }, (args) => ({ path: args.path, namespace: 'node-stub' }));
    b.onLoad({ filter: /.*/, namespace: 'node-stub' }, (args) => ({
      contents: STUBS[args.path.replace('node:', '')] || 'module.exports = {};',
      loader: 'js',
    }));
  },
};

// Enough of path and fs for server.js's top-level setup; its static-file code never runs here.
const STUBS = {
  path: `module.exports = {
    join: (...p) => p.join('/').replace(/\\/+/g, '/'),
    normalize: (p) => p, extname: (p) => (p.match(/\\.[^./]*$/) || [''])[0], dirname: () => '/',
  };`,
  fs: 'module.exports = { existsSync: () => false };',
  crypto: 'module.exports = { randomUUID: () => globalThis.crypto.randomUUID() };',
};

await build({
  entryPoints: [path.join(ROOT, 'mobile', 'main.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['safari16'],
  outfile: path.join(WWW, 'mobile', 'mobile.js'),
  plugins: [appModules],
  define: { __dirname: '"/app"' },
  // The modules read process.env for optional server settings; on the phone there are none.
  banner: { js: 'var process = globalThis.process || { env: {} };' },
  minify: true,
  logLevel: 'warning',
});

// Load the phone layer first; it starts the in-app API and then loads the web app's script.
const indexFile = path.join(WWW, 'index.html');
let html = fs.readFileSync(indexFile, 'utf8');
const appScript = /<script\s+src="\/?app\.js"\s*><\/script>/;
if (!appScript.test(html)) {
  console.error('index.html no longer loads app.js the expected way; update scripts/build.mjs.');
  process.exit(1);
}
fs.copyFileSync(path.join(ROOT, 'mobile', 'ios.css'), path.join(WWW, 'mobile', 'ios.css'));
html = html
  .replace(appScript, '<script src="/mobile/mobile.js"></script>')
  .replace('</head>', '  <link rel="stylesheet" href="/mobile/ios.css">\n</head>');
fs.writeFileSync(indexFile, html);
console.log(`Built www/ from ${APP}`);
