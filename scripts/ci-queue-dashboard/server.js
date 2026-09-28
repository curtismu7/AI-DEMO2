'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
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
};

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

function createDashboardServer({ getSnapshot, host = '127.0.0.1', port = 0, assetDirectory = __dirname } = {}) {
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

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' });
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
      });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch {
      response.writeHead(404, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end();
    }
  });
  return server;
}

module.exports = { createDashboardServer };
