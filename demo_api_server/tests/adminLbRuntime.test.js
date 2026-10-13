/**
 * adminLbRuntime.test.js — the mcpgw-lb runtime park/unpark route.
 *
 * HAProxy's runtime API is a line protocol on a TCP socket. The route fans
 * every command out to BOTH LB pods (a headless Service DNS returns both pod
 * IPs) — park state must agree across pods or the two pods' pinning/health
 * state diverges (GATEWAY-LOAD-BALANCER.md's invariant).
 *
 * The fake HAProxy socket below answers `show stat` with a minimal CSV (one
 * row for the gateways backend plus one per server) and records disable/
 * enable commands per connection.
 */
'use strict';

const net = require('net');
const http = require('http');
const express = require('express');
const { EventEmitter } = require('events');

// The route under test. Hoisted so the fake socket ports are knowable first.
const SOCK_PORTS = [19901, 19902];
let route;
beforeAll(() => {
  process.env.MCPGW_LB_RUNTIME_SOCKETS = SOCK_PORTS.map((p) => `127.0.0.1:${p}`).join(',');
  route = require('../routes/adminLbRuntime').router;
});

const FAKE_CSV = [
  '# pxname,svname,status,scur,smax,slim',
  'gateways,FRONTEND,OPEN,1,3,4096',
  'gateways,gateway-1,UP,2,4,-1',
  'gateways,gateway-2,UP,1,2,-1',
  'gateways,gateway-3,MAINT,0,0,-1',
  'health,FRONTEND,OPEN,0,1,4096',
].join('\n') + '\n';

const seen = { 19901: [], 19902: [] };

function startFakeHaproxy(port) {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.on('data', (buf) => {
        const cmd = buf.toString().trim();
        seen[port].push(cmd);
        if (cmd === 'show stat') {
          socket.end(FAKE_CSV);
        } else if (/^(disable|enable) server /.test(cmd)) {
          socket.end(cmd + '\n');
        } else {
          socket.end('');
        }
      });
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

let servers;

beforeEach(async () => {
  seen[19901] = [];
  seen[19902] = [];
  servers = await Promise.all(SOCK_PORTS.map(startFakeHaproxy));
});

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
});

function makeApp() {
  const app = express();
  app.use(express.json());
  // Mounted at the path the helper requests, exactly as server.js mounts it.
  app.use('/', route);
  return app;
}

function request(app, method, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      // agent: false — keep-alive on the default global agent would hold the
      // socket open and make app.close() wait forever in afterEach.
      { host: '127.0.0.1', port: app.address().port, method, path, agent: false, headers: { 'content-type': 'application/json' } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let parsed = null;
          try { parsed = data ? JSON.parse(data) : null; } catch { /* Express HTML errors */ }
          resolve({ status: res.statusCode, body: parsed, text: data });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let app;

beforeEach(async () => {
  app = http.createServer(makeApp());
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
});

afterEach(async () => {
  await new Promise((r) => app.close(r));
});

describe('GET / (runtime state)', () => {
  it('returns one row per gateway node with status and sessions, from both pods', async () => {
    const res = await request(app, 'GET', '/');
    expect(res.status).toBe(200);
    expect(res.body.nodes).toEqual([
      { name: 'gateway-1', status: 'UP', sessions: 2 },
      { name: 'gateway-2', status: 'UP', sessions: 1 },
      { name: 'gateway-3', status: 'MAINT', sessions: 0 },
    ]);
  });

  it('fans the show stat command out to both pods', async () => {
    await request(app, 'GET', '/');
    expect(seen[19901]).toContain('show stat');
    expect(seen[19902]).toContain('show stat');
  });

  it('one pod unreachable: reports it instead of failing the whole read', async () => {
    await new Promise((r) => servers[1].close(r));
    const res = await request(app, 'GET', '/');
    expect(res.status).toBe(200);
    expect(res.body.errors.length).toBe(1);
    expect(res.body.nodes).toEqual([
      { name: 'gateway-1', status: 'UP', sessions: 2 },
      { name: 'gateway-2', status: 'UP', sessions: 1 },
      { name: 'gateway-3', status: 'MAINT', sessions: 0 },
    ]);
  });
});

describe('POST /:node/park and /unpark — disable/enable fan-out to both pods', () => {
  it('park: sends disable server gateways/<node> to both pods', async () => {
    const res = await request(app, 'POST', '/gateway-2/park');
    expect(res.status).toBe(200);
    expect(seen[19901]).toContain('disable server gateways/gateway-2');
    expect(seen[19902]).toContain('disable server gateways/gateway-2');
  });

  it('unpark: sends enable server gateways/<node> to both pods', async () => {
    const res = await request(app, 'POST', '/gateway-2/unpark');
    expect(res.status).toBe(200);
    expect(seen[19901]).toContain('enable server gateways/gateway-2');
    expect(seen[19902]).toContain('enable server gateways/gateway-2');
  });

  it('unknown node: 404, and no park/unpark command reaches the pods', async () => {
    const res = await request(app, 'POST', '/gateway-9/park');
    expect(res.status).toBe(404);
    // The membership lookup reads state (show stat) but never mutates.
    expect(seen[19901].some((c) => /^(disable|enable) server/.test(c))).toBe(false);
    expect(seen[19902].some((c) => /^(disable|enable) server/.test(c))).toBe(false);
  });

  it('node name is sanitized: path trickery does not inject commands', async () => {
    const res = await request(app, 'POST', '/gateway-2%0Adisable%20server%20gateways%2Fgateway-1/park');
    expect(res.status).toBe(404);
    expect(seen[19901].every((c) => /^(show stat|disable server gateways\/[\w.-]+|enable server gateways\/[\w.-]+)$/.test(c))).toBe(true);
  });
});
