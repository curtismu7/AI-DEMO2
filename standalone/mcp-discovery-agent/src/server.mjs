import { createServer } from 'node:http';

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 32_000) throw new Error('request_too_large');
  }
  try { return body ? JSON.parse(body) : {}; } catch { return {}; }
}

export function createDiscoveryServer({ store, scan }) {
  return createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/health') return sendJson(response, 200, { status: 'ok' });
      if (request.method === 'GET' && request.url === '/api/inventory') {
        const snapshot = store.snapshot ? await store.snapshot() : {};
        return sendJson(response, 200, { ...snapshot, records: await store.list() });
      }
      if (request.method === 'GET' && request.url.startsWith('/api/inventory/')) {
        const id = decodeURIComponent(request.url.slice('/api/inventory/'.length));
        const record = await store.get(id);
        return record ? sendJson(response, 200, { record }) : sendJson(response, 404, { error: 'inventory_not_found' });
      }
      if (request.method === 'POST' && request.url === '/api/scan') {
        await readBody(request); // Deliberately ignore all browser-provided fields, including credentials.
        const result = await scan();
        return sendJson(response, 202, { scanId: result.scanId });
      }
      return sendJson(response, 404, { error: 'not_found' });
    } catch (error) {
      return sendJson(response, error.message === 'request_too_large' ? 413 : 500, { error: 'discovery_agent_error' });
    }
  });
}
