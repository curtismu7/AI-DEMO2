'use strict';

/**
 * banking-mcp-resource-server — entry point
 *
 * MCP server for investment and airlines tools. Runs over WebSocket (same
 * protocol as banking_mcp_server). Validates inbound token aud ===
 * MCP_SERVER_RESOURCE_URI (mcp-invest.ping.demo — the audience the PingOne
 * "Demo MCP Invest" resource carries; the value is a comma-separated ACCEPTED
 * list, so the gateway audience and the older URI stay valid too).
 *
 * The invest tools proxy back to the BFF; the airlines tools are served from
 * this server's own SQLite database (src/db/airlinesDb.ts).
 *
 * HTTP surfaces (same port):
 *   GET  /.well-known/oauth-protected-resource  — RFC 9728 metadata
 *   GET  /health
 *   POST /mcp                                   — MCP JSON-RPC (for PingGateway,
 *                                                 which has no WS listener)
 *
 * Start: MCP_SERVER_RESOURCE_URI=mcp-invest.ping.demo node dist/index.js
 */

import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';

interface ResourceDef {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  requiredScope: string;
  uriTemplate: string;
  templateName: string;
  listTool: string;
}

const RESOURCE_CATALOG: ResourceDef[] = [
  { uri: 'banking://accounts', name: 'Bank Accounts', description: 'All bank accounts for the authenticated user', mimeType: 'application/json', requiredScope: 'banking:read', uriTemplate: 'banking://accounts/{accountId}', templateName: 'Bank Account', listTool: 'list_banking_accounts' },
  { uri: 'healthcare://records', name: 'Patient Records', description: 'All patient records for the authenticated user', mimeType: 'application/json', requiredScope: 'healthcare:read', uriTemplate: 'healthcare://records/{recordId}', templateName: 'Patient Record', listTool: 'list_patient_records' },
  { uri: 'government://permits', name: 'Government Permits', description: 'All government permits for the authenticated user', mimeType: 'application/json', requiredScope: 'government:read', uriTemplate: 'government://permits/{permitId}', templateName: 'Government Permit', listTool: 'list_permits' },
  { uri: 'manufacturing://work-orders', name: 'Work Orders', description: 'All work orders for the authenticated user', mimeType: 'application/json', requiredScope: 'manufacturing:read', uriTemplate: 'manufacturing://work-orders/{orderId}', templateName: 'Work Order', listTool: 'list_work_orders' },
  { uri: 'retail://orders', name: 'Retail Orders', description: 'All retail orders for the authenticated user', mimeType: 'application/json', requiredScope: 'retail:read', uriTemplate: 'retail://orders/{orderId}', templateName: 'Retail Order', listTool: 'list_orders' },
  { uri: 'sporting-goods://gear-orders', name: 'Gear Orders', description: 'All sporting-goods orders for the authenticated user', mimeType: 'application/json', requiredScope: 'sporting-goods:read', uriTemplate: 'sporting-goods://gear-orders/{orderId}', templateName: 'Gear Order', listTool: 'list_gear_orders' },
  { uri: 'university://courses', name: 'Courses', description: 'All courses for the authenticated student', mimeType: 'application/json', requiredScope: 'university:read', uriTemplate: 'university://courses/{courseId}', templateName: 'Course', listTool: 'list_courses' },
  { uri: 'workforce://expenses', name: 'Expenses', description: 'All expense reports for the authenticated employee', mimeType: 'application/json', requiredScope: 'workforce:read', uriTemplate: 'workforce://expenses/{expenseId}', templateName: 'Expense', listTool: 'list_expenses' },
  { uri: 'anf://orders', name: 'ANF Orders', description: 'All Abercrombie & Fitch orders for the authenticated user', mimeType: 'application/json', requiredScope: 'anf:read', uriTemplate: 'anf://orders/{orderId}', templateName: 'ANF Order', listTool: 'list_anf_orders' },
  { uri: 'investment://accounts', name: 'Investment Accounts', description: 'All investment accounts for the authenticated user', mimeType: 'application/json', requiredScope: 'invest:read', uriTemplate: 'investment://accounts/{accountId}', templateName: 'Investment Account', listTool: 'get_investment_accounts' },
  { uri: 'airlines://bookings', name: 'Airline Bookings', description: 'All airline bookings for the authenticated passenger', mimeType: 'application/json', requiredScope: 'airlines:read', uriTemplate: 'airlines://bookings/{bookingId}', templateName: 'Airline Booking', listTool: 'get_airline_bookings' },
];
import { createServer, IncomingMessage, ServerResponse } from 'http';
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import { filterByScopes } from './tools/toolTypes';
import { ALL_TOOLS, SUPPORTED_SCOPES, dispatch, findTool } from './tools/registry';
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
const RESOURCE_URI_LIST = (process.env.MCP_SERVER_RESOURCE_URI || 'mcp-invest.ping.demo')
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

// SUPPORTED_SCOPES is derived from the tool catalog (tools/registry.ts), so a
// client reading this RFC 9728 metadata always requests a scope that actually
// unlocks tools — 'invest:read' for the invest namespace, 'airlines:read' for
// the SQLite-backed airlines namespace.

/** Cap on a single HTTP MCP request body — a tool call is a few hundred bytes. */
const MAX_MCP_BODY_BYTES = 256 * 1024;

/**
 * Extract a bearer token from an Authorization header. Shared by both
 * transports so the HTTP path can never diverge from the WebSocket one on
 * something as easy to get subtly wrong as header parsing.
 */
function bearerFrom(header: string | string[] | undefined): string {
  const parts = String(header || '').split(' ');
  return parts.length === 2 && parts[0].toLowerCase() === 'bearer' ? parts[1] : '';
}

// ---------------------------------------------------------------------------
// HTTP: RFC 9728 metadata + health + MCP (JSON-RPC over POST)
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
      scopes_supported: SUPPORTED_SCOPES,
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

  // HTTP MCP — JSON-RPC over POST.
  //
  // The WebSocket transport below is the original one, but PingGateway/IG has no
  // WebSocket listener, so an IG-fronted deployment could not reach these tools
  // at all (its /mcp/invest route proxied to an endpoint that 404'd). This runs
  // the SAME handleMessage as the WS path, so audience validation and the
  // per-tool scope gate are identical by construction, not by duplication.
  if (url === '/mcp' && req.method === 'POST') {
    const token = bearerFrom(req.headers['authorization']);
    if (!token) {
      res.writeHead(401, {
        'Content-Type': 'application/json',
        // RFC 9728: point an unauthenticated caller at the metadata document.
        'WWW-Authenticate': `Bearer resource_metadata="${RESOURCE_URI}/.well-known/oauth-protected-resource"`,
      });
      res.end(JSON.stringify({ error: 'invalid_token', error_description: 'Bearer token required' }));
      return;
    }

    let body = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > MAX_MCP_BODY_BYTES) {
        tooLarge = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'payload_too_large' }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooLarge) return;
      let replied = false;
      const send = (s: string): void => {
        if (replied) return;
        replied = true;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(s);
      };
      handleMessage(body, token, send)
        .then(() => {
          // A notification (e.g. notifications/initialized) produces no response.
          if (!replied) { res.writeHead(202); res.end(); }
        })
        .catch((err) => {
          console.error('[mcp-resource-server] HTTP MCP handler error:', err);
          if (!replied) {
            replied = true;
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(rpcError(null, -32603, 'Internal error'));
          }
        });
    });
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
      capabilities: {
        tools: {},
        resources: { subscribe: false, listChanged: false },
      },
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
    const tools = filterByScopes(ALL_TOOLS, scopes).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      requiredScopes: t.requiredScopes,
      readOnly: t.readOnly,
      ...(t.intentHints ? { intentHints: t.intentHints } : {}),
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
    const tool = findTool(toolName);
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
      const result = await dispatch(toolName, args, token, decoded.sub);
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

  if (method === 'resources/list') {
    let decoded;
    try { decoded = await decodeAndValidate(token, ACCEPTED_AUDIENCES); } catch (e) {
      const te = e as TokenError;
      send(rpcError(id, -32001, te.message));
      return;
    }
    const scopes = extractScopes(decoded);
    const has = (s: string) => scopes.includes(s) || scopes.includes('*');
    const resources = RESOURCE_CATALOG.filter((r) => has(r.requiredScope)).map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    }));
    send(rpcResult(id, { resources }));
    return;
  }

  if (method === 'resources/templates/list') {
    let decoded;
    try { decoded = await decodeAndValidate(token, ACCEPTED_AUDIENCES); } catch (e) {
      const te = e as TokenError;
      send(rpcError(id, -32001, te.message));
      return;
    }
    const scopes = extractScopes(decoded);
    const has = (s: string) => scopes.includes(s) || scopes.includes('*');
    const resourceTemplates = RESOURCE_CATALOG.filter((r) => has(r.requiredScope)).map((r) => ({
      uriTemplate: r.uriTemplate,
      name: r.templateName,
      description: r.description,
      mimeType: r.mimeType,
    }));
    send(rpcResult(id, { resourceTemplates }));
    return;
  }

  if (method === 'resources/read') {
    const uri: string = msg.params?.uri || '';
    let decoded: Awaited<ReturnType<typeof decodeAndValidate>>;
    try { decoded = await decodeAndValidate(token, ACCEPTED_AUDIENCES); } catch (e) {
      const te = e as TokenError;
      send(rpcError(id, -32001, te.message));
      return;
    }
    const resource = RESOURCE_CATALOG.find((r) => r.uri === uri);
    if (!resource) {
      send(rpcError(id, -32002, `Unknown resource URI: ${uri}`));
      return;
    }
    const scopes = extractScopes(decoded);
    const hasScope = scopes.includes(resource.requiredScope) || scopes.includes('*');
    if (!hasScope) {
      send(rpcError(id, -32005, `Insufficient scope for resource '${uri}'`, {
        requiredScope: resource.requiredScope,
        availableScopes: scopes,
      }));
      return;
    }
    try {
      const data = await dispatch(resource.listTool, {}, token, decoded.sub);
      send(rpcResult(id, {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(data, null, 2),
        }],
      }));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      send(rpcError(id, -32603, `Resource read failed: ${errMsg}`));
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
  const token = bearerFrom(req.headers['authorization']);

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
  console.log(`[mcp-resource-server] Tools: ${ALL_TOOLS.map((t) => t.name).join(', ')}`);
});

process.on('SIGINT', () => { httpServer.close(); process.exit(0); });
process.on('SIGTERM', () => { httpServer.close(); process.exit(0); });

// Exported so the HTTP MCP transport can be exercised against a real socket
// (PORT=0 for an ephemeral port) instead of a hand-rolled request/response fake.
export { httpServer };
