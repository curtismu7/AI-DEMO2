import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { addProtectedResources, createShim, METADATA_PATH } from './metadata-shim.mjs';

const RESOURCE = 'https://company.example';
const listen = (h) => new Promise((res) => { const s = http.createServer(h).listen(0, '127.0.0.1', () => res(s)); });
const get = (port, path, method = 'GET', body) => new Promise((res, rej) => {
  const q = http.request({ host: '127.0.0.1', port, path, method, headers: body ? { 'content-type': 'application/json' } : {} }, (r) => {
    const c = []; r.on('data', (x) => c.push(x)); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: Buffer.concat(c) }));
  });
  q.on('error', rej); q.end(body);
});

test('adds protected_resources to a JSON object once, and leaves everything else alone', () => {
  const out = JSON.parse(addProtectedResources(Buffer.from('{"issuer":"https://pf.example","token_endpoint":"x"}'), RESOURCE));
  assert.deepEqual(out.protected_resources, [RESOURCE]);
  assert.equal(out.issuer, 'https://pf.example');
  const kept = JSON.parse(addProtectedResources(Buffer.from('{"protected_resources":["https://other.example"]}'), RESOURCE));
  assert.deepEqual(kept.protected_resources, ['https://other.example'], 'an existing value is not overwritten');
});

test('non-object or non-JSON metadata passes through unchanged', () => {
  for (const raw of ['not json', '[1,2]', 'null', '"text"']) assert.equal(addProtectedResources(Buffer.from(raw), RESOURCE).toString(), raw);
});

test('the metadata path is rewritten; every other path, method, status and body is forwarded unchanged', async () => {
  const seen = [];
  const upstream = await listen((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, accept: req.headers['accept-encoding'], body: Buffer.concat(chunks).toString() });
      if (req.url.startsWith(METADATA_PATH)) { res.writeHead(200, { 'content-type': 'application/json', 'x-keep': 'yes' }); return res.end('{"issuer":"https://pf.example"}'); }
      if (req.url === '/teapot') { res.writeHead(418, { 'x-keep': 'teapot' }); return res.end('short and stout'); }
      res.writeHead(201, { 'content-type': 'text/plain' }); res.end(`got ${req.method} ${Buffer.concat(chunks).toString()}`);
    });
  });
  const shim = await listen(createShim({ upstream: `http://127.0.0.1:${upstream.address().port}`, protectedResource: RESOURCE, plain: true }));
  const port = shim.address().port;
  try {
    const meta = await get(port, METADATA_PATH);
    assert.equal(meta.status, 200);
    assert.equal(meta.headers['x-keep'], 'yes');
    assert.deepEqual(JSON.parse(meta.body).protected_resources, [RESOURCE]);
    assert.equal(Number(meta.headers['content-length']), meta.body.length);
    assert.equal(seen.at(-1).accept, 'identity');

    const teapot = await get(port, '/teapot');
    assert.equal(teapot.status, 418);
    assert.equal(teapot.headers['x-keep'], 'teapot');
    assert.equal(teapot.body.toString(), 'short and stout');

    const post = await get(port, '/oauth/token?x=1', 'POST', '{"grant":"a"}');
    assert.equal(post.status, 201);
    assert.equal(post.body.toString(), 'got POST {"grant":"a"}');
    assert.equal(seen.at(-1).url, '/oauth/token?x=1');
  } finally { shim.close(); upstream.close(); }
});

test('an unreachable upstream is a clean 502', async () => {
  const shim = await listen(createShim({ upstream: 'http://127.0.0.1:1', protectedResource: RESOURCE, plain: true }));
  try { const r = await get(shim.address().port, METADATA_PATH); assert.equal(r.status, 502); } finally { shim.close(); }
});

test('the static JWKS path serves the configured key set and never touches upstream', async () => {
  const seen = [];
  const upstream = await listen((req, res) => { seen.push(req.url); res.writeHead(200); res.end('upstream'); });
  const jwks = { keys: [{ kty: 'RSA', kid: 'only-key', n: 'x', e: 'AQAB' }] };
  const shim = await listen(createShim({ upstream: `http://127.0.0.1:${upstream.address().port}`, protectedResource: RESOURCE, plain: true, staticJwks: jwks }));
  const port = shim.address().port;
  try {
    const hit = await get(port, '/pf/JWKS-idjag');
    assert.equal(hit.status, 200);
    assert.deepEqual(JSON.parse(hit.body.toString()), jwks);
    const other = await get(port, '/pf/JWKS');
    assert.equal(other.body.toString(), 'upstream'); // the dynamic set still proxies
    assert.deepEqual(seen, ['/pf/JWKS']);            // the static path never reached upstream
  } finally { shim.close(); upstream.close(); }
});
