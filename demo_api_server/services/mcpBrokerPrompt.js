'use strict';

/**
 * How hard the MCP OAuth brokers make PingOne re-authenticate.
 *
 * Neither broker sent anything before (oauth-mcp's OAuthRouter, demo_mcp_gateway's
 * OAuthBrokerRouter), so PingOne silently re-authenticated against whatever SSO
 * session the browser already held. LM Studio opens the SYSTEM default browser —
 * exactly where a stale session lives — so an MCP client adopted the current user
 * with no login screen and nothing revealed whose identity was on the token.
 *
 *   once            re-authenticate only if the session is older than ONCE_MAX_AGE_S
 *                   (OIDC `max_age`). The first door prompts; the rest ride that
 *                   login. This is the default: it makes the identity visible once
 *                   without turning seven doors into seven logins.
 *   login           `prompt=login` — force a fresh credential prompt every time.
 *   select_account  `prompt=select_account` — PingOne's chooser: visible, one click.
 *   off             send nothing; the original silent-reuse behavior.
 *
 * The MODE→params mapping lives here rather than in the brokers on purpose. Both
 * brokers are image-built, so anything hard-coded in them needs a rebuild to
 * change; they just apply whatever params this returns (against their own small
 * allowlist), which means a new mode ships with a BFF restart alone.
 */

const configStore = require('./configStore');

const CHOICES = Object.freeze(['once', 'login', 'select_account', 'off']);
const DEFAULT = 'once';

/**
 * Freshness window for `once`, in seconds. 30 minutes comfortably covers one
 * demo session across every door while still forcing a real login the next
 * morning. Change here; the brokers read the number, they do not hold it.
 */
const ONCE_MAX_AGE_S = 1800;

/** Query params a broker is allowed to receive from this endpoint. */
const ALLOWED_PARAMS = Object.freeze(['prompt', 'max_age']);

/** @param {unknown} value @returns {boolean} */
function isValid(value) {
  return CHOICES.includes(String(value));
}

/**
 * The mode in force right now. Anything unset or unrecognized falls back to
 * DEFAULT — a typo in the store must not silently land on `off`, which is the
 * one outcome that reintroduces the bug this setting exists for.
 * @returns {'once'|'login'|'select_account'|'off'}
 */
function effective() {
  const raw = String(configStore.getEffective('mcp_broker_prompt') || '').trim();
  return isValid(raw) ? raw : DEFAULT;
}

/**
 * The authorize-request parameters for a mode.
 * @param {string} [mode] defaults to the effective mode
 * @returns {Record<string,string>}
 */
function authorizeParams(mode) {
  switch (isValid(mode) ? String(mode) : effective()) {
    // max_age is a re-auth DEADLINE, not a prompt: PingOne re-authenticates only
    // when the session's auth_time is older than this, so one login satisfies
    // every door that follows within the window.
    case 'once': return { max_age: String(ONCE_MAX_AGE_S) };
    case 'login': return { prompt: 'login' };
    case 'select_account': return { prompt: 'select_account' };
    default: return {};
  }
}

module.exports = { CHOICES, DEFAULT, ONCE_MAX_AGE_S, ALLOWED_PARAMS, isValid, effective, authorizeParams };
