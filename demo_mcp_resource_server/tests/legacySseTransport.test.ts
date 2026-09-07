'use strict';

/**
 * Legacy HTTP+SSE transport (2024-11-05), added for ONE caller: the PingOne
 * Privilege AI Gateway's discovery client, which opens a bare GET and waits
 * for the SSE `endpoint` event rather than POSTing `initialize` (see
 * .claude/skills/privilege-mcpgw-agent-k8s). Without it, registering this
 * server as an Agentic App fails discovery entirely.
 *
 * Mirrors oauth-mcp/tests/legacy-sse-transport.test.ts's coverage, adapted to
 * this file's own real-server + fetch() convention (see httpMcp.test.ts).
 *
 * The load-bearing test is the tools/call one: /messages delegates to the
 * exact same POST /mcp handler used everywhere else, so the bearer gate
 * cannot diverge between transports. If someone ever gives /messages its own
 * dispatch, an unauthenticated tools/call is what that mistake looks like.
 */

import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-sse-'));
process.env.AIRLINES_DB_PATH = path.join(tmpDir, 'airlines.db');
process.env.AIRLINES_SEED_PATH = path.join(__dirname, '..', 'seed', 'airlines.seed.json');
process.env.MCP_RESOURCE_SERVER_RESOURCE_URI = 'mcp-resource-server.ping.demo';
process.env.SKIP_TOKEN_SIGNATURE_VALIDATION = 'true';
process.env.PORT = '0';

let server: http.Server;
let base: string;

beforeAll(async () => {
  const mod = await import('../src/index');
  server = (mod as unknown as { httpServer: http.Server }).httpServer;
  await new Promise<void>((resolve) => {
    if (server.listening) return resolve();
    server.once('listening', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Reads an SSE stream incrementally, only ever returning text NOT already handed back. */
class SseReader {
  private buffered = '';
  private consumed = 0;
  private readonly decoder = new TextDecoder();
  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  /** Waits for `marker` in unread text; returns that one SSE frame (up to the blank-line terminator). */
  async readUntil(marker: string, timeoutMs = 5000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const unread = this.buffered.slice(this.consumed);
      const idx = unread.indexOf(marker);
      if (idx !== -1) {
        const frameEnd = unread.indexOf('\n\n', idx);
        const end = frameEnd === -1 ? unread.length : frameEnd + 2;
        this.consumed += end;
        return unread.slice(idx, end);
      }
      if (Date.now() > deadline) throw new Error(`timed out waiting for "${marker}"; unread so far: ${unread}`);
      const { value, done } = await this.reader.read();
      if (done) throw new Error(`SSE stream closed before "${marker}" appeared; unread so far: ${unread}`);
      this.buffered += this.decoder.decode(value, { stream: true });
    }
  }
}

function parseDataLine(frame: string): any {
  const line = frame.split('\n').find((l) => l.startsWith('data: '));
  if (!line) throw new Error(`no "data: " line in frame: ${frame}`);
  return JSON.parse(line.slice('data: '.length));
}

async function openSse(): Promise<{ sessionId: string; sse: SseReader; close: () => void }> {
  const ac = new AbortController();
  const res = await fetch(`${base}/sse`, { signal: ac.signal });
  const sse = new SseReader(res.body!.getReader());
  const frame = await sse.readUntil('event: endpoint');
  const match = /data: \/messages\?sessionId=([0-9a-f-]+)/.exec(frame);
  if (!match) throw new Error(`endpoint frame had no sessionId: ${frame}`);
  return { sessionId: match[1], sse, close: () => ac.abort() };
}

async function postMessages(sessionId: string, body: unknown): Promise<{ status: number }> {
  const res = await fetch(`${base}/messages?sessionId=${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status };
}

describe('GET /sse', () => {
  it('emits the endpoint event the gateway waits for', async () => {
    const { sessionId, close } = await openSse();
    try {
      expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      close();
    }
  });
});

describe('POST /messages', () => {
  it('with an unknown session id says so, rather than failing opaquely', async () => {
    const r = await fetch(`${base}/messages?sessionId=not-a-real-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    expect(r.status).toBe(404);
    const body = await r.json() as { error: string };
    expect(body.error).toMatch(/unknown or closed/i);
  });

  it('relays an unauthenticated initialize reply on the stream, not the POST body', async () => {
    const { sessionId, sse, close } = await openSse();
    try {
      const r = await postMessages(sessionId, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
      expect(r.status).toBe(202); // the POST is only an ACK in this transport

      const frame = await sse.readUntil('event: message');
      const msg = parseDataLine(frame);
      expect(msg.result.protocolVersion).toBe('2025-11-25');
    } finally {
      close();
    }
  });

  it('relays an unauthenticated tools/list reply with the FULL unfiltered catalog', async () => {
    const { sessionId, sse, close } = await openSse();
    try {
      await postMessages(sessionId, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
      const frame = await sse.readUntil('event: message');
      const msg = parseDataLine(frame);

      // Unauthenticated discovery gets every tool's metadata, unfiltered by scope —
      // an authenticated caller with only 'airlines:read' sees a strict subset
      // (see httpMcp.test.ts's "filters tools/list by scope" test), so this list
      // must be strictly larger than that to prove no scope filter ran.
      const names: string[] = msg.result.tools.map((t: { name: string }) => t.name);
      expect(names).toContain('get_airline_bookings');
      expect(names).toContain('list_banking_accounts');
      expect(names.length).toBeGreaterThan(4);
    } finally {
      close();
    }
  });

  it('does NOT let /messages bypass the bearer gate for tools/call', async () => {
    const { sessionId, sse, close } = await openSse();
    try {
      const r = await postMessages(sessionId, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'get_airline_bookings', arguments: {} },
      });
      // 202 is only the ACK for the POST itself — what matters is what landed on the stream.
      expect(r.status).toBe(202);

      const frame = await sse.readUntil('event: message');
      expect(frame).toContain('invalid_token');
    } finally {
      close();
    }
  });

  it('still requires a bearer for tools/call when reached over the ordinary POST /mcp path (no regression)', async () => {
    const r = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'get_airline_bookings', arguments: {} },
      }),
    });
    expect(r.status).toBe(401);
  });
});
