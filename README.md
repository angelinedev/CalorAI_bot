# CalorAI Assignment Submission

CalorAI is a full-stack assignment project for a Telegram-first health chatbot with A/B testing, event logging, analytics, and workflow automation artifacts.

## What is included

- Telegram webhook backend with health bot flows
- Meal logging, editing, deletion, and daily summary APIs
- A/B testing with a deterministic local allocator and optional Statsig adapter
- Event logging to JSONL plus live dashboard metrics
- Real-time dashboard with chat simulator and meal operations
- PWA support for mobile-friendly access
- n8n workflow exports for relay and digest orchestration
- Test and smoke-check scripts

## Tech choices

- Backend: Node.js HTTP server with built-in `fetch`
- Frontend: static HTML, CSS, and vanilla JS
- Data layer: JSON + JSONL files for frictionless local setup
- Experimentation: local hash allocation, upgradeable to Statsig
- Automation: n8n workflow exports

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

`npm install` does not pull any runtime dependencies right now, but it creates a standard project flow for reviewers.

## Environment variables

Preferred: copy `.env.example` to `.env` and set values there.

For convenience in this assignment repo, if `.env` is missing the app will also read `.env.example`.

- `PORT`: server port
- `APP_BASE_URL`: public base URL
- `TELEGRAM_BOT_TOKEN`: enables outbound Telegram replies
- `TELEGRAM_WEBHOOK_SECRET`: validates Telegram webhook requests
- `STATSIG_SERVER_KEY`: enables the Statsig adapter if `@statsig/statsig-node-core` is installed
- `DEFAULT_EXPERIMENT`: experiment name used in logging and allocation

## Main routes

- `GET /api/health`
- `POST /api/chat`
- `POST /api/telegram/webhook`
- `GET /api/users/:userId/meals`
- `POST /api/users/:userId/meals`
- `PATCH /api/users/:userId/meals/:mealId`
- `DELETE /api/users/:userId/meals/:mealId`
- `GET /api/users/:userId/summary`
- `GET /api/metrics`
- `GET /api/evaluation-framework`
- `GET /api/stream`

## Telegram flow

1. Create a bot with BotFather.
2. Expose your local app with a tunnel such as ngrok or Cloudflare Tunnel.
3. Set Telegram webhook delivery to `https://your-domain/api/telegram/webhook`.
4. Optionally place n8n in front of the backend with `n8n/telegram-relay.json`.

## Statsig integration

The project works offline with deterministic local assignment. For production-style evaluation:

1. Install `@statsig/statsig-node-core`
2. Set `STATSIG_SERVER_KEY`
3. Create an experiment whose config returns a `variant` value of `A` or `B`

The adapter lives in `src/services/statsig-adapter.js`.

## Evaluation framework

- North-star metric: users who log at least one meal per day
- Primary metrics: activation rate, meals logged per user, summary views
- Guardrails: delete rate, edit rate, send failures
- Hypothesis:
  - Variant A should improve speed and reduce friction
  - Variant B should improve continued engagement

## Architecture docs

- [Architecture](./docs/architecture.md)
- [n8n setup](./docs/n8n-setup.md)
- [Walkthrough script](./docs/walkthrough-script.md)
- [Time breakdown](./docs/time-breakdown.md)
- [Submission email template](./docs/submission-email.md)

## Testing

```bash
npm test
npm run check
```

## Submission checklist

- Public GitHub repo
- Clean commit history
- README with setup, architecture, and time breakdown
- 5 to 10 minute walkthrough using `docs/walkthrough-script.md`
- Submission email with repo link, video link, and notes on tradeoffs
