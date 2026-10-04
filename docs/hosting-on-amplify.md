# Hosting Family Planner on AWS Amplify

Amplify builds the home screen version straight from this GitHub repository and publishes it. Every change pushed to `main` goes live by itself. Everything runs in the browser and each device keeps its own data, so Amplify only serves files. You can do all of this from an iPad.

## Connect the repository (once)

1. **AWS account.** Sign up at aws.amazon.com (needs a card). Choose the **London (eu-west-2)** region at the top right of the console.
2. Open **AWS Amplify > Create new app**, choose **GitHub**, and allow Amplify to access your GitHub. Pick the `family-planner` repository and the `main` branch.
3. Amplify finds [`amplify.yml`](../amplify.yml) and fills in the build settings. Leave them as they are. Name the app `family-planner` and choose **Save and deploy**.
4. After a few minutes you get an address like `https://main.d1abc23xyz.amplifyapp.com`. You can add your own domain under **Hosting > Custom domains**.
5. **Optional, so every address opens the app:** under **Hosting > Rewrites and redirects > Manage redirects**, add
   - Source: `</^[^.]+$|\.(?!(css|js|png|svg|json|webmanifest|txt|ico)$)([^.]+$)/>`
   - Target: `/index.html`
   - Type: `200 (Rewrite)`

## Put it on your iPhone and iPad

Open the address in Safari, tap **Share**, then **Add to Home Screen**, and leave **Open as Web App** switched on. It opens full screen with its own icon and works offline. To use AI, open **Settings** in the app, find **AI helper**, choose a service and paste your key.

## Updating

Nothing to do. When a change is pushed to `main`, Amplify rebuilds and publishes it, and the app picks it up the next time it's opened with internet. Data on your devices isn't affected.

## Cost

Amplify Hosting is free for the first 12 months (1,000 build minutes, 15 GB served and 5 GB stored a month). After that it's $0.01 per build minute, $0.15 per GB served and $0.023 per GB stored. A build takes about a minute and the app is about 0.2 MB, so a family's use comes to pennies a month. A custom domain costs extra, about £10 a year. Setting an AWS budget alert (Billing > Budgets) is a good safety net.

## What it doesn't do (yet)

- **No sharing between devices.** The iPhone and iPad each keep their own data. To copy it across, use **Settings > Download backup** and **Restore from file**.
- No Apple built-in AI and no phone notifications. Those need the native iPhone app ([phone/](../phone/)).

Sharing one household across devices and people would need logins and a database. Amplify can add both (Amplify Auth and Amplify Data), and that's the "go multi-user" step in [the running-costs write-up](ideas-and-running-costs.md).
