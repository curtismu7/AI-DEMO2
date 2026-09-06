'use strict';

/**
 * GET /banking, /banking/:id — the X-API-Key backend-app REST mirror of
 * list_banking_accounts / get_banking_account, same pattern as /invest.
 * Exists so an OpenAPI-to-MCP importer has a real, callable REST surface to
 * point at (openapi/banking-rest.openapi.json documents it).
 */

import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-banking-http-'));
process.env.BANKING_DB_PATH = path.join(tmpDir, 'banking.db');
process.env.BANKING_SEED_PATH = path.join(__dirname, '..', 'seed', 'banking.seed.json');
process.env.AIRLINES_DB_PATH = path.join(tmpDir, 'airlines.db');
process.env.AIRLINES_SEED_PATH = path.join(__dirname, '..', 'seed', 'airlines.seed.json');
process.env.MCP_RESOURCE_SERVER_RESOURCE_URI = 'mcp-resource-server.ping.demo';
process.env.MCP_RESOURCE_SERVER_API_KEY = 'test-banking-api-key';
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

async function get(urlPath: string, apiKey?: string) {
  const res = await fetch(`${base}${urlPath}`, {
    headers: apiKey ? { 'X-API-Key': apiKey } : {},
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

describe('GET /banking', () => {
  it('401s with no X-API-Key', async () => {
    const r = await get('/banking');
    expect(r.status).toBe(401);
    expect(r.json.error).toBe('api_key_missing');
  });

  it('401s with the wrong X-API-Key', async () => {
    const r = await get('/banking', 'wrong-key');
    expect(r.status).toBe(401);
    expect(r.json.error).toBe('api_key_invalid');
  });

  it('returns the demo subject\'s accounts with a valid key', async () => {
    const r = await get('/banking', 'test-banking-api-key');
    expect(r.status).toBe(200);
    expect(r.json.count).toBe(3);
    expect(r.json.accounts.map((a: { id: string }) => a.id).sort()).toEqual(['acct-001', 'acct-002', 'acct-003']);
  });
});

describe('GET /banking/:id', () => {
  it('401s with no X-API-Key', async () => {
    const r = await get('/banking/acct-001');
    expect(r.status).toBe(401);
  });

  it('returns a single account with a valid key', async () => {
    const r = await get('/banking/acct-001', 'test-banking-api-key');
    expect(r.status).toBe(200);
    expect(r.json.found).toBe(true);
    expect(r.json.account.accountType).toBe('checking');
  });

  it('404s for an unknown account id', async () => {
    const r = await get('/banking/does-not-exist', 'test-banking-api-key');
    expect(r.status).toBe(404);
    expect(r.json.found).toBe(false);
  });
});

describe('GET /openapi/banking-rest.json', () => {
  it('serves the OpenAPI doc unauthenticated', async () => {
    const r = await get('/openapi/banking-rest.json');
    expect(r.status).toBe(200);
    expect(r.json.paths['/banking']).toBeDefined();
    expect(r.json.paths['/banking/{accountId}']).toBeDefined();
  });
});
