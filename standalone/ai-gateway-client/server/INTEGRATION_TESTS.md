# AI Gateway Client live integration tests

The default `npm test` suite stays local and offline. Live Gateway checks are opt-in and use explicit fixture URLs; they never change Gateway applications, identities, or policies.

## Prepare a fixture

From `standalone/ai-gateway-client/server/`:

```bash
npm ci
cp integration/config.example.json integration/config.local.json
```

Edit the ignored `integration/config.local.json` with URLs and tool names from a dedicated non-production environment. Configure an allowed app with a harmless read-only tool and an app-level denied door. Use HTTPS URLs; loopback HTTP is available only with `AI_GATEWAY_ALLOW_HTTP_TEST_URLS=true`.

The fixture schema also has `filteredTool` and `aggregate` entries for the planned tool-policy and aggregate checks. The current allow/deny/probe case does not call those URLs yet; replace their example values before running once those cases are added.

Use a dedicated test identity already enrolled for Gateway sign-in and authorized for the fixture's read-only tool. If PingOne asks for profile setup on first sign-in, complete that setup before running the live checks.

## Run with interactive sign-in

```bash
npm run test:integration:interactive
```

The command starts an isolated relay on loopback, prints its Gateway authorization URL, and waits for you to open it in a browser. Complete PingOne sign-in in that browser within two minutes; the command polls the local authenticated state immediately. After the relay receives the PKCE callback, it runs the configured allow/deny/probe assertions.

The access token remains in the Node process and relay memory. The runner does not print it, write it to a file, or expose an HTTP token-export route. It uses the existing PKCE/DCR flow; when the Gateway advertises Dynamic Client Registration, each new command process may register a fresh OAuth client, which the authorization server may retain after the run. The runner keeps DCR client credentials only in relay memory, and does not persist or unregister those clients. This is separate from the Gateway's Agentic Apps, identities, and policies.

The command requires an interactive TTY. It does not read `AI_GATEWAY_TEST_TOKEN`.

## Run with a pre-provisioned bearer

`npm run test:integration` is for CI or operators who already have a short-lived Gateway bearer in a protected secret source. Set `AI_GATEWAY_TEST_TOKEN` through the ignored local `server/.env` or CI secret injection, then run the command. Do not put the token in the fixture, command history, source control, or chat.

Both live commands read `AI_GATEWAY_TEST_CONFIG` when set; otherwise they use `integration/config.local.json`. Keep the fixture free of credentials. `AI_GATEWAY_ALLOW_HTTP_TEST_URLS` only permits loopback HTTP for local stub services.

## Read results

- `200` from the allowed app and its configured read-only call shows the test identity can use that door.
- `403` from the denied app and the denied-door probe is the expected policy result.
- `401` indicates sign-in or token authorization did not complete.
- `5xx` indicates Gateway or upstream availability/fixture trouble, not an expected policy denial.

The current live case checks only the allowed read, a denied-door probe, and app-level denial. It never invokes a denied live tool. Tool-level filtering and aggregate namespace discovery/call remain separate checks and require their own verified harmless fixtures.
