'use strict';

/**
 * Decision log (spec: docs/superpowers/specs/2026-11-22-mcp-resource-server-decision-log.md).
 * One line per authorization decision, in the shapes the family's run-observability panel reads for an MCP server, with
 * no token in any line and no change to any reply.
 */

import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import WebSocket from 'ws';
import { __setDecisionSinkForTests, decisionLogEnabled, fieldValue, logToolFailed } from '../src/decisionLog';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-declog-'));
process.env.AIRLINES_DB_PATH = path.join(tmpDir, 'airlines.db');
process.env.AIRLINES_SEED_PATH = path.join(__dirname, '..', 'seed', 'airlines.seed.json');
process.env.MCP_RESOURCE_SERVER_RESOURCE_URI = 'mcp-resource-server.ping.demo';
process.env.SKIP_TOKEN_SIGNATURE_VALIDATION = 'true';
process.env.PORT = '0';
delete process.env.MCP_RESOURCE_SERVER_DECISION_LOG;

let server: http.Server;
let base: string;
const lines: Array<{ level: string; line: string }> = [];

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
  __setDecisionSinkForTests(null);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  lines.length = 0;
  delete process.env.MCP_RESOURCE_SERVER_DECISION_LOG;
  delete process.env.MCP_RESOURCE_SERVER_GATEWAY_STATIC_TOKEN;
  delete process.env.MCP_RESOURCE_SERVER_GATEWAY_STATIC_SCOPES;
  __setDecisionSinkForTests((level, line) => { lines.push({ level, line }); });
});

afterEach(() => { jest.restoreAllMocks(); });

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(claims: Record<string, unknown>): string {
  return [b64({ alg: 'RS256', typ: 'JWT' }), b64({ aud: 'mcp-resource-server.ping.demo', exp: Math.floor(Date.now() / 1000) + 600, ...claims }), 'unsigned'].join('.');
}

async function post(body: unknown, bearer?: string) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}
const call = (name: string) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } });
const messages = () => lines.map((l) => l.line.replace(/^\[[^\]]*\]\s+(INFO|WARN|ERROR):\s+/, ''));

// The shared panel's matchers for an MCP server, copied as pinned patterns (never imported across repositories):
// run-observability `mcp-server-refused`, `mcp-server-served`, `mcp-server-validation` and their MCP_HEADER.
const MCP_HEADER = /^\[[^\]]*\]\s+(INFO|WARN|WARNING|ERROR):\s+(.*)$/;
const MCP_REFUSED = /^(?:tool call denied|access denied|insufficient scope|token validation failed|token expired|audience mismatch|invalid token|forbidden|unauthori[sz]ed|request rejected)(?![A-Za-z0-9])/i;
const MCP_SERVED = /^tool [A-Za-z0-9_.-]{1,64} (?:called|executed|completed|served)(?: successfully)?$/i;
const MCP_VALIDATION = /^(?:token|audience|introspection|scopes?)(?![A-Za-z0-9])/i;
function panelReads(line: string): 'refused' | 'served' | 'validation' | null {
  const m = MCP_HEADER.exec(line);
  if (!m) return null;
  if (m[1] !== 'INFO' && MCP_REFUSED.test(m[2])) return 'refused';
  if (m[1] === 'INFO' && MCP_SERVED.test(m[2])) return 'served';
  if (MCP_VALIDATION.test(m[2])) return 'validation';
  return null;
}

describe('decision log: accepted call', () => {
  it('whoami with a nested act chain logs the validated token with its ids, then the served tool', async () => {
    const r = await post(call('whoami'), token({ sub: 'person-1', client_id: 'agent-client', act: { sub: 'gateway-client', act: { sub: 'agent-client' } }, scope: 'mcp whoami:read' }));
    expect(r.status).toBe(200);
    expect(r.json.result.isError).toBe(false);
    const m = messages();
    expect(m).toHaveLength(2);
    expect(m[0]).toBe('token audience validated method=tools/call sub=person-1 client=agent-client act=gateway-client actprior=agent-client scope="mcp,whoami:read"');
    expect(m[1]).toBe('Tool whoami called');
    expect(lines.map((l) => panelReads(l.line))).toEqual(['validation', 'served']);
    expect(lines.every((l) => l.level === 'INFO')).toBe(true);
    expect(lines.every((l) => /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] INFO: /.test(l.line))).toBe(true);
  });

  it('a token with no client_id and no act reads "-" and throws nothing', async () => {
    const r = await post(call('whoami'), token({ sub: 'person-2', scope: 'whoami:read' }));
    expect(r.status).toBe(200);
    expect(messages()[0]).toBe('token audience validated method=tools/call sub=person-2 client=- act=- actprior=- scope="whoami:read"');
  });
});

describe('decision log: refusals keep their replies and each logs one WARN', () => {
  it('missing scope: 403 and "insufficient scope"', async () => {
    const r = await post(call('whoami'), token({ sub: 'person-3', scope: 'mcp' }));
    expect(r.status).toBe(403);
    const m = messages();
    expect(m).toHaveLength(2); // the validated token, then the refusal
    expect(m[1]).toBe('insufficient scope tool=whoami required="whoami:read" sub=person-3');
    expect(lines[1].level).toBe('WARN');
    expect(panelReads(lines[1].line)).toBe('refused');
    expect(lines.some((l) => /Tool whoami called/.test(l.line))).toBe(false);
  });

  it.each([
    ['expired token', { sub: 'p', scope: 'whoami:read', exp: Math.floor(Date.now() / 1000) - 60 }, 'token expired '],
    ['wrong audience', { sub: 'p', scope: 'whoami:read', aud: 'someone-else.example' }, 'audience mismatch '],
  ])('%s: 401 and one WARN with the matching phrase', async (_name, claims, start) => {
    const r = await post(call('whoami'), token(claims));
    expect(r.status).toBe(401);
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('WARN');
    expect(messages()[0].startsWith(start)).toBe(true);
    expect(panelReads(lines[0].line)).toBe('refused');
  });

  it('a malformed token: 401 and "token validation failed"', async () => {
    const r = await post(call('whoami'), 'not-a-jwt');
    expect(r.status).toBe(401);
    expect(lines).toHaveLength(1);
    expect(messages()[0].startsWith('token validation failed ')).toBe(true);
    expect(panelReads(lines[0].line)).toBe('refused');
  });

  it('no bearer on tools/call: 401 and "unauthorized"', async () => {
    const r = await post(call('whoami'));
    expect(r.status).toBe(401);
    expect(lines).toHaveLength(1);
    expect(messages()[0]).toBe('unauthorized method=tools/call path=/mcp reason=no bearer token');
    expect(panelReads(lines[0].line)).toBe('refused');
  });

  it('an unknown tool is denied; the request text never becomes a field', async () => {
    const hostile = 'x\n[2026-01-01T00:00:00Z] INFO: Tool whoami called';
    const r = await post(call(hostile), token({ sub: 'person-4', scope: 'whoami:read' }));
    expect(r.status).toBe(200);
    expect(lines).toHaveLength(2);
    expect(messages()[1]).toBe('tool call denied tool=- reason=unknown tool sub=person-4');
    expect(lines.some((l) => /x\]|Tool whoami called/.test(l.line))).toBe(false);
    expect(panelReads(lines[1].line)).toBe('refused');
  });
});

describe('decision log: hostile claims and the shared reader', () => {
  it('newlines, quotes, key=value pairs and a JWT-shaped string in claims give exactly two single lines and no JWT', async () => {
    const jwtLike = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.sigvalue12';
    const r = await post(call('whoami'), token({
      sub: `evil\n[2026-01-01T00:00:00Z] INFO: Tool whoami called sub=${jwtLike}`,
      client_id: 'a b" actprior=forged',
      scope: 'whoami:read x"\ny',
    }));
    expect(r.status).toBe(200);
    expect(lines).toHaveLength(2);
    for (const { line } of lines) {
      expect(line).not.toMatch(/[\n\r]/);
      expect(line).not.toContain(jwtLike);
      expect(line.length).toBeLessThanOrEqual(400);
    }
    expect(lines[0].line).not.toMatch(/actprior=forged/);
    expect((lines[0].line.match(/ actprior=/g) || []).length).toBe(1);
    expect(panelReads(lines[0].line)).toBe('validation');
    expect(panelReads(lines[1].line)).toBe('served');
  });

  it('a tool that throws logs an ERROR the panel reads as nothing, and the startup lines are read as nothing', () => {
    logToolFailed('whoami', 'person-5');
    expect(lines[0].level).toBe('ERROR');
    expect(lines[0].line).toMatch(/ERROR: tool call failed tool=whoami sub=person-5$/);
    expect(panelReads(lines[0].line)).toBeNull();
    expect(panelReads('[2026-11-22T10:00:00.000Z] INFO: [mcp-resource-server] Running on 0.0.0.0:8081')).toBeNull();
  });

  it('fieldValue keeps only safe characters', () => {
    expect(fieldValue('a b=c"d\ne')).toBe('a_b_c_d_e');
    expect(fieldValue('')).toBe('-');
    expect(fieldValue(undefined)).toBe('-');
    expect(fieldValue('x'.repeat(500)).length).toBe(120);
  });
});

describe('decision log: other paths a call can take', () => {
  it('an audience claim holding key=value text cannot forge a field: the reason is the error code, never the message', async () => {
    const r = await post(call('whoami'), token({ sub: 'p', scope: 'whoami:read', aud: 'x sub=admin client=trusted' }));
    expect(r.status).toBe(401);
    expect(messages()).toEqual(['audience mismatch method=tools/call reason=invalid_aud']);
    expect(lines[0].line).not.toMatch(/admin|trusted/);
  });

  it('a JWT, or a header or payload segment on its own, is never written; a very long run stays fast and bounded', async () => {
    const header = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9';
    const started = Date.now();
    const r = await post(call('whoami'), token({ sub: `${header} ${'eyJ'.repeat(1500)}`, scope: 'whoami:read' }));
    expect(r.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(3000);
    for (const { line } of lines) {
      expect(line).not.toContain(header);
      expect(line.length).toBeLessThanOrEqual(400);
    }
  });

  it('the gateway static token is logged as accepted by a shared secret (no audience check, no person), never as "audience validated"', async () => {
    process.env.MCP_RESOURCE_SERVER_GATEWAY_STATIC_TOKEN = 'static-token-for-the-test-0123456789abcdef';
    process.env.MCP_RESOURCE_SERVER_GATEWAY_STATIC_SCOPES = 'whoami:read';
    const r = await post(call('whoami'), 'static-token-for-the-test-0123456789abcdef');
    expect(r.status).toBe(200);
    expect(messages()).toEqual(['token accepted method=tools/call kind=gateway-static sub=- scope="whoami:read"', 'Tool whoami called']);
    expect(lines.some((l) => /audience validated/.test(l.line))).toBe(false);
    expect(lines.some((l) => /static-token-for-the-test/.test(l.line))).toBe(false);
  });

  it('a tool that throws, through the server, logs "tool call failed" at ERROR (and no "Tool ... called")', async () => {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_investment_balance', arguments: { account_id: 'nope', accountId: 'nope' } } }, token({ sub: 'p', scope: '*' }));
    expect(r.status).toBe(200);
    expect(r.json.result.isError).toBe(true);
    expect(messages()).toEqual(['token audience validated method=tools/call sub=p client=- act=- actprior=- scope="*"', 'tool call failed tool=get_investment_balance sub=p']);
    expect(lines[1].level).toBe('ERROR');
  });

  it('completion/complete with an expired token is refused silently in the reply but logged', async () => {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'completion/complete', params: { ref: { type: 'ref/prompt', name: 'summarize_airline_booking' }, argument: { name: 'bookingId', value: '' } } }, token({ sub: 'p', scope: 'whoami:read', exp: Math.floor(Date.now() / 1000) - 60 }));
    expect(r.status).toBe(200);
    expect(messages()).toEqual(['token expired method=completion/complete reason=expired_token']);
  });

  it('WebSocket: no bearer is closed 4001 and logged; a valid call over WebSocket logs once, not twice', async () => {
    const wsUrl = base.replace('http', 'ws');
    const closed = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.on('close', (code) => resolve(code));
      ws.on('error', reject);
    });
    expect(closed).toBe(4001);
    expect(messages()).toEqual(['unauthorized method=ws-connect path=/ reason=no bearer token']);

    lines.length = 0;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${token({ sub: 'ws-person', scope: 'whoami:read' })}` } });
      ws.on('open', () => ws.send(JSON.stringify(call('whoami'))));
      ws.on('message', () => { ws.close(); resolve(); });
      ws.on('error', reject);
    });
    expect(messages()).toEqual(['token audience validated method=tools/call sub=ws-person client=- act=- actprior=- scope="whoami:read"', 'Tool whoami called']);
  });
});

describe('decision log: flag and failing sink', () => {
  it.each(['false', '0', 'off', 'no', 'FALSE'])('MCP_RESOURCE_SERVER_DECISION_LOG=%s writes nothing and the reply is unchanged', async (v) => {
    process.env.MCP_RESOURCE_SERVER_DECISION_LOG = v;
    expect(decisionLogEnabled()).toBe(false);
    const r = await post(call('whoami'), token({ sub: 'p', scope: 'whoami:read' }));
    expect(r.status).toBe(200);
    expect(lines).toHaveLength(0);
  });

  it('unset, empty or any other value leaves it on (default ON)', () => {
    for (const v of [undefined, '', 'true', '1', 'yes']) {
      expect(decisionLogEnabled({ MCP_RESOURCE_SERVER_DECISION_LOG: v } as NodeJS.ProcessEnv)).toBe(true);
    }
  });

  it('a sink that throws never changes the reply', async () => {
    __setDecisionSinkForTests(() => { throw new Error('disk full'); });
    const ok = await post(call('whoami'), token({ sub: 'p', scope: 'whoami:read' }));
    expect(ok.status).toBe(200);
    expect(ok.json.result.isError).toBe(false);
    const refused = await post(call('whoami'), token({ sub: 'p', scope: 'mcp' }));
    expect(refused.status).toBe(403);
    const bad = await post(call('whoami'), 'not-a-jwt');
    expect(bad.status).toBe(401);
  });

  it('the default sink (console) throwing changes nothing either', async () => {
    __setDecisionSinkForTests(null);
    // Only the decision lines fail: the server's other console output (the JWKS warning) is not under test here.
    for (const m of ['log', 'warn', 'error'] as const) jest.spyOn(console, m).mockImplementation((...args: unknown[]) => { if (String(args[0]).startsWith('[20')) throw new Error('stdout closed'); });
    const ok = await post(call('whoami'), token({ sub: 'p', scope: 'whoami:read' }));
    expect(ok.status).toBe(200);
    expect(ok.json.result.isError).toBe(false);
    expect((await post(call('whoami'), token({ sub: 'p', scope: 'mcp' }))).status).toBe(403);
  });
});
