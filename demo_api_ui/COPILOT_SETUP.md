# Copilot agent mode — setup (Part 2 of the Copilot Studio round-trip)

The `/copilot` route is a standalone chat surface that signs the user in to **Microsoft
Entra** (browser MSAL) and talks to a **published Copilot Studio agent** via the M365
Agents SDK (`@microsoft/agents-copilotstudio-client`). It ships **dark** behind the
`copilot_mode_enabled` config flag (default off) and is fully isolated from the banking
agent.

This file covers the **Microsoft-side prerequisites** (created by you — there is no MCP/API
automation for Entra/Copilot here) and the config values to fill in.

## 1. Publish a Copilot Studio agent

1. In [Copilot Studio](https://copilotstudio.microsoft.com), create or open an agent and
   **Publish** it.
2. Note its **Environment ID** and **Schema name** (Settings → Advanced / Metadata).
   - Schema name looks like `cr1a2_myAgent`.
3. Under the agent's **Channels / Security**, allow the **web** origin that will call it
   (your app origin, e.g. `https://api.ping.demo:4000`) so the Direct Engine accepts
   browser requests (CORS).

## 2. Register an Entra (Azure AD) application

1. In **Entra admin center → App registrations → New registration**.
2. Platform: **Single-page application (SPA)**. Redirect URI = your **app origin** exactly
   (local: `https://api.ping.demo:4000`; the code uses `window.location.origin`).
3. **API permissions → Add a permission → APIs my organization uses →** Power Platform API
   → **Delegated** → `CopilotStudio.Copilots.Invoke`. Grant admin consent.
4. Note the **Application (client) ID** and **Directory (tenant) ID**.

> No client secret is needed — this is a public SPA client; the user signs in interactively.

## 3. Fill in the config values

On the Configuration page (or via `.env` / configStore), set these **public** fields:

| Config key | Value |
|---|---|
| `copilot_mode_enabled` | `true` to enable the `/copilot` route |
| `copilot_entra_client_id` | Entra Application (client) ID |
| `copilot_entra_tenant_id` | Entra Directory (tenant) ID |
| `copilot_environment_id` | Copilot Studio Environment ID |
| `copilot_agent_schema_name` | Copilot Studio agent Schema name |

Reload the app, open **`/copilot`**, click **Sign in with Microsoft**, and send a message.

## How it fits the round trip

- **Part 1** (PR #302) — the PingOne agent-token broker (`agent_token_service`): the
  *Copilot → our-backend* token source.
- **Part 2** (this) — the *our-app → Copilot* leg: a React chat surface driving the
  Copilot agent via Entra + the Copilot Studio client.
- **Part 3** (next) — wire the Copilot agent's REST/MCP tool's OAuth **Token URL** to the
  Part-1 broker so the agent can call our MCP gateway. Step-by-step: `../docs/COPILOT_PART3_RUNBOOK.md`.

## Notes / gotchas

- **Redirect URI must match exactly** — the SPA registration's redirect URI has to equal the
  app origin MSAL uses (`window.location.origin`).
- **CORS / web channel** — if sign-in works but messages fail, check the agent's channel
  security allows the browser origin.
- Two identities are in play by design: **PingOne** for the banking app session, **Entra**
  for the Copilot agent. The Copilot sign-in is a separate Microsoft popup.
