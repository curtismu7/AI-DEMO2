# OAuth Callback Path Configuration

Configure the paths the IDP redirects to after authentication. Different IDPs expect different callback URL structures; these settings let you match whatever the IDP requires without code changes.

## Quick start

```bash
OAUTH_ADMIN_CALLBACK_PATH=/oauth2/callback   # admin OAuth app
OAUTH_USER_CALLBACK_PATH=/oauth2/callback    # user OAuth app
```

The redirect URIs registered in your IDP must exactly match these paths (including domain and port).

## Default (PingOne)

PingOne uses the BFF's native paths:

```bash
OAUTH_ADMIN_CALLBACK_PATH=/api/auth/oauth/callback         # default
OAUTH_USER_CALLBACK_PATH=/api/auth/oauth/user/callback     # default
```

No configuration needed for PingOne — these are the built-in defaults.

## PingFederate

Federate typically uses a single callback path for all clients:

```bash
OAUTH_ADMIN_CALLBACK_PATH=/oauth2/callback
OAUTH_USER_CALLBACK_PATH=/oauth2/callback
```

Register these in Federate under each OAuth client's **Redirect URIs**:
- `https://your-app.example.com/oauth2/callback`

When both paths are the same, the admin callback handler takes priority. Session state from the original login determines which OAuth flow completes.

## Auth0

Auth0 applications use a short callback path:

```bash
OAUTH_ADMIN_CALLBACK_PATH=/callback
OAUTH_USER_CALLBACK_PATH=/callback
```

In your Auth0 Application settings, add to **Allowed Callback URLs**:
- `https://your-app.example.com/callback`

## Okta

Okta recommends a standard path:

```bash
OAUTH_ADMIN_CALLBACK_PATH=/oauth/callback
OAUTH_USER_CALLBACK_PATH=/oauth/callback
```

## Architecture

The `callbackDispatcher` service registers Express routes at startup:

```
server.js
  └─ registerCallbacks(app, oauthRoutes, oauthUserRoutes, rateLimiter)
       ├─ reads OAUTH_ADMIN_CALLBACK_PATH / OAUTH_USER_CALLBACK_PATH
       ├─ validates path (must start with /, max 255 chars)
       └─ app.get(configuredPath, rateLimiter, handler)
            └─ rewrites req.url → /callback before delegating to router
```

Login paths (`/api/auth/oauth/login`, `/api/auth/oauth/user/login`) are **not configurable** — they stay fixed per OAuth spec. Only the callback (redirect URI) path is configurable.

## Notes

- Path must start with `/` and be ≤ 255 characters
- The configured path must exactly match the redirect URI registered in your IDP (scheme + host + path)
- Both admin and user may share the same path (e.g., Federate / Auth0) — admin handler takes priority; user callback completes via session state
- Rate limiting is applied to custom callback paths automatically
