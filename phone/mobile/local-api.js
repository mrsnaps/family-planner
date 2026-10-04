// Runs the web app's own API handler (server.js createApp) inside the app and
// answers fetch('/api/...') calls with it, so the UI works without a server.
export function localFetcher(handler) {
  return async function localFetch(url, init = {}) {
    const method = (init.method || 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? init.body : init.body ? JSON.stringify(init.body) : '';
    const req = {
      method,
      url,
      headers: Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v])),
      on(event, cb) {
        // readJson() subscribes to data, end and error; feed it the body after it has.
        if (event === 'data' && body) setTimeout(() => cb(body));
        if (event === 'end') setTimeout(cb);
        return req;
      },
    };
    return new Promise((resolve, reject) => {
      const res = {
        status: 200,
        headers: {},
        setHeader(k, v) { this.headers[k] = v; },
        writeHead(status, headers = {}) {
          this.status = status;
          Object.assign(this.headers, headers);
          return this;
        },
        end(text = '') {
          resolve(new Response(this.status === 204 ? null : text, { status: this.status, headers: this.headers }));
          return this;
        },
      };
      Promise.resolve(handler(req, res)).catch(reject);
    });
  };
}

export function installFetch(localFetch) {
  const original = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(raw, location.href);
    if (u.origin === location.origin && u.pathname.startsWith('/api/')) {
      return localFetch(u.pathname + u.search, init);
    }
    return original(input, init);
  };
  return original;
}
