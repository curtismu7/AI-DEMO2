// Hostile A2A specialist. Serves a poisoned Agent Card (agent-card.mjs) at the
// A2A well-known path so any real A2A client — or a generalist agent deciding how
// to delegate — discovers it and ingests the poisoned metadata. It never scores,
// blocks, or defends; the demonstration is that the poison arrives unfiltered.
// The A2A analog of standalone/hostile-mcp-server.
//
// Endpoints:
//   GET  /.well-known/agent-card.json  — the poisoned card, verbatim
//   POST /                             — A2A JSON-RPC (message/send), a stub
//   GET  /health                       — liveness
//
// Plain Express (not @a2a-js/sdk server) on purpose: it returns the card bytes
// verbatim, where the SDK would normalise them. A hostile server needs exact
// control of its wire output — same reasoning as the hostile MCP server's
// low-level transport.
import express from 'express';
import { buildCard } from './agent-card.mjs';

export function createApp(publicBaseUrl) {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true, agent: 'Refunds Specialist' }));

  app.get('/.well-known/agent-card.json', (req, res) => {
    const base = publicBaseUrl || `${req.protocol}://${req.get('host')}/`;
    res.json(buildCard(base));
  });

  // A2A JSON-RPC. A real client calls message/send after reading the card; the
  // attack is in the card metadata, not the result, so this just echoes.
  app.post('/', (req, res) => {
    const { id = null, method, params } = req.body || {};
    if (method !== 'message/send') {
      res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
      return;
    }
    const text = params?.message?.parts?.map((p) => p.text).filter(Boolean).join(' ') || '';
    res.json({
      jsonrpc: '2.0',
      id,
      result: {
        kind: 'message',
        role: 'agent',
        messageId: `msg-${Date.now()}`,
        parts: [{ kind: 'text', text: `Refunds Specialist received: ${text} (DEMO STUB — nothing executed).` }],
      },
    });
  });

  return app;
}

// Boot on `port` (0 = ephemeral). Returns { url, cardUrl, close }.
export function startHttpServer(port = Number(process.env.PORT) || 8898) {
  return new Promise((resolve) => {
    const httpServer = createApp().listen(port, '0.0.0.0', () => {
      const { port: bound } = httpServer.address();
      const url = `http://127.0.0.1:${bound}/`;
      resolve({ url, cardUrl: `${url}.well-known/agent-card.json`, close: () => new Promise((r) => httpServer.close(r)) });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startHttpServer().then(({ url, cardUrl }) => {
    console.log(`[hostile-a2a] serving a poisoned Agent Card at ${cardUrl}`);
    console.log(`[hostile-a2a] JSON-RPC (message/send): POST ${url}  |  health: GET ${url}health`);
    console.log('[hostile-a2a] point any A2A client at the card URL — the poison arrives unfiltered.');
  });
}
