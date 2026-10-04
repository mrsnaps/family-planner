# Getting Family Planner on your iPhone without a Mac

There are two versions, and you can have both.

| | Home screen version | Full app (TestFlight) |
| --- | --- | --- |
| Cost | Free | Apple Developer Program, about £79 a year |
| Ready | Today | After Apple approves your membership (can take a day or two) |
| All the app's features | Yes | Yes |
| Apple's built-in AI (on the phone, free, private) | No | Yes |
| Extra AI of your choice (Claude, ChatGPT…) | Yes | Yes |
| Photos read on the phone, barcodes from photos | No, the extra AI reads photos | Yes |
| Notifications | No (reminders show on the Home page) | Yes |
| Works offline once opened | Yes | Yes |

Everything below can be done on an iPad or iPhone.

---

## 1. Home screen version (free, today)

The simplest way is to let AWS Amplify publish it from this repository: see [hosting-on-amplify.md](hosting-on-amplify.md). Or, without an AWS account:

1. **Download** `family-planner-home-screen.zip` from the project thread and save it to Files. Don't unzip it.
2. **Put it online.** In Safari, go to **app.netlify.com/drop**. Sign up free with your email, so the site doesn't expire. Tap **browse to upload** and pick the zip. Netlify gives you an address like `https://cheerful-otter-123.netlify.app`. You can change the name under **Site configuration > Change site name**, for example `schofield-family.netlify.app`.
3. **Add it to your iPhone.** Open the address in Safari on the iPhone, tap **Share**, then **Add to Home Screen**, and leave **Open as Web App** switched on. It now opens full screen like an app, with its own icon.
4. **Optional: add an AI.** In the app, go to **Settings**, find **AI helper**, choose a service (Claude, ChatGPT, Gemini…) and paste your API key.

Good to know:
- Your data is saved on the device, not on Netlify. The iPhone and iPad each keep their own copy. To copy data across, use **Settings > Download backup** on one and **Restore from file** on the other.
- The address is public, but it only serves the empty app. Nobody else can see your data.
- **To update** when the app gets new features, download the new zip, open your site on Netlify, go to **Deploys**, and upload it there. Your data stays.

---

## 2. Full app through TestFlight (with Apple's built-in AI)

GitHub's Macs build the app and send it to Apple's TestFlight app on your iPhone. You set it up once (around 30 minutes, plus Apple's approval). After that, a new version is one tap.

**A. Join the Apple Developer Program.** Install the **Apple Developer** app on the iPhone or iPad, sign in with your Apple ID, and tap **Enroll**. It's about £79 a year. Wait for the email saying you're approved.

**B. Register the app's ID.** In Safari, go to **developer.apple.com/account**.
1. Under **Membership details**, copy your **Team ID** (10 letters and numbers).
2. Go to **Certificates, IDs & Profiles > Identifiers > +**, choose **App IDs**, then **App**, then Continue. For Description enter `Family Planner`. For Bundle ID choose **Explicit** and enter something unique, like `com.schofield.familyplanner`. Then Continue and Register.

**C. Create the app in App Store Connect.** Go to **appstoreconnect.apple.com > Apps > + > New App**. Choose iOS, a name (it must be unique on the App Store, so try `Schofield Family Planner`), language English (UK), and the bundle ID from step B. For SKU enter `familyplanner`. Nothing is published to the App Store. TestFlight only.

**D. Make an API key** so GitHub can sign and upload the app for you. In App Store Connect, go to **Users and Access > Integrations > App Store Connect API**. Generate a key named `GitHub` with **Admin** access. Copy the **Issuer ID** and the **Key ID**, and **download the key** (you can only download it once). In Files, rename it from `.p8` to `.txt` so you can open it and copy the text.

**E. GitHub.** This repository already has the build set up in [`.github/workflows/testflight.yml`](../.github/workflows/testflight.yml).

**F. Add the secrets.** In this repository on GitHub, go to **Settings > Secrets and variables > Actions > New repository secret** and add these five:

| Name | Value |
| --- | --- |
| `APPLE_TEAM_ID` | Team ID from step B |
| `APP_BUNDLE_ID` | Bundle ID from step B, e.g. `com.schofield.familyplanner` |
| `ASC_KEY_ID` | Key ID from step D |
| `ASC_ISSUER_ID` | Issuer ID from step D |
| `ASC_KEY_P8` | All the text from the key file, including the BEGIN and END lines |

These stay in your GitHub account. Don't paste them into the chat.

**G. Build it.** In the repository, go to **Actions > iPhone app to TestFlight > Run workflow**. It takes about 15 to 20 minutes. If it fails, tell me in the thread and I'll fix it from the build log.

**H. Install it.**
1. In App Store Connect, open your app, go to **TestFlight > Internal Testing > +**, create a group, and add yourself (and family who have Apple IDs).
2. On the iPhone, install **TestFlight** from the App Store and open the invite email. Tap **Install**.
3. On first run, allow notifications and turn on Apple Intelligence (Settings > Apple Intelligence & Siri) if it isn't already. The app's AI helper (in Settings) will then show as ready.

TestFlight builds last 90 days. Running the build again (step G) gives you a fresh one with the latest features.

**Costs:** the Apple Developer Program is about £79 a year. GitHub's free plan includes enough Mac build time for roughly 10 builds a month in a private repository.
