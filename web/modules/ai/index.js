// AI helpers: meal ideas from what's in, and photo scanning of food and clothes.
// The household picks the AI (Claude, OpenAI, Gemini, a local model...) in settings.
// Every task's prompt and JSON schema is also served by GET /api/v1/ai/tasks/:task,
// so the phone app can run the same task with on-device AI (Apple Foundation Models)
// and save the results through the normal bulk endpoints.
const { HttpError } = require('../../lib/http');
const { PRESETS, presetFor, callProvider } = require('./providers');
const { TYPES } = require('../clothes/engine');

const UNITS = ['g', 'kg', 'ml', 'l', 'pcs', 'tin', 'pack'];
const DEFAULT = { provider: 'none', model: '', baseUrl: '', apiKey: '', onDevice: true, monthlyLimit: 100, usage: { month: '', count: 0 } };

const SCHEMAS = {
  'meal-ideas': {
    type: 'object',
    properties: {
      ideas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            minutes: { type: 'integer' },
            servings: { type: 'integer' },
            why: { type: 'string' },
            uses: { type: 'array', items: { type: 'string' } },
            missing: { type: 'array', items: { type: 'string' } },
            ingredients: {
              type: 'array',
              items: {
                type: 'object',
                properties: { name: { type: 'string' }, qty: { type: 'number' }, unit: { type: 'string', enum: UNITS } },
                required: ['name', 'qty', 'unit'],
                additionalProperties: false,
              },
            },
            steps: { type: 'array', items: { type: 'string' } },
          },
          required: ['name', 'minutes', 'servings', 'why', 'uses', 'missing', 'ingredients', 'steps'],
          additionalProperties: false,
        },
      },
    },
    required: ['ideas'],
    additionalProperties: false,
  },
  'scan-food': {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            quantity: { type: 'number' },
            unit: { type: 'string', enum: UNITS },
          },
          required: ['name', 'quantity', 'unit'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
  'scan-clothes': {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string', enum: TYPES },
            colour: { type: 'string' },
            pattern: { type: 'string', enum: ['plain', 'patterned'] },
            season: { type: 'string', enum: ['all', 'summer', 'winter'] },
          },
          required: ['name', 'type', 'colour', 'pattern', 'season'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
};

const SYSTEM = {
  'meal-ideas':
    'You help a UK family decide what to cook from what is already in their kitchen. Suggest realistic, ' +
    'child-friendly home meals that mostly use the food listed, favouring anything that goes off soon. ' +
    'Follow the dietary needs strictly. Keep steps short and practical. Quantities are for the servings you give. ' +
    'List in "missing" only ingredients they would need to buy, ignoring salt, pepper, oil and water.',
  'scan-food':
    'You read photos of food: a fridge, a cupboard, shopping on a table, or a supermarket receipt. ' +
    'List each distinct food item you can identify with a short everyday name (for example "Cheddar", "Chopped tomatoes"). ' +
    'Estimate the amount from the pack size where you can, using g, kg, ml, l, tin, pack or pcs; use 0 when you cannot tell. ' +
    'Leave out non-food items, prices and totals.',
  'scan-clothes':
    'You look at photos of children\'s clothes and describe each garment you can see so it can be added to a wardrobe app. ' +
    'Give a short name (for example "Blue dinosaur T-shirt"), the type, the main colour as one common word, ' +
    'whether it is plain or patterned, and the season it suits (all, summer or winter).',
};

function mealPrompt({ family, pantry, recipes, request, today }) {
  const kids = family.children.map((c) => (c.age != null ? `${Math.floor(c.age)}` : '?')).join(', ');
  const food = pantry.map((p) => `- ${p.name}${p.quantity != null ? `: ${p.quantity} ${p.unit}` : ''}${p.expiry ? ` (use by ${p.expiry})` : ''}`).join('\n');
  return [
    `Today is ${today}.`,
    `Family: ${family.adults} adult${family.adults === 1 ? '' : 's'}${family.children.length ? ` and children aged ${kids}` : ''} (about ${family.portions} adult portions per meal).`,
    family.dietary.length ? `Dietary needs: ${family.dietary.join(', ')}.` : 'No dietary restrictions.',
    `Food in the kitchen:\n${food || '- (nothing listed)'}`,
    `They already know these recipes, so suggest something different: ${recipes.slice(0, 60).join(', ')}.`,
    `Suggest 4 meal ideas.${request ? ` They asked for: ${request}` : ''}`,
  ].join('\n\n');
}

const SCAN_PROMPT = {
  'scan-food': 'List the food in this photo.',
  'scan-clothes': 'Describe the clothes in this photo.',
};

function register(router, store, { familySummary, food }) {
  const settings = () => {
    const s = store.get('ai', DEFAULT);
    for (const [k, v] of Object.entries(DEFAULT)) if (s[k] === undefined) s[k] = structuredClone(v);
    return s;
  };
  const publicSettings = () => {
    const { apiKey, ...rest } = settings();
    const preset = presetFor(rest.provider);
    return {
      ...rest,
      hasKey: Boolean(apiKey) || (preset?.format === 'anthropic' ? Boolean(process.env.ANTHROPIC_API_KEY) : Boolean(process.env.AI_API_KEY)),
      apiKeyHint: apiKey ? `…${apiKey.slice(-4)}` : null,
      ready: rest.provider !== 'none' && Boolean(preset),
    };
  };

  // Count each call against a monthly cap so a paid AI can't run up a surprise bill.
  const spend = () => {
    const s = settings();
    const month = new Date().toISOString().slice(0, 7);
    if (s.usage.month !== month) s.usage = { month, count: 0 };
    if (s.monthlyLimit && s.usage.count >= s.monthlyLimit) {
      throw new HttpError(429, `This month's AI limit (${s.monthlyLimit}) is used up. Raise it in AI settings.`);
    }
    s.usage.count++;
    store.save();
  };

  const run = async (task, { text, image }) => {
    spend();
    try {
      return await callProvider(settings(), { system: SYSTEM[task], text, image, schema: SCHEMAS[task] });
    } catch (e) {
      throw new HttpError(e.status || 502, e.message);
    }
  };

  const mealContext = (request) => mealPrompt({
    family: familySummary(),
    pantry: food.pantry(),
    recipes: food.recipes().map((r) => r.name),
    request: request ? String(request).slice(0, 300) : '',
    today: new Date().toISOString().slice(0, 10),
  });

  router.get('/api/v1/ai/providers', () => PRESETS);
  router.get('/api/v1/ai/settings', () => publicSettings());

  router.put('/api/v1/ai/settings', (req, body) => {
    const s = settings();
    if (body.provider !== undefined) {
      if (body.provider !== 'none' && !presetFor(body.provider)) throw new HttpError(400, 'Unknown provider');
      if (body.provider !== s.provider) {
        // A key for one provider is no use to another.
        s.apiKey = '';
        s.baseUrl = '';
        s.model = '';
      }
      s.provider = body.provider;
    }
    if (body.model !== undefined) s.model = String(body.model || '').trim();
    if (body.baseUrl !== undefined) {
      const u = String(body.baseUrl || '').trim();
      if (u && !/^https?:\/\//.test(u)) throw new HttpError(400, 'Server address must start with http:// or https://');
      s.baseUrl = u;
    }
    if (body.apiKey !== undefined) s.apiKey = String(body.apiKey || '').trim();
    if (body.onDevice !== undefined) s.onDevice = Boolean(body.onDevice);
    if (body.monthlyLimit !== undefined) {
      const n = Number(body.monthlyLimit);
      if (!Number.isInteger(n) || n < 0) throw new HttpError(400, 'monthlyLimit must be a whole number (0 = no limit)');
      s.monthlyLimit = n;
    }
    store.save();
    return publicSettings();
  });

  // Prompt + schema for a task, filled with this household's data.
  // For on-device AI: run it on the phone, then save with the bulk endpoints.
  router.get('/api/v1/ai/tasks/:task', (req, body, { task }) => {
    if (!SCHEMAS[task]) throw new HttpError(404, `Unknown task. Try: ${Object.keys(SCHEMAS).join(', ')}`);
    return {
      task,
      system: SYSTEM[task],
      prompt: task === 'meal-ideas' ? mealContext(req.query.get('request')) : SCAN_PROMPT[task],
      needsImage: task !== 'meal-ideas',
      schema: SCHEMAS[task],
      saveWith: { 'meal-ideas': 'POST /api/v1/ai/meal-ideas/save', 'scan-food': 'POST /api/v1/food/items/bulk', 'scan-clothes': 'POST /api/v1/clothes/items/bulk' }[task],
    };
  });

  router.post('/api/v1/ai/test', async () => {
    const r = await run('scan-food', { text: 'There is no photo. Reply with an items list containing one item: name "Test", quantity 1, unit "pcs".' });
    return { ok: Array.isArray(r.items), reply: r };
  });

  router.post('/api/v1/ai/meal-ideas', async (req, body) => {
    const r = await run('meal-ideas', { text: mealContext(body.request) });
    return { ideas: Array.isArray(r.ideas) ? r.ideas : [] };
  });

  // Turn an AI idea (from the server or on-device) into a saved recipe.
  router.post('/api/v1/ai/meal-ideas/save', (req, body) => {
    const idea = body.idea || body;
    const recipe = food.addRecipe({
      name: idea.name,
      servings: idea.servings || 4,
      minutes: idea.minutes || 30,
      tags: ['dinner', 'ai'],
      ingredients: (idea.ingredients || []).filter((i) => i.qty > 0),
      steps: idea.steps,
    });
    return recipe;
  });

  router.post('/api/v1/ai/scan', async (req, body) => {
    const kind = body.kind === 'clothes' ? 'clothes' : 'food';
    if (!body.image) throw new HttpError(400, 'Send a photo as image (a base64 data URL)');
    if (body.image.length > 7_000_000) throw new HttpError(413, 'Photo too large. Try a smaller one.');
    const task = `scan-${kind}`;
    const r = await run(task, { text: SCAN_PROMPT[task], image: body.image });
    const items = (Array.isArray(r.items) ? r.items : []).map((i) =>
      kind === 'food' ? { ...i, quantity: i.quantity > 0 ? i.quantity : null } : i);
    return { kind, items };
  });

  return { publicSettings };
}

module.exports = { register, SCHEMAS, SYSTEM, mealPrompt };
