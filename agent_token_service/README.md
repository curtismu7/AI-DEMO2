# agent_token_service — PingOne agent-token broker

A standalone, reusable service that mints a **PingOne `AI_AGENT`
client-credentials token** and hands it to API-key-authenticated callers. Built
so a **Microsoft Copilot Studio** agent (or any other application) can obtain a
PingOne agent identity token **without ever holding the PingOne client secret**.

This is **Part 1** of the Copilot Studio round-trip integration. It issues the
token Copilot uses on the **Copilot → our backend** leg.

## Why a broker (vs. Copilot calling PingOne directly)

The PingOne client secret stays here, on a server you control. Copilot Studio
only holds a single static `BROKER_API_KEY`. Rotating the PingOne secret, adding
audit, or swapping the agent identity is a one-place change — and the same
endpoint is reusable by any other app that needs a PingOne agent token.

## Endpoints

| Method | Path       | Auth          | Returns |
| ------ | ---------- | ------------- | ------- |
| `POST` | `/token`   | `x-api-key`   | `{ access_token, token_type, expires_in, scope }` |
| `GET`  | `/healthz` | none          | `{ status: "ok" }` (does not call PingOne) |

Tokens are cached in-process until ~10s before expiry, and concurrent cold-start
callers are de-duplicated into a single PingOne request.

## Configuration

Copy `.env.example` to `.env` and fill it in. Required: `BROKER_API_KEY`,
`PINGONE_AGENT_CLIENT_ID`, `PINGONE_AGENT_CLIENT_SECRET`, and either
`PINGONE_TOKEN_ENDPOINT` or `PINGONE_ENVIRONMENT_ID` (+ `PINGONE_REGION`).

The dedicated PingOne app — **"Demo AI App - Copilot Studio Agent"**
(`client_id 7d028710-c411-4a6c-be12-067141b36d5a`, a WEB_APP with the
`CLIENT_CREDENTIALS` grant, `CLIENT_SECRET_POST`) — is granted **`agent:invoke`**
on the Agent Gateway resource. So the issued token carries
**`aud = agentgateway.ping.demo`** (`PINGONE_AGENT_SCOPE=agent:invoke`).

> **Why not `aud = mcpgateway.ping.demo` directly?** In this environment the MCP
> gateway audience is reached **only via RFC 8693 token exchange** — no app holds
> a direct client-credentials grant to it. The broker therefore issues the
> blessed **agent identity** token (`agent:invoke`); turning that into an
> MCP-gateway call is a **Part-3** decision (an exchange step, or a gateway
> Authorize rule that accepts an agent-only, no-`act`-chain token).

## Run

```bash
npm install
npm run build && npm start      # or: npm run dev
curl http://127.0.0.1:8097/healthz
curl -s -X POST http://127.0.0.1:8097/token -H "x-api-key: $BROKER_API_KEY" | jq
```

> Use `127.0.0.1`, not `localhost` — `localhost` resolves to IPv6 `::1` first, and
> the broker binds IPv4 loopback by default (`HOST=127.0.0.1`).

## Wiring into a Copilot Studio REST/MCP tool (Part 3)

In the Copilot Studio agent, add a REST API tool (or MCP plugin) for the banking
backend and configure its authentication as **OAuth 2.0 — client credentials**:

- **Token URL:** `https://<this-broker-host>/token`
- **Authentication:** send the broker's static key as the `x-api-key` header
  (configure it as a custom header / API-key on the connector). The broker — not
  Copilot — performs the PingOne client-credentials grant and returns the bearer.
- Copilot then attaches the returned `access_token` as `Authorization: Bearer`
  on outbound calls to the MCP gateway.

## Round trip (where this fits)

```
React "Copilot" mode --MSAL/Entra login--> Copilot Studio Client (JS)
        --> Copilot agent --(its REST/MCP tool)-->
            agent_token_service  (x-api-key)            <-- THIS SERVICE (Part 1)
                --client_credentials--> PingOne Copilot agent app
                <-- PingOne agent token (aud = agentgateway.ping.demo)
        --(Part-3: exchange or Authorize rule)--> MCP gateway --> banking tools
```

- **Part 1 (this service):** issue the PingOne agent token.
- **Part 2 (follow-on):** React standalone Copilot agent mode + MSAL/Entra +
  `@microsoft/agents-copilotstudio-client`.
- **Part 3 (follow-on):** build/publish the Copilot Studio agent and wire its
  tool's Token URL to this broker.

A full end-to-end architecture diagram is a tracked follow-up, to be authored
once Parts 1–3 are integrated.
