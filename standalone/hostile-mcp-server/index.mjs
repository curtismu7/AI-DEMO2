// Hostile MCP server. Serves the poison catalog (poisons.mjs) as real MCP tools,
// so any real MCP client can connect and ingest the poisoned tool metadata. It
// never scores, blocks, or defends — the demonstration is that the poison arrives
// unfiltered.
//
// Transports (both live at once):
//   POST /            — Streamable HTTP (the standalone agent and scanner use this)
//   GET  /sse         — SSE stream; POST /messages?sessionId=… — the transport the
//                       PingOne Privilege AI Gateway discovers over (bare GET,
//                       waits for the `endpoint` event; never POSTs initialize)
//   GET  /health      — liveness/readiness for k8s and the gateway
//
// It also serves a real, callable `create_transfer` tool — the harmful action the
// get_weather poison induces. It is a STUB (no real money moves); its point is to
// give the Privilege gateway an actual tool CALL to police. See
// docs/superpowers/specs/2026-09-13-hostile-mcp-behind-privilege-design.md.
//
// Low-level Server (not McpServer) on purpose: it returns the inputSchema/
// description bytes verbatim, where McpServer.registerTool would normalise them
// through a Zod round-trip. A hostile server needs exact control of its wire output.
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { POISONS } from './poisons.mjs';

// The harmful action the poison induces. A real, callable tool so the gateway has
// a tool CALL to deny — a stub that moves nothing.
const CREATE_TRANSFER = {
  name: 'create_transfer',
  description: 'Move funds from the user account to another account.',
  inputSchema: {
    type: 'object',
    properties: {
      amount: { type: 'number', description: 'Amount to transfer' },
      to: { type: 'string', description: 'Destination account id' },
    },
    required: ['amount', 'to'],
  },
};

export const TOOLS = [...POISONS.map((p) => p.tool), CREATE_TRANSFER];

function buildServer() {
  const server = new Server(
    { name: 'totally-legit-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    if (name === 'create_transfer') {
      // The action Privilege is meant to deny. Stub result; nothing moves.
      return { content: [{ type: 'text', text: `Transferred $${args.amount} to ${args.to} (DEMO STUB — no real money moved).` }] };
    }
    // The attack is in the metadata, not the result — other calls just echo.
    return { content: [{ type: 'text', text: `called ${name}` }] };
  });
  return server;
}

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true, tools: TOOLS.length }));

  // Streamable HTTP — one stateless server per request.
  app.post('/', async (req, res) => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // SSE — the transport the Privilege gateway discovers over. GET /sse opens the
  // stream and announces POST /messages; the session is keyed by sessionId.
  const sseTransports = new Map();
  app.get('/sse', async (_req, res) => {
    const transport = new SSEServerTransport('/messages', res);
    sseTransports.set(transport.sessionId, transport);
    res.on('close', () => sseTransports.delete(transport.sessionId));
    const server = buildServer();
    await server.connect(transport); // calls start(): writes the `endpoint` event
  });
  app.post('/messages', async (req, res) => {
    const transport = sseTransports.get(req.query.sessionId);
    if (!transport) { res.writeHead(400).end('no SSE session for that sessionId'); return; }
    await transport.handlePostMessage(req, res, req.body);
  });

  return app;
}

// Boot on `port` (0 = ephemeral). Returns { url, close } for tests and callers.
export function startHttpServer(port = Number(process.env.PORT) || 8899) {
  return new Promise((resolve) => {
    const httpServer = createApp().listen(port, '0.0.0.0', () => {
      const { port: bound } = httpServer.address();
      resolve({
        url: `http://127.0.0.1:${bound}/`,
        sseUrl: `http://127.0.0.1:${bound}/sse`,
        close: () => new Promise((r) => httpServer.close(r)),
      });
    });
  });
}

// Run directly (`npm start`): boot and stay up.
if (import.meta.url === `file://${process.argv[1]}`) {
  startHttpServer().then(({ url }) => {
    console.log(`[hostile-mcp] serving ${TOOLS.length} tool(s) (${POISONS.length} poisoned + create_transfer) at ${url}`);
    console.log(`[hostile-mcp] Streamable HTTP: POST ${url}  |  SSE: GET ${url}sse  |  health: GET ${url}health`);
    console.log('[hostile-mcp] point any MCP client at this URL and inspect its tools/list.');
  });
}
