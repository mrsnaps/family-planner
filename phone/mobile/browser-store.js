// Drop-in for the web app's lib/store.js when it runs inside the phone app.
// Same interface; save() hands the data to whatever persist function main.js sets.
let persist = () => {};
const setPersist = (fn) => { persist = fn; };

class Store {
  constructor(data) {
    this.data = data && typeof data === 'object' ? data : {};
  }

  get(key, fallback) {
    if (this.data[key] === undefined) this.data[key] = structuredClone(fallback);
    return this.data[key];
  }

  save() {
    persist(this.data);
  }
}

const newId = () =>
  globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

module.exports = { Store, newId, setPersist };
