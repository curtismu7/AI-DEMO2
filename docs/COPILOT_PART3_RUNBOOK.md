# Copilot Studio — Part 3 runbook: wire the agent's tool to our backend

This is the **Copilot → our-backend** leg. In the Copilot Studio **portal**, you give the
published agent a tool that calls our MCP gateway, and configure that tool to fetch a
**PingOne agent token from the Part-1 broker** and attach it as a Bearer.

All steps here are **manual portal work** (there is no MCP/API automation for the Copilot
Studio portal). This runbook is precise enough to follow once the prerequisites are met.

- Part 1 — the broker (`agent_token_service`, PR #302): issues the PingOne agent token.
- Part 2 — the `/copilot` React mode (PR #304): the user → Copilot leg.
- Part 3 — **this**: the Copilot → our-backend leg.

---

## Prerequisites (verify ALL before wiring — three are real blockers)

1. **Published Copilot agent** exists (the Part-2 prerequisite in `demo_api_ui/COPILOT_SETUP.md`).
2. **Broker reachable from the Copilot Studio cloud.** The broker defaults to
   `127.0.0.1:8097`; Copilot Studio is a cloud service and cannot reach localhost. Expose
   the broker at a **public HTTPS URL** (a tunnel like a dev tunnel/ngrok for testing, or a
   real deployment). Set `HOST=0.0.0.0` and put TLS in front. The Token URL you give Copilot
   will be `https://<broker-host>/token`.
3. **Broker accepts the API key as an OAuth `client_secret`** — ⚠️ **small Part-1 change
   required.** Copilot Studio's tool auth is standard OAuth 2.0 client-credentials: it POSTs
   `grant_type=client_credentials` + `client_id` + `client_secret` to the Token URL. The
   broker today gates on an `x-api-key` header instead. Make the broker **also** accept the
   API key presented as `client_secret` (standard form/Basic) so Copilot's OAuth connector
   works natively. The broker already returns `{ access_token, token_type, expires_in,
   scope }`, which is exactly the OAuth token-response shape Copilot expects — only the
   inbound credential form needs to change. (Tracked as a Part-1 follow-up; not done in PR
   #304.)
4. **MCP gateway accepts the Copilot agent token** — ⚠️ **blocking design gap.** The broker
   issues a token with `aud = agentgateway.ping.demo` (scope `agent:invoke`), but the MCP
   gateway requires `aud = mcpgateway.ping.demo` and runs a PingOne Authorize policy that may
   require a valid actor chain. An agent-only token (no end-user `act`) will **401/deny at
   the gateway** until one of these is in place: an RFC 8693 exchange step (agentgateway →
   mcpgateway), or an Authorize rule that permits an agent-identity token. This is the
   "gateway-acceptance" decision flagged in Parts 1–2; resolve it before expecting tool
   calls to succeed. Until then, wiring is testable only up to the 401.

---

## Step-by-step (Copilot Studio portal)

### A. Add the tool that calls our backend
Pick the surface that matches how our gateway is exposed:

- **MCP server (preferred):** the gateway speaks Streamable HTTP MCP and advertises
  `GET /.well-known/mcp-server`. In the agent, **Tools → Add a tool → Model Context Protocol
  → Add an existing MCP server**, and point it at the gateway's public `/mcp` URL.
- **REST API tool:** if you prefer REST, **Tools → Add a tool → REST API** and supply an
  OpenAPI (Swagger 2.0) description of the gateway endpoints you want to expose.

### B. Configure the tool's authentication = OAuth 2.0 (client credentials)
On the tool/connector's authentication settings:

| Field | Value |
|---|---|
| Authentication type | **OAuth 2.0** |
| Grant type / flow | **Client credentials** |
| **Token URL** | `https://<broker-host>/token` (the Part-1 broker) |
| Client ID | any non-empty value (the broker ignores it; or use the Copilot app's client_id for clarity) |
| Client Secret | **the broker's `BROKER_API_KEY`** (per prerequisite #3, the broker accepts this as `client_secret`) |
| Scope | leave blank — the broker sets scope from its own config (`agent:invoke`) |

Copilot calls the Token URL, receives the PingOne `access_token`, and attaches it as
`Authorization: Bearer <token>` on every call to the gateway.

> **Why not the "API key in header" option?** That sends a static key directly to the called
> API — it does **not** fetch a Bearer. Our gateway requires a PingOne Bearer, so the API-key
> option does not fit. Use OAuth client-credentials with the broker as the Token URL.

### C. Add the tool to the agent's topics/instructions
Reference the tool in the agent's instructions so it's invoked for the relevant intents
(e.g. "to read accounts, call the get_my_accounts tool"). Publish the agent.

---

## Verify

1. **Token leg (independently):** `curl` the broker as Copilot will
   (`-d grant_type=client_credentials -d client_id=x -d client_secret=$BROKER_API_KEY`)
   and confirm a `200` with an `access_token`. Decode it: `scope=agent:invoke`,
   `aud=agentgateway.ping.demo`.
2. **In Copilot Studio test chat:** trigger the tool. Watch for:
   - Token fetch succeeds (no `invalid_client`).
   - Gateway call returns data → done. **Or** returns **401/deny** → that's prerequisite #4
     (the gateway-acceptance gap), not a wiring bug.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Token URL unreachable / timeout | Broker not exposed at a public HTTPS URL (prereq #2). |
| `invalid_client` from the broker | Broker not accepting the API key as `client_secret` (prereq #3), or wrong key. |
| `401`/deny at the **gateway** after a successful token fetch | Expected until prereq #4 — the agent-only token's `aud=agentgateway` + missing `act` chain. Add the exchange or the Authorize rule. |
| Tool never fires | The agent's instructions don't reference the tool, or the agent isn't published. |

See `.claude/skills/copilot-studio/SKILL.md` for the architecture and the audience nuance,
and `agent_token_service/README.md` for the broker contract.
