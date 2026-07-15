# Datadog scaffold (Phase 1)

Learning Log / BFF observability ships a **scaffold only**. The demo runs
locally and in CI with **zero** Datadog config.

## Enable later (Phase 1.5+)

Set in the environment (never commit secrets):

| Variable | Purpose | Default |
|---|---|---|
| `DD_TRACE_ENABLED` | Must be `true` to load tracer | unset / false |
| `DD_API_KEY` | Datadog API key | — |
| `DD_SITE` | e.g. `datadoghq.com` | — |
| `DD_SERVICE` | Service name | `banking-demo-bff` |
| `DD_ENV` | Environment tag | `NODE_ENV` |
| `DD_VERSION` | Release version | — |
| `DD_LOGS_INJECTION` | Inject trace ids into logs | `true` when tracer on |

Install optional SDK when enabling:

```bash
cd demo_api_server && npm install dd-trace --save-optional
```

Bootstrap: `demo_api_server/services/datadogBootstrap.js` (required from
`server.js` after dotenv). If flags/key are missing, it no-ops.

## Correlation

In-app Learning Log uses `correlationId` (aliases `flowId` on app events).
When Datadog shipping is added, map that field to a log attribute (and
prefer Datadog `trace_id` when APM is active).

## Non-goals (scaffold)

- No required install of Datadog packages for default `npm install`
- No log ship from default Docker/K8s profiles
- No browser RUM / session replay
