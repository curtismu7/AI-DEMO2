# Running on Replit

This app can be hosted on **Replit** as well as Vercel. Use a stable public URL in PingOne (see `PUBLIC_APP_URL` / `REPLIT_DEV_DOMAIN` in the API).

**Two OAuth clients (required):** Use **two** PingOne OIDC applications — one for **Admin** sign-in and one for **Customer** sign-in — on Replit just like Vercel and localhost. Supply both sets of variables in Secrets (for example `PINGONE_ADMIN_CLIENT_ID` / `PINGONE_ADMIN_CLIENT_SECRET` and `PINGONE_USER_CLIENT_ID` / `PINGONE_USER_CLIENT_SECRET`, plus separate redirect URIs in each PingOne app). See `banking_api_server/.env.example`.

## Environment variables (Replit-specific or common)

| Variable | Purpose |
|----------|---------|
| `REPLIT_DEV_DOMAIN` | Public `*.replit.dev` hostname when provided by Replit; used with canonical OAuth URLs when set. |
| `PUBLIC_APP_URL` | Preferred stable HTTPS origin for redirects (no trailing slash). |
| `REPLIT_MANAGED_OAUTH` | Set to `true` to hide full OAuth credential editing in the Config UI (deployment-managed PingOne, similar to the old hosted demo). |
| `REPLIT_CONFIG_PASSWORD_MODE` | Set to `true` to allow config updates via `X-Config-Password` + `ADMIN_CONFIG_PASSWORD` when sessions are unreliable. |
| `CORS_ORIGIN` | Browser origin allowed by the API when different from the API host. |

Shared with other hosts: `KV_REST_API_URL`, `KV_REST_API_TOKEN` (Upstash / KV), `REDIS_URL` (sessions), `ADMIN_CONFIG_PASSWORD`, and the usual `PINGONE_*` variables. See `banking_api_server/.env.example`.

## Notes

- **LangChain / MCP agent** still runs as a separate local process; the hosted web UI typically leaves `MCP_AGENT_URL` blank.
- **CSP / console warnings** in the embedded Replit preview can include platform or iframe policies; compare with a direct `*.replit.dev` tab when debugging.
