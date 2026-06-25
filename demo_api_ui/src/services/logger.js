/**
 * Minimal named logger factory for banking UI services.
 *
 * Usage:
 *   import { createLogger } from './logger';
 *   const log = createLogger('callMcpTool');
 *   log.debug('starting', { tool });   // [callMcpTool] starting { ... }
 *   log.warn('slow response');
 *   log.error('failed', err);
 *
 * Level hierarchy: debug < info < warn < error
 *
 * Production behaviour (NODE_ENV === 'production'):
 *   - Only warn and error pass through — keeps the browser console quiet.
 *   - Set window.__BANKING_DEBUG__ = true in DevTools to re-enable debug/info.
 */

const IS_PROD = typeof process !== 'undefined' && process.env.NODE_ENV === 'production';

function isDebugEnabled() {
  return !IS_PROD || (typeof window !== 'undefined' && window.__BANKING_DEBUG__ === true);
}

export function createLogger(name) {
  const prefix = `[${name}]`;
  return {
    debug(...args) {
      if (isDebugEnabled()) console.log(prefix, ...args);
    },
    info(...args) {
      if (isDebugEnabled()) console.info(prefix, ...args);
    },
    warn(...args) {
      console.warn(prefix, ...args);
    },
    error(...args) {
      console.error(prefix, ...args);
    },
  };
}
