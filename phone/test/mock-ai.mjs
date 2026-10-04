// A stand-in OpenAI-compatible AI for tests: answers by recognising the task.
import http from 'node:http';

export const MEAL = { name: 'Chicken and rice traybake', minutes: 35, servings: 4, why: 'Uses the chicken first.',
  uses: ['chicken', 'rice'], missing: ['lemon'],
  ingredients: [{ name: 'chicken', qty: 500, unit: 'g' }, { name: 'rice', qty: 300, unit: 'g' }], steps: ['Roast it all.'] };

export function answerFor(text) {
  // AI suggestions (shopping, meals, outfits): pick from the ids listed in the prompt.
  const ids = (re) => [...text.matchAll(re)].map((m) => m.slice(1));
  if (/shopping list right/.test(text)) return { suggestions: [{ kind: 'food', name: 'Teabags', quantity: 0, childName: '', size: '', reason: 'You get through a box a week.' }] };
  if (/plan dinners for a UK family/.test(text)) {
    const [first] = ids(/(?:\n|\\n)- ([\w-]+) \| /g);
    return { picks: first ? [{ recipeId: first[0], why: 'Uses the chicken before it goes off.' }] : [], week: first ? [{ day: 0, recipeId: first[0] }] : [] };
  }
  if (/choose a child's clothes/.test(text)) {
    const items = ids(/(?:\n|\\n)- ([\w-]+) \| (\w+) \|/g);
    const pick = ['top', 'bottom'].map((t) => items.find((i) => i[1] === t)?.[0]).filter(Boolean);
    return { outfits: [{ itemIds: pick, why: 'Comfy for the park.' }] };
  }
  if (/cook|meal ideas/i.test(text)) return { ideas: [MEAL] };
  if (/clothes|garment/i.test(text)) return { items: [{ name: 'Navy joggers', type: 'bottom', colour: 'navy', pattern: 'plain', season: 'all' }] };
  return { items: [{ name: 'Chopped tomatoes', quantity: 2, unit: 'tin' }, { name: 'Carrots', quantity: 0, unit: 'kg' }] };
}

export function startMockAI(port = 5174) {
  const calls = [];
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const msg = JSON.parse(body);
      calls.push(msg);
      const content = 'Sure!\n```json\n' + JSON.stringify(answerFor(JSON.stringify(msg.messages))) + '\n```';
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
    });
  });
  return new Promise((r) => server.listen(port, () => r({ server, calls })));
}
