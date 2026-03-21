# n8n Setup Notes

## Workflow 1: Telegram Relay

- Import `n8n/telegram-relay.json`
- Configure the webhook path and point Telegram webhook delivery to the n8n URL
- Set the HTTP Request node URL to `https://your-app-domain/api/telegram/webhook`
- Add the same secret token to both Telegram and the backend

## Workflow 2: Daily Digest

- Import `n8n/daily-digest.json`
- Configure the HTTP Request node to call `GET /api/metrics`
- Extend the workflow to post summaries to Telegram, Slack, or email

These exports are included to demonstrate orchestration around the backend rather than replacing the backend logic itself.
