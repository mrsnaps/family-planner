# Hosting Family Planner on AWS Amplify

**Live now:** https://main.d3ofenwxb2m5fu.amplifyapp.com (Amplify app `family-planner`, London region). **Updates are automatic:** every push to `main` runs the tests, and when they pass the `deploy` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) builds `phone/dist-web` and publishes it. GitHub signs in to AWS with the role in [`infra/deploy.yaml`](../infra/deploy.yaml) (stack `family-planner-deploy`), so no AWS keys are stored in GitHub. The steps below are the alternative of linking a new Amplify app to the repo in the console.

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

Nothing to do. When a change is pushed to `main` and the tests pass, GitHub publishes it to Amplify (the `deploy` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)), and the app picks it up the next time it's opened with internet. Data on your devices isn't affected. GitHub signs in to AWS through the role in [`infra/deploy.yaml`](../infra/deploy.yaml), which can only publish this one app and only from `main`; no AWS keys are stored in GitHub.

## Cost

Amplify Hosting is free for the first 12 months (1,000 build minutes, 15 GB served and 5 GB stored a month). After that it's $0.01 per build minute, $0.15 per GB served and $0.023 per GB stored. A build takes about a minute and the app is about 0.2 MB, so a family's use comes to pennies a month. A custom domain costs extra, about £10 a year. Setting an AWS budget alert (Billing > Budgets) is a good safety net.

## Accounts and saving online

In the app, **Settings > Account** lets each person create their own login (email and password, confirmed with a code by email) and sign in with it on each iPhone, iPad or computer. To share one household, someone already signed in taps **Invite someone** and passes on the 8-character code (it lets one person in, works for 7 days, and stops working if the person who made it leaves); the other person signs in with their own email, taps **Join a household** and enters it. Their device then switches to the household's lists. **Leave household** takes them back to their own lists, starting from a copy. Every change is then saved online by itself, and the other devices pick it up when they're next opened. While the app is open it checks for other people's changes every few seconds, so a list two people are shopping from stays the same on both phones. If two people change things at the same moment, both sets of changes are combined (when both changed the very same thing, the first save wins). Each device keeps its own AI key, which is never uploaded, and only sends it to the AI server it was typed in for: if someone changes the AI's address, the key has to be typed in again. Signing out keeps the data on that device but stops saving it online.

Behind it is the CloudFormation stack `family-planner-cloud` in London ([`infra/cloud.yaml`](../infra/cloud.yaml)):
- **Amazon Cognito** for sign-in (Lite tier, free up to 10,000 people a month). Codes come from Cognito's own email address, which is limited to 50 emails a day.
- **S3** holds one private file per household. Old copies are kept for 30 days, so a bad change can be undone from the AWS console.
- **API Gateway and a small Lambda function** ([`infra/lambda/index.js`](../infra/lambda/index.js)) read and save that file for the people in that household, and handle invites. After editing the function, run `node infra/build.mjs` to copy it into the template; CI checks they match and runs its tests.

For one family this costs nothing within the free tiers, and pennies a month after them. The app's address and IDs are in [`phone/mobile/cloud-config.js`](../phone/mobile/cloud-config.js). If the app moves to a new address, update the stack's `AppOrigin` parameter so the new address is allowed to save.

