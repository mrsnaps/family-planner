// Serves www/ for trying the phone app in a desktop browser (npm run serve).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WWW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', process.env.SERVE_DIR || 'www');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const port = Number(process.env.PORT) || 5173;

http.createServer((req, res) => {
  let file = path.normalize(path.join(WWW, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!file.startsWith(WWW)) return res.writeHead(403).end();
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WWW, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Phone app preview at http://localhost:${port}`));
