# CalorAI Architecture

## Core flow

1. Telegram sends updates to `/api/telegram/webhook`.
2. The backend records inbound events, assigns an experiment variant, and routes the message to the health bot service.
3. The health bot service parses meal commands and calls the meal service for create, edit, delete, and summary operations.
4. Every critical action emits JSONL events for evaluation and is rebroadcast over Server-Sent Events to the dashboard.
5. The dashboard visualizes experiment distribution, activation metrics, and the live event stream.

## Services

- `src/services/health-bot.js`: conversational command parsing and variant-aware reply shaping
- `src/services/meals.js`: meal CRUD and daily nutrition summaries
- `src/services/experiments.js`: deterministic local assignment with an optional Statsig adapter
- `src/services/statsig-adapter.js`: production-ready hook for `@statsig/statsig-node-core`
- `src/services/event-log.js`: append-only JSONL logging for analytics and auditability
- `src/services/telegram.js`: Telegram send-message integration
- `src/services/metrics.js`: dashboard aggregation and evaluation framework API

## Storage strategy

- `data/meals.json`: meal records keyed by user
- `data/profiles.json`: lightweight user profile metadata
- `data/events.jsonl`: append-only event log for experiment exposures and product analytics

This keeps local setup dead simple while still showing a credible path to moving storage into Postgres or Supabase later.
