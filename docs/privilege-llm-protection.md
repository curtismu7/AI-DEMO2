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

3. **Docker** needs nothing further. These arrive through
   `env_file: ./demo_api_server/.env`. They are deliberately **not** listed under
   the service's `environment:` block: `environment:` always overrides `env_file`
   for the same key, even when that key is unset, so a `${VAR:-}` default there
   would replace a real virtual key with an empty string.

4. **Kubernetes**: all four are declared **empty** in
   [`k8s/03-secrets.yaml.template`](../k8s/03-secrets.yaml.template) — they are
   credentials, and a populated template would commit them.
   [`k8s/create-secrets.sh`](../k8s/create-secrets.sh) mirrors the real values
   from `demo_api_server/.env` into `ai-demo-secrets`, which the BFF mounts.

5. **Verify the process actually has them** — a template naming a key does not
   prove the container received it:

   ```bash
   docker exec ai-demo-api-server printenv | grep -c '^PRIVILEGE_LLM_'
   ```

   Expected: `4`. Check the **count**, never the values.

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

## What a failure means

| Result | Meaning |
|---|---|
| `403` + `llm_policy_denied` | Privilege denied it. **Working as designed** — this is the demo. |
| `503` | A virtual key or the gateway URL is missing. The message names which one. |
| `502` | The gateway or the provider is unreachable, or returned something unexpected. |
| `400` | Unknown provider, or an empty prompt. Nothing was called. |

An empty `200` is treated as a failure, not a pass: the service rejects a
response with no text rather than returning an empty string.

## Related

- The agent modes `privilege_llm` and `privilege_claude` use the same service
  through [`services/geminiNlIntent.js`](../demo_api_server/services/geminiNlIntent.js)
  and are unaffected by the panel.
- Config drift is pinned by `node --test scripts/check-privilege-llm-config.test.js`,
  which fails if a key the service reads is missing from any deployment surface.
