const net = require('net');

// The BFF must reach PF at PF_TOKEN_ENDPOINT for the code exchange, so a refused
// connection there means the login cannot complete. Fails open: unset/odd config,
// timeouts and any other error report "reachable" so this never blocks a working login.
const DEFINITIVELY_DOWN = new Set(['ECONNREFUSED', 'ENOTFOUND']);

function isPingFederateDown(endpoint = process.env.PF_TOKEN_ENDPOINT, timeoutMs = 1500) {
  let u;
  try {
    u = new URL(endpoint);
  } catch {
    return Promise.resolve(false);
  }
  const port = Number(u.port) || (u.protocol === 'http:' ? 80 : 443);
  return new Promise((resolve) => {
    const s = net.connect({ host: u.hostname, port, timeout: timeoutMs });
    s.once('connect', () => { s.destroy(); resolve(false); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.once('error', (e) => resolve(DEFINITIVELY_DOWN.has(e.code)));
  });
}

module.exports = { isPingFederateDown };
