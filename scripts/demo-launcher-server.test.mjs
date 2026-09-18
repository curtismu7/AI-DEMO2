import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import test from 'node:test';

import {
  createLauncherServer,
  getAllowedServices,
  isLoopbackHost,
  listenOnLoopback,
} from './demo-launcher-server.mjs';

function createResponse() {
  const response = new EventEmitter();
  response.headers = {};
  response.statusCode = null;
  response.body = '';
  response.setHeader = (name, value) => {
    response.headers[name.toLowerCase()] = value;
  };
  response.writeHead = (statusCode, headers = {}) => {
    response.statusCode = statusCode;
    Object.entries(headers).forEach(([name, value]) => response.setHeader(name, value));
  };
  response.end = (body = '') => {
    response.body += body;
    response.emit('finish');
  };
  return response;
}

async function dispatch(launcher, path, { method = 'GET', body, headers = {} } = {}) {
  const request = new EventEmitter();
  request.method = method;
  request.url = path;
  request.headers = {
    ...headers,
    ...(body === undefined ? {} : { 'content-length': String(Buffer.byteLength(body)) }),
  };
  request.resumed = false;
  request.resume = () => {
    request.resumed = true;
  };
  const response = createResponse();
  const finished = new Promise((resolve) => response.once('finish', resolve));
  launcher.listeners('request')[0](request, response);
  if (body === undefined) {
    request.emit('end');
  } else {
    request.emit('data', Buffer.from(body));
    request.emit('end');
  }
  await finished;
  return response;
}

async function withLauncher(options, run) {
  const launcher = createLauncherServer(options);
  await run((path, options) => dispatch(launcher, path, options));
}

test('exposes only the local demo service allowlist', () => {
  assert.deepEqual(
    getAllowedServices().map(({ service }) => service),
    ['LibreChat', 'MCP gateway', 'Authorization service', 'JWT verifier'],
  );
  assert.ok(getAllowedServices().every(({ url }) => new URL(url).hostname === '127.0.0.1'));
});

test('reports sanitized allowlisted status records', async () => {
  const probeCalls = [];
  await withLauncher(
    {
      probe: async (service, { timeoutMs }) => {
        probeCalls.push({ service, timeoutMs });
        return { ok: true, body: 'access_token=must-not-appear' };
      },
    },
    async (request) => {
      const response = await request('/api/status');
      const payload = JSON.parse(response.body);

      assert.equal(response.statusCode, 200);
      assert.deepEqual(Object.keys(payload.services[0]), ['service', 'status', 'detail']);
      assert.equal(payload.services[0].detail, 'ready');
      assert.doesNotMatch(JSON.stringify(payload), /access_token/);
      assert.equal(probeCalls.length, 4);
      assert.ok(probeCalls.every(({ timeoutMs }) => timeoutMs > 0));
    },
  );
});

test('returns 503 without dependency response details when a readiness probe fails', async () => {
  await withLauncher(
    {
      probe: async (service) => {
        if (service.service === 'MCP gateway') {
          throw new Error('token=must-not-appear');
        }
        return { ok: true };
      },
    },
    async (request) => {
      const response = await request('/api/status');
      const payload = JSON.parse(response.body);

      assert.equal(response.statusCode, 503);
      assert.deepEqual(payload.services[1], {
        service: 'MCP gateway',
        status: 'unavailable',
        detail: 'readiness probe failed',
      });
      assert.doesNotMatch(JSON.stringify(payload), /token=/);
    },
  );
});

test('starts only through the injected fixed callback and exposes startup progress', async () => {
  let releaseStart;
  const started = new Promise((resolve) => {
    releaseStart = resolve;
  });
  let startCalls = 0;

  await withLauncher(
    {
      startStack: async () => {
        startCalls += 1;
        await started;
      },
      probe: async () => ({ ok: true }),
    },
    async (request) => {
      const startResponse = await request('/api/start', { method: 'POST' });
      assert.equal(startResponse.statusCode, 202);
      assert.equal(startCalls, 1);

      const status = JSON.parse((await request('/api/status')).body);
      assert.equal(status.startup.status, 'starting');

      const duplicateResponse = await request('/api/start', { method: 'POST' });
      assert.equal(duplicateResponse.statusCode, 202);
      assert.equal(startCalls, 1);

      releaseStart();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const completedStatus = JSON.parse((await request('/api/status')).body);
      assert.equal(completedStatus.startup.status, 'ready');
    },
  );
});

test('rejects bodies, unsupported methods, and arbitrary proxy routes', async () => {
  await withLauncher(
    { probe: async () => ({ ok: true }) },
    async (request) => {
      assert.equal((await request('/api/start', { method: 'PUT' })).statusCode, 405);
      const bodyResponse = await request('/api/start', { method: 'POST', body: 'start' });
      assert.equal(bodyResponse.statusCode, 400);
      assert.equal((await request('/api/proxy?url=http://example.com')).statusCode, 404);
      assert.equal((await request('/unknown')).statusCode, 404);
    },
  );
});

test('rejects a foreign Origin before starting the stack', async () => {
  let startCalls = 0;
  await withLauncher(
    {
      startStack: async () => {
        startCalls += 1;
      },
    },
    async (request) => {
      const response = await request('/api/start', {
        method: 'POST',
        headers: {
          origin: 'https://attacker.example',
        },
      });

      assert.equal(response.statusCode, 403);
      assert.equal(startCalls, 0);
    },
  );
});

test('rejects a cross-site browser signal without an Origin', async () => {
  let startCalls = 0;
  await withLauncher(
    {
      startStack: async () => {
        startCalls += 1;
      },
    },
    async (request) => {
      const response = await request('/api/start', {
        method: 'POST',
        headers: { 'sec-fetch-site': 'cross-site' },
      });

      assert.equal(response.statusCode, 403);
      assert.equal(startCalls, 0);
    },
  );
});

test('drains a rejected body-bearing request', async () => {
  const launcher = createLauncherServer({ probe: async () => ({ ok: true }) });
  const request = new EventEmitter();
  request.method = 'POST';
  request.url = '/api/start';
  request.headers = { 'content-length': '5' };
  request.resumed = false;
  request.resume = () => {
    request.resumed = true;
  };
  const response = createResponse();
  const finished = new Promise((resolve) => response.once('finish', resolve));

  launcher.listeners('request')[0](request, response);
  await finished;

  assert.equal(response.statusCode, 400);
  assert.equal(request.resumed, true);
});

test('uses bounded probe and startup timeouts', async () => {
  await withLauncher(
    {
      probe: () => new Promise(() => {}),
      probeTimeoutMs: 10,
      startStack: () => new Promise(() => {}),
      startupTimeoutMs: 10,
    },
    async (request) => {
      const failedStatus = await request('/api/status');
      assert.equal(failedStatus.statusCode, 503);

      assert.equal((await request('/api/start', { method: 'POST' })).statusCode, 202);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const status = JSON.parse((await request('/api/status')).body);
      assert.equal(status.startup.status, 'failed');
      assert.equal(status.startup.detail, 'startup timed out');
    },
  );
});

test('allows only loopback binding addresses', () => {
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('::1'), true);
  assert.equal(isLoopbackHost('0.0.0.0'), false);
  assert.equal(isLoopbackHost('localhost'), false);
});

test('binds a real listener only to an explicit loopback host', async (t) => {
  const server = createHttpServer((_request, response) => response.end('ok'));
  t.after(() => new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  }));

  await listenOnLoopback(server, 0, '127.0.0.1');
  assert.equal(server.address().address, '127.0.0.1');

  await assert.rejects(
    () => listenOnLoopback(createHttpServer(), 0, '0.0.0.0'),
    /loopback host/,
  );
});
