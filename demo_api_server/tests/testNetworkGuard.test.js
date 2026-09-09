'use strict';

/**
 * Guards the guard: src/__tests__/setup.js blocks outbound network from unit
 * tests. Two things about it are easy to get wrong and silent when wrong, and
 * both were got wrong on the first attempt:
 *
 *  1. Socket.prototype.connect takes THREE shapes — connect(options),
 *     connect(port, host) and connect(normalized), where `normalized` is Node's
 *     internal [options, callback] ARRAY. An array is typeof 'object', so
 *     reading `.host` off it yields undefined and every net.connect() call
 *     sails through. A guard broken that way still looks installed.
 *  2. Loopback must be decided by RESOLVED address, not by name: the demo maps
 *     api.ping.demo and local.ping-devops.com to 127.0.0.1 in /etc/hosts, and
 *     suites that dial the local stack through those names must still work.
 */

const fs = require('fs');
const net = require('net');

/** First hostname /etc/hosts points at a loopback address, or null. */
function loopbackNameFromEtcHosts() {
  try {
    for (const rawLine of fs.readFileSync('/etc/hosts', 'utf8').split('\n')) {
      const line = rawLine.replace(/#.*$/, '').trim();
      if (!line) continue;
      const [addr, ...names] = line.split(/\s+/);
      if (!/^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1)$/.test(addr)) continue;
      // 'localhost' would pass on the literal check alone and prove nothing.
      const alias = names.find((n) => n.toLowerCase() !== 'localhost' && n.includes('.'));
      if (alias) return alias;
    }
  } catch { /* no /etc/hosts */ }
  return null;
}

const connectError = (opts) =>
  new Promise((resolve) => {
    const socket = net.connect(opts);
    socket.on('error', resolve);
    socket.on('connect', () => { socket.destroy(); resolve(null); });
  });

describe('unit-test network guard', () => {
  it('is installed', () => {
    expect(net.Socket.prototype[Symbol.for('aiDemo.testNetworkGuard')]).toBe(true);
  });

  it('blocks a host that is not loopback', async () => {
    const err = await connectError({ host: 'gw.local', port: 443 });
    expect(err).toBeTruthy();
    expect(err.code).toBe('ENOTFOUND');
    // Its own message, not the real resolver's — proving the guard answered
    // rather than a five-second DNS timeout.
    expect(err.message).toMatch(/outbound network is blocked in unit tests/);
  });

  it('blocks via the normalized-array call shape too', async () => {
    // net.connect(port, host) normalizes to [options, cb] internally. This is
    // the shape the first version of the guard silently let through.
    const err = await new Promise((resolve) => {
      const socket = net.connect(443, 'gw.local');
      socket.on('error', resolve);
      socket.on('connect', () => { socket.destroy(); resolve(null); });
    });
    expect(err).toBeTruthy();
    expect(err.message).toMatch(/outbound network is blocked in unit tests/);
  });

  it('allows a hostname /etc/hosts maps to loopback', async () => {
    // Derived, never hardcoded: a dev box maps api.ping.demo to 127.0.0.1 and a
    // clean CI runner maps nothing, where blocking that name is the CORRECT
    // answer. Asserting `api.ping.demo` is allowed passes locally and fails on
    // CI for the right reason, which is exactly what happened first time round.
    const name = loopbackNameFromEtcHosts();
    if (!name) return; // no loopback aliases on this host — nothing to assert
    // Whether the local stack happens to be listening is irrelevant; what
    // matters is that the guard did NOT answer.
    const err = await connectError({ host: name, port: 3001 });
    if (err) expect(err.message).not.toMatch(/outbound network is blocked/);
  });

  it('allows literal loopback', async () => {
    const err = await connectError({ host: '127.0.0.1', port: 1 });
    if (err) expect(err.message).not.toMatch(/outbound network is blocked/);
  });
});
