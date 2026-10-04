# Family Planner

A family web app with two tools that share one design and one set of data:

- **Food planner.** Tell it what food is in, and it suggests meals you can make, tracks what goes off soonest, plans the week's dinners and estimates how many meals are left.
- **Kids clothes matcher.** Add each child's clothes, and it suggests outfits, counts what still fits, and forecasts when each child will need the next size (clothes and shoes) and what to buy.

It also has a shared shopping list, reminders, and optional AI help (meal ideas, and adding food or clothes from a photo) using the AI service you choose.

## What's in this repository

| Folder | What it is |
| --- | --- |
| [`web/`](web/) | The app itself: a zero-dependency Node server with a JSON API (`/api/v1`) and the web UI. `cd web && npm start`. See [web/README.md](web/README.md). |
| [`phone/`](phone/) | Builds the same app to run entirely in the browser or on an iPhone, with no server: the **home screen version** (`npm run build:web`) and an **iPhone app** (Capacitor, with Apple's on-device AI). See [phone/README.md](phone/README.md). |
| [`docs/`](docs/) | [Hosting on AWS Amplify](docs/hosting-on-amplify.md), [getting it on an iPhone without a Mac](docs/iphone-without-a-mac.md), and [improvement ideas and running costs](docs/ideas-and-running-costs.md). |
| [`amplify.yml`](amplify.yml) | Tells Amplify how to build and publish the home screen version from this repository. |

## Using it

The easiest way is the hosted home screen version. Connect this repository to AWS Amplify ([steps](docs/hosting-on-amplify.md)), open the address on your phone, and choose **Share > Add to Home Screen**. Your data stays on each device.

## Developing

```bash
cd web && npm test                  # web app tests
cd phone && npm ci && npm test      # phone layer unit tests
npm run test:e2e && npm run test:web  # browser tests (needs Playwright's Chromium)
```

GitHub Actions runs all of these on every push ([Tests](.github/workflows/ci.yml)). There's also a manual workflow that builds the iPhone app and sends it to TestFlight ([setup](docs/iphone-without-a-mac.md)).
