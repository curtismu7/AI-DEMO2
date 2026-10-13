/**
 * adminLbStatsView.test.js — the /stats-view proxy on the LB runtime route.
 *
 * The iframe points HERE, not at HAProxy directly: the demo's PingOne session
 * (admin-gated on the mount) replaces the browser basic-auth prompt, and the
 * stats credential lives only in the BFF env. The proxy fetches the page from
 * the LB frontend, rewrites HAProxy's absolute /lb-stats* hrefs to the proxy
 * path, and forwards the Refresh header so the 5s auto-refresh keeps working
 * inside the iframe.
 */
'use strict';

const http = require('http');
const express = require('express');

const LB_PORT = 19911;

// Minimal HAProxy stats page: title, absolute hrefs, Refresh header.
const STATS_HTML = [
  '<html><head><title>Statistics Report for HAProxy</title></head>',
  '<body><h1>gateways</h1>',
  '<a href="/lb-stats">back</a>',
  '<a href="/lb-stats;csv;norefresh">csv</a>',
  '<a href="#gateways/gateway-1">anchor</a>',
  '</body></html>',
].join('\n');

let seen = { path: null, auth: null };

function startFakeLb() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      seen.path = req.url;
      seen.auth = req.headers.authorization || null;
      if (req.headers.authorization !== 'Basic YWRtaW46cHc=') {
        // admin:pw
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="HAProxy"' });
        return res.end('unauthorized');
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', refresh: '5' });
      res.end(STATS_HTML);
    });
    server.listen(LB_PORT, '127.0.0.1', () => resolve(server));
  });
}

let app;
let server;

beforeAll(async () => {
  server = await startFakeLb();
  process.env.MCPGW_LB_STATS_URL = `http://127.0.0.1:${LB_PORT}/lb-stats`;
  process.env.MCPGW_LB_STATS_AUTH = 'Basic YWRtaW46cHc=';
  app = express();
  app.use('/api/admin/lb/runtime', require('../routes/adminLbRuntime').router);
  await new Promise((r) => (server2 = http.createServer(app).listen(0, '127.0.0.1', r)));
});

let server2;

afterAll(async () => {
  await Promise.all([
    new Promise((r) => server.close(r)),
    new Promise((r) => server2.close(r)),
  ]);
});

function request(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server2.address().port, path, agent: false }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

describe('GET /stats-view', () => {
  beforeEach(() => {
    seen = { path: null, auth: null };
  });

  it('proxies the stats page with the configured credential and rewrites absolute hrefs', async () => {
    const res = await request('/api/admin/lb/runtime/stats-view');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['refresh']).toBe('5');
    expect(seen.auth).toBe('Basic YWRtaW46cHc=');
    expect(res.body).toContain('/api/admin/lb/runtime/stats-view"');
    expect(res.body).toContain('/api/admin/lb/runtime/stats-view;csv;norefresh"');
    // anchors (non-absolute) stay untouched
    expect(res.body).toContain('href="#gateways/gateway-1"');
    expect(res.body).not.toContain('href="/lb-stats"');
  });

  it('csv variant: appends the ;csv suffix on the proxied request', async () => {
    const res = await request('/api/admin/lb/runtime/stats-view;csv');
    expect(res.status).toBe(200);
    expect(seen.path).toBe('/lb-stats;csv');
  });

  it('credential unset: 503 with a name, not a crash', async () => {
    const saved = process.env.MCPGW_LB_STATS_AUTH;
    delete process.env.MCPGW_LB_STATS_AUTH;
    const res = await request('/api/admin/lb/runtime/stats-view');
    process.env.MCPGW_LB_STATS_AUTH = saved;
    expect(res.status).toBe(503);
    expect(res.body).toContain('MCPGW_LB_STATS_AUTH');
  });

  it('upstream 401: surfaced as 502, no credential leak in the body', async () => {
    const saved = process.env.MCPGW_LB_STATS_AUTH;
    process.env.MCPGW_LB_STATS_AUTH = 'Basic d3Jvbmc6cHc='; // wrong:pw
    const res = await request('/api/admin/lb/runtime/stats-view');
    process.env.MCPGW_LB_STATS_AUTH = saved;
    expect(res.status).toBe(502);
    expect(res.body).not.toContain('d3Jvbmc');
  });
});
