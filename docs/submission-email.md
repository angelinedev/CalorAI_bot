# Submission Email Template

Subject: CalorAI Full Stack Assignment Submission - Your Name

Hello CalorAI Team,

Please find my submission for the Full Stack assignment below.

- GitHub repository: `<repo-link>`
- Walkthrough video: `<video-link>`
- Live/demo notes:
  - Telegram webhook backend with meal logging, editing, deletion, and summary flows
  - A/B testing with local deterministic assignment and a Statsig-ready adapter
  - Real-time analytics dashboard with SSE updates
  - n8n workflow exports for Telegram relay and daily digest orchestration

Tradeoffs and notes:

- The local demo runs without external dependencies so it can be reviewed immediately.
- Statsig and Telegram become active once credentials are configured.
- The analytics layer uses JSONL logging for simplicity and can be upgraded to a database later.

Thank you for your time.

Best regards,
`<your-name>`
