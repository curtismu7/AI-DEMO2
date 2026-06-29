// banking_api_server/services/platformAgentRuntime.js
/**
 * Live platform-driven runtime for agent modes 4b/5b (spec
 * 2026-05-18-five-mode-agent-provider §5). The PLATFORM (OpenAI
 * Responses API / Claude mcp_connector) drives the tool loop against
 * the MCP Gateway POST /mcp using a BFF-minted gateway-audience token.
 *
 * EDUCATIONAL LOSS (intentional, surfaced in UI banner): one broad
 * gateway-audience token, no per-tool RFC 8693 exchange, no `act`
 * delegation claim, Token Chain dark before the gateway. The gateway
 * (D-05 + PingAuthorize) STILL enforces — that survives the agent swap.
 *
 * This module only BUILDS + ISSUES the platform request. The
 * gateway-audience token is minted by the caller via
 * oauthService.performTokenExchange (same helper as
 * scripts/mint-gateway-token.js) — token custody stays in the BFF.
 */
const axios = require('axios');

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

function buildPlatformRequest(provider, opts = {}) {
  // systemPrompt: session-scoped vertical persona (optional) — makes the external
  // platform agent adopt the active vertical's voice. OpenAI Responses uses
  // `instructions`; Anthropic Messages uses `system`.
  const { gatewayMcpUrl, gatewayToken, userMessage, model, systemPrompt } = opts;
  if (provider === 'openai') {
    return {
      url: OPENAI_RESPONSES_URL,
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY || ''}` },
      body: {
        model: model || 'gpt-4o',
        ...(systemPrompt ? { instructions: systemPrompt } : {}),
        tools: [{
          type: 'mcp',
          server_label: 'super-banking-gateway',
          server_url: gatewayMcpUrl,
          authorization: gatewayToken,
        }],
        input: userMessage,
      },
    };
  }
  if (provider === 'anthropic') {
    return {
      url: ANTHROPIC_MESSAGES_URL,
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'mcp-client-2025-04-04',
      },
      body: {
        model: model || 'claude-sonnet-4-6',
        max_tokens: 1024,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        mcp_servers: [{
          type: 'url',
          url: gatewayMcpUrl,
          name: 'super-banking-gateway',
          authorization_token: gatewayToken,
        }],
        messages: [{ role: 'user', content: userMessage }],
      },
    };
  }
  throw new Error(`Unsupported platform provider: ${provider}`);
}

async function runPlatformLoop(provider, opts) {
  const reqSpec = buildPlatformRequest(provider, opts);
  const resp = await axios.post(reqSpec.url, reqSpec.body, {
    headers: { 'Content-Type': 'application/json', ...reqSpec.headers },
    timeout: 60000,
    validateStatus: (s) => s < 500,
  });
  return { ok: resp.status < 300, status: resp.status, data: resp.data };
}

module.exports = { buildPlatformRequest, runPlatformLoop, OPENAI_RESPONSES_URL, ANTHROPIC_MESSAGES_URL };
