# Meta setup and limits — lessons from a real client setup (Oct 2026)

Read this before connecting a business to Meta for the first time, or when the person asks for DMs, comment replies
or "100% automatic" Meta. It complements `SKILL.md` (which rules stay the same: the person activates, publishes, pays).
Everything marked **verify** is Meta documentation or behavior observed once; confirm it against the live docs or the
account before depending on it. No ids, names or card data from the client belong in this file.

## 1. Discover before touching anything

- A person can own several business portfolios (own business, a company, a school). Open the portfolio selector
  (`business.facebook.com/select`) and list them. Work only inside the portfolio that `facts.md` names; never open,
  edit or "tidy" the others, even if they show up in the same login.
- Map the asset graph first and write it into `facts.md` as `confirmed`, with source and date: portfolio id, Facebook
  Page id, Instagram account id, ad account id (currency, status, payment method yes/no), dataset/pixel id.
- The same Meta login often carries ad accounts of other projects (some read-only, some disabled for "unusual
  activity"). Never use or fix them; only the one in `facts.md`.
- Look for existing automation before building any: **system users** (for example one named `meta-api`) assigned to
  the Page or Instagram account, and the app behind them. Note what each can do (content, messages, comments,
  insights) and ask the person who created it. It may already be an app with App Review.

## 2. Checks with the Meta Ads MCP (read-only)

| Question | Tool | What to look at |
|---|---|---|
| Which ad accounts, and are they usable? | `ads_get_ad_accounts` | `account_status`, `is_queryable`, `has_payment_method`, `currency`, `min_daily_budget_cents`, owning business |
| Is the Instagram account linked for ads? | `ads_get_ig_accounts` (ad account id) | username present |
| Is the pixel/dataset available to the ad account? | `ads_get_datasets` (ad account id) | `is_active`, `last_fired_time`; `server_last_fired_time` of 1969 means no server-side (Conversions API) events |
| Is the Page promoted under the ad account? | `ads_get_ad_account_pages` | **Known gap:** it can return an empty list even when the Instagram account and the Page are linked in Business settings. Do not conclude it is broken: confirm when the first PAUSED draft ad picks the Page |

Every `ads_*` call needs the same `client_conversation_id` for the whole conversation (generate once, 20
letters/digits, reuse the one the tools return) and the exact model id in `client_model`.

The OAuth of `meta-ads` grants **ads and Instagram basic only**: no messages, no organic publishing. It cannot answer
DMs or post. Those need the Instagram/Messenger APIs or a separate app (section 5).

## 3. Creating the ad account (the person decides and signs)

- Business settings → Accounts → Ad accounts → Add → Create a new ad account. **Irreversible:** Meta states that an ad
  account cannot be removed from a portfolio once added, and currency and time zone cannot be changed afterwards.
- The form defaults the currency to **USD**. For a Mexican business choose **MXN** (the list is long and virtualized:
  scroll the list, do not assume the option is on screen) and a Mexican time zone. Usage: "My business", unless the
  person advertises for a client.
- The person ticks the Meta Commercial Terms and adds the payment method (Billing & payments). The agent never types
  card data and never ticks legal terms. Stop at the Confirm screen and ask for the OK.
- Minimum daily budget in MXN is about 18.59 pesos (`min_daily_budget_cents` in the MCP); the person sets real budgets.

## 4. Connecting the assets (what worked)

1. Instagram account → Connect assets → Other business assets → pick the ad account → Add. Meta may then ask for an
   **email verification code**: the person enters it. After that the Page and the ad account show under the Instagram
   account's Connected assets.
2. Pixel/dataset: Events Manager → Datasets → the dataset → Settings → Ad accounts → **Share with an ad account**
   (it opens Business settings → Datasets → Connected assets → Connect assets). Verify with `ads_get_datasets`.
3. The Page's own "Connect assets" only offers Instagram, not ad accounts (see the known gap above).
4. Check events in Events Manager: expected `PageView`; a name like `__missing_event` means events with no name
   (a Google Tag Manager container is the usual suspect, not the site's own code); no `InitiateCheckout` simply means
   the site never fires it (for example pricing cards that are not clickable).

## 5. Messaging with an internal app (docs, Oct 2026, **verify**)

- **Development mode:** the app can message only people who have a role on it (admins, developers, testers).
  **Standard Access** is for apps used only by people with a role, or that serve accounts the business owns.
  **Advanced Access** (App Review plus Business Verification) is for anyone else, including real customers.
- Open question the docs do not settle: whether Standard Access on the business's own Instagram account lets a customer
  with no role write in and get an answer. The cheap empirical test: a personal account with no role on the app writes
  to the business account; see whether the message arrives and can be answered.
- **Private reply to a comment:** one message per comment, within 7 days of the comment, about 750 calls per hour per
  professional account.
- **DMs:** the business can answer inside a window of about 24 hours after the user's last message. **Cold DMs to
  people who never wrote or commented are not possible through the API** and put the account at risk: never propose them.
- **Through the Meta-AI gateway** (`meta-ai`, see `SKILL.md`): inbound WhatsApp, Messenger and Instagram DMs arrive in its
  inbox, and replies go out with `send_message` inside the same 24-hour window. The gateway's Meta app already has the
  access, so the questions above about the business's own app do not apply. Every send is still one message, one OK
  from the person (the hook asks); outside the window only a pre-approved WhatsApp template can open the conversation,
  and choosing to send one is the person's decision.
- Meta Business Suite also has native replies (saved replies, ice-breaker questions, automatic replies in the inbox) that
  need no API and no App Review: a valid bridge while a review is pending.

## 6. Browser automation: how not to trip Meta's security

Meta treats an automated browser as a **new device**. Observed: "The action isn't available right now. We are running
additional checks on this new device. Please retry in N minutes" (a real countdown that clears), and an identity
re-check (code by SMS or email) before Business settings.

- Click through the menus like a person; do not jump straight to deep internal URLs one after another.
- One screen at a time, with a screenshot or snapshot before each action. Pause between steps.
- During a cooldown, stop and tell the person how long; never retry in a loop.
- Verification codes, SMS, email and passkeys are the person's: ask them to enter them in the window.
- Use role-based locators; if a menu item resolves to several elements, pick the exact one by role and name.
- The hook `meta-gate.mjs` already asks a human on billing and system-user pages and denies `browser_evaluate`;
  reading page text through `browser_evaluate` is blocked for the same reason: use `browser_snapshot`.

## 7. What "100% agentic" can and cannot mean today

| Capability | Today | Condition |
|---|---|---|
| Read ads, insights, accounts | Yes | `meta-ads` MCP connected |
| Create campaigns, ad sets, ads | As **PAUSED** drafts only | The person activates; the hook denies the rest |
| Organic posts and reels | Draft in Business Suite Planner | The person publishes |
| Reply to inbound DMs / comments | Draft for the person to send | Auto-reply needs the Instagram/Messenger APIs, an app with the right access, and an explicit decision by the person |
| Reply to inbound WhatsApp / Messenger / Instagram DMs through the Meta-AI gateway | Yes, one approved message at a time | Gateway connected, inside the 24-hour window; the hook asks the person on every send |
| Organic analytics (reach, engagement, posts) | Yes | Meta-AI gateway with `analytics:read` |
| Private reply to a commenter | Not automatic by default | Same as above, plus pre-approved templates |
| Cold DMs | Never | Not allowed by Meta |

The default of the whole system stays **draft-only**. A person who wants pre-approved templates sent automatically to
people who commented is making a policy decision for their business: record it in `facts.md` with the exact templates,
the opt-out line and the daily cap, and note that `hooks/meta-gate.mjs` and the sales rules ("no auto-replies to DMs")
must be changed by whoever maintains Back Office before an agent may do it. Do not work around the hook.
