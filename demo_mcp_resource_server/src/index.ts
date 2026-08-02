'use strict';

/**
 * banking-mcp-resource-server — entry point
 *
 * MCP server for investment tools. Runs over WebSocket (same protocol as banking_mcp_server).
 * Validates inbound token aud === MCP_SERVER_RESOURCE_URI (mcp-resource-server.ping.demo).
 *
 * HTTP surfaces (same port):
 *   GET  /.well-known/oauth-protected-resource  — RFC 9728 metadata
 *   GET  /health
 *
 * Start: MCP_SERVER_RESOURCE_URI=https://mcp-resource-server.ping.demo node dist/index.js
 */

import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import { INVEST_TOOLS, filterByScopes } from './tools/investTools';
import { dispatchTool } from './tools/investToolHandler';
import { decodeAndValidate, extractScopes, TokenError } from './server/tokenValidator';

// Security guard: SKIP_TOKEN_SIGNATURE_VALIDATION downgrades JWT signature
// verification to a warning (tokenValidator.ts) and must never run in production.
// Fail fast at startup so a misconfigured deploy can't silently accept forged
// tokens — matches demo_api_server/server.js and demo_mcp_server.
if (process.env.SKIP_TOKEN_SIGNATURE_VALIDATION === 'true' && process.env.NODE_ENV === 'production') {
  console.error('[invest][FATAL] SKIP_TOKEN_SIGNATURE_VALIDATION=true is not allowed in production. Remove this env var before deploying.');
  process.exit(1);
}

const PORT = parseInt(process.env.PORT || '8081', 10);
const HOST = process.env.HOST || '0.0.0.0';
// MCP_SERVER_RESOURCE_URI may be a comma-separated accepted-audience list (RFC 8693
// rollout). The FIRST entry is this server's canonical resource URI (RFC 9728
// metadata, health, logs); the full list feeds aud validation.
const RESOURCE_URI_LIST = (process.env.MCP_SERVER_RESOURCE_URI || 'https://mcp-resource-server.ping.demo')
  .split(',').map((s) => s.trim()).filter(Boolean);
const RESOURCE_URI = RESOURCE_URI_LIST[0];
const ACCEPTED_AUDIENCES = RESOURCE_URI_LIST.join(',');
const RESOURCE_NAME = process.env.MCP_SERVER_RESOURCE_NAME || 'Super Banking MCP Server (mcp-resource-server)';

// Startup env validation
if (!process.env.MCP_SERVER_RESOURCE_URI) {
  console.warn(
    '[demo-mcp-resource-server] WARNING: MCP_SERVER_RESOURCE_URI is not set — ' +
    `using default '${RESOURCE_URI}'. Token audience validation may fail. ` +
    'Set MCP_SERVER_RESOURCE_URI in demo_api_server/.env'
  );
}

const PINGONE_ENV_ID = process.env.PINGONE_ENVIRONMENT_ID || '';
const PINGONE_REGION = process.env.PINGONE_REGION || 'com';

// ---------------------------------------------------------------------------
// API-key auth (backend-app pattern) — gateway fetches key from vault and sends
// it in X-API-Key. This coexists with the Bearer/WebSocket path above.
// ---------------------------------------------------------------------------
const API_KEY_ENV = (process.env.MCP_RESOURCE_SERVER_API_KEY || '').trim();
let API_KEY: string;
if (API_KEY_ENV) {
  API_KEY = API_KEY_ENV;
} else {
  API_KEY = crypto.randomBytes(24).toString('hex');
  console.warn('[mcp-resource-server] MCP_RESOURCE_SERVER_API_KEY unset — ephemeral key generated. Set it so the gateway can call the /invest HTTP endpoint.');
}
const API_KEY_DIGEST = crypto.createHash('sha256').update(API_KEY, 'utf8').digest();
function apiKeyMatches(presented: string): boolean {
  const d = crypto.createHash('sha256').update(presented, 'utf8').digest();
  return crypto.timingSafeEqual(d, API_KEY_DIGEST);
}

// Must match the requiredScopes the invest tools declare (investTools.ts), so a
// client reading this RFC 9728 metadata requests a scope that actually unlocks
// tools — all invest tools require 'invest:read'.
const INVEST_SCOPES = ['invest:read'];

// ---------------------------------------------------------------------------
// HTTP: RFC 9728 metadata + health
// ---------------------------------------------------------------------------

function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url || '/';

  if (url === '/.well-known/oauth-protected-resource' && req.method === 'GET') {
    const asList = PINGONE_ENV_ID
      ? [`https://auth.pingone.${PINGONE_REGION}/${PINGONE_ENV_ID}/as`]
      : [];
    const metadata: Record<string, unknown> = {
      resource: RESOURCE_URI,
      bearer_methods_supported: ['header'],
      scopes_supported: INVEST_SCOPES,
      resource_name: RESOURCE_NAME,
      resource_documentation: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization',
    };
    if (asList.length) metadata.authorization_servers = asList;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' });
    res.end(JSON.stringify(metadata, null, 2));
    return;
  }

  if (url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'banking-mcp-resource-server',
      uptime: process.uptime(),
      resourceUri: RESOURCE_URI,
      authMethods: ['bearer_token', 'api_key'],
    }));
    return;
  }

  // HTTP + API-key path: backend-app pattern (gateway drops bearer, sends X-API-Key)
  if (url === '/invest' && req.method === 'GET') {
    const presented = req.headers['x-api-key'] as string | undefined;
    if (!presented) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'api_key_missing', message: 'X-API-Key header required' }));
      return;
    }
    if (!apiKeyMatches(presented)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'api_key_invalid' }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'X-Auth-Mechanism': 'api_key',
    });
    res.end(JSON.stringify({
      invest: {
        portfolioId: 'INV-8842',
        holder: 'Jordan A. Rivera',
        totalValue: 184320.55,
        cashSweep: 12580.10,
        ytdReturnPct: 11.4,
        riskProfile: 'Growth',
        holdings: [
          { symbol: 'VTI', name: 'Vanguard Total Market ETF', quantity: 220, marketValue: 62480.00 },
          { symbol: 'UST-10Y', name: 'US Treasury Note', quantity: null, marketValue: 60010.35 },
          { symbol: 'AAPL', name: 'Apple Inc.', quantity: 90, marketValue: 19260.00 },
          { symbol: 'VNQ', name: 'Vanguard Real Estate ETF', quantity: 340, marketValue: 29990.10 },
        ],
      },
      source: 'banking_mcp_resource_server',
      authMechanism: 'X-API-Key (shared secret)',
      note: 'This portfolio was returned because the gateway presented a valid service API key. No OAuth bearer was involved on this hop — the gateway dropped the user token and attached a shared secret from its vault.',
    }, null, 2));
    return;
  }

  res.writeHead(404);
  res.end();
}

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

function rpcError(id: unknown, code: number, message: string, data?: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } });
}

function rpcResult(id: unknown, result: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

// ---------------------------------------------------------------------------
// MCP message handler
// ---------------------------------------------------------------------------

async function handleMessage(
  rawMsg: string,
  token: string,
  send: (s: string) => void,
): Promise<void> {
  let msg: any;
  try { msg = JSON.parse(rawMsg); } catch { send(rpcError(null, -32700, 'Parse error')); return; }

  const { method, id } = msg;

  if (method === 'initialize') {
    send(rpcResult(id, {
      protocolVersion: '2025-11-25',
      capabilities: { tools: {} },
      serverInfo: { name: 'banking-mcp-resource-server', version: '1.0.0' },
    }));
    return;
  }

  if (method === 'notifications/initialized') return;

  if (method === 'tools/list') {
    let decoded;
    try { decoded = await decodeAndValidate(token, ACCEPTED_AUDIENCES); } catch (e) {
      const te = e as TokenError;
      send(rpcError(id, -32001, te.message));
      return;
    }
    const scopes = extractScopes(decoded);
    const tools = filterByScopes(INVEST_TOOLS, scopes).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      requiredScopes: t.requiredScopes,
      readOnly: t.readOnly,
    }));
    send(rpcResult(id, { tools }));
    return;
  }

  if (method === 'tools/call') {
    const toolName: string = msg.params?.name || '';
    const args: Record<string, unknown> = msg.params?.arguments || {};

    let decoded;
    try { decoded = await decodeAndValidate(token, ACCEPTED_AUDIENCES); } catch (e) {
      const te = e as TokenError;
      send(rpcError(id, -32001, te.message));
      return;
    }

    // Per-tool scope check
    const tool = INVEST_TOOLS.find((t) => t.name === toolName);
    if (!tool) {
      send(rpcResult(id, { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true }));
      return;
    }

    const scopes = extractScopes(decoded);
    const hasScopes = tool.requiredScopes.every(
      (s) => scopes.includes(s) || scopes.includes('*') || scopes.includes('*'),
    );
    if (!hasScopes) {
      send(rpcError(id, -32005, `Insufficient scope for tool '${toolName}'`, {
        requiredScopes: tool.requiredScopes,
        availableScopes: scopes,
      }));
      return;
    }

    try {
      const result = await dispatchTool(toolName, args, token);
      send(rpcResult(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: false,
      }));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      send(rpcResult(id, { content: [{ type: 'text', text: errMsg }], isError: true }));
    }
    return;
  }

  send(rpcError(id, -32601, `Method not found: ${method}`));
}

// ---------------------------------------------------------------------------
// Start WebSocket + HTTP
// ---------------------------------------------------------------------------

const httpServer = createServer(handleHttp);
const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', (ws, req) => {
  const auth = req.headers['authorization'] || '';
  const tokenParts = auth.split(' ');
  const token = tokenParts.length === 2 && tokenParts[0].toLowerCase() === 'bearer'
    ? tokenParts[1]
    : '';

  if (!token) {
    ws.close(4001, 'Bearer token required');
    return;
  }

  ws.on('message', (raw) => {
    handleMessage(raw.toString(), token, (s) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(s);
    }).catch((err) => {
      console.error('[mcp-resource-server] Handler error:', err);
      if (ws.readyState === WebSocket.OPEN) ws.send(rpcError(null, -32603, 'Internal error'));
    });
  });

  ws.on('error', (err) => console.error('[mcp-resource-server] WS error:', err.message));
});

httpServer.listen(PORT, HOST, () => {
  console.log(`[mcp-resource-server] Running on ${HOST}:${PORT}`);
  console.log(`[mcp-resource-server] Resource URI (aud): ${RESOURCE_URI}`);
  console.log(`[mcp-resource-server] RFC 9728: http://localhost:${PORT}/.well-known/oauth-protected-resource`);
  console.log(`[mcp-resource-server] Tools: ${INVEST_TOOLS.map((t) => t.name).join(', ')}`);
});

process.on('SIGINT', () => { httpServer.close(); process.exit(0); });
process.on('SIGTERM', () => { httpServer.close(); process.exit(0); });
