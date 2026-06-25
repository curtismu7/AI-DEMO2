# Helix LLM Integration — Setup Guide

## Overview

**Ping AI / Helix** is a hosted AI agent platform. This guide explains how to
create a published Helix agent, obtain the correct API credentials, and wire
them into any application that calls the Helix conversation API.

The integration follows a three-step conversation pattern:

```
1. POST /agents/{name}/conversations          → returns conversation ID + home channel
2. POST /conversations/{id}/channels/{ch}/messages  → send prompt, receive (or wait for) reply
3. GET  /conversations/{id}/channels/{ch}/messages  → poll if reply was not immediate
```

Authentication uses an `x-api-key` header — **not** `Authorization: Bearer`.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Helix tenant | e.g. `https://openam-helix.forgeblocks.com` |
| Published agent | Must be published, not just saved — the API only serves the published version |
| Agent-scoped API key | See [Step 2 — API Keys](#step-2--api-keys) — key type matters |
| LLM provider credentials | Environment-level (Anthropic/Google) or per-agent (Vertex AI) |

---

## Step 1 — Create and Configure an Agent

### 1.1 Create the agent

1. Log in to the Helix console
2. Go to **Agents** → **New Agent**
3. Give it a short, lowercase name — this becomes the URL path segment (e.g. `my-agent`)

### 1.2 Add an AI Task node

In the agent designer:

1. Drag an **AI Task** node onto the canvas
2. Connect it between the **Start** and **End** nodes
3. Open the node and configure:

| Field | Guidance |
|---|---|
| **Provider** | `anthropic` or `google` — these use environment-level credentials and require no per-agent API key |
| **Model** | Any model available for your chosen provider (e.g. `claude-sonnet-4-5`, `gemini-2.5-flash`) |
| **API Key** | Leave blank when using environment-level credentials |

> **Avoid `google-vertexai`** unless you have a dedicated per-agent Vertex AI
> key. If the API Key field is empty and you use `google-vertexai`, the agent
> initialises but returns `null` for every conversation — a silent failure with
> no error message. Use `google` instead, which inherits shared environment
> credentials.

### 1.3 Note the Prompt Field ID

Every input field in the designer has a unique ID (e.g. `textInput502c5045a61c`).
You need this to send messages to the agent.

Find it by:

- Hovering over the input field in the node configuration panel, or
- Checking the field's properties row in the designer sidebar

Copy it exactly — it is **case-sensitive** and agent-version-specific.

### 1.4 Publish the agent

**Saving is not the same as publishing.** The conversation API only serves the
*published* version of an agent.

1. Click **Publish** (or **Deploy** — the label varies by console version)
2. Confirm the publish dialog
3. Wait for the status badge to show **Published** or **Live**

> **If API behaviour doesn't change after saving:** Look for a separate
> "Publish" or "Deploy to Published" option in the top-right toolbar or the
> agent overflow menu. Changes to provider, model, or API Key only take effect
> after a successful publish.

---

## Step 2 — API Keys

There are two distinct key types. **Only one can invoke agents.**

### Agent invocation key (required)

Created from the **agent's overflow menu** in the console:

1. Go to **Agents** and locate your published agent
2. Click the **⋮** (three-dot) menu on the agent card
3. Select **Create API Key** (or **Generate Key**)
4. Download the resulting JSON file

A valid agent invocation key looks like:

```json
{
  "keyName": "my-agent-key",
  "keyValue": "Base64EncodedKeyValueHere...",
  "target": "my-agent",
  "branch": "published",
  "scope": "agent",
  "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "createdBy": "user@example.com"
}
```

The `target` field must equal the agent name and `branch` must be `published`.
If either is empty, the key is the wrong type.

### Environment admin key (wrong type for agent invocation)

Created from **Environment Settings**. Looks similar but has empty `target` and
`branch`:

```json
{
  "scope": "env_admin",
  "target": "",
  "branch": ""
}
```

This key can call management APIs (list agents, create agents, read
configuration) but **cannot start conversations**. Using it for agent invocation
returns HTTP 200 with body `null` — which appears successful but is not.

### Quick check

```bash
cat your-key.json | python3 -c \
  "import json,sys; k=json.load(sys.stdin); \
   print('OK — agent invocation key' if k.get('target') else 'WRONG TYPE — env admin key, target is empty')"
```

---

## Step 3 — Configuration Values

Collect these five values before configuring your application:

| Value | Where to find it |
|---|---|
| **Base URL** | Your tenant origin only — e.g. `https://openam-helix.forgeblocks.com`. Do not include any path; the API path (`/dpc/jas/helix/v1`) is appended automatically |
| **Environment ID** | Helix console → Settings, or read from the URL when browsing your environment (a UUID, e.g. `fe213c3c-9c1d-4bdb-954a-a22879dad26d`) |
| **Agent Name** | The agent's name as shown in the console — **not** the UUID. Case-sensitive (e.g. `my-agent`) |
| **Prompt Field ID** | The input field ID inside the AI Task node (e.g. `textInput502c5045a61c`) |
| **API Key** | The `keyValue` string from the agent-scoped key JSON |

---

## Step 4 — Environment Variables

Set these in your application's environment before starting the server:

```
HELIX_BASE_URL=https://your-tenant.forgeblocks.com
HELIX_API_KEY=<keyValue from agent-scoped key JSON>
HELIX_ENVIRONMENT_ID=<your-environment-uuid>
HELIX_AGENT_ID=<your-agent-name>
HELIX_PROMPT_FIELD_ID=<your-prompt-field-id>
```

For this application, add them to `banking_api_server/.env` and restart the
server. The configuration store picks them up automatically — no code changes
are needed.

Alternatively, use the admin UI: **Configuration → LLM Provider → Helix**.
Click **Import API Key JSON** to auto-populate the API Key and Agent Name from
the downloaded key file, then fill in the remaining fields and save.

---

## Step 5 — Verify

### Startup check

When the server starts it prints a configuration report. A fully configured
Helix integration shows:

```
✓  [HELIX LLM     ]  Helix AI Agent                    configured
```

`partial` means one or more of the five vars is missing. The banner lists which
ones.

### Live log

```bash
tail -f /tmp/bank-helix.log
```

A successful call sequence looks like:

```
2026-05-08T10:02:36Z [helix/info] Helix call started {"agent":"my-agent","environment":"fe213c3c-..."}
2026-05-08T10:02:37Z [helix/info] Conversation created {"conversationId":"e863355a-...","channelId":"e8d9d20b-..."}
2026-05-08T10:02:39Z [helix/info] Response received (immediate) {"conversationId":"e863355a-..."}
```

If you see `createConversation failed` or `returned null`, go to
[Troubleshooting](#troubleshooting).

### Manual curl test

Replace the placeholders with your real values:

```bash
BASE=https://your-tenant.forgeblocks.com/dpc/jas/helix/v1
ENV=your-environment-id
AGENT=your-agent-name
KEY=your-api-key

# Step 1 — create conversation
curl -s -X POST "$BASE/environments/$ENV/agents/$AGENT/conversations" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $KEY" \
  -d '{"agent":{"version":"published"}}' | python3 -m json.tool
```

A successful response returns `{ "id": "...", "home_channel": "..." }`.
A `null` body means something is wrong — see the troubleshooting checklist below.

---

## API Reference

All requests use `x-api-key: <your-key>`. Bearer tokens are not used.

The base path for all endpoints is:

```
https://{your-tenant}/dpc/jas/helix/v1
```

### 1. Create conversation

```
POST /environments/{env_id}/agents/{agent_name}/conversations
Content-Type: application/json
x-api-key: <key>

{
  "agent": { "version": "published" }
}
```

**Success response:**

```json
{
  "id": "e863355a-abd6-497f-83f5-e6bde77ec206",
  "home_channel": "e8d9d20b-e734-4628-9c17-3a39e489db3f"
}
```

**Failure:** HTTP 200 with body `null`. See [Troubleshooting](#troubleshooting).

> The request body `{ "agent": { "version": "published" } }` is required.
> Omitting it causes Helix to return `null` even when the key and agent name are
> correct.

### 2. Send message

```
POST /environments/{env_id}/conversations/{conv_id}/channels/{channel_id}/messages
Content-Type: application/json; async=false
x-api-key: <key>

{
  "class": "start",
  "content": {
    "<prompt_field_id>": "The user's message goes here"
  }
}
```

`Content-Type` must include `; async=false`. Omitting it can cause responses to
arrive asynchronously with no usable signal.

**Immediate response** (agent answered in the POST body):

```json
{
  "message_id": "abc123",
  "class": "complete",
  "value": "The agent's answer"
}
```

**Deferred response** (poll required):

```json
{
  "message_id": "abc123"
}
```

### 3. Poll for response

```
GET /environments/{env_id}/conversations/{conv_id}/channels/{channel_id}/messages
x-api-key: <key>
```

**Response:** An array of all messages in the conversation.

```json
[
  { "message_id": "abc123", "sender_role": "user", "class": "start", ... },
  { "message_id": "xyz789", "sender_role": "agent", "class": "complete", "value": "The answer" }
]
```

Look for an entry with `"sender_role": "agent"`, `"class": "complete"`, and a
non-null `value`. Poll on a 1-second interval; set a timeout of 30 seconds to
avoid indefinite blocking.

---

## Troubleshooting

### Conversation returns `null` (no error, but no ID)

The most common problem. Work through this checklist:

1. **Is the agent published?** Saving ≠ publishing. Click the Publish button and
   confirm the status badge changes.
2. **Is the key agent-scoped?** Run the quick check from
   [Step 2](#step-2--api-keys). If `target` is empty it is an env admin key —
   create a new key from the agent's ⋮ menu.
3. **Does the agent name match exactly?** `HELIX_AGENT_ID` must be the name
   string as shown in the console, not the UUID. Case matters.
4. **Does the request body include `{ "agent": { "version": "published" } }`?**
   This field is required — omitting it produces `null` even with valid
   credentials.
5. **Is the AI Task node provider configured correctly?** `google-vertexai` with
   an empty API Key field silently returns null. Switch to `google` and republish.

### HTTP 401

The API key is invalid or expired.

- Create a fresh agent-scoped key from the agent's ⋮ menu
- Use the `keyValue` field — not `id`
- Update the config and restart

### HTTP 404

The agent name or environment ID is wrong.

- Confirm `HELIX_AGENT_ID` matches the console name exactly (case-sensitive)
- Confirm `HELIX_ENVIRONMENT_ID` is the environment UUID, not the environment name
- Confirm `HELIX_BASE_URL` is the origin only — no trailing slash, no `/dpc/...` path

### Config error: missing fields

```text
Helix config incomplete: missing helix_base_url, helix_api_key, ...
```

One or more of the five required values is not set. Check your environment:

```bash
grep ^HELIX .env
```

All five must be non-empty. Fill any gaps and restart.

### Agent responds but the answer is empty

The `HELIX_PROMPT_FIELD_ID` is wrong.

- Open the agent in the designer and click the AI Task node
- Copy the input field ID exactly as shown (e.g. `textInput502c5045a61c`)
- Field IDs are case-sensitive and specific to each published version

### Timeout after 30 seconds

The agent is taking too long to respond, or the poll response structure is not
being matched.

- Check the live log for what the poll endpoint is returning
- Confirm the AI Task node is connected between Start and End (not floating)
- Test the agent directly in the Helix console to rule out a platform issue

### Edits to the agent have no effect via the API

Changes saved in the designer are not live until published.

- Look for a **Publish** or **Deploy to Published** option (top toolbar or
  overflow menu — exact label varies by console version)
- Wait for the status badge to update before testing
- Provider, model, and field ID changes all require a republish

### `google-vertexai` always returns null

The AI Task node requires a per-agent Vertex AI API key. If the key field is
blank, every conversation returns null.

Fix: change the provider from `google-vertexai` to `google` in the designer
(which uses shared environment credentials) and republish.

---

## Integration Pattern

The following pattern is framework-agnostic and works in any server-side
language.

```text
function callHelixAgent(config, userMessage, systemPrompt):

  # Step 1 — create conversation
  conv = POST /environments/{env_id}/agents/{agent_name}/conversations
           body: { "agent": { "version": "published" } }
  if conv is null → raise ConfigurationError (key type, agent name, publish status)

  # Step 2 — send message
  # Prepend system prompt to user message if the agent doesn't have a directive field
  prompt = systemPrompt + "\n\n" + userMessage  (if systemPrompt exists)

  response = POST /conversations/{conv.id}/channels/{conv.home_channel}/messages
               Content-Type: application/json; async=false
               body: { "class": "start", "content": { promptFieldId: prompt } }

  # Step 3 — check for immediate answer
  if response contains class="complete" and value → return value

  # Step 4 — poll
  deadline = now + 30s
  while now < deadline:
    messages = GET /conversations/{conv.id}/channels/{conv.home_channel}/messages
    agentMsg = messages.find(sender_role="agent", class="complete", value≠null)
    if agentMsg → return agentMsg.value
    sleep 1s

  raise TimeoutError
```

Key implementation notes:

- Always send `{ "agent": { "version": "published" } }` in the create-conversation body
- Use `x-api-key` header, not `Authorization: Bearer`
- `Content-Type: application/json; async=false` on the send-message request
- The `value` field in the response may be a plain string or JSON — try `JSON.parse` and fall back to raw string
- Filter poll results by `sender_role: "agent"` to avoid matching the message you sent

---

## Public demo Helix agent

This repo ships with four of the five Helix values committed as defaults in
[`banking_api_server/services/configStore.js`](banking_api_server/services/configStore.js)
(see the `FIELD_DEFS` block — search for `helix_base_url`). Anyone cloning the
repo gets the **LLM2** demo agent on the shared Ping-hosted preview tenant
without touching the `/setup` UI:

| Key | Committed default |
|---|---|
| `helix_base_url` | `https://openam-helix.forgeblocks.com` |
| `helix_environment_id` | `fe213c3c-9c1d-4bdb-954a-a22879dad26d` |
| `helix_agent_id` | `LLM2` |
| `helix_prompt_field_id` | `textInputa7c39a0e8292` |

The fifth value, **`helix_api_key`**, is intentionally **not** in git. New
contributors need to obtain it one of three ways:

1. **From the team** — paste it into **Configuration → LLM Provider → Helix → API Key** in the admin UI, then click **Save**.
2. **Via `.env`** — add `HELIX_API_KEY="<key>"` to `banking_api_server/.env` and restart the BFF.
3. **Bring your own Helix tenant** — replace any of the four defaults via `/setup` or `HELIX_*` env vars and supply a key for that tenant. Env vars and runtime config both override the committed defaults.

The key for the public demo agent is shared via the team's password manager,
not via this repo. If you've never been given the key, ask in `#super-banking`
or the team chat.

---

## This Application's Configuration

For reference, the env var names used in this project and example values:

```bash
# banking_api_server/.env

HELIX_BASE_URL=https://openam-helix.forgeblocks.com
HELIX_API_KEY=<keyValue from agent-scoped key JSON>
HELIX_ENVIRONMENT_ID=fe213c3c-9c1d-4bdb-954a-a22879dad26d
HELIX_AGENT_ID=LLM2
HELIX_PROMPT_FIELD_ID=textInputa7c39a0e8292
```

Relevant source files:

| File | Role |
| --- | --- |
| `banking_api_server/services/helixLlmService.js` | Helix API client — conversation create, send, poll |
| `banking_api_server/services/geminiNlIntent.js` | NL routing — routes to Helix JSON router or conversational fallback |
| `banking_api_server/services/configStore.js` | Runtime config — `HELIX_*` env vars resolve via `getEffective('helix_*')` |
| `banking_api_ui/src/components/HelixPanel.jsx` | Admin UI for Helix configuration |

Running tests:

```bash
cd banking_api_server

# Helix service unit tests
npx jest --testPathPattern='helixLlmService' --no-coverage

# LLM-only routing tests
npx jest --testPathPattern='geminiNlIntent.llmOnly' --no-coverage
```
