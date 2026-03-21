# Walkthrough Script

1. Open the dashboard and show the live metrics, event stream, and experiment split.
2. Use the chat sandbox to send `/start`, then log a meal with `log oats bowl | 320 | 14 | 48 | 8`.
3. Open the meal log panel to show the new meal, then use the quick edit and delete actions.
4. Call out that every action is tracked in `data/events.jsonl` and surfaced in `/api/metrics`.
5. Explain the A/B test:
   - Variant A is concise.
   - Variant B is more supportive.
   - Local deterministic assignment is used for offline demos.
   - Statsig can take over by adding `@statsig/statsig-node-core` and a server key.
6. Show the `n8n/telegram-relay.json` workflow and describe how it can front the webhook or orchestrate notifications.
7. Close with setup instructions, tradeoffs, and which bonus items were attempted.
