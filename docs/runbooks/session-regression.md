# Session Regression — Overview

> **This file is now an index only.**
> The full regression runbooks have been split into focused files so no single
> document exceeds ~10 000 tokens.

| Runbook | What it covers |
|---------|---------------|
| [regression/api-session.md](regression/api-session.md) | Jest unit tests, BFF store ping, API smoke (server required) |
| [regression/ui-browser.md](regression/ui-browser.md) | Playwright browser E2E — customer dashboard, landing page, admin, Banking Agent |
| [regression/post-deploy.md](regression/post-deploy.md) | Manual smoke checks after production or preview deploys |
| [regression/index.md](regression/index.md) | Quick reference — run everything command |

## Fastest path

```bash
# Session + OAuth unit tests (no server, no browser)
npm run test:session

# UI smoke (no server — mocked API)
npm run test:e2e:ui:smoke
```
