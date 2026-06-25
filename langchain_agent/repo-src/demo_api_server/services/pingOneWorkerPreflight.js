/**
 * pingOneWorkerPreflight.js
 *
 * Boot-time health check for the PingOne management (worker) credential — the single
 * identity behind getManagementToken(): may_act hardening, delegation grant/revoke
 * emails, admin user lookups, the redirect-uri guard, and the resource validator all
 * depend on it. When it is misconfigured, every one of those used to fail independently
 * at runtime with a confusing 400/403. This collapses the whole class into ONE clear,
 * actionable verdict logged once at startup.
 *
 * What it catches (with the exact fix for each):
 *   - no_credentials   — no worker/management client configured
 *   - grant_type       — resolved client lacks the client_credentials grant (the recurring
 *                        "Unsupported grant type" 400 — wrong app selected at /config)
 *   - auth             — bad client secret / client unknown (invalid_client)
 *   - role             — token mints but the worker app lacks the management role (403)
 *   - unreachable      — network error talking to PingOne
 *
 * Always resolves (never throws) so it can't block startup. Default: warn-and-continue.
 *   - Opt out entirely:  PINGONE_WORKER_PREFLIGHT=false
 *   - Fail fast at boot: PINGONE_PREFLIGHT_STRICT=true  (caller may exit on { ok:false, fatal:true })
 */
'use strict';

const configStore = require('./configStore');
const { getManagementToken, resolveWorkerCredentials } = require('./pingOneClientService');
const pingOneUserService = require('./pingOneUserService');

const TAG = '[pingone-preflight]';

function flag(key, def) {
  const v = configStore.getEffective(key);
  return v === undefined || v === null || v === '' ? def : String(v).toLowerCase();
}

/** Classify a token-mint failure into a stable code + actionable hint. */
function classifyTokenError(err) {
  const status = err?.response?.status;
  const data = err?.response?.data || {};
  const code = data.error || '';
  const desc = data.error_description || err?.message || '';

  if (status === 400 && /unsupported grant type|unauthorized_client/i.test(`${code} ${desc}`)) {
    return {
      code: 'grant_type',
      message:
        'Resolved worker/management client is NOT enabled for the client_credentials grant. ' +
        'Point the Worker App at /config to a Client-Credentials-enabled app (or enable that ' +
        'grant on the current app in the PingOne console → app → Configuration → Grant Types).',
    };
  }
  if (status === 401 || /invalid_client/i.test(code)) {
    return { code: 'auth', message: 'Worker client id/secret rejected by PingOne (invalid_client) — verify PINGONE_WORKER_CLIENT_ID / PINGONE_WORKER_CLIENT_SECRET.' };
  }
  if (status === undefined) {
    return { code: 'unreachable', message: `Could not reach PingOne token endpoint: ${desc}` };
  }
  return { code: 'token_error', message: `Token request failed (status ${status}): ${desc}` };
}

/**
 * @returns {Promise<{ ok:boolean, code:string, message:string, skipped?:boolean, fatal?:boolean }>}
 */
async function runWorkerTokenPreflight() {
  if (flag('pingone_worker_preflight', 'true') === 'false') {
    return { ok: true, code: 'disabled', message: 'preflight disabled', skipped: true };
  }
  const strict = flag('pingone_preflight_strict', 'false') === 'true';
  const fail = (code, message) => {
    console.warn(`${TAG} ⚠️  ${message}`);
    return { ok: false, code, message, fatal: strict };
  };

  // 1) credentials present?
  const { clientId } = resolveWorkerCredentials(true);
  if (!clientId) {
    // No creds is a clean "not set up yet" state, not an error — never fatal.
    console.warn(`${TAG} Skipped — no worker/management credentials configured (set PINGONE_WORKER_CLIENT_ID + PINGONE_WORKER_CLIENT_SECRET).`);
    return { ok: true, code: 'no_credentials', message: 'no worker credentials', skipped: true };
  }

  // 2) can we mint a management token?
  try {
    await getManagementToken();
  } catch (err) {
    const c = classifyTokenError(err);
    if (c.code === 'unreachable') {
      // Transient network — warn but never fatal (don't wedge boot on a blip).
      console.warn(`${TAG} ⚠️  ${c.message}`);
      return { ok: false, code: c.code, message: c.message, fatal: false };
    }
    return fail(c.code, c.message);
  }

  // 3) token works — confirm the worker app actually has the management role (read users).
  try {
    pingOneUserService.initialize();
    await pingOneUserService.listUsers({ limit: 1 });
  } catch (err) {
    const status = err?.response?.status;
    if (status === 403) {
      return fail('role', 'Worker token mints OK but the worker app lacks the management role — assign an Identity admin role to it in the PingOne console (app → Roles).');
    }
    if (status === undefined) {
      console.warn(`${TAG} ⚠️  Reached PingOne for the token but the user-read check errored: ${err.message}`);
      return { ok: false, code: 'unreachable', message: err.message, fatal: false };
    }
    return fail('read_error', `Worker user-read check failed (status ${status}): ${err.message}`);
  }

  console.log(`${TAG} ✅ Worker credential healthy — management token + user read OK (client ...${String(clientId).slice(-8)}).`);
  return { ok: true, code: 'healthy', message: 'ok' };
}

module.exports = { runWorkerTokenPreflight, classifyTokenError };
