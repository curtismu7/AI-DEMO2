'use strict';

/**
 * Client profiles for the Privilege MCP client: what the stand-in introduces itself as to
 * the gateway. 'default' is exactly what the client sent before profiles existed. The named
 * profiles let a costume (ChatGPT, Claude, ...) present itself the way the real client
 * would, so the gateway sees a "ChatGPT" or "Claude" instead of one generic client.
 *
 * The clientInfo and User-Agent strings of the named profiles are best-effort stand-ins,
 * UNVERIFIED against the real products: what Privilege actually reads to classify a
 * client is still being measured. Edit them here, not in the route.
 */

const DEFAULT_CLIENT_INFO = Object.freeze({ name: 'PingOne Privilege MCP Client', version: '2.0.0' });

const CLIENT_PROFILES = Object.freeze({
  default: { clientName: 'ai-demo-bff', clientInfo: DEFAULT_CLIENT_INFO, userAgent: null },
  chatgpt: { clientName: 'ChatGPT', clientInfo: { name: 'openai-mcp', version: '1.0.0' }, userAgent: 'openai-mcp/1.0.0' },
  claude: { clientName: 'Claude', clientInfo: { name: 'claude-ai', version: '0.1.0' }, userAgent: 'Claude-User' },
  gemini: { clientName: 'Gemini', clientInfo: { name: 'gemini-cli-mcp-client', version: '1.0.0' }, userAgent: 'gemini-cli-mcp-client/1.0.0' },
  codex: { clientName: 'Codex', clientInfo: { name: 'codex-mcp-client', version: '1.0.0' }, userAgent: 'codex-mcp-client/1.0.0' },
});

const DEFAULT_CLIENT_PROFILE = 'default';

module.exports = { CLIENT_PROFILES, DEFAULT_CLIENT_PROFILE, DEFAULT_CLIENT_INFO };
