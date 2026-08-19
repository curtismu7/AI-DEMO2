'use strict';

/**
 * agentGatewayLogs — read the Real Agent Gateway (PingGateway / IG) container
 * logs so the admin UI can display them in a window.
 *
 * The BFF has no docker CLI, but /var/run/docker.sock is bind-mounted (see
 * docker-compose.yml) and the BFF joins the docker group. So we talk to the
 * Docker Engine API directly over the unix socket with Node's built-in http —
 * no dockerode dependency.
 *
 * Endpoint used: GET /containers/{name}/logs?stdout=1&stderr=1&tail=N&timestamps=1
 * A non-TTY container multiplexes stdout/stderr into an 8-byte-framed stream:
 *   [ STREAM_TYPE(1) | 0 0 0 | SIZE(4, big-endian) ][ payload(SIZE bytes) ]
 * demuxStream() reassembles the payloads back into plain log text.
 *
 * SECURITY: logs are admin-only (guarded at the route). As defence-in-depth we
 * still redact anything that looks like a bearer token / access_token before it
 * leaves the process — the IG groovy does not print raw tokens, but a future
 * log line must never leak one through this window.
 */

const http = require('http');

const SOCKET_PATH = process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock';
// The IG container name (compose sets container_name: ai-demo-ping-gateway).
const GATEWAY_CONTAINER =
  process.env.AGENT_GATEWAY_CONTAINER || 'ai-demo-ping-gateway';
const MAX_TAIL = 2000;

/** Redact bearer tokens / access_token values from a log chunk. */
function redact(text) {
  return String(text)
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1<redacted>')
    .replace(/("access_token"\s*:\s*")[^"]+(")/gi, '$1<redacted>$2')
    .replace(/(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})/g, '<redacted-jwt>');
}

/**
 * Demultiplex a Docker non-TTY log buffer into plain text. Each frame carries an
 * 8-byte header; we concatenate the payloads. Falls back to the raw string if the
 * buffer is not framed (TTY containers stream plain bytes).
 */
function demuxStream(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return '';
  const out = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const streamType = buf[offset];
    // A valid frame header has stream type 0,1,2 and three zero bytes after it.
    const framed =
      (streamType === 0 || streamType === 1 || streamType === 2) &&
      buf[offset + 1] === 0 && buf[offset + 2] === 0 && buf[offset + 3] === 0;
    if (!framed) {
      // Not a framed stream (or corrupt) — return the remainder verbatim.
      return out.join('') + buf.slice(offset).toString('utf8');
    }
    const size = buf.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > buf.length) {
      out.push(buf.slice(start).toString('utf8'));
      break;
    }
    out.push(buf.slice(start, end).toString('utf8'));
    offset = end;
  }
  return out.join('');
}

/**
 * Fetch the last `tail` log lines from the Agent Gateway container.
 * @param {object} [opts]
 * @param {number} [opts.tail=200]   number of trailing lines (capped at MAX_TAIL)
 * @param {string} [opts.filter]     case-insensitive substring; only matching lines returned
 * @returns {Promise<{ok:boolean, container:string, lines:string[], error?:string}>}
 */
function fetchLogs(opts = {}) {
  const tail = Math.min(
    Math.max(parseInt(opts.tail, 10) || 200, 1),
    MAX_TAIL
  );
  const filter = typeof opts.filter === 'string' && opts.filter.trim()
    ? opts.filter.trim().toLowerCase()
    : null;

  const path =
    `/containers/${encodeURIComponent(GATEWAY_CONTAINER)}/logs` +
    `?stdout=1&stderr=1&timestamps=1&tail=${tail}`;

  return new Promise((resolve) => {
    const req = http.request(
      { socketPath: SOCKET_PATH, path, method: 'GET', timeout: 8000 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode === 404) {
            return resolve({
              ok: false, container: GATEWAY_CONTAINER, lines: [],
              error: `container_not_found: ${GATEWAY_CONTAINER} (is the Real Agent Gateway running?)`,
            });
          }
          if (res.statusCode >= 400) {
            return resolve({
              ok: false, container: GATEWAY_CONTAINER, lines: [],
              error: `docker_api_error: HTTP ${res.statusCode}`,
            });
          }
          const text = redact(demuxStream(Buffer.concat(chunks)));
          let lines = text.split('\n').filter((l) => l.length > 0);
          if (filter) lines = lines.filter((l) => l.toLowerCase().includes(filter));
          resolve({ ok: true, container: GATEWAY_CONTAINER, lines });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, container: GATEWAY_CONTAINER, lines: [], error: 'docker_socket_timeout' });
    });
    req.on('error', (err) => {
      resolve({
        ok: false, container: GATEWAY_CONTAINER, lines: [],
        error: `docker_socket_error: ${err.code || err.message}`,
      });
    });
    req.end();
  });
}

module.exports = { fetchLogs, GATEWAY_CONTAINER, _redact: redact, _demuxStream: demuxStream };
