'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createGitHubReader } = require('./github');
const { createRunnerController } = require('./runner-control');

const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/dashboard-model.js', ['dashboard-model.js', 'text/javascript; charset=utf-8']],
  ['/dashboard.js', ['dashboard.js', 'text/javascript; charset=utf-8']],
  ['/dashboard.css', ['dashboard.css', 'text/css; charset=utf-8']],
]);
const SAFE_ERRORS = {
  GH_MISSING: { status: 503, message: 'GitHub CLI was not found. Install gh and run gh auth login.' },
  GH_AUTH: { status: 503, message: 'GitHub CLI authentication is unavailable. Run gh auth login.' },
  GH_API: { status: 502, message: 'GitHub Actions data could not be loaded. Check GitHub access and try again.' },
  GH_TIMEOUT: { status: 504, message: 'GitHub did not respond in time. The dashboard will retry on its next refresh.' },
  GH_OUTPUT_LIMIT: { status: 502, message: 'GitHub returned more dashboard data than expected.' },
  GH_RESPONSE: { status: 502, message: 'GitHub returned an unreadable dashboard response.' },
  GH_REPOSITORY: { status: 503, message: 'The current checkout is not a GitHub repository.' },
  GH_PERMISSION: { status: 403, message: 'GitHub denied this Actions operation. Check repository Actions or Administration permissions.' },
  GH_CONTROL_LIMIT: { status: 502, message: 'GitHub returned more Actions controls than the dashboard limit.' },
  GH_ACTION: { status: 400, message: 'This dashboard action is not supported.' },
  RUNNER_BUSY: { status: 409, message: 'This runner is running a job. Wait until it is idle before pausing it.' },
  RUNNER_STATE: { status: 409, message: 'The runner is not in a state that allows this action.' },
  RUNNER_ACTION: { status: 400, message: 'This runner action is not supported.' },
  RUNNER_CONTROL_UNAVAILABLE: { status: 409, message: 'No matching local runner service is available on this machine.' },
  RUNNER_CONTROL_FAILED: { status: 502, message: 'The local runner service action failed.' },
  RUNNER_CONTROL_TIMEOUT: { status: 504, message: 'The local runner service did not respond in time.' },
  ACTION_STALE: { status: 409, message: 'That item changed state. Refresh the dashboard and try again.' },
};
const MAX_ACTION_BODY_BYTES = 4096;

function jsonResponse(response, status, body, headOnly = false) {
  const data = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(headOnly ? undefined : data);
}

function allowedHost(request, server) {
  const hostHeader = request.headers.host;
  if (!hostHeader) return false;
  try {
    const host = new URL(`http://${hostHeader}`);
    return host.hostname === '127.0.0.1' && host.port === String(server.address()?.port || '');
  } catch {
    return false;
  }
}

function allowedOrigin(request, server) {
  const originHeader = request.headers.origin;
  if (!originHeader) return true;
  try {
    const origin = new URL(originHeader);
    return origin.protocol === 'http:'
      && origin.hostname === '127.0.0.1'
      && origin.port === String(server.address()?.port || '')
      && origin.pathname === '/'
      && !origin.search
      && !origin.hash;
  } catch {
    return false;
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
      reject(Object.assign(new Error('JSON is required.'), { code: 'BAD_JSON' }));
      request.resume();
      return;
    }
    let size = 0;
    let body = '';
    let tooLarge = false;
    request.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_ACTION_BODY_BYTES) {
        tooLarge = true;
        body = '';
        return;
      }
      body += chunk.toString('utf8');
    });
    request.once('error', () => reject(Object.assign(new Error('Request could not be read.'), { code: 'BAD_JSON' })));
    request.once('end', () => {
      if (tooLarge) {
        reject(Object.assign(new Error('Request is too large.'), { code: 'BODY_LIMIT' }));
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error('JSON is invalid.'), { code: 'BAD_JSON' }));
      }
    });
  });
}

function validateActionInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.id !== 'number') return null;
  const id = value.id;
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const allowed = {
    run: ['cancel', 'rerun-failed'],
    workflow: ['pause', 'resume'],
    runner: ['pause', 'resume'],
  };
  if (!allowed[value.type]?.includes(value.action)) return null;
  return { type: value.type, action: value.action, id };
}

function errorResponse(error) {
  const safe = SAFE_ERRORS[error?.code] || { status: 502, message: 'Dashboard action could not be completed. Check GitHub access and try again.' };
  return { status: safe.status, body: { error: { code: SAFE_ERRORS[error?.code] ? error.code : 'ACTION_FAILED', message: safe.message } } };
}

function createDashboardServer({ getSnapshot, getControlState, performAction, performRunnerAction, host = '127.0.0.1', port = 0, assetDirectory = __dirname } = {}) {
  if (host !== '127.0.0.1') throw new TypeError('Dashboard server must bind to 127.0.0.1.');
  if (typeof getSnapshot !== 'function') throw new TypeError('getSnapshot must be a function.');

  const server = http.createServer(async (request, response) => {
    if (!allowedHost(request, server)) {
      jsonResponse(response, 403, { error: { code: 'LOCAL_ONLY', message: 'This dashboard accepts local requests only.' } });
      return;
    }
    if (!allowedOrigin(request, server)) {
      jsonResponse(response, 403, { error: { code: 'LOCAL_ONLY', message: 'This dashboard accepts local requests only.' } });
      return;
    }

    let pathname;
    try {
      pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    } catch {
      jsonResponse(response, 400, { error: { code: 'BAD_REQUEST', message: 'Request could not be read.' } });
      return;
    }

    if (pathname === '/api/control-state' && (request.method === 'GET' || request.method === 'HEAD')) {
      if (typeof getControlState !== 'function') {
        jsonResponse(response, 503, { error: { code: 'CONTROL_UNAVAILABLE', message: 'Workflow and runner controls are unavailable.' } }, request.method === 'HEAD');
        return;
      }
      try {
        jsonResponse(response, 200, await getControlState(), request.method === 'HEAD');
      } catch (error) {
        const safe = errorResponse(error);
        jsonResponse(response, safe.status, safe.body, request.method === 'HEAD');
      }
      return;
    }

    if (pathname === '/api/actions' && request.method === 'POST') {
      let input;
      try {
        input = validateActionInput(await readJsonBody(request));
      } catch (error) {
        if (!response.headersSent) {
          const code = error?.code === 'BODY_LIMIT' ? 'BODY_LIMIT' : 'BAD_REQUEST';
          const message = error?.code === 'BODY_LIMIT' ? 'Action request is too large.' : 'Action request must contain valid JSON.';
          jsonResponse(response, error?.code === 'BODY_LIMIT' ? 413 : 400, { error: { code, message } });
        }
        return;
      }
      if (!input) {
        jsonResponse(response, 400, { error: { code: 'BAD_ACTION', message: 'Choose a supported action and a valid identifier.' } });
        return;
      }
      try {
        let result;
        if (input.type === 'runner') {
          if (typeof getControlState !== 'function' || typeof performRunnerAction !== 'function') {
            throw Object.assign(new Error(), { code: 'RUNNER_CONTROL_UNAVAILABLE' });
          }
          const state = await getControlState();
          const runner = state.runners?.find((item) => item.id === input.id);
          if (!runner || !runner.localControlAvailable) throw Object.assign(new Error(), { code: 'RUNNER_CONTROL_UNAVAILABLE' });
          if (input.action === 'pause' && runner.busy) throw Object.assign(new Error(), { code: 'RUNNER_BUSY' });
          result = await performRunnerAction(state.repository, runner, input.action);
        } else if (input.type === 'workflow') {
          if (typeof getControlState !== 'function' || typeof performAction !== 'function') {
            throw Object.assign(new Error(), { code: 'GH_ACTION' });
          }
          const state = await getControlState();
          const workflow = state.workflows?.find((item) => item.id === input.id);
          const desiredState = input.action === 'pause' ? 'active' : 'disabled';
          if (!workflow || (desiredState === 'active' ? workflow.state !== 'active' : workflow.state === 'active')) {
            throw Object.assign(new Error(), { code: 'ACTION_STALE' });
          }
          result = await performAction(input);
        } else {
          if (typeof performAction !== 'function') throw Object.assign(new Error(), { code: 'GH_ACTION' });
          const snapshot = await getSnapshot();
          const run = snapshot.runs?.find((item) => item.id === input.id);
          const canCancel = ['queued', 'requested', 'waiting', 'pending', 'in_progress'].includes(run?.status);
          const canRerun = run?.status === 'completed' && ['failure', 'timed_out', 'action_required'].includes(run?.conclusion);
          if (!run || (input.action === 'cancel' ? !canCancel : !canRerun)) {
            throw Object.assign(new Error(), { code: 'ACTION_STALE' });
          }
          result = await performAction(input);
        }
        jsonResponse(response, 200, result || { ok: true });
      } catch (error) {
        const safe = errorResponse(error);
        jsonResponse(response, safe.status, safe.body);
      }
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: pathname === '/api/actions' ? 'GET, HEAD, POST' : 'GET, HEAD', 'Cache-Control': 'no-store' });
      response.end();
      return;
    }

    if (pathname === '/api/snapshot') {
      try {
        const snapshot = await getSnapshot();
        jsonResponse(response, 200, snapshot, request.method === 'HEAD');
      } catch (error) {
        const safe = SAFE_ERRORS[error?.code] || { status: 502, message: 'Dashboard data could not be loaded. Try again shortly.' };
        jsonResponse(response, safe.status, { error: { code: SAFE_ERRORS[error?.code] ? error.code : 'GH_API', message: safe.message } }, request.method === 'HEAD');
      }
      return;
    }

    const asset = ASSETS.get(pathname);
    if (!asset) {
      response.writeHead(404, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end();
      return;
    }

    try {
      const filePath = path.join(assetDirectory, asset[0]);
      const content = await fs.promises.readFile(filePath);
      response.writeHead(200, {
        'Content-Type': asset[1],
        'Content-Length': content.length,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch {
      response.writeHead(404, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end();
    }
  });
  return server;
}

function startDashboard({ port = 0, log = console.log, errorLog = console.error } = {}) {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 22) {
    throw new Error('Node.js 22 or newer is required to run the CI queue dashboard.');
  }

  const reader = createGitHubReader();
  const runnerController = createRunnerController();
  const getControlState = async () => {
    const state = await reader.getControlState();
    return { ...state, runners: await runnerController.inspect(state.repository, state.runners) };
  };
  const server = createDashboardServer({
    getSnapshot: reader.getSnapshot,
    getControlState,
    performAction: reader.performAction,
    performRunnerAction: runnerController.perform,
  });
  const onError = (error) => {
    server.removeListener('listening', onListening);
    errorLog(error?.code === 'EADDRINUSE'
      ? 'The local dashboard port is unavailable. Stop the other process and try again.'
      : 'The local dashboard could not start.');
    process.exitCode = 1;
  };
  const onListening = () => {
    const address = server.address();
    log(`CI queue dashboard: http://127.0.0.1:${address.port}`);
    log('Press Ctrl-C to stop.');
  };

  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port, '127.0.0.1');

  const stop = () => server.close();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return server;
}

if (require.main === module) {
  try {
    startDashboard();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { createDashboardServer, startDashboard };
