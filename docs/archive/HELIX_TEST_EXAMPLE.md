# Helix LLM Test Example

## Quick Test Setup

To test Helix LLM integration in the Banking demo:

### 1. Get Test Credentials

Contact the Helix team or your Ping admin for test credentials. You'll need:
- **Base URL**: e.g., `https://openam-helix.forgeblocks.com`
- **Environment ID**: e.g., `env-abc123`
- **Agent ID**: e.g., `agent-xyz789`
- **API Key**: From Helix Admin console

### 2. Configure Helix in Demo

Navigate to **`/configure?tab=llm-helix`** and enter:

| Field | Example | Notes |
|-------|---------|-------|
| **Base URL** | `https://openam-helix.forgeblocks.com` | Your Helix tenant URL |
| **API Key** | `sk_live_...` | From Helix Admin → API Keys |
| **Environment ID** | `env-abc123` | Helix environment/tenant ID |
| **Agent ID** | `agent-xyz789` | Specific agent to invoke |

Click **"Save & Activate"** → status should show ✅ Active

### 3. Test via Chat

Once configured, use the chat interface:

1. Click **"LLM Demo: Ask Helix"** chip
2. Type a banking or financial question
3. Watch the agent invoke Helix instead of Ollama

Example prompts:
- "What are the best practices for account security?"
- "Explain the difference between checking and savings accounts"
- "Give me tips for reducing transaction fees"

### 4. Verify in Browser Console

Open DevTools → Console and look for:
```
[agentBuilder] Initializing Helix LLM: gpt-4o-mini
[agentBuilder] LLM initialized: helix/gpt-4o-mini
```

If you see the stub error instead:
```
Helix LLM integration stub — please configure the real endpoint URL...
```

This means `helixLlmService.js` still has the placeholder. The real API call needs to be implemented once Helix endpoint format is confirmed.

### 5. Real Implementation

Once Helix API format is confirmed, edit:
```
banking_api_server/services/helixLlmService.js
```

Replace the stub with the real HTTP call to Helix:
```js
const response = await fetch(`${helix_base_url}/api/environments/${helix_environment_id}/agents/${helix_agent_id}/invoke`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${helix_api_key}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ messages }),
});
```

See the comments in that file for the expected request/response format.

---

## What's Wired Up

✅ **Config UI** — `/configure?tab=llm-helix` with 4 credential fields  
✅ **Backend Storage** — Encrypted API key persisted in SQLite  
✅ **Agent Detection** — `agentBuilder.js` detects `provider === 'helix'`  
✅ **LLM Selection** — Agent uses Helix when configured  
⏳ **Real API Call** — Stub placeholder (TODO: replace with real endpoint)  
✅ **Demo Chips** — New "LLM Demo" chips to test Helix in chat  

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Form fields clear when leaving tab | (FIXED) Uses sessionStorage persistence |
| "Load from Database" doesn't populate | (FIXED) API is now source of truth |
| Fake test data shows up | (FIXED) Cleared runtimeData.json |
| System modal on Clear | (FIXED) Now uses app modal |
| API Key shows as blank | ✓ Normal — encrypted secrets never displayed |

