// demo_llm_proxy/residentRecover.js
'use strict';

const http = require('http');
const { parseResidentPorts } = require('./ensureArgs');

/**
 * Probe a local llama-server /health endpoint.
 * @param {string|number} port
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
function probePort(port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * If any resident tier is down, call ensureFn once (ensure-set reloads the set).
 * @param {object} opts
 * @param {string} opts.residentCsv
 * @param {(port: string) => Promise<unknown>} opts.ensureFn
 * @param {(port: string|number) => Promise<boolean>} [opts.probeFn]
 * @param {() => boolean} [opts.isBusy] skip while a swap is in flight
 * @returns {Promise<{ recovered: boolean, dead: string[] }>}
 */
async function recoverDeadResidents(opts) {
  const ports = parseResidentPorts(opts.residentCsv);
  if (!ports.length) return { recovered: false, dead: [] };
  if (typeof opts.isBusy === 'function' && opts.isBusy()) {
    return { recovered: false, dead: [] };
  }

  const probe = opts.probeFn || probePort;
  const dead = [];
  for (const p of ports) {
    if (!(await probe(p))) dead.push(p);
  }
  if (!dead.length) return { recovered: false, dead: [] };

  // One ensure-set (via ensureFn on first resident) reloads the whole resident set.
  await opts.ensureFn(ports[0]);
  return { recovered: true, dead };
}

module.exports = { probePort, recoverDeadResidents };
