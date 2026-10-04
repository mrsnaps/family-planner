# Family Planner: improvement ideas and running costs

Written 4 October 2026 for Nathan Schofield. This looks at the app as it stands in `/mnt/project-files/family-planner/` (a Node server that stores everything in one JSON file, for one household, with no logins). The redesign and new features are being handled in a separate thread, so some of the ideas below may already be under way there.

---

## Part 1: Ideas to improve it

They're grouped by effort. Within each group, the ideas near the top give the most value for the work.

### Quick wins (days)

**Food**
1. **Recipe form in the UI.** Right now custom recipes can only be added through the API. A form, plus "save this meal" from a suggestion, makes the 25 built-in recipes grow into the family's own cookbook.
2. **Shopping list from "nearly there" meals.** The app already knows which meals are one or two items short. Add a button that puts the missing items on a shopping list, and tick items off as they go into the pantry.
3. **Use-it-up alerts.** Highlight food going off in the next 3 days at the top of the Food tab (the data is already there), and show which meals use it.
4. **Kid-friendly and dietary tags.** Tags like vegetarian, nut-free, "picky eater approved" and under-30-minutes, with filters, so suggestions fit the family.
5. **Quick-add staples.** A one-tap list of common items (milk, bread, eggs, pasta) with typical pack sizes, because typing every item in is the biggest chore.

**Clothes**
6. **Shoe-size forecast.** The README lists it as not done yet. Feet grow on a fairly predictable curve by age, so it's the same idea as clothing sizes.
7. **Hand-me-downs.** When a child outgrows something, offer to pass it to a younger sibling if it would fit them later, instead of marking it worn out.
8. **Weather-aware outfit of the day.** Pick today's outfit using the local forecast (free weather APIs exist), so it suggests coats and long sleeves when it's cold.
9. **Laundry status.** Mark items as "in the wash" so outfits only use clean clothes, and show "you'll run out of clean school tops by Thursday".

**Both**
10. **Install as a phone app (PWA).** A manifest and service worker let people add it to their home screen and use it offline. This gets most of the "phone app later" goal for very little work.
11. **Export and backup.** Download all data as a file, and import it again.

### Medium (weeks)

12. **Barcode scanning** to add food. Phone camera plus the free Open Food Facts database gives product name, pack size and often allergens.
13. **Receipt or photo scanning with AI.** Take a photo of a supermarket receipt or the fridge shelf and the items are added automatically. Do the same for clothes: snap a photo and colour, type and pattern are filled in. AI costs are in Part 2.
14. **Weekly meal plan.** Plan the week from what's in, see a calendar, and get one shopping list for the gaps. It's the natural next step after "what can I make tonight".
15. **Supermarket ordering.** Turn the shopping list into a Tesco, Sainsbury's or Ocado basket. Official APIs are limited, so start with copy-ready lists or deep links.
16. **Clothes budget forecast.** Combine the size forecast with typical prices to say "about £120 of clothes needed for Ella before March".
17. **School uniform mode.** Track uniform items separately, with term dates, so parents buy the next size before September.

### Bigger (months, and they need accounts first)

18. **Shared household.** Both parents (or grandparents) log in to the same household and see changes live.
19. **Reminders by email or push.** "Chicken goes off tomorrow", "Sam will need size 5-6 in about 6 weeks".
20. **Nutrition overview.** Rough balance of veg, protein and treats across the week's meals.
21. **Second-hand selling.** List outgrown clothes on Vinted or eBay straight from the app, or swap with other local families.

### Things to fix in the foundations before going online

- **Accounts and households.** Every record needs to belong to a household, and every request needs to check who's asking. This is the biggest single change.
- **Real database.** Replace `lib/store.js` (one JSON file, rewritten on every save) with Postgres. The store is already kept separate, so this is a contained change.
- **Children's data is personal data.** The app stores children's names and birth dates, so UK GDPR applies: privacy notice, a way to delete an account, data kept in the UK or EU, and encrypted backups.
- **Security basics.** The API currently allows requests from any website (open CORS). Once there are logins this needs locking down, plus rate limiting and HTTPS.

---

## Part 2: What it would cost to run online

### Assumptions

- A "household" is 1 to 2 logins. Prices are monthly in GBP and include VAT where it applies to a UK customer, rounded. Dollar prices are converted at about £0.75 per $1.
- Prices are typical published list prices as I know them in late 2026. They change often, so check each provider's pricing page before committing.
- Usage is light: a family opens it a few times a day, and data per household is tiny (well under 1 MB). Most of the cost is fixed platform fees, not usage.
- The suggested setup: the existing Node app on a managed host (such as Render, Railway or Fly.io) or a small VPS (such as Hetzner); managed Postgres (Supabase or Neon); logins from Supabase Auth or Clerk, which are free at these sizes; transactional email from Resend, Postmark or Amazon SES.

### Monthly running cost

| | **10 households** (friends and family) | **1,000 households** | **10,000 households** |
| --- | --- | --- | --- |
| App hosting | £0 to £6 (free tier, or a small VPS around £4) | £6 to £20 (one always-on instance) | £30 to £60 (2 to 3 instances, load balanced) |
| Database (Postgres, with backups) | £0 (free tier) | £20 (Supabase Pro, about $25) | £30 to £70 (Pro plus a bigger compute size) |
| Logins | £0 | £0 (free up to about 50,000 monthly users) | £0 to £20 |
| Email (sign-up, password reset, reminders) | £0 (free tier, about 3,000 a month) | £0 to £16 | £16 to £70 (40,000 to 100,000 emails a month) |
| Error tracking and uptime monitoring | £0 | £0 | £0 to £25 |
| Domain (.co.uk or .com, about £10 to £15 a year) | £1 | £1 | £1 |
| **Total, without AI** | **about £1 to £10** | **about £30 to £60** | **about £80 to £250** |
| Cost per household | under £1 | 3p to 6p | 1p to 3p |

### Optional AI features (photo scanning, smarter meal ideas)

AI is the one cost that grows directly with use, so it needs a limit per household.

Claude Haiku 4.5 costs $1 per million input tokens and $5 per million output tokens (Sonnet 5.5 is $2 and $10, for harder tasks). A meal-idea request or a photo scan is roughly 2,000 tokens in and 600 out, which is about 0.4p each on Haiku.

| | 10 households | 1,000 households | 10,000 households |
| --- | --- | --- | --- |
| Light use (20 AI actions per household a month) | under £1 | about £75 | about £750 |
| Heavy use (100 a month) | about £4 | about £375 | about £3,750 |

Ways to keep it down: use the built-in matching engine for normal suggestions (it's free) and AI only for photos; cap free use (say 20 scans a month); cache common results; make AI a paid feature.

### One-off and yearly costs

| Item | Cost |
| --- | --- |
| ICO data protection fee (needed in the UK when you handle personal data as a business) | about £52 a year for a small organisation |
| Apple App Store developer account (phone app later) | $99 a year, about £79 |
| Google Play developer account | $25 once, about £20 |
| Privacy policy and terms (template service or solicitor review) | £0 to £500 once |
| Taking payments, if it becomes paid (Stripe, UK cards) | 1.5% + 20p per payment |

### Paying for it

At 1,000 households without AI it costs around 3p to 6p per household a month, so it can be free with no real pressure. With AI scanning, a subscription of about £2 to £3 a month (or a "Plus" tier) would cover heavy users comfortably. After Stripe fees, a £2.99 subscription keeps about £2.74.

### Recommended path

1. **Now (10 households):** one small VPS or a free-tier host plus free Supabase, a domain, and logins. Costs about £5 to £10 a month and proves people use it.
2. **Growing (up to 1,000):** move to paid database and hosting plans for reliable backups and no sleeping servers. Budget £50 a month plus AI.
3. **10,000 and beyond:** add monitoring and a second app instance, and put AI behind a subscription. Budget £150 to £250 a month plus AI.

The bigger cost at every stage is building the account system and keeping the app maintained, not the hosting.
