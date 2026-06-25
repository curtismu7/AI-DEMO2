/**
 * Education Topics Service
 * Content extracted from banking demo to explain key OAuth, identity, and agent concepts
 * Extracted from BankingAgent.js TOPIC_MESSAGES © 2024
 */

const TOPIC_MESSAGES = {
  'login-flow': `🔐 Authorization Code + PKCE Flow:\n\n1. App generates code_verifier (random 64 bytes) + code_challenge (SHA-256 hash)\n2. Browser redirects to PingOne /as/authorize with challenge\n3. User authenticates → PingOne redirects back with code\n4. Backend-for-Frontend (BFF) exchanges code + verifier for tokens (server-side only)\n5. Browser never sees the token — only a session cookie\n\nPKCE prevents interception: even if code is stolen, attacker can't exchange it without the verifier.`,
  'token-exchange': `🔄 RFC 8693 Token Exchange (User token → MCP token):\n\nWhy: The user token has broad scope. The MCP server needs a narrowly-scoped MCP token for least-privilege.\n\nHow:\n• Backend-for-Frontend (BFF) holds the User token (session access token)\n• Backend-for-Frontend (BFF) calls PingOne /as/token with grant_type=urn:ietf:params:oauth:grant-type:token-exchange\n• User token is subject_token; agent client credentials are actor_token\n• PingOne validates may_act on the User token and issues an MCP token\n• MCP token has: sub=user, act={client_id=agent}, narrow scope, MCP audience\n\nmay_act on the User token → act on the MCP token — proving delegation chain.`,
  'may-act': `📋 may_act / act Claims (RFC 8693 §4.1):\n\nmay_act on the User token: "this client is allowed to act on my behalf"\n  { "sub": "user-uuid", "may_act": { "client_id": "bff-admin-client" } }\n\nact on the MCP token (exchanged token): "this action was delegated"\n  { "sub": "user-uuid", "act": { "client_id": "bff-admin-client" } }\n\nThe MCP server validates act to confirm the Backend-for-Frontend (BFF) is the authorized actor — not just any client that got a token.`,
  'mcp-protocol': `⚙️ Model Context Protocol (MCP):\n\nMCP is a JSON-RPC 2.0 protocol over WebSocket (or stdio/SSE) for AI tools.\n\nHandshake:\n  initialize → { protocolVersion, capabilities, serverInfo }\n  → notifications/initialized (client notification)\n\nDiscovery:\n  tools/list → [{ name, description, inputSchema }]\n\nExecution:\n  tools/call { name, arguments } → { content: [{ type, text }] }\n\nIn this demo:\n  Browser → Backend-for-Frontend (BFF) (/api/mcp/tool) → MCP Server (WebSocket) → Banking API\n\nToken flow: Backend-for-Frontend (BFF) performs RFC 8693 exchange before forwarding tool calls.`,
  'introspection': `🔍 RFC 7662 Token Introspection:\n\nThe MCP server calls PingOne to validate tokens in real-time:\n  POST /as/introspect\n  { token: "...", token_type_hint: "access_token" }\n  → { active: true, sub, scope, exp, aud }\n\nWhy not just verify the JWT locally?\n• Catches revoked tokens (user logged out, compromised session)\n• Zero-trust: every tool call re-validates the token\n• Results cached 60s to avoid hammering PingOne`,
  'step-up': `⬆️ Step-Up Authentication:\n\nTriggered when a high-value action requires stronger auth:\n• Transfer ≥ $250 → require MFA\n• Backend-for-Frontend (BFF) returns HTTP 428 with WWW-Authenticate: Bearer scope="step_up"\n\nTwo methods:\n1. CIBA: PingOne pushes challenge to user's device (out-of-band)\n2. Redirect: Browser redirects to /api/auth/oauth/user/stepup?acr_values=Multi_factor\n\nAfter approval, PingOne issues new token with higher ACR — Backend-for-Frontend (BFF) stores it and retries the original transaction.`,
  'agent-gateway': `🌐 Agent Gateway / Resource Indicators (RFC 8707):\n\nRFC 8707: client specifies the resource URI when requesting a token\n  /as/token?resource=https://mcp.example.com\n  → token aud = "https://mcp.example.com"\n\nRFC 9728: Protected Resource Metadata\n  GET https://mcp.example.com/.well-known/oauth-protected-resource\n  → { resource, authorization_servers, scopes_supported }\n\nThis lets a dynamic AI agent discover what auth is needed before attempting a tool call — no hardcoded configuration.`,
  'pingone-authorize': `🔐 PingOne Authorize (DaVinci):\n\nPingOne Authorize evaluates access policies at runtime using DaVinci flows.\n\nIn this demo it drives:\n• Step-up MFA triggers (ACR values like "Multi_factor")\n• CIBA push notifications to the user's device\n• Dynamic consent for high-value transactions\n\nThe acr_values parameter in /as/authorize tells PingOne which DaVinci policy to run.`,
  'cimd': `📄 Client ID Metadata Document (CIMD / RFC 7591):\n\nTraditional OAuth: client_id is an opaque string, pre-registered in the AS.\nCIMD: client_id is a URL you control — it hosts the client's metadata.\n\nThe AS fetches the URL to discover:\n  { redirect_uris, grant_types, scope, client_name, logo_uri, … }\n\nBenefits:\n• No pre-registration — client registers itself\n• Client controls updates (change the hosted document)\n• Works across AS instances that support DCR/RFC 7591\n\nIn this demo: click "▶ Simulate" in the CIMD panel to see PingOne dynamic client registration.`,
  'langchain': `🔗 LangChain 1.x (ReactAgent + LangGraph):\n\nLangChain 1.x modernises AI agent composition:\n• ReactAgent: built on LangGraph, invokes tools in a loop until converged\n• createAgent() factory: { model, tools, systemPrompt } → agent.invoke({ messages }, config)\n• Model-agnostic: swap Groq, OpenAI, Anthropic, Gemini, Ollama via provider packages\n• Stateless per-request: agent initializes fresh with history passed in message context\n• Security: API keys live in the BFF session only — never sent to the browser\n\nIn this demo: the Chat Widget invokes createAgent() per message, restores history from session.`,
  'human-in-loop': `👤 Human-in-the-loop (HITL) for the banking agent:\n\n• Above the consent threshold (configurable, default $250) the server issues a consent challenge in your session; after you confirm in the consent popup, operations must include matching consentId (one-time use).\n• All transfers require HITL consent regardless of amount (enforced by policy).\n• The agent cannot complete that path without your browser session.\n• If you decline, the agent notifies you.\n• HITL ≠ MITM (attack). The pattern: agent detects high-value/transfer → returns 428 → UI shows consent modal → user approves → agent resumes with consentId.`,
};

/**
 * Look up education content for a topic
 * Supports direct match and fuzzy matching
 *
 * @param {string} topicKey - Topic key to explain (e.g., 'login-flow', 'langchain')
 * @returns {string} Education content for the topic
 */
function explainTopic(topicKey) {
  if (!topicKey) {
    return `I can explain: ${Object.keys(TOPIC_MESSAGES).join(', ')}. Which topic would you like to know about?`;
  }

  // Direct match
  const msg = TOPIC_MESSAGES[topicKey];
  if (msg) return msg;

  // Fuzzy match: check if any key is contained in topicKey or vice versa
  const normalized = topicKey.toLowerCase();
  const fuzzyKey = Object.keys(TOPIC_MESSAGES).find(
    (k) => normalized.includes(k) || k.includes(normalized)
  );

  if (fuzzyKey) return TOPIC_MESSAGES[fuzzyKey];

  // Fallback
  return `I can explain: ${Object.keys(TOPIC_MESSAGES).join(', ')}. Which topic would you like to know about?`;
}

module.exports = { TOPIC_MESSAGES, explainTopic };
