# Family Planner for iPhone

The Family Planner web app as an iPhone app. It has all the web app's features (food planner, clothes matcher, shopping list, reminders and AI helpers) and runs entirely on the phone, so no server or computer has to stay on.

- **iPhone AI.** On iPhones with Apple Intelligence (iPhone 15 Pro or newer, iOS 26+), meal ideas and photo scanning use Apple's on-device model. Nothing leaves the phone and it costs nothing.
- **An extra AI of your choice.** In Settings you can add Claude, ChatGPT, Gemini, Mistral, OpenRouter or any OpenAI-compatible service with your own API key. It's used when on-device AI is turned off or isn't available, and for jobs too big for the on-device model.
- **Photos read on the phone.** Receipts, barcodes and clothes are read with Apple's Vision framework before any AI sees them. Barcodes are looked up in Open Food Facts, which is free.
- **Notifications** for food about to go off, low stock and upcoming size changes, at 5pm the day before.
- **Backup.** Export opens the iOS share sheet (Save to Files, AirDrop and so on). Import also accepts the web app's `data/db.json`, so you can move a household from the web version to the phone.

## Installing it on your iPhone

**No Mac?** See [docs/iphone-without-a-mac.md](../docs/iphone-without-a-mac.md). It covers a free home screen version (`npm run build:web`) and the full app built in the cloud and installed with TestFlight ([`.github/workflows/testflight.yml`](../.github/workflows/testflight.yml)). To host the home screen version, see [docs/hosting-on-amplify.md](../docs/hosting-on-amplify.md).

**With a Mac:**

You need a Mac with **Xcode 26** or newer (from the Mac App Store), **Node.js 20+**, your iPhone and a USB cable.

1. Clone this repository. The phone app is built from the web app in `../web`.
2. In Terminal:
   ```bash
   cd family-planner/phone
   npm install
   npm run sync      # builds the app from ../web and updates the Xcode project
   npm run open      # opens it in Xcode
   ```
3. In Xcode, click **App** in the left sidebar, open **Signing & Capabilities**, and choose your Apple ID under **Team**. Add the Apple ID in Xcode > Settings > Accounts if it isn't listed. If Xcode says the bundle identifier is taken, change `com.familyplanner.app` to something unique, such as `com.yourname.familyplanner`.
4. Plug in the iPhone, pick it at the top of the Xcode window, and press ▶ Run. The first time, the iPhone will ask you to trust the developer: open Settings > General > VPN & Device Management and tap your Apple ID. It also needs Developer Mode on (Settings > Privacy & Security > Developer Mode).

With a free Apple ID the app works for 7 days before Xcode has to reinstall it. A paid Apple Developer account (about £79 a year) removes that limit and lets you share the app with family through TestFlight.

**After the web app changes**, run `npm run sync` again and press Run in Xcode. The phone app always picks up the web app's latest features this way.

## How it works

```
www/                     built by `npm run build` (not edited by hand)
  index.html, app.js...  the web app's own UI, copied from ../web/public
  mobile/mobile.js       the web app's API (server.js + modules), bundled to run in the phone
mobile/                  the phone layer
  main.js                starts everything: loads saved data, runs the API, then the web UI
  local-api.js           answers the UI's /api/v1 calls inside the app instead of over a network
  browser-store.js       stands in for lib/store.js; saves to the phone (storage.js)
  on-device.js           sends AI meal ideas and photo scans to Apple's on-device model
  ios-shims.js           iPhone fixes: barcode scanning, file export, Claude from the phone
  notifications.js       turns /api/v1/reminders into iPhone notifications
  cloud.js               household account: sign-in and saving online (infra/cloud.yaml)
plugins/on-device-ai/    the app's own Swift plugin: Apple Foundation Models + Vision
ios/                     the Xcode project (Capacitor 8)
scripts/build.mjs        builds www/ from ../web (or FAMILY_PLANNER_DIR)
scripts/ios-assets.mjs   draws the app icon and splash screen from the web app's icon
```

The web app's code isn't copied by hand or changed. `npm run build` bundles it as it is, swapping only its JSON-file store for one that saves on the phone. The phone layer adds Apple's on-device AI by answering `POST /api/v1/ai/meal-ideas`, `/api/v1/ai/scan` and `/api/v1/ai/test` itself, using the prompt and JSON schema the web app serves at `GET /api/v1/ai/tasks/:task`. If on-device AI is off, unavailable, or can't handle a job (too much text, or nothing readable in a photo), the request goes to the web app's own handler, which uses the extra AI if one is set up. `GET /api/v1/ai/settings` also reports `onDeviceAvailable` and `onDeviceReason`.

### Privacy

- Household data is stored only on the phone, in the app's private storage. It isn't synced with the web version; use export and import to move it.
- With iPhone AI, nothing leaves the phone.
- With an extra AI, the food list or photo for that request goes to the service you chose, and it bills you for it. The web app's monthly AI limit still applies. Your API key is kept in the app's private storage on the phone.

## Trying it without an iPhone

```bash
npm run serve      # http://localhost:5173 in a desktop browser, at phone size in dev tools
npm test           # unit tests for the phone layer
npm run test:web   # checks the home screen build, including opening offline
npm run test:account  # account sign-in and saving online, against a stand-in for AWS
npm run test:e2e   # runs the built app in Chromium at iPhone size, with a stand-in for
                   # Apple's on-device AI and a mock extra AI (needs Playwright's Chromium)
```

In a desktop browser, on-device AI reports "Only available in the iPhone app" and everything else works, including an extra AI.

## Not checked yet

- The Swift plugin (`plugins/on-device-ai`) hasn't been compiled. That needs a Mac, and none was available here. Everything in JavaScript is tested, including the on-device path through a stand-in. If Xcode shows a build error, send the message and it can be fixed quickly.
- On-device AI needs iOS 26 and Apple Intelligence turned on. On older iPhones the app still works, using the extra AI or no AI.
- Apple's on-device model has a small context window. A very large pantry can be too much for it, and then meal ideas go to the extra AI, or the app says so if there isn't one.
