'use strict';

/**
 * sideband.test.js — mock PingOne Authorize Sideband API contract.
 *
 * The contract is not published in the PingAuthorize documentation; it was
 * recorded from the live service on 2026-07-27 (see
 * docs/superpowers/specs/2026-07-27-aam-end-to-end-design.md). These tests pin
 * the parts that PingGateway's SidebandApiFilter actually depends on, because
 * getting any of them wrong fails inside the Java filter rather than here:
 *
 *   - a `response` object PRESENT means deny, ABSENT means allow. That is the
 *     entire discriminator; there is no "decision" field.
 *   - `response_code` is a STRING ("403"), not a number.
 *   - `headers` is an ARRAY OF SINGLE-KEY OBJECTS, not a map. A map fails in
 *     SidebandApiFilter.fillHeadersFromJson with a null-map NPE.
 *   - `url` and `http_version` must be echoed back, or the filter fails in the
 *     URI parser and toCommonsHttpVersion respectively.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const sideband = require('./routes/sideband');
const { sidebandResponse } = require('./routes/sideband');

function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

function makeReq(headers) {
  return {
    body: {
      source_ip: '192.168.97.1',
      source_port: 56782,
      method: 'GET',
      url: 'http://api.ping.demo:3036/aam/health',
      http_version: '1.1',
      headers,
    },
  };
}

test('permits when the required group is present: no response object', () => {
  const res = makeRes();
  sideband(makeReq([{ 'X-Demo-Groups': 'Full access' }]), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.response, undefined, 'allow must omit `response` entirely');
});

test('denies when the group is absent', () => {
  const res = makeRes();
  sideband(makeReq([{ Accept: '*/*' }]), res);
  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body.response, 'deny must carry a `response` object');
  assert.strictEqual(res.body.response.response_status, 'Forbidden');
});

test('response_code is a string, not a number', () => {
  const res = makeRes();
  sideband(makeReq([{ Accept: '*/*' }]), res);
  assert.strictEqual(typeof res.body.response.response_code, 'string');
  assert.strictEqual(res.body.response.response_code, '403');
});

test('headers are an array of single-key objects, never a map', () => {
  const res = makeRes();
  sideband(makeReq([{ Accept: '*/*' }]), res);
  assert.ok(Array.isArray(res.body.headers), 'echoed headers must be an array');
  assert.ok(Array.isArray(res.body.response.headers), 'response headers must be an array');
  for (const h of res.body.response.headers) {
    assert.strictEqual(typeof h, 'object');
    assert.strictEqual(Object.keys(h).length, 1, 'each header entry carries exactly one key');
  }
});

test('echoes every field the gateway requires back', () => {
  const res = makeRes();
  sideband(makeReq([{ Accept: '*/*' }]), res);
  for (const k of ['source_ip', 'source_port', 'method', 'url', 'http_version', 'headers']) {
    assert.ok(k in res.body, `missing echoed field: ${k}`);
  }
  assert.strictEqual(res.body.url, 'http://api.ping.demo:3036/aam/health');
  assert.strictEqual(res.body.http_version, '1.1');
});

test('group matching is case-insensitive on the header name and tolerates spacing', () => {
  const res = makeRes();
  sideband(makeReq([{ 'x-demo-groups': ' Other , Full access ' }]), res);
  assert.strictEqual(res.body.response, undefined);
});

test('the response leg echoes its payload verbatim', () => {
  // Reached only on ALLOW: the gateway posts the backend's answer here so AAM can
  // rewrite it. Without this route the allow path fails with a 404 from the
  // "Sideband API" while deny keeps working — the exact split seen live before it
  // was added. Echoing keeps the mock shape-agnostic on this leg.
  const res = makeRes();
  const payload = {
    method: 'GET',
    url: 'http://api.ping.demo:3036/aam/health',
    http_version: '1.1',
    response: { response_code: '200', response_status: 'OK', headers: [{ 'content-type': 'application/json' }] },
  };
  sidebandResponse({ body: payload }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, payload);
});

test('the response leg tolerates an empty body', () => {
  const res = makeRes();
  sidebandResponse({}, res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, {});
});

test('a missing or malformed headers array denies rather than throwing', () => {
  const res = makeRes();
  sideband({ body: { method: 'GET', url: 'http://x/y', http_version: '1.1' } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body.response, 'no headers means no group, which must deny');
  assert.ok(Array.isArray(res.body.headers), 'echoed headers must still be an array');
});
