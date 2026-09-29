# PingOne Privilege LLM protection

## What it is

This app calls an LLM provider **through** PingOne Privilege rather than
directly. Two consequences, and they are the whole point:

1. **The app never holds a provider API key.** The Privilege gateway injects the
   real Anthropic / Google / OpenAI key server-side. A virtual key is what this
   app holds, and it is useless outside the gateway.
2. **A policy can deny the call before it reaches the provider.** The denial is
   attributable — it names the provider, the route and the reason.

Contrast with `ANTHROPIC_API_KEY` elsewhere in `demo_api_server/.env`: that is a
real provider key this app does hold, used by the direct Claude agent mode. The
Privilege path exists to show what changes when it does not.

## The three routes

Appended to `PRIVILEGE_LLM_GATEWAY_URL` by
[`services/privilegeLlmProxyService.js`](../demo_api_server/services/privilegeLlmProxyService.js):

| Provider | Route | Wire shape |
|---|---|---|
| Anthropic | `/llm/anthropic/v1/messages` | Native Anthropic Messages API — needs the `anthropic-version` header, and `system` is a **top-level field**, not a message role |
| Google | `/llm/google/v1/chat/completions` | OpenAI-compatible |
| OpenAI | `/llm/openai/v1/chat/completions` | OpenAI-compatible |

Google and OpenAI share a shape; Anthropic does not. That difference is why the
service has three functions rather than one parameterised call.

## Setup

1. **Issue a virtual key per provider** in the Privilege console: Virtual Keys →
   Add, once for each of Anthropic, Google and OpenAI. A virtual key is not a
   provider API key — the provider key stays inside Privilege.

2. **Set four values** in `demo_api_server/.env` (see
   [`.env.example`](../demo_api_server/.env.example) for the annotated block):

   ```bash
   PRIVILEGE_LLM_GATEWAY_URL=https://mcpgw.ai-demo.ping-devops.com
   PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC=...
   PRIVILEGE_LLM_VIRTUAL_KEY_GOOGLE=...
   PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI=...
   ```

   The gateway URL takes no trailing slash — one is stripped if present.
   Opening the gateway origin at `/` currently shows an MCP/OAuth information
   page. LLM calls use the provider routes above.

3. **Docker** needs nothing further. These arrive through
   `env_file: ./demo_api_server/.env`. They are deliberately **not** listed under
   the service's `environment:` block: `environment:` always overrides `env_file`
   for the same key, even when that key is unset, so a `${VAR:-}` default there
   would replace a real virtual key with an empty string.

   **Optional agent-mode path:** `demo_agent_service` reads its own
   `demo_agent_service/.env`; it does not inherit the BFF's `.env`. If enabling
   `ff_privilege_llm_first` for requests handled by that service, set the same
   gateway URL plus the Anthropic and Google virtual keys there. The variable
   names are listed in [`demo_agent_service/.env.example`](../demo_agent_service/.env.example).

4. **Kubernetes**: all four are declared **empty** in
   [`k8s/03-secrets.yaml.template`](../k8s/03-secrets.yaml.template) — they are
   credentials, and a populated template would commit them.
   [`k8s/create-secrets.sh`](../k8s/create-secrets.sh) mirrors the real values
   from `demo_api_server/.env` into `ai-demo-secrets`, which the BFF mounts. The
   optional agent-mode path uses a separate `agent-secrets` secret and needs its
   own values when enabled.

5. **Verify the process actually has them** — a template naming a key does not
   prove the container received it:

   ```bash
   docker exec ai-demo-api-server printenv | grep -c '^PRIVILEGE_LLM_'
   ```

   Expected: `4`. Check the **count**, never the values.

   For the optional agent-mode path, check the separate container too:

   ```bash
   docker exec ai-demo-agent-service printenv | grep -c '^PRIVILEGE_LLM_'
   ```

   Expected: at least `3` when that path is configured.

> **Never paste a virtual key into a doc, a ticket, a log line or a commit.**
> `create-secrets.sh` logs that the mirror happened, not what it mirrored.

## How to demo it

On `/privilege-mcp-client`:

1. Pick a provider, type a prompt, click **Send**.
2. Point at the reply, then at the line under it: the **gateway route** the call
   took and the latency. That route is the visible difference between "we called
   Anthropic" and "we called Anthropic through Privilege".
3. Click **Prove the policy**. It sends a prompt containing obvious PII that the
   Privilege policy is configured to deny, and the panel renders the denial: the
   provider, the route, and the policy's own reason.

Step 3 is the story. It is styled as a warning with an explanation rather than a
red failure, because a denial is the feature working.

If **Prove the policy** returns a normal reply instead of a denial, the policy
does not deny that prompt. Fix the policy or the prompt — do not describe the
feature as proven.

## Demoing the model allowlist

A virtual key can be restricted to a subset of its provider's models. Privilege
enforces that on the chat/messages call itself — a `403` — so it looks exactly
like the PII denial above and lands in the same place on the console.

On `/llm-gateway`, next to the prompt box:

1. Pick the lane. The **Model** dropdown sits on *Lane default — `<id>`*, which
   sends no `model` at all and lets the server apply the lane's own.
2. Pick a model. The options come from `GET /llm/models` — the **provider's
   catalog fetched through the virtual key, not the key's allowlist**. Privilege
   does not publish the allowlist, so the dropdown cannot mark which ids are
   blocked. That is fine: the demo is finding out.
3. Send. Allowed model → the model answers. Blocked model → 🔐 **Privilege
   stopped this**, *Denied by policy*, *Reached the model: no*, and the **Model**
   row names the id that was refused.

Sourcing the options from the catalog is what keeps the demo honest: **the id has
to be real for that provider**. A made-up one is rejected by the *provider*
(`400`/`404`, arriving as `502` *Provider refused*, having reached it) — the
opposite of the story. The dropdown cannot produce one; the Raw Request tab can,
so take care there.

The same three lanes, same field, `"model"` on the wire in each shape:

| Lane | Body |
|---|---|
| Anthropic | `{"model": "claude-…", "max_tokens": …, "messages": […]}` |
| Google | `{"model": "gemini-…", "messages": […]}` |
| OpenAI | `{"model": "gpt-…", "messages": […]}` |

The raw equivalent, if you would rather show the wire than the console, is the
**AI Guard — Raw Request** tab on the same page: the request body is free-text
JSON and prints the gateway's untouched response.

### Current lane connectivity check

Verified **2026-09-29** against the running local BFF using
`GET /api/privilege-mcp/llm/models?provider=<lane>`:

| Lane | Result |
|---|---|
| Anthropic | `200`, 13 models returned |
| OpenAI | `200`, 132 models returned |
| Google | `401 invalid_api_key` |

The local BFF has all three virtual-key variables set. The Google key currently
does not authenticate on its lane; check its provider association and credential
in the Privilege console, then update the local value. A successful catalog
request confirms that lane's key and provider route; it does not test a chat
completion, model allowlist, or policy denial.

### Historical model allowlist snapshot

Verified live against `mcpgw.ai-demo.ping-devops.com`, **2026-09-09**. This is a
historical snapshot; the allowlist is Privilege console config, so re-check
before a demo.

| Lane | Answers | Refused `403` |
|---|---|---|
| Anthropic | `claude-haiku-4-5-20251001` | `claude-opus-5`, `claude-sonnet-5` |
| OpenAI | `gpt-4o-mini`, `gpt-4o` | `o3` |
| Google | **nothing** — see below | every id tried, incl. the lane default |

The latency gap is the line to say out loud: the allowed call took ~2–8 s, the
refusal ~40 ms. Nothing left the gateway, so there was nothing to wait for.

> **Historical Google-key diagnosis from 2026-09-09:** the Google lane returned
> `403 wrong_provider`, while the same virtual key was accepted on the OpenAI
> route and reached an upstream API-key failure. That pointed to a provider
> association mismatch in the Privilege console. The current check above now
> returns `401 invalid_api_key`; verify the Google virtual key and its provider
> credential in the console before using that lane.

## What a failure means

| Result | Meaning |
|---|---|
| `403` + `llm_policy_denied` | Privilege denied it — a policy, or the key's model allowlist. **Working as designed** — this is the demo. |
| `503` | A virtual key or the gateway URL is missing. The message names which one. |
| `502` | The gateway or the provider is unreachable, or returned something unexpected. |
| `400` | Unknown provider, or an empty prompt. Nothing was called. |

An empty `200` is treated as a failure, not a pass: the service rejects a
response with no text rather than returning an empty string.

## Related

- [Privilege AIGuard training guide](privilege-aiguard-training.md) — deck-to-demo
  presenter flow, Attack Lab attribution, and pre-session checks.
- The agent modes `privilege_llm` and `privilege_claude` use the same service
  through [`services/geminiNlIntent.js`](../demo_api_server/services/geminiNlIntent.js)
  and are unaffected by the panel.
- Config drift is pinned by `node --test scripts/check-privilege-llm-config.test.js`,
  which fails if a key the service reads is missing from any deployment surface.
