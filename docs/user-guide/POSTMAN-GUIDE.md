# Super Banking Postman Collections — Quick-Start Guide

## Collections Overview

| Collection | Audience | Best for |
|------------|----------|----------|
| `Super-Banking-1-Exchange-Step-by-Step.postman_collection.json` | Learner | Understanding each OAuth step individually |
| `Super Banking — 1-Exchange Delegated Chain — pi.flow.postman_collection.json` | Demo runner | Running the full 1-exchange flow quickly |
| `Super Banking — 2-Exchange Delegated Chain — pi.flow.postman_collection.json` | Demo runner | Running the full 2-exchange (nested delegation) flow |
| `Super-Banking-Advanced-Utilities.postman_collection.json` | Engineer | PAZ policy decisions, token revocation |

All collection and environment files referenced in this guide live in [`docs/`](../) (relative to this file: `../<filename>`):
[1-Exchange Step-by-Step](../Super-Banking-1-Exchange-Step-by-Step.postman_collection.json) ·
[1-Exchange Delegated Chain — pi.flow](../Super%20Banking%20%E2%80%94%201-Exchange%20Delegated%20Chain%20%E2%80%94%20pi.flow.postman_collection.json) ·
[2-Exchange Delegated Chain — pi.flow](../Super%20Banking%20%E2%80%94%202-Exchange%20Delegated%20Chain%20%E2%80%94%20pi.flow.postman_collection.json) ·
[Advanced Utilities](../Super-Banking-Advanced-Utilities.postman_collection.json) ·
[Shared environment](../Super-Banking-Shared.postman_environment.json).

All collections use: `Super-Banking-Shared.postman_environment.json`

---

## Prerequisites

Before running any collection:

1. **Import the shared environment** — In Postman: **Import** → select `Super-Banking-Shared.postman_environment.json`. Then select **Super Banking — Shared** from the environment dropdown (top-right in Postman).
2. **Fill in your values** — In the environment editor, set:
   - `PINGONE_ENVIRONMENT_ID` — your PingOne environment ID (Admin Console → Settings → Environment ID)
   - `PINGONE_CORE_USER_CLIENT_ID` / `PINGONE_CORE_USER_CLIENT_SECRET` — end-user app credentials
   - `PINGONE_CORE_CLIENT_ID` / `PINGONE_CORE_CLIENT_SECRET` — AI agent / BFF app credentials
   - `MCP_CLIENT_ID` / `MCP_CLIENT_SECRET` — MCP service app credentials
   - `TEST_USERNAME` / `TEST_PASSWORD` — test user credentials
   - `PINGONE_CORE_USER_REDIRECT_URI` — must match your PingOne app's allowed redirect URI
   - `ENDUSER_AUDIENCE` — AI Agent resource URI registered in PingOne (e.g. `https://ai-agent.yourdomain.com`)
   - `MCP_RESOURCE_URI` — MCP Server resource URI registered in PingOne
3. **Set mayAct on your test user** (one-time) — Run **Utility B — Set mayAct on User** from any collection. This adds the `mayAct` attribute to the user record in PingOne, enabling their tokens to be used as subject tokens in RFC 8693 exchanges. Required once per test user.

---

## If you're a Learner (want to understand each OAuth step)

Use: **`Super-Banking-1-Exchange-Step-by-Step`** + shared env

Run steps **1 → 2 → 3 → 4** in order.

Each step saves its output token to a collection variable. After Step 2, use **Utility — Decode Token** to inspect the MCP token's `act` claim, which shows the delegation chain: `act.sub` = the BFF client that performed the exchange.

---

## If you're a Demo Runner (want to run the full flow quickly)

**1-Exchange flow** — Use: **`Super Banking — 1-Exchange Delegated Chain — pi.flow`** + shared env

Run steps **1 → 2 → 3 → 4 → 5 → 6 → 7** in order. Steps 1–4 complete the pi.flow authorization; Step 5 performs the RFC 8693 token exchange.

**2-Exchange flow** — Use: **`Super Banking — 2-Exchange Delegated Chain — pi.flow`** + shared env

Run steps **1 → 2 → 3 → 4 → 5a → 5b → 6a → 6b → 7 → 8** in order. Steps 5b and 6b are the two RFC 8693 token exchanges that build the nested `act` chain. The final MCP token's `act.sub` is the MCP client, and `act.act.sub` is the AI Agent client.

---

## If you're an Engineer (want PAZ or token revocation)

Use: **`Super-Banking-Advanced-Utilities`** + shared env

- **PAZ Policy Decision**: Run the 2-exchange pi.flow first to populate `mcp_exchanged_token` (Step 6b saves it). Set `PAZ_DECISION_ENDPOINT_ID` in the shared environment (PingOne Admin → Authorize → Decision Endpoints → copy the UUID from the endpoint URL). Then run **PAZ Policy Decision** — expected response: `200` with a `decision` field (PERMIT or DENY).
- **Token Revocation**: Set `token_to_revoke` in the **Advanced Utilities collection variables** to the token you want to invalidate. Run **Token Revocation** — expected response: `200` empty body (token revoked).

---

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `stale flow_id` / `TIMEOUT` | pi.flow `flow_id` is valid for 120 seconds. Step 1b timed out. | Re-run Step 1 (Initiate Authorization) to start a new flow, then immediately run Step 2 (Submit Username + Password). |
| `Variable not set` (pre-request script throws) | A required collection or environment variable is empty. | Read the error message — it names the missing variable. Open the environment editor and fill it in. |
| `Environment not selected` | No environment is active in Postman — all `{{VARS}}` resolve to empty strings. | Select **Super Banking — Shared** from the environment dropdown (top-right corner in Postman). |
| `invalid_grant` on token exchange | Subject Token expired, `may_act` not set on user, or `resource` audience mismatch. | Re-run the login steps to get a fresh Subject Token. Verify Utility B (Set mayAct) has been run for the test user. Verify `ENDUSER_AUDIENCE` matches the resource URI registered in PingOne. |
| PAZ returns 404 | `PAZ_DECISION_ENDPOINT_ID` is wrong or empty. | Find the correct UUID in PingOne Admin → Authorize → Decision Endpoints → copy it from the endpoint's URL. |
| Token Revocation returns 401 | `MCP_CLIENT_ID` or `MCP_CLIENT_SECRET` is wrong. | Check MCP client credentials in the shared environment file. |
| `invalid_token` on introspect | Token has expired or was revoked. | Re-run the flow to obtain a fresh token. |
