// Talks to whichever AI the household picked. Two wire formats cover almost everything:
// Anthropic's Messages API, and the OpenAI-style chat completions API that OpenAI,
// Google Gemini, Mistral, OpenRouter and local servers like Ollama or LM Studio all speak.
// Raw fetch keeps the app dependency-free.

const PRESETS = [
  {
    id: 'anthropic', label: 'Claude (Anthropic)', format: 'anthropic', baseUrl: 'https://api.anthropic.com',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'], needsKey: true,
    note: 'Opus 5.5 gives the best ideas. Haiku 4.5 is the cheapest.',
  },
  { id: 'openai', label: 'OpenAI', format: 'openai', baseUrl: 'https://api.openai.com/v1', models: [], needsKey: true, note: 'Enter the model name from your OpenAI account.' },
  { id: 'gemini', label: 'Google Gemini', format: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: [], needsKey: true, note: 'Uses Gemini\'s OpenAI-compatible endpoint.' },
  { id: 'mistral', label: 'Mistral', format: 'openai', baseUrl: 'https://api.mistral.ai/v1', models: [], needsKey: true },
  { id: 'openrouter', label: 'OpenRouter (many models)', format: 'openai', baseUrl: 'https://openrouter.ai/api/v1', models: [], needsKey: true },
  { id: 'ollama', label: 'Ollama on this computer (free, private)', format: 'openai', baseUrl: 'http://localhost:11434/v1', models: [], needsKey: false, note: 'Install Ollama and pull a model first. Use a vision model for photo scanning.' },
  { id: 'custom', label: 'Other OpenAI-compatible server', format: 'openai', baseUrl: '', models: [], needsKey: false },
];

const presetFor = (id) => PRESETS.find((p) => p.id === id);

function parseDataUrl(image) {
  const m = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(image || '');
  if (!m) throw Object.assign(new Error('image must be a base64 data URL (png, jpeg, webp or gif)'), { status: 400 });
  return { mediaType: m[1] === 'image/jpg' ? 'image/jpeg' : m[1], data: m[2] };
}

// Pull the first JSON object out of a reply, tolerating ```json fences or chatter.
function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error('The AI did not return JSON');
  }
}

// Claude models that accept an effort setting and server-side refusal fallbacks.
const EFFORT_MODELS = /^claude-(opus|sonnet|fable)-/;
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

async function callAnthropic({ baseUrl, apiKey, model }, { system, text, image, schema }) {
  const content = [];
  if (image) {
    const { mediaType, data } = parseDataUrl(image);
    content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data } });
  }
  content.push({ type: 'text', text });
  const body = {
    model,
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content }],
    output_config: { format: { type: 'json_schema', schema } },
  };
  // Simple extraction and suggestion jobs don't need deep thinking.
  if (EFFORT_MODELS.test(model)) body.output_config.effort = 'low';
  const headers = { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
  const official = /api\.anthropic\.com/.test(baseUrl);
  if (official && FALLBACK_MODELS.has(model)) {
    // If a safety check declines the request, let the API retry it on its recommended fallback model.
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    body.fallbacks = 'default';
  }
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Claude returned ${res.status}: ${json.error?.message || res.statusText}`);
  if (json.stop_reason === 'refusal') throw new Error('Claude declined this request.');
  if (json.stop_reason === 'max_tokens') throw new Error('The answer was cut off. Try a smaller request.');
  const out = (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return extractJson(out);
}

async function callOpenAICompatible({ baseUrl, apiKey, model }, { system, text, image, schema }) {
  const user = image
    ? [{ type: 'text', text }, { type: 'image_url', image_url: { url: image } }]
    : text;
  const headers = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const body = {
    model,
    messages: [
      { role: 'system', content: `${system}\n\nReply with only a JSON object matching this JSON Schema:\n${JSON.stringify(schema)}` },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_object' },
  };
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`The AI returned ${res.status}: ${json.error?.message || res.statusText}`);
  const out = json.choices?.[0]?.message?.content;
  if (!out) throw new Error('The AI sent an empty reply');
  return extractJson(typeof out === 'string' ? out : out.map((p) => p.text || '').join(''));
}

// A saved key only goes to the server it was typed in for. If the AI's address is changed
// later (by an imported backup, someone else in the household, or a page that shouldn't be
// talking to this app), the key isn't sent there; it has to be typed in again.
const keyTarget = (settings, preset = presetFor(settings.provider)) =>
  preset ? `${preset.id} ${(settings.baseUrl || preset.baseUrl || '').replace(/\/+$/, '')}` : '';

function usableKey(settings) {
  const preset = presetFor(settings.provider);
  if (!preset) return '';
  const target = keyTarget(settings, preset);
  if (settings.apiKey) {
    // Keys saved before this check have no keyFor: trust them only at the preset's own address.
    const ok = settings.keyFor ? settings.keyFor === target : !settings.baseUrl || settings.baseUrl === preset.baseUrl;
    return ok ? settings.apiKey : '';
  }
  // A key from the server's environment (self-hosting) only goes to the preset's own address.
  if (settings.baseUrl && settings.baseUrl !== preset.baseUrl) return '';
  return (preset.format === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.AI_API_KEY) || '';
}

function callProvider(settings, request) {
  const preset = presetFor(settings.provider);
  if (!preset) throw Object.assign(new Error('No AI is set up. Choose one in Settings.'), { status: 409 });
  const cfg = {
    baseUrl: settings.baseUrl || preset.baseUrl,
    apiKey: usableKey(settings),
    model: settings.model || preset.models[0],
  };
  if (!cfg.baseUrl) throw Object.assign(new Error('Add the server address in AI settings.'), { status: 409 });
  if (!cfg.model) throw Object.assign(new Error('Choose a model in AI settings.'), { status: 409 });
  if (preset.needsKey && !cfg.apiKey) {
    const moved = settings.apiKey ? ' The AI\'s address has changed since the key was saved, so type the key in again.' : '';
    throw Object.assign(new Error(`Add an API key in AI settings.${moved}`), { status: 409 });
  }
  return preset.format === 'anthropic' ? callAnthropic(cfg, request) : callOpenAICompatible(cfg, request);
}

module.exports = { PRESETS, presetFor, callProvider, keyTarget, usableKey, extractJson, parseDataUrl };
