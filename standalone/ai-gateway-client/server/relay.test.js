'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DOOR_STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-gateway-client-test-'));
process.env.GATEWAY_ENV_PATH = path.join(process.env.DOOR_STORE_DIR, 'gateway.env');

const http = require('http');
const express = require('express');
const relay = require('./lib/relay');

function startServer() {
  const app = express();
  app.use('/api/gateway', relay);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function withServer(fn) {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    relay.__test.reset();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function startMockMcpServer(handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rpc = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    requests.push({ pathname, rpc, authorization: req.headers.authorization });

    const outcome = await handler({ pathname, rpc, authorization: req.headers.authorization });
    const status = outcome.status || 200;
    res.statusCode = status;
    res.setHeader('Content-Type', typeof outcome.body === 'string' ? 'text/plain' : 'application/json');
    if (outcome.body !== undefined) {
      res.end(typeof outcome.body === 'string' ? outcome.body : JSON.stringify(outcome.body));
      return;
    }
    res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: outcome.result || {} }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function withMockMcpServer(handler, fn) {
  const mock = await startMockMcpServer(handler);
  try {
    await fn(mock.base, mock.requests);
  } finally {
    await mock.close();
  }
}

async function configureDoor(base, { gatewayMode = 'privilege', mcpUrl }, authorization) {
  return fetch(`${base}/api/gateway/config`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify({ gatewayMode, mcpUrl }),
  });
}

function modernDiscovery(capabilities = { tools: {} }) {
  return {
    supportedVersions: ['2026-07-28'],
    capabilities,
    _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'Mock Privilege Gateway', version: '1' } },
  };
}

test('GET /state defaults to privilege mode with a Privilege door preset', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/gateway/state`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.gatewayMode, 'privilege');
    assert.ok(body.presets.some((p) => p.mode === 'privilege' && p.url.includes('/mcp')));
    assert.equal(body.oauth.authenticated, false);
  });
});

test('Privilege presets include the MCP Aggregate app door', async () => {
  await withServer(async (base) => {
    const body = await (await fetch(`${base}/api/gateway/state`)).json();
    const aggregate = body.presets.find((p) => p.label === 'Privilege — aggregate');
    assert.ok(aggregate, 'no Privilege aggregate preset in /state');
    assert.equal(aggregate.url, 'https://mcpgw.ai-demo.ping-devops.com/aggregate/mcp');
  });
});

test('Privilege presets include the libre hostile-server door', async () => {
  await withServer(async (base) => {
    const body = await (await fetch(`${base}/api/gateway/state`)).json();
    const libre = body.presets.find((p) => p.label === 'Privilege — libre');
    assert.ok(libre, 'no Privilege libre preset in /state');
    assert.equal(libre.url, 'https://mcpgw.ai-demo.ping-devops.com/libre/mcp');
  });
});

test('Direct mode ships the opensearch default, Brave, and hostile-MCP siblings at their exact URLs', async () => {
  await withServer(async (base) => {
    const body = await (await fetch(`${base}/api/gateway/state`)).json();
    const directPresets = body.presets.filter((p) => p.mode === 'direct');
    assert.equal(directPresets.length, 3, 'expected exactly 3 Direct presets (opensearch default + Brave + Hostile MCP)');

    const opensearch = directPresets.find((p) => p.label === '2 · Direct — no Privilege in the path');
    assert.ok(opensearch, 'no Direct opensearch-default preset in /state');
    assert.equal(opensearch.url, 'https://ai-demo.ping-devops.com/mcp-facade/opensearch/mcp');

    const brave = directPresets.find((p) => p.label === 'Direct — Brave Search');
    assert.ok(brave, 'no Direct Brave preset in /state — regressed, the new sibling disappeared');
    assert.equal(brave.url, 'https://ai-demo.ping-devops.com/mcp-facade/brave/mcp');

    const hostile = directPresets.find((p) => p.label === 'Direct — Hostile MCP (no Privilege)');
    assert.ok(hostile, 'no Direct Hostile MCP preset in /state');
    assert.equal(hostile.url, 'http://127.0.0.1:8899/');
  });
});

test('DIRECT_MCP_URL and DIRECT_BRAVE_MCP_URL override the Direct presets independently', async () => {
  const prevMcp = process.env.DIRECT_MCP_URL;
  const prevBrave = process.env.DIRECT_BRAVE_MCP_URL;
  process.env.DIRECT_MCP_URL = 'https://example.com/custom-opensearch/mcp';
  process.env.DIRECT_BRAVE_MCP_URL = 'https://example.com/custom-brave/mcp';
  try {
    await withServer(async (base) => {
      const body = await (await fetch(`${base}/api/gateway/state`)).json();
      const directPresets = body.presets.filter((p) => p.mode === 'direct');
      assert.equal(directPresets.length, 3);
      assert.equal(
        directPresets.find((p) => p.label === '2 · Direct — no Privilege in the path').url,
        'https://example.com/custom-opensearch/mcp',
      );
      assert.equal(
        directPresets.find((p) => p.label === 'Direct — Brave Search').url,
        'https://example.com/custom-brave/mcp',
      );
    });
  } finally {
    if (prevMcp === undefined) delete process.env.DIRECT_MCP_URL; else process.env.DIRECT_MCP_URL = prevMcp;
    if (prevBrave === undefined) delete process.env.DIRECT_BRAVE_MCP_URL; else process.env.DIRECT_BRAVE_MCP_URL = prevBrave;
  }
});

test('POST /config switches mode and persists a per-door mcpUrl', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/gateway/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gatewayMode: 'direct', mcpUrl: 'https://example.com/mcp' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.gatewayMode, 'direct');
    assert.equal(body.config.mcpUrl, 'https://example.com/mcp');

    const state = await (await fetch(`${base}/api/gateway/state`)).json();
    assert.equal(state.gatewayMode, 'direct');
    assert.equal(state.config.mcpUrl, 'https://example.com/mcp');
  });
});

test('tools/list and tools/call 401 without a token', async () => {
  await withServer(async (base) => {
    const list = await fetch(`${base}/api/gateway/tools/list`, { method: 'POST' });
    assert.equal(list.status, 401);
    const call = await fetch(`${base}/api/gateway/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'echo', arguments: {} }),
    });
    assert.equal(call.status, 401);
  });
});

test('tools/list separates permitted tools from gateway-filtered tools', async () => {
  await withMockMcpServer(({ rpc }) => {
    if (rpc.method === 'server/discover') return { result: modernDiscovery() };
    if (rpc.method === 'tools/list') {
      return {
        result: {
          tools: [{ name: 'opensearch__search', description: 'Search records' }],
          _meta: {
            deniedTools: [{ name: 'opensearch__delete', deniedReason: 'scope_missing' }],
          },
        },
      };
    }
    return { status: 400, body: `Unexpected MCP method: ${rpc.method}` };
  }, async (mcpBase, requests) => {
    await withServer(async (base) => {
      await configureDoor(base, { mcpUrl: `${mcpBase}/aggregate/mcp` });
      const response = await fetch(`${base}/api/gateway/tools/list`, {
        method: 'POST',
        headers: { Authorization: 'Bearer demo-agent-token' },
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(body.tools.map((tool) => tool.name), ['opensearch__search']);
      assert.deepEqual(body.policy, {
        total: 2,
        permitted: 1,
        filtered: 1,
        filteredTools: [{ name: 'opensearch__delete', reason: 'scope_missing' }],
      });
      assert.ok(requests.every((request) => request.authorization === 'Bearer demo-agent-token'));
    });
  });
});

test('doors/probe uses one agent token and keeps denied, unauthenticated, and unavailable doors distinct', async () => {
  await withMockMcpServer(({ pathname, rpc }) => {
    if (pathname === '/denied/mcp') return { status: 403, body: 'Forbidden by gateway policy' };
    if (pathname === '/unauthenticated/mcp') return { status: 401, body: 'Bearer token rejected' };
    if (pathname === '/unavailable/mcp') return { status: 503, body: 'Gateway unavailable' };
    if (rpc.method === 'server/discover') return { result: modernDiscovery() };
    if (rpc.method === 'tools/list') return { result: { tools: [{ name: 'search' }, { name: 'read_record' }] } };
    return { status: 400, body: `Unexpected MCP method: ${rpc.method}` };
  }, async (mcpBase, requests) => {
    await withServer(async (base) => {
      await configureDoor(base, { mcpUrl: `${mcpBase}/current/mcp` });
      const response = await fetch(`${base}/api/gateway/doors/probe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer same-agent-token',
        },
        body: JSON.stringify({
          urls: [
            `${mcpBase}/allowed/mcp`,
            `${mcpBase}/denied/mcp`,
            `${mcpBase}/unauthenticated/mcp`,
            `${mcpBase}/unavailable/mcp`,
          ],
        }),
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(body.results.map(({ ok, status, tools }) => ({ ok, status, tools })), [
        { ok: true, status: undefined, tools: 2 },
        { ok: false, status: 403, tools: undefined },
        { ok: false, status: 401, tools: undefined },
        { ok: false, status: 500, tools: undefined },
      ]);
      assert.equal(requests.length, 5);
      assert.ok(requests.every((request) => request.authorization === 'Bearer same-agent-token'));
    });
  });
});

test('a denied Privilege tool call does not fall back to the Direct door', async () => {
  let backendCalls = 0;
  await withMockMcpServer(({ pathname, rpc }) => {
    if (rpc.method === 'server/discover') return { result: modernDiscovery() };
    if (rpc.method === 'tools/call' && pathname === '/privilege/deny/mcp') {
      return { status: 403, body: 'Forbidden by gateway policy' };
    }
    if (rpc.method === 'tools/call' && pathname === '/direct/mcp') {
      backendCalls += 1;
      return { result: { content: [{ type: 'text', text: 'Demo transfer completed' }] } };
    }
    if (rpc.method === 'tools/list') return { result: { tools: [{ name: 'create_transfer' }] } };
    return { status: 400, body: `Unexpected MCP request: ${rpc.method}` };
  }, async (mcpBase, requests) => {
    await withServer(async (base) => {
      const token = 'Bearer same-agent-token';
      await configureDoor(base, { gatewayMode: 'direct', mcpUrl: `${mcpBase}/direct/mcp` }, token);
      const directResponse = await fetch(`${base}/api/gateway/tools/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token },
        body: JSON.stringify({ name: 'create_transfer', arguments: { amount: 10 } }),
      });
      assert.equal(directResponse.status, 200);

      await configureDoor(base, { gatewayMode: 'privilege', mcpUrl: `${mcpBase}/privilege/deny/mcp` }, token);
      const deniedResponse = await fetch(`${base}/api/gateway/tools/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token },
        body: JSON.stringify({ name: 'create_transfer', arguments: { amount: 10 } }),
      });
      const deniedBody = await deniedResponse.json();

      assert.equal(deniedResponse.status, 403);
      assert.match(deniedBody.error, /403 Forbidden by gateway policy/);
      assert.equal(backendCalls, 1);
      assert.deepEqual(requests.map(({ pathname, rpc }) => [pathname, rpc.method]), [
        ['/direct/mcp', 'server/discover'],
        ['/direct/mcp', 'tools/call'],
        ['/privilege/deny/mcp', 'server/discover'],
        ['/privilege/deny/mcp', 'tools/call'],
      ]);
      assert.ok(requests.every((request) => request.authorization === token));
    });
  });
});

test('aggregate door preserves member namespaces in tool discovery and calls', async () => {
  await withMockMcpServer(({ pathname, rpc }) => {
    if (pathname !== '/aggregate/mcp') return { status: 404, body: 'Unknown aggregate door' };
    if (rpc.method === 'server/discover') return { result: modernDiscovery() };
    if (rpc.method === 'tools/list') {
      return {
        result: {
          tools: [
            { name: 'opensearch__search' },
            { name: 'banking-mcp__show_balance' },
          ],
        },
      };
    }
    if (rpc.method === 'tools/call') {
      return { result: { content: [{ type: 'text', text: `Called ${rpc.params.name}` }] } };
    }
    return { status: 400, body: `Unexpected MCP method: ${rpc.method}` };
  }, async (mcpBase, requests) => {
    await withServer(async (base) => {
      const token = 'Bearer aggregate-agent-token';
      await configureDoor(base, { mcpUrl: `${mcpBase}/aggregate/mcp` }, token);
      const listedResponse = await fetch(`${base}/api/gateway/tools/list`, {
        method: 'POST',
        headers: { Authorization: token },
      });
      const listed = await listedResponse.json();
      const callResponse = await fetch(`${base}/api/gateway/tools/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token },
        body: JSON.stringify({ name: 'banking-mcp__show_balance', arguments: {} }),
      });
      const call = await callResponse.json();

      assert.equal(listedResponse.status, 200);
      assert.deepEqual(listed.tools.map((tool) => tool.name), [
        'opensearch__search',
        'banking-mcp__show_balance',
      ]);
      assert.equal(callResponse.status, 200);
      assert.equal(call.result.content[0].text, 'Called banking-mcp__show_balance');
      assert.equal(requests.at(-1).rpc.params.name, 'banking-mcp__show_balance');
    });
  });
});

test('catalog discovers permitted prompts and resources while denied invocations retain 403', async () => {
  await withMockMcpServer(({ rpc }) => {
    if (rpc.method === 'server/discover') {
      return { result: modernDiscovery({ prompts: {}, resources: {} }) };
    }
    if (rpc.method === 'prompts/list') {
      return { result: { prompts: [{ name: 'account_summary' }] } };
    }
    if (rpc.method === 'resources/list') {
      return { result: { resources: [{ uri: 'bank://accounts/current', name: 'Current accounts' }] } };
    }
    if (rpc.method === 'resources/templates/list') {
      return { result: { resourceTemplates: [{ uriTemplate: 'bank://accounts/{id}' }] } };
    }
    if (rpc.method === 'prompts/get' || rpc.method === 'resources/read') {
      return { status: 403, body: 'Forbidden by gateway policy' };
    }
    return { status: 400, body: `Unexpected MCP method: ${rpc.method}` };
  }, async (mcpBase, requests) => {
    await withServer(async (base) => {
      const token = 'Bearer same-agent-token';
      await configureDoor(base, { mcpUrl: mcpBase }, token);

      const catalogResponse = await fetch(`${base}/api/gateway/catalog`, {
        headers: { Authorization: token },
      });
      const catalog = await catalogResponse.json();
      assert.equal(catalogResponse.status, 200);
      assert.deepEqual(catalog.prompts.map(({ name }) => name), ['account_summary']);
      assert.deepEqual(catalog.resources.map(({ uri }) => uri), ['bank://accounts/current']);
      assert.deepEqual(catalog.resourceTemplates.map(({ uriTemplate }) => uriTemplate), ['bank://accounts/{id}']);
      assert.deepEqual(catalog.errors, []);

      const promptResponse = await fetch(`${base}/api/gateway/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token },
        body: JSON.stringify({ method: 'prompts/get', params: { name: 'account_summary' } }),
      });
      const promptError = await promptResponse.json();
      const resourceResponse = await fetch(`${base}/api/gateway/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token },
        body: JSON.stringify({ method: 'resources/read', params: { uri: 'bank://accounts/current' } }),
      });
      const resourceError = await resourceResponse.json();

      assert.equal(promptResponse.status, 403);
      assert.match(promptError.error, /403 Forbidden by gateway policy/);
      assert.equal(resourceResponse.status, 403);
      assert.match(resourceError.error, /403 Forbidden by gateway policy/);
      const invocationRequests = requests.filter(({ rpc }) => ['prompts/get', 'resources/read'].includes(rpc.method));
      assert.deepEqual(
        invocationRequests.map(({ rpc }) => [
          rpc.method,
          Object.fromEntries(Object.entries(rpc.params).filter(([key]) => key !== '_meta')),
        ]),
        [
          ['prompts/get', { name: 'account_summary' }],
          ['resources/read', { uri: 'bank://accounts/current' }],
        ],
      );
      assert.ok(invocationRequests.every(
        ({ rpc }) => rpc.params._meta['io.modelcontextprotocol/protocolVersion'] === '2026-07-28',
      ));
      assert.ok(requests.every((request) => request.authorization === token));
    });
  });
});

test('a Bearer token on any request seeds session.oauth so tools/list is no longer 401-blocked on auth', async () => {
  await withServer(async (base) => {
    // Point at an unreachable URL so the call fails at the network hop, not
    // the auth guard — proves the guard passed.
    await fetch(`${base}/api/gateway/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gatewayMode: 'direct', mcpUrl: 'http://127.0.0.1:1' }),
    });
    const res = await fetch(`${base}/api/gateway/tools/list`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token-123' },
    });
    assert.notEqual(res.status, 401);
  });
});

test('GET/PUT /env round-trips allowed keys and merges rather than overwriting', async () => {
  await withServer(async (base) => {
    await fetch(`${base}/api/gateway/env`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vars: { OIDC_CLIENT_ID: 'abc', not_allowed: 'x' } }),
    });
    const first = await (await fetch(`${base}/api/gateway/env`)).json();
    assert.equal(first.vars.OIDC_CLIENT_ID, 'abc');
    assert.equal(first.vars.not_allowed, undefined);

    await fetch(`${base}/api/gateway/env`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vars: { OIDC_CLIENT_SECRET: 'shh' } }),
    });
    const second = await (await fetch(`${base}/api/gateway/env`)).json();
    // Previously written key survives a partial update.
    assert.equal(second.vars.OIDC_CLIENT_ID, 'abc');
    assert.equal(second.vars.OIDC_CLIENT_SECRET, 'shh');
  });
});

test('POST /console/connect requires an authToken', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/gateway/console/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });
});

// Stands in for console.privilege.pingone.com so consoleInventory's reads
// (session-token, applications, pacpolicys) resolve without a live console.
function startMockConsole() {
  const server = http.createServer((req, res) => {
    const send = (body) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
    if (req.url === '/session-token') return send({ session_id: 'sid-1' });
    if (req.url.includes('/v1/applications')) {
      return send({
        Applications: [{
          ObjectMeta: { Name: 'cmuir' },
          Spec: {
            McpAppConfig: {
              Backends: { Elems: ['http://mcp-server:8080/mcp'] },
              AuthMode: 'OAuth',
              AIGuardConfig: { Enabled: true, FailClosed: true },
            },
          },
          Status: {
            McpServerStatus: {
              Status: 'Ready',
              LastDiscoveredAt: '2026-09-10T12:00:00Z',
              Transport: 'streamable-http',
              Capabilities: { Tools: [{ name: 'search' }, { name: 'get_user' }] },
            },
          },
        }],
      });
    }
    if (req.url.includes('/v1/pacpolicys')) {
      return send({
        PacPolicys: [
          { ObjectMeta: { Name: 'cmuir-tools' }, Spec: { Apps: ['cmuir'] }, NotAfter: '2020-01-01T00:00:00Z' },
          // Go's zero time: the console's "not set", must not read as expired.
          { ObjectMeta: { Name: 'other' }, Spec: {}, NotAfter: '0001-01-01T00:00:00Z' },
        ],
      });
    }
    res.statusCode = 404;
    send({});
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

test('console/connect carries the 2026-09 spec fields: tools, discovery, auth mode, AI Guard, policy expiry', async () => {
  const mockConsole = await startMockConsole();
  const prevConsoleUrl = process.env.PRIVILEGE_CONSOLE_URL;
  const prevEnvId = process.env.PRIVILEGE_CONSOLE_ENV_ID;
  process.env.PRIVILEGE_CONSOLE_URL = `http://127.0.0.1:${mockConsole.address().port}`;
  process.env.PRIVILEGE_CONSOLE_ENV_ID = 'test-env-id';
  try {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/gateway/console/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authToken: 'console-cookie-value' }),
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.deepEqual(
        { tools: body.applications[0].tools, lastDiscoveredAt: body.applications[0].lastDiscoveredAt, transport: body.applications[0].transport, authMode: body.applications[0].authMode, aiGuard: body.applications[0].aiGuard },
        { tools: ['search', 'get_user'], lastDiscoveredAt: '2026-09-10T12:00:00.000Z', transport: 'streamable-http', authMode: 'OAuth', aiGuard: { enabled: true, failClosed: true } },
      );
      assert.equal(body.policies[0].notAfter, '2020-01-01T00:00:00.000Z');
      assert.equal(body.policies[1].notAfter, null);
    });
  } finally {
    if (prevConsoleUrl === undefined) delete process.env.PRIVILEGE_CONSOLE_URL; else process.env.PRIVILEGE_CONSOLE_URL = prevConsoleUrl;
    if (prevEnvId === undefined) delete process.env.PRIVILEGE_CONSOLE_ENV_ID; else process.env.PRIVILEGE_CONSOLE_ENV_ID = prevEnvId;
    await new Promise((resolve) => mockConsole.close(resolve));
  }
});
