'use strict';

/**
 * Guards that startupConfigGuard validates HITL_SERVICE_URL's port against
 * service-topology.json's hitl-service port — so a wrong HITL port fails loudly
 * at boot instead of every transfer consent challenge silently failing to reach
 * the HITL service at request time.
 */

const fs = require('node:fs');
const path = require('node:path');
const guard = require('../../services/startupConfigGuard');

const KEY = 'HITL_SERVICE_URL';
const topo = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../service-topology.json'), 'utf8'),
);
const hitlPort = topo.services['hitl-service'].port;

describe('startupConfigGuard — HITL_SERVICE_URL port checked against the SoT', () => {
  const original = process.env[KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it('flags a HITL URL on the wrong port', () => {
    process.env[KEY] = 'http://hitl-service:9999';
    const issues = guard.collectIssues();
    expect(issues.some((i) => i.includes(KEY) && i.includes('hitl-service'))).toBe(true);
  });

  it('does not flag a HITL URL on the SoT port', () => {
    process.env[KEY] = `http://hitl-service:${hitlPort}`;
    const issues = guard.collectIssues();
    expect(issues.some((i) => i.includes(KEY))).toBe(false);
  });
});
