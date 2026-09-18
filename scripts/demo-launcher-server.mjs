import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PROBE_TIMEOUT_MS = 3_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 60_000;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3090;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultPagePath = resolve(repositoryRoot, 'docs/demo-launcher/index.html');

const allowedServices = Object.freeze([
  Object.freeze({ service: 'LibreChat', url: 'http://127.0.0.1:3080/api/health' }),
  Object.freeze({ service: 'MCP gateway', url: 'http://127.0.0.1:3005/health' }),
  Object.freeze({ service: 'Authorization service', url: 'http://127.0.0.1:9001/health' }),
  Object.freeze({ service: 'JWT verifier', url: 'http://127.0.0.1:8083/health' }),
]);

export function getAllowedServices() {
  return allowedServices.map((service) => ({ ...service }));
}

export function isLoopbackHost(host) {
  return host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

export function listenOnLoopback(server, port = DEFAULT_PORT, host = DEFAULT_HOST) {
  if (!isLoopbackHost(host)) {
    return Promise.reject(new Error('Demo launcher must bind to a loopback host'));
  }

  return new Promise((resolveListen, rejectListen) => {
    const onError = (error) => {
      server.off('listening', onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveListen(server);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function withTimeout(operation, timeoutMs, message) {
  return new Promise((resolveOperation, rejectOperation) => {
    const timeout = setTimeout(() => rejectOperation(new Error(message)), timeoutMs);
    Promise.resolve(operation).then(
      (value) => {
        clearTimeout(timeout);
        resolveOperation(value);
      },
      (error) => {
        clearTimeout(timeout);
        rejectOperation(error);
      },
    );
  });
}

async function defaultProbe(service, { timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(service.url, { signal: controller.signal });
    return { ok: response.ok };
  } finally {
    clearTimeout(timeout);
  }
}

function defaultStartStack() {
  return new Promise((resolveStart, rejectStart) => {
    const child = spawn('./run-docker.sh', [], {
      cwd: repositoryRoot,
      shell: false,
      stdio: 'inherit',
    });
    child.once('error', rejectStart);
    child.once('exit', (code) => {
      if (code === 0) {
        resolveStart();
        return;
      }
      rejectStart(new Error('Local demo stack startup failed'));
    });
  });
}

async function defaultStaticPage() {
  try {
    return await readFile(defaultPagePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function writeJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function writeText(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(body);
}

function isTrustedStartRequest(request) {
  const fetchSite = request.headers['sec-fetch-site'];
  if (typeof fetchSite === 'string' && fetchSite.toLowerCase() === 'cross-site') {
    return false;
  }

  const origin = request.headers.origin;
  if (origin === undefined) {
    return true;
  }
  if (typeof origin !== 'string') {
    return false;
  }

  try {
    return isLoopbackHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function discardRequestBody(request) {
  if (typeof request.resume === 'function') {
    request.resume();
  }
}

function hasRawDotSegment(requestTarget) {
  const rawPath = requestTarget.split(/[?#]/, 1)[0];
  return rawPath.split('/').some((segment) => /^(?:\.|%2e){1,2}$/i.test(segment));
}

async function hasRequestBody(request) {
  if (request.headers['content-length'] && request.headers['content-length'] !== '0') {
    return true;
  }
  if (request.headers['transfer-encoding']) {
    return true;
  }

  return new Promise((resolveBody) => {
    request.once('data', () => resolveBody(true));
    request.once('end', () => resolveBody(false));
    request.once('aborted', () => resolveBody(true));
  });
}

function startupRecord(startup) {
  return { status: startup.status, detail: startup.detail };
}

export function createLauncherServer({
  startStack = defaultStartStack,
  probe = defaultProbe,
  servePage = defaultStaticPage,
  probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
} = {}) {
  let startup = { status: 'idle', detail: 'not started' };
  let startOperation = null;
  let latestStartupOperation = null;

  async function checkServices() {
    const services = await Promise.all(
      getAllowedServices().map(async (service) => {
        try {
          const result = await withTimeout(
            probe(service, { timeoutMs: probeTimeoutMs }),
            probeTimeoutMs,
            'Readiness probe timed out',
          );
          if (result?.ok !== true) {
            return { service: service.service, status: 'unavailable', detail: 'readiness probe failed' };
          }
          return { service: service.service, status: 'ready', detail: 'ready' };
        } catch {
          return { service: service.service, status: 'unavailable', detail: 'readiness probe failed' };
        }
      }),
    );
    return services;
  }

  function beginStartup() {
    if (startOperation) {
      return;
    }

    startup = { status: 'starting', detail: 'fixed local startup is running' };
    const operation = Promise.resolve().then(() => startStack());
    startOperation = operation;
    latestStartupOperation = operation;
    operation.finally(() => {
      if (startOperation === operation) {
        startOperation = null;
      }
    }).catch(() => {});

    withTimeout(operation, startupTimeoutMs, 'Startup timed out').then(
      () => {
        if (latestStartupOperation === operation) {
          startup = { status: 'ready', detail: 'startup completed' };
        }
      },
      (error) => {
        if (latestStartupOperation === operation) {
          startup = {
            status: 'failed',
            detail: error?.message === 'Startup timed out' ? 'startup timed out' : 'startup failed',
          };
        }
      },
    );
  }

  return createServer(async (request, response) => {
    const requestTarget = request.url ?? '/';
    if (hasRawDotSegment(requestTarget)) {
      writeText(response, 404, 'Not found');
      return;
    }
    const requestUrl = new URL(requestTarget, 'http://127.0.0.1');
    const { pathname } = requestUrl;
    const method = request.method ?? 'GET';

    if (pathname === '/health') {
      if (method !== 'GET') {
        response.setHeader('allow', 'GET');
        writeText(response, 405, 'Method not allowed');
        return;
      }
      writeJson(response, 200, { service: 'demo-launcher', status: 'ready', detail: 'loopback launcher ready' });
      return;
    }

    if (pathname === '/api/status') {
      if (method !== 'GET') {
        response.setHeader('allow', 'GET');
        writeText(response, 405, 'Method not allowed');
        return;
      }
      const services = await checkServices();
      const statusCode = services.every((service) => service.status === 'ready') ? 200 : 503;
      writeJson(response, statusCode, { services, startup: startupRecord(startup) });
      return;
    }

    if (pathname === '/api/start') {
      if (method !== 'POST') {
        response.setHeader('allow', 'POST');
        writeText(response, 405, 'Method not allowed');
        return;
      }
      if (!isTrustedStartRequest(request)) {
        discardRequestBody(request);
        writeText(response, 403, 'Cross-origin startup is not allowed');
        return;
      }
      if (await hasRequestBody(request)) {
        discardRequestBody(request);
        writeText(response, 400, 'Request body is not supported');
        return;
      }
      beginStartup();
      writeJson(response, 202, { status: startup.status, detail: startup.detail });
      return;
    }

    if (pathname === '/' || pathname === '/index.html') {
      if (method !== 'GET') {
        response.setHeader('allow', 'GET');
        writeText(response, 405, 'Method not allowed');
        return;
      }
      try {
        const page = await servePage();
        if (typeof page !== 'string') {
          writeText(response, 503, 'Demo launcher page is not installed');
          return;
        }
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end(page);
      } catch {
        writeText(response, 500, 'Unable to load demo launcher page');
      }
      return;
    }

    writeText(response, 404, 'Not found');
  });
}

function configuredPort() {
  const port = Number(process.env.DEMO_LAUNCHER_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('DEMO_LAUNCHER_PORT must be a valid TCP port');
  }
  return port;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const host = process.env.DEMO_LAUNCHER_HOST ?? DEFAULT_HOST;
  const server = createLauncherServer();
  listenOnLoopback(server, configuredPort(), host).then(() => {
    const { port } = server.address();
    process.stdout.write(`Demo launcher listening at http://${host}:${port}\n`);
  }).catch((error) => {
    process.stderr.write(`Unable to start demo launcher: ${error.message}\n`);
    process.exitCode = 1;
  });
}
