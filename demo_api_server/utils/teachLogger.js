'use strict';

/**
 * CommonJS port of banking_mcp_server/src/utils/teachLogger.ts
 *
 * Intentionally NO redaction — token visibility is a teaching feature of the demo.
 * Additive: does NOT replace utils/logger.js or Morgan.
 */

const pino = require('pino');
const { getCorrelationId } = require('./correlationContext');

const RESERVED = new Set(['level', 'time', 'msg', 'service', 'pid', 'hostname', 'correlation_id']);

function safeFields(fields) {
  if (!fields) return {};
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    out[RESERVED.has(k) ? `field_${k}` : k] = v;
  }
  return out;
}

function resolveLevel(opt) {
  return opt || process.env.LOG_LEVEL || 'debug';
}

function withCorrelation(obj) {
  const cid = getCorrelationId();
  return cid ? Object.assign({}, obj, { correlation_id: cid }) : obj;
}

function wrap(p) {
  return {
    info: (msg, fields) => p.info(withCorrelation(safeFields(fields)), msg),
    warn: (msg, fields) => p.warn(withCorrelation(safeFields(fields)), msg),
    debug: (msg, fields) => p.debug(withCorrelation(safeFields(fields)), msg),
    error: (msg, err, fields) => {
      const base = withCorrelation(safeFields(fields));
      if (err instanceof Error) {
        base.err = err;
      } else if (err !== undefined) {
        base.err = err;
      }
      p.error(base, msg);
    },
    step: (n, total, msg, fields) =>
      p.info(withCorrelation({ ...safeFields(fields), teach: true }), `[TEACH] step ${n}/${total}: ${msg}`),
    child: (bindings) => wrap(p.child(bindings)),
  };
}

function createTeachLogger(opts) {
  const level = resolveLevel(opts.level);
  const base = { level, base: { service: opts.service } };
  let p;
  if (opts.stream) {
    p = pino(base, opts.stream);
  } else if (opts.pretty != null ? opts.pretty : process.env.NODE_ENV !== 'production') {
    p = pino({ ...base, transport: { target: 'pino-pretty', options: { colorize: true } } });
  } else {
    p = pino(base);
  }
  return wrap(p);
}

const teachLog = createTeachLogger({ service: 'api-server' });

module.exports = { createTeachLogger, teachLog };
