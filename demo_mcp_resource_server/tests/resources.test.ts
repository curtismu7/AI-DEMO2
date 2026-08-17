'use strict';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-res-'));
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

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(scope: string, aud = 'mcp-resource-server.ping.demo'): string {
  return [
    b64({ alg: 'RS256', typ: 'JWT' }),
    b64({ sub: 'probe', aud, scope, exp: Math.floor(Date.now() / 1000) + 600 }),
    'unsigned',
  ].join('.');
}

async function post(body: unknown, bearer?: string) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

describe('resources/list', () => {
  it('returns resources filtered by scope', async () => {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'resources/list', params: {} }, token('banking:read'));
    const uris = r.json.result.resources.map((res: any) => res.uri);
    expect(uris).toContain('banking://accounts');
    expect(uris).not.toContain('healthcare://records');
  });

  it('returns all resources for wildcard scope', async () => {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'resources/list', params: {} }, token('*'));
    expect(r.json.result.resources.length).toBeGreaterThanOrEqual(11);
  });

  it('returns -32001 without a token', async () => {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'resources/list', params: {} });
    expect(r.status).toBe(401);
  });
});

describe('resources/templates/list', () => {
  it('returns URI templates for scoped verticals', async () => {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'resources/templates/list', params: {} }, token('read'));
    const templates = r.json.result.resourceTemplates.map((t: any) => t.uriTemplate);
    expect(templates).toContain('healthcare://records/{recordId}');
  });
});

describe('resources/read', () => {
  it('returns banking accounts content for banking:read token', async () => {
    const r = await post({
      jsonrpc: '2.0', id: 1, method: 'resources/read',
      params: { uri: 'banking://accounts' },
    }, token('banking:read'));
    expect(r.json.result.contents[0].mimeType).toBe('application/json');
    const data = JSON.parse(r.json.result.contents[0].text);
    expect(Array.isArray(data.accounts)).toBe(true);
  });

  it('returns -32005 for wrong scope', async () => {
    const r = await post({
      jsonrpc: '2.0', id: 1, method: 'resources/read',
      params: { uri: 'banking://accounts' },
    }, token('healthcare:read'));
    expect(r.json.error.code).toBe(-32005);
  });

  it('returns -32002 for unknown URI', async () => {
    const r = await post({
      jsonrpc: '2.0', id: 1, method: 'resources/read',
      params: { uri: 'unknown://foo' },
    }, token('banking:read'));
    expect(r.json.error.code).toBe(-32002);
  });

  it('returns healthcare records content', async () => {
    // view_records requires plain 'read' (scope-topology.json's real,
    // already-granted scope for this tool name) — not the invented
    // 'healthcare:read' the resource-server catalog entry used to declare.
    const r = await post({
      jsonrpc: '2.0', id: 1, method: 'resources/read',
      params: { uri: 'healthcare://records' },
    }, token('read'));
    const data = JSON.parse(r.json.result.contents[0].text);
    expect(Array.isArray(data.records)).toBe(true);
  });
});

describe('initialize capabilities', () => {
  it('advertises resources capability', async () => {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, token('banking:read'));
    expect(r.json.result.capabilities).toHaveProperty('resources');
    expect(r.json.result.capabilities.resources.subscribe).toBe(false);
  });
});
