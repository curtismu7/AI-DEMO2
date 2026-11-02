// A TLS pass-through in front of PingFederate's runtime listener that adds `protected_resources` to the authorization server
// metadata (spec 3.2). PingFederate has no setting for that field, so this is the only place it can be added. Everything else is
// forwarded byte for byte: request method, headers and body in, status, headers and body out.
//
//   SHIM_CERT=... SHIM_KEY=... SHIM_PROTECTED_RESOURCE=https://local.ping-devops.com \
//     node scripts/pingfederate/metadata-shim.mjs
//
//   SHIM_LISTEN_PORT (default 9031)   the port the world uses for the issuer
//   SHIM_UPSTREAM    (default https://127.0.0.1:9032)   PingFederate's runtime, published on another port
//   SHIM_VERIFY_UPSTREAM=1            verify the upstream certificate (off by default: it is a loopback hop to our own PingFederate)
//   SHIM_PLAIN=1                      plain http on both sides, for tests only
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

export const METADATA_PATH = '/.well-known/oauth-authorization-server';

// Returns the metadata document with protected_resources added (once), or the original bytes when it is not a JSON object.
export function addProtectedResources(raw, protectedResource) {
  let doc;
  try { doc = JSON.parse(raw.toString('utf8')); } catch { return raw; }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return raw;
  if (!('protected_resources' in doc)) doc.protected_resources = [protectedResource];
  return Buffer.from(JSON.stringify(doc));
}

export function createShim({ upstream, protectedResource, verifyUpstream = false, plain = false, serverOptions = {} }) {
  const up = new URL(upstream);
  const lib = plain ? http : https;
  const agent = plain ? undefined : new https.Agent({ rejectUnauthorized: verifyUpstream });
  return (req, res) => {
    const isMetadata = req.method === 'GET' && req.url.split('?')[0] === METADATA_PATH;
    const headers = { ...req.headers };
    if (isMetadata) headers['accept-encoding'] = 'identity'; // so the body can be read and changed
    const upReq = lib.request({ protocol: up.protocol, hostname: up.hostname, port: up.port, path: req.url, method: req.method, headers, agent }, (upRes) => {
      if (!isMetadata) { res.writeHead(upRes.statusCode, upRes.headers); upRes.pipe(res); return; }
      const chunks = [];
      upRes.on('data', (c) => chunks.push(c));
      upRes.on('end', () => {
        const original = Buffer.concat(chunks);
        const body = upRes.statusCode === 200 ? addProtectedResources(original, protectedResource) : original;
        const out = { ...upRes.headers, 'content-length': body.length };
        delete out['transfer-encoding'];
        res.writeHead(upRes.statusCode, out);
        res.end(body);
      });
    });
    upReq.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }); res.end('upstream unavailable'); });
    req.pipe(upReq);
  };
}

function start() {
  const port = Number(process.env.SHIM_LISTEN_PORT || 9031);
  const upstream = process.env.SHIM_UPSTREAM || 'https://127.0.0.1:9032';
  const protectedResource = process.env.SHIM_PROTECTED_RESOURCE;
  if (!protectedResource) throw new Error('SHIM_PROTECTED_RESOURCE is required (the Company origin, https://{domain})');
  const handler = createShim({ upstream, protectedResource, verifyUpstream: process.env.SHIM_VERIFY_UPSTREAM === '1', plain: process.env.SHIM_PLAIN === '1' });
  const server = process.env.SHIM_PLAIN === '1'
    ? http.createServer(handler)
    : https.createServer({ cert: fs.readFileSync(process.env.SHIM_CERT), key: fs.readFileSync(process.env.SHIM_KEY) }, handler);
  server.listen(port, '127.0.0.1', () => console.log(`[metadata-shim] 127.0.0.1:${port} -> ${upstream}, protected_resources ${protectedResource}`));
}

if (import.meta.url === `file://${process.argv[1]}`) start();
