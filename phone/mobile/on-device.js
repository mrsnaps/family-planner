// Lets the web app's AI features run on Apple's on-device model when the iPhone has
// Apple Intelligence and the household left "use on-device AI" on. The web app's own
// task prompts and schemas come from GET /api/v1/ai/tasks/:task, so both stay in step.
// Anything on-device can't do falls back to the household's chosen AI, if there is one.
import { OnDeviceAI, onDeviceStatus, REASONS } from './native.js';
import { extractJson } from './json.js';

const BY = 'iPhone AI';
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

export function withOnDevice(localFetch) {
  const get = async (path) => {
    const res = await localFetch(path);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };

  const generate = async (task, prompt, extra = '') => {
    const t = await get(`/api/v1/ai/tasks/${task}${extra}`);
    const { text } = await OnDeviceAI.generate({
      instructions: `${t.system}\nReply with JSON only.`,
      prompt: prompt ?? t.prompt,
      schemaJson: JSON.stringify(t.schema),
    });
    return extractJson(text);
  };

  const handlers = {
    '/api/v1/ai/meal-ideas': async (body) => {
      const q = body.request ? `?request=${encodeURIComponent(body.request)}` : '';
      const r = await generate('meal-ideas', undefined, q);
      return { ideas: Array.isArray(r.ideas) ? r.ideas : [], by: BY };
    },

    '/api/v1/ai/scan': async (body) => {
      const kind = body.kind === 'clothes' ? 'clothes' : 'food';
      if (!body.image) throw Object.assign(new Error('Send a photo as image (a base64 data URL)'), { status: 400 });
      const base64 = String(body.image).replace(/^data:[^,]*,/, '');
      const scan = await OnDeviceAI.scanImage({ base64 });
      const text = (scan.text || '').trim();

      if (kind === 'food') {
        const items = [];
        for (const code of scan.barcodes || []) {
          const res = await localFetch(`/api/v1/food/barcode/${encodeURIComponent(code)}`);
          if (res.ok) {
            const p = await res.json();
            items.push({ name: p.name, quantity: p.quantity, unit: p.unit, barcode: p.barcode });
          }
        }
        if (text.length >= 12) {
          const r = await generate('scan-food',
            `Text read from a photo of food (a receipt, packaging, a list or a shelf):\n${text.slice(0, 3000)}\n\nList the food items.`);
          for (const i of r.items || []) items.push({ ...i, quantity: i.quantity > 0 ? i.quantity : null });
        }
        if (!items.length) throw new Error('Couldn’t read any food in that photo on the phone. Try a closer, flatter photo.');
        return { kind, items, by: BY };
      }

      const labels = (scan.labels || []).slice(0, 8).map((l) => `${l.name} (${Math.round(l.confidence * 100)}%)`);
      if (!labels.length && !text) throw new Error('Couldn’t make out the clothes in that photo on the phone. Try one item, laid flat, in good light.');
      const r = await generate('scan-clothes',
        `A phone photo of children's clothes. What the camera recognised: ${labels.join(', ') || 'nothing clear'}. ` +
        `Main colour: ${scan.colour || 'unknown'}. Text on labels: ${text.slice(0, 300) || 'none'}.\n\nDescribe each garment.`);
      return { kind, items: Array.isArray(r.items) ? r.items : [], by: BY };
    },

    '/api/v1/ai/test': async () => {
      const r = await generate('scan-food',
        'There is no photo. Reply with an items list containing one item: name "Test", quantity 1, unit "pcs".');
      return { ok: Array.isArray(r.items), reply: r, by: BY };
    },
  };

  return async function fetchWithOnDevice(url, init = {}) {
    const method = (init.method || 'GET').toUpperCase();
    const path = new URL(url, 'http://app').pathname;

    // Tell the UI whether on-device AI is there, and count it as an AI being ready.
    if (path === '/api/v1/ai/settings') {
      const res = await localFetch(url, init);
      if (!res.ok) return res;
      const s = await res.json();
      const st = await onDeviceStatus({ refresh: true });
      return json({
        ...s,
        onDeviceAvailable: Boolean(st.available),
        onDeviceReason: REASONS[st.reason] || REASONS.unknown,
        ready: Boolean(s.ready || (s.onDevice && st.available)),
      });
    }

    const handler = method === 'POST' && handlers[path];
    if (!handler) return localFetch(url, init);

    const settings = await get('/api/v1/ai/settings');
    const st = await onDeviceStatus();
    if (!settings.onDevice || !st.available) return localFetch(url, init);

    let body = {};
    try {
      body = init.body ? JSON.parse(init.body) : {};
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }
    try {
      return json(await handler(body));
    } catch (err) {
      if (err.status === 400) return json({ error: err.message }, 400);
      // Too much for the small on-device model, or it couldn't read the photo:
      // hand over to the household's chosen AI when one is set up.
      if (settings.ready) return localFetch(url, init);
      return json({ error: friendly(err) }, 502);
    }
  };
}

function friendly(err) {
  const code = err.code || '';
  if (code === 'contextTooLong') return 'That’s too much for the iPhone’s built-in AI. Add an extra AI in AI settings for bigger jobs.';
  if (code === 'guardrail') return 'The iPhone’s built-in AI declined this. Try rewording it.';
  if (code === 'unavailable') return REASONS.unknown;
  return err.message || 'The iPhone’s built-in AI couldn’t do that. Try again.';
}
