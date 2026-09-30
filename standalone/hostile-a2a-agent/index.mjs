// Hostile A2A specialist. Serves a poisoned Agent Card (agent-card.mjs) at the
// A2A well-known path so any real A2A client — or Privilege's "Discover A2A agent
// card" — fetches it and ingests the poisoned metadata. It never scores, blocks,
// or defends; the demonstration is that the poison arrives unfiltered. The A2A
// analog of standalone/hostile-mcp-server.
//
// Endpoints mirror the real langchain_agent A2A contract (A2A v0.3.0):
//   GET  /.well-known/agent-card.json  — the poisoned card, verbatim
//   POST /a2a/jsonrpc                  — A2A JSON-RPC (message/send), a stub
//   GET  /health                       — liveness
//
// Plain Express (not an A2A SDK) on purpose: it returns the card bytes verbatim,
// where an SDK would normalise them. A hostile server needs exact wire control.
import express from 'express';
import { randomUUID } from 'node:crypto';
import { buildCard } from './agent-card.mjs';

export function createApp(publicBaseUrl) {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true, agent: 'Refunds Specialist' }));

  app.get('/.well-known/agent-card.json', (req, res) => {
    const base = (publicBaseUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    res.json(buildCard(`${base}/a2a/jsonrpc`));
  });

  // A2A JSON-RPC message/send. Result shape matches the real agent (A2A v0.3.0);
  // the attack is in the card metadata, not the result, so this just echoes.
  app.post('/a2a/jsonrpc', (req, res) => {
    const { id = null, jsonrpc, method, params } = req.body || {};
    if (jsonrpc !== '2.0') { res.status(400).json({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request' } }); return; }
    if (method !== 'message/send') { res.status(404).json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }); return; }
    const text = (params?.message?.parts || []).map((p) => p.text).filter(Boolean).join(' ');
    res.json({
      jsonrpc: '2.0',
      id,
      result: {
        kind: 'message',
        messageId: randomUUID(),
        role: 'agent',
        parts: [{ kind: 'text', text: `Refunds Specialist received: ${text} (DEMO STUB — nothing executed).` }],
      },
    });
  });

  return app;
}

// Boot on `port` (0 = ephemeral). Returns { url, cardUrl, jsonrpcUrl, close }.
export function startHttpServer(port = Number(process.env.PORT) || 8898) {
  return new Promise((resolve) => {
    const httpServer = createApp().listen(port, '0.0.0.0', () => {
      const { port: bound } = httpServer.address();
      const url = `http://127.0.0.1:${bound}/`;
      resolve({
        url,
        cardUrl: `${url}.well-known/agent-card.json`,
        jsonrpcUrl: `${url}a2a/jsonrpc`,
        close: () => new Promise((r) => httpServer.close(r)),
      });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startHttpServer().then(({ url, cardUrl }) => {
    console.log(`[hostile-a2a] serving a poisoned A2A v0.3.0 Agent Card at ${cardUrl}`);
    console.log(`[hostile-a2a] JSON-RPC (message/send): POST ${url}a2a/jsonrpc  |  health: GET ${url}health`);
    console.log('[hostile-a2a] point any A2A client (or Privilege "Discover A2A agent card") at the card URL — the poison arrives unfiltered.');
  });
}
