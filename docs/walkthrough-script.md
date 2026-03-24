# CalorAI Walkthrough Script

## 1. Intro

- This is CalorAI, a Telegram-first nutrition assistant with A/B testing, event logging, an analytics dashboard, an admin portal, and a private user portal.
- The stack is a Node backend, SQLite for app data, JSONL event logging for telemetry, Statsig-ready experimentation, and n8n workflow exports for orchestration.

## 2. Telegram chatbot

- Start in Telegram and send a natural-language meal such as `I ate pani poori`.
- Show that the bot logs the meal, returns calories/macros, and offers the next actions.
- Demo `/summary`, `/analysis`, and `/createportal`.
- Explain that `/createportal` issues website credentials for the same user account.

## 3. A/B testing

- Open the admin dashboard and point out the experiment overview.
- Explain that variant assignment is deterministic locally and can switch to Statsig when credentials are configured.
- Mention the two tones:
  - Variant A: more concise
  - Variant B: more supportive

## 4. Analytics dashboard

- Show the admin view with setup health, total users, meals today, active users, recent events, and experiment exposure.
- Mention that events are logged to `data/events.jsonl` and streamed live into the dashboard.
- Call out that this is the monitoring surface for adoption and system health.

## 5. User portal

- Open `/portal` and sign in with a portal user created from admin or Telegram.
- Show calories today, protein today, meal journal, 7-day trend, and daily analysis.
- Log or edit a meal from the portal and show the dashboard updating.

## 6. Admin portal

- Open `/admin`.
- Show user provisioning, password reset, setup status, and per-user drilldown.
- Explain that admins can issue credentials for Telegram users and monitor the whole product from one place.

## 7. Mobile app

- Open the Expo Go app in the `mobile` folder.
- Sign in with the same portal credentials.
- Show that the app reads the same backend and near-real-time polling brings Telegram meals into mobile automatically.
- Mention the scheduled daily reminder notification and daily summary notification.

## 8. n8n workflows

- Show the workflow exports in the `n8n` folder.
- Explain:
  - `telegram-relay.json` can sit in front of the backend webhook
  - `daily-digest.json` can fetch dashboard metrics on a schedule
- Mention that the backend also exposes an n8n-friendly Telegram reply endpoint for orchestrated flows.

## 9. Close

- Summarize the deliverables:
  - Primary chatbot flow
  - Secondary Telegram nutrition use case
  - Bonus dashboard
  - Bonus mobile companion
- Mention tradeoffs:
  - Local SQLite keeps setup simple for review
  - Statsig and Telegram become fully live with credentials
  - ngrok is used for demo hosting
