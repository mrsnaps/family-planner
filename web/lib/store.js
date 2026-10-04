// Tiny JSON-file store. Each module owns one top-level key ("family", "food", "clothes").
// Swap this file for a real database later without touching the modules.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Store {
  constructor(file) {
    this.file = file;
    this.data = {};
    if (file && fs.existsSync(file)) {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  }

  get(key, fallback) {
    if (this.data[key] === undefined) this.data[key] = structuredClone(fallback);
    return this.data[key];
  }

  save() {
    if (!this.file) return; // in-memory store (tests)
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

const newId = () => crypto.randomUUID();

module.exports = { Store, newId };
