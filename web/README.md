# Family Planner

A web app with two separate tools that share one UI and one API:

- **Food planner**: list what food you have in and it shows the meals you can make, the ones you're one or two items short of, and an estimate of how many meals you have left.
- **Kids clothes matcher**: list each child's clothes and it suggests outfit combinations, counts what still fits, and forecasts when each child will need the next size and how many of each item to buy.

A **shopping list** ties them together: it suggests the food that would unlock the most meals and the clothes each child is short of, and ticking "Bought" puts things straight into the cupboard or wardrobe.

Both read the **family settings** (number of adults, plus each child's birth date, clothing size and shoe size). Change the family size and meal portions, meal estimates and clothes forecasts adjust.

## Run it

You need Node.js 18 or newer. There are no packages to install.

```bash
cd family-planner
npm start            # http://localhost:3000
```

Set `PORT` to change the port and `DATA_FILE` to choose where data is saved (default `data/db.json`).

```bash
npm test             # engine and API tests
```

## Using it

1. **Family**: set the number of adults and add each child with their birthday, clothing size (UK age bands such as `18-24M`, `4-5Y`) and UK shoe size (`11`, or `2 adult`). Edit a child any time. You can also set how many of each item a child should have (default 7 tops, 5 bottoms, 3 pyjamas, 1 coat, 2 pairs of shoes).
2. **Food**, in three views:
   - *What's in*: add food (or tap a quick-add), grouped by type, with +/- steppers and use-by warnings. Use g/kg, ml/l, `tin` or `pcs` so quantities can be counted; items without a quantity count as "have some" and never run out.
   - *Meals*: recipe cards you can filter (ready now, under 20 minutes, vegetarian, uses food going off). Each shows the ingredients scaled to your family. "Cooked it" takes them out of the cupboard; "Add to shopping" lists what's missing.
   - *My recipes*: add your own recipes with an ingredients list. They appear in meal ideas and the weekly plan.
3. **Clothes**: pick a child. You get an outfit of the day (it changes daily, or tap Shuffle), the child's status and forecasts, their wardrobe with filters and outgrown / grow-into / worn-out labels, and every outfit idea by season.
4. **Shopping**: your list grouped into food, clothes and other, plus suggestions you can add one at a time or all at once. Suggestions come from your own habits, with no AI: food that ran out, things you buy regularly that are due again, and what's missing for the meals you cook most or have starred. Each says why, and **Not now** hides one for two weeks.
5. **Home**: the data panel. Meals left, food to use soon, children needing clothes, the shopping list count, this week's dinners and each child's clothes and shoe forecasts.

6. **Settings**: family diet (vegetarian, dairy-free, gluten-free, nut-free), your town for weather, the AI helper, typical clothes prices and backups.

### What's new in this version

- **Food**: scan a barcode (camera, or type the number; product details come from Open Food Facts), or snap a photo of the cupboard or a receipt and let AI list it for you to check. Meals respect the family's diet, you can star family favourites, and the home page shows the week's balance (veg, protein, carbs, dairy) with tips.
- **AI meal ideas**: ask for something ("quick, no oven") and get new ideas from what's in, with the steps. Save one as a recipe, or add what's missing to the shopping list.
- **Clothes**: mark things as in the wash ("Laundry done" puts them back), flag school uniform (kept out of everyday outfits, with a "buy before term" forecast), weather-aware outfit of the day, hand-me-downs between siblings, a copy-ready listing for selling outgrown clothes, and a clothes budget per child (now, next size, shoes).
- **Reminders**: one list of what needs doing soon (food going off, kids short of clothes, laundry, the shopping list), on the home page and at `/api/v1/reminders` for phone notifications.
- **Shopping**: copy or share the list, and search links for Tesco, Sainsbury's and Ocado on food items.
- **Backup**: download everything as a file and restore it later (your AI key is never included).
- **Works offline**: once loaded, the app opens without a connection and shows the last data it saw. Changes need the connection back.

## AI (optional)

Everything works without AI. In **Settings → AI helper** pick one:

| Option | Key needed | Notes |
| --- | --- | --- |
| iPhone on-device AI | No | In the phone app on supported iPhones. Free and private. Used first when it's on; the extra AI below is the fallback |
| Claude (Anthropic) | Yes | Default model `claude-opus-5-5`; Sonnet and Haiku are cheaper |
| ChatGPT (OpenAI), Gemini, Mistral, OpenRouter | Yes | Any model name the service offers |
| Ollama | No | Free, runs on your own computer (web version only) |
| Other OpenAI-compatible server | Depends | Give it the server address |

AI is used for meal ideas and for reading photos of food, receipts and clothes. You review everything before it's added. There's a monthly limit (default 100 requests, 0 means none) so a paid key can't run away. The key is stored with your data on the server or phone, is never sent back to the browser in full, and is never put in backups.

There's a light and dark mode (it follows your device until you pick one), and on a phone the menu moves to a bar at the bottom. You can add it to your phone's home screen from the browser menu.

## How the estimates work

- **Portions**: each adult is 1 portion; children under 4 are ½, 4 to 10 are ¾, 11 and over are 1, and under 1s are 0. Recipe quantities are scaled to that total.
- **Meals left**: the app "cooks" the best available main meal over and over (favouring food that goes off within 3 days and variety) until nothing more can be made, and counts the meals. Breakfast recipes aren't counted.
- **Outfits**: tops are paired with bottoms, and dresses and onesies stand alone; the best-matching coat and shoes are added. Neutrals (black, white, grey, navy, denim, beige...) go with anything; two patterns, or pairs like pink and red, score lower. Only clothes that fit now and aren't marked worn out are used. Summer and winter items aren't mixed.
- **Weekly dinners**: the first seven meals of that plan, starting today. Days the food runs out show "Shop needed".
- **Shoe forecast**: feet go up roughly half a size every 2 months for babies, 2.5 for toddlers, 3.5 at 3 to 5, 5 at 5 to 8, 6 at 8 to 12 and 9 after that, counted from when the shoe size was entered. A 7 year old's "2" is read as adult size 2.
- **Size forecast**: kids move up roughly one band per band's worth of age. If the child's age sits inside their current band, they're expected to move up when they reach the top of it; if they're big or small for their age, the app assumes they were mid-band when the size was entered. Update the size whenever it changes and the forecast resets from that date.

## API (shared by the web and phone apps)

Everything the UI does goes through this JSON API, and CORS is open, so a phone app can use it unchanged.

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/api/v1/dashboard` | Combined data panel: family, food stats, clothes stats per child |
| GET/PUT | `/api/v1/family` | Household (`{ adults }`), with `people` and `portions` computed |
| POST | `/api/v1/family/children` | Add a child `{ name, birthDate, clothingSize, shoeSize }` |
| PUT/DELETE | `/api/v1/family/children/:id` | Update or remove a child (removing also removes their clothes) |
| GET/POST | `/api/v1/food/items` | Pantry items `{ name, quantity, unit, expiry }` |
| PUT/DELETE | `/api/v1/food/items/:id` | Update or remove a pantry item |
| GET/POST | `/api/v1/food/recipes` | Built-in plus your own recipes |
| DELETE | `/api/v1/food/recipes/:id` | Remove one of your own recipes |
| GET | `/api/v1/food/meals?maxMissing=2` | Meal suggestions, ready ones first |
| POST | `/api/v1/food/meals/:id/cook` | Deduct a meal's ingredients, scaled to the family |
| GET | `/api/v1/food/stats` | Meals left, the plan behind it, items to use soon |
| GET/POST | `/api/v1/clothes/items?childId=` | Clothes `{ childId, name, type, colour, size, pattern, season, wornOut }` |
| PUT/DELETE | `/api/v1/clothes/items/:id` | Update or remove a clothes item |
| GET | `/api/v1/clothes/outfits/:childId?season=any&limit=50` | Ranked outfit combinations |
| GET | `/api/v1/clothes/stats` | Per-child counts, shortfall, forecast, next-size shopping list |
| GET | `/api/v1/shopping` | Shopping list items and suggestions (each with `reason`, `source` and `key`) |
| POST | `/api/v1/ai/suggest/:area` | AI suggestions for `shopping`, `meals` (picks + week) or `outfits` (`childId`, `tempC`, `rain`); `refresh` asks again, `result` hands in an on-device answer |
| POST | `/api/v1/shopping/suggestions/dismiss` | `{ key }`: hide a suggestion for 14 days |
| POST | `/api/v1/shopping/items` | Add `{ name, kind: food\|clothes\|other, quantity, childId, size, type, note }` |
| PUT/DELETE | `/api/v1/shopping/items/:id` | Update (e.g. `{ done: true }`) or remove |
| POST | `/api/v1/shopping/items/:id/bought` | Food goes to the pantry, clothes to the child's wardrobe |
| POST | `/api/v1/shopping/clear-done` | Remove ticked items |
| GET/PUT | `/api/v1/clothes/targets` | How many of each item type a child should have |
| GET | `/api/v1/food/meta`, `/api/v1/clothes/meta` | Allowed units, diets, clothing types and sizes |
| POST | `/api/v1/food/items/bulk`, `/api/v1/clothes/items/bulk` | Add up to 200 items `{ items: [...] }` |
| GET | `/api/v1/food/barcode/:code` | Product lookup `{ barcode, name, brand, packSize, quantity, unit }` |
| PUT | `/api/v1/food/recipes/:id/favourite` | `{ favourite: true }` |
| POST | `/api/v1/clothes/laundry/done` | Mark everything (or `{ childId }`) clean |
| GET | `/api/v1/clothes/hand-me-downs` | Outgrown clothes a sibling can use |
| POST | `/api/v1/clothes/items/:id/hand-down` | Move an item to `{ childId }` |
| GET | `/api/v1/clothes/outfit-of-the-day/:childId?tempC=&rain=` | Today's outfit, adjusted for weather |
| GET/PUT | `/api/v1/clothes/prices` | Typical prices used for the budget |
| GET | `/api/v1/reminders` | `[{ id, kind, level, title, detail, date }]`, ids are stable |
| GET | `/api/v1/export`, POST `/api/v1/import` | Backup and restore |
| GET/PUT | `/api/v1/ai/settings` | Provider, model, key (write only), monthly limit, `ready` |
| GET | `/api/v1/ai/providers` | The AI services you can pick |
| GET | `/api/v1/ai/tasks/:task` | Prompt and JSON schema for a task, so on-device AI can run it |
| POST | `/api/v1/ai/test`, `/api/v1/ai/meal-ideas`, `/api/v1/ai/scan` | Run AI (`409` if none set up, `429` at the monthly limit) |
| POST | `/api/v1/ai/meal-ideas/save` | Save an idea `{ idea }` as a recipe |

Errors come back as `{ "error": "message" }` with a 4xx status.

## Layout

```
server.js                 HTTP server: static UI + /api/v1, wires the modules together
lib/store.js              JSON-file storage (swap for a database later)
lib/http.js               Tiny router
modules/family.js         Family settings and portion sizes (shared)
modules/food/             Food planner: recipes.js, engine.js (logic), index.js (routes)
modules/clothes/          Clothes matcher: sizes.js, shoes.js, engine.js (logic), index.js (routes)
modules/shopping/         Shopping list that reads from both tools
modules/reminders.js      Reminders across food, clothes, laundry and shopping
modules/ai/               AI providers (Claude, OpenAI-compatible) and tasks
public/sw.js              Offline support
public/                   Web UI (plain HTML/CSS/JS)
test/                     node:test tests
```

The two tools don't depend on each other; each only reads the shared family settings. The engine files are pure functions with no storage or HTTP, so they can be reused or ported for a phone app.

## Not done yet

- No logins: it's one household per server, so run it on your own machine or home network.
- No supermarket ordering: the shopping links open a search on the shop's site.
- It needs a connection the first time to load its font; without one it falls back to the system font.
