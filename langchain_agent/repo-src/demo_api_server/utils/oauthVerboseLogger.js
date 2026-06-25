'use strict';

const { isOAuthVerboseDebug } = require('./oauthDebugFlags');
const oauthVerboseLogStore = require('../services/oauthVerboseLogStore');

/**
 * Log OAuth verbose diagnostics to console and to the admin-visible log store (file / KV / memory).
 */
function verboseOAuthLog(...args) {
  if (!isOAuthVerboseDebug()) return;
  const msg = args
    .map((a) => {
      if (a instanceof Error) return a.message;
      if (typeof a === 'object' && a !== null) {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(' ');
  console.log(msg);
  oauthVerboseLogStore.appendLine(`[${new Date().toISOString()}] ${msg}`);
}

module.exports = { verboseOAuthLog };
