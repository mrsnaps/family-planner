// Copies infra/lambda/index.js into the DataFunction's inline code in infra/cloud.yaml.
// `node infra/build.mjs --check` fails if the template is out of date (run in CI).
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('.', import.meta.url);
const code = readFileSync(new URL('lambda/index.js', dir), 'utf8');
const file = new URL('cloud.yaml', dir);
const yaml = readFileSync(file, 'utf8');
const INDENT = '          ';
const start = yaml.indexOf('        ZipFile: |\n');
if (start < 0) throw new Error('No ZipFile block in cloud.yaml');
const bodyStart = start + '        ZipFile: |\n'.length;
let end = bodyStart;
for (const line of yaml.slice(bodyStart).split('\n')) {
  if (line && !line.startsWith(INDENT)) break;
  end += line.length + 1;
}
const block = code.trimEnd().split('\n').map((l) => (l ? INDENT + l : '')).join('\n') + '\n\n';
const next = yaml.slice(0, bodyStart) + block + yaml.slice(end).replace(/^\n+/, '');
if (process.argv.includes('--check')) {
  if (next !== yaml) {
    console.error('infra/cloud.yaml is out of date: run `node infra/build.mjs`');
    process.exit(1);
  }
} else {
  writeFileSync(file, next);
  console.log(`Copied ${code.length} characters of Lambda code into infra/cloud.yaml`);
}
