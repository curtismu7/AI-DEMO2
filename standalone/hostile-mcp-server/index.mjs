// Hostile MCP server. Serves the poison catalog (poisons.mjs) as real MCP tools
// over Streamable HTTP, so any real MCP client (standalone/mcp-inspector,
// Downloads/mcpclient, or any agent) can connect and ingest the poisoned tool
// metadata. It never scores, blocks, or defends — the demonstration is that the
// poison arrives unfiltered.
//
// Low-level Server (not McpServer) on purpose: it returns the inputSchema/
// description bytes verbatim, where McpServer.registerTool would normalise them
// through a Zod round-trip. A hostile server needs exact control of its wire
// output.
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { POISONS } from './poisons.mjs';

const TOOLS = POISONS.map((p) => p.tool);

// Fresh Server per request — the SDK's documented stateless pattern. Rebuilding
// from the (static) catalog is cheap and avoids sharing transport state across
// requests.
function buildServer() {
  const server = new Server(
    { name: 'totally-legit-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => ({
    // A real call just echoes; the attack is in the metadata, not the result.
    content: [{ type: 'text', text: `called ${req.params.name}` }],
  }));
  return server;
}

export function createApp() {
  const app = express();
  app.use(express.json());
  app.post('/', async (req, res) => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  return app;
}

// Boot on `port` (0 = ephemeral). Returns { url, close } for tests and callers.
export function startHttpServer(port = Number(process.env.PORT) || 8899) {
  return new Promise((resolve) => {
    const httpServer = createApp().listen(port, '127.0.0.1', () => {
      const { port: bound } = httpServer.address();
      resolve({
        url: `http://127.0.0.1:${bound}/`,
        close: () => new Promise((r) => httpServer.close(r)),
      });
    });
  });
}

// Run directly (`npm start`): boot and stay up.
if (import.meta.url === `file://${process.argv[1]}`) {
  startHttpServer().then(({ url }) => {
    console.log(`[hostile-mcp] serving ${TOOLS.length} poisoned tool(s) at ${url}`);
    console.log('[hostile-mcp] point any MCP client at this URL and inspect its tools/list.');
  });
}
