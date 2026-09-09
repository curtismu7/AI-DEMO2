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

const net = require('net');

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
    // api.ping.demo is 127.0.0.1 here. Whether the local stack happens to be up
    // is irrelevant — what matters is that the guard did NOT answer.
    const err = await connectError({ host: 'api.ping.demo', port: 3001 });
    if (err) expect(err.message).not.toMatch(/outbound network is blocked/);
  });

  it('allows literal loopback', async () => {
    const err = await connectError({ host: '127.0.0.1', port: 1 });
    if (err) expect(err.message).not.toMatch(/outbound network is blocked/);
  });
});
