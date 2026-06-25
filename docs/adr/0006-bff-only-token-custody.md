# Tokens are held exclusively in the BFF; the browser never receives a raw token

**Status:** accepted

## Context

OAuth access tokens are high-value credentials. If a token reaches the browser's JavaScript environment (via a response body, localStorage, or a URL parameter), any XSS vulnerability — in application code or a third-party library — can exfiltrate it. Once stolen, a token grants full API access until it expires.

The alternative is to store the token exclusively on the server side and identify the browser session with an httpOnly cookie that JavaScript cannot read.

## Decision

The BFF (`demo_api_server`) is the sole token custodian:

1. The OAuth authorization code is exchanged for tokens **inside the BFF callback handler** (`routes/oauthUser.js`, `routes/oauth.js`). Tokens are written directly to the server-side session (`req.session.oauthTokens`).
2. The browser receives only a **session cookie** (`connect.sid`) with `httpOnly=true`. JavaScript running in the page cannot access it.
3. Every API call from the React SPA goes to `/api/*` on the same origin (proxied in dev, same host in production). The BFF reads the token from the session and attaches it to upstream calls. The browser never sees an `Authorization` header.
4. The MCP tool pipeline uses `getSessionBearerForMcp(req)` (in `mcpWebSocketClient.js`) to extract the token — always from `req.session`, never from a request header sent by the browser.

## Consequences

- **XSS resilience:** Even a full script injection cannot steal tokens because they are not reachable from JavaScript.
- **No token in localStorage/sessionStorage:** A common mistake with SPAs. Deliberately avoided here.
- **Demo teaching value:** This is the architecture pattern learners should apply. The token chain UI panel shows the token *contents* (decoded claims) for educational purposes, but raw token strings are never sent to the browser — only sanitised claim objects.
- **Complexity:** Every API that needs the token must go through the BFF. Direct browser-to-resource-server calls are not possible by design.

## What this means for learners

When you see `bffAxios` in the frontend code (`src/services/bffAxios.js`), it calls `/api/*` with credentials (the session cookie). The BFF then uses the stored token. There is no `Authorization: Bearer ...` header from the browser.
