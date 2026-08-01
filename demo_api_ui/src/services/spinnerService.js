// banking_api_ui/src/services/spinnerService.js
/**
 * Global spinner service — imperative singleton, framework-free.
 * Works like react-toastify: call spinner.increment/decrement from interceptors,
 * or spinner.show/hide from components. SpinnerContext subscribes for React rendering.
 */

/** Human-readable descriptions keyed by "METHOD /api/path-prefix" (longest match wins) */
const API_MESSAGES = {
  'POST /api/transactions/consent':      'Reviewing consent request…',
  'POST /api/transactions':              'Processing your transaction…',
  'GET /api/transactions':               'Loading your transactions…',
  'GET /api/accounts':                   'Loading your accounts…',
  'POST /api/auth/switch':               'Switching roles…',
  'GET /api/auth/oauth':                 'Checking your session…',
  'GET /api/auth/session':               'Loading your session…',
  'POST /api/mcp/tool':                  'Asking the AI agent…',
  'GET /api/mcp':                        'Connecting to the AI agent…',
  'PATCH /api/admin/feature-flags':      'Saving feature flags…',
  'GET /api/admin/feature-flags':        'Loading feature flags…',
  'POST /api/admin/config':              'Saving configuration…',
  'GET /api/admin/config':               'Loading configuration…',
  'POST /api/admin/config/test':         'Testing PingOne connection…',
  'GET /api/setup/plan':                 'Loading PingOne setup plan…',
  'GET /api/admin/setup/worker-credentials': 'Checking PingOne worker configuration…',
  'GET /api/admin/setup/management-probe': 'Calling PingOne Management API…',
  'POST /api/admin/setup/pingone-bootstrap-run': 'Running PingOne bootstrap…',
  'POST /api/clients':                   'Creating OAuth application in PingOne…',
  'GET /api/admin':                      'Loading admin data…',
  'DELETE /api/logs':                    'Clearing logs…',
  'GET /api/logs':                       'Fetching logs…',
  'POST /api/auth/ciba':                 'Initiating secure login…',
  'POST /api/delegated':                 'Requesting delegated access…',
  'POST /api/tokens':                    'Exchanging tokens…',
  'GET /api/users':                      'Loading users…',
  'GET /api/authorize':                  'Checking authorization…',
  'POST /api/authorize':                 'Evaluating access policy…',
};

/** Fallback quips when URL has no mapped message */
const SPINNER_QUIPS = [
  'Bribing the servers…',
  'Counting beans (there are many)…',
  'Asking PingOne very nicely…',
  'Herding OAuth tokens…',
  'Locating your money (it was behind the couch)…',
  'Teaching the AI to count…',
  'Negotiating with the database…',
  'Summoning RFC 8693…',
  'Spinning up the hamster wheel…',
  'Calculating your net worth (round number)…',
  'Untangling the token chain…',
  'Consulting the access policy oracle…',
];

const SPINNER_COLORS = [
  'var(--brand-navy)', // blue
  '#7c3aed', // violet
  '#059669', // emerald
  '#dc2626', // red
  '#d97706', // amber
  '#0891b2', // cyan
  '#db2777', // pink
];

const MIN_DISPLAY_MS = 300;    // clear quickly once request finishes
const DEBOUNCE_MS    = 2500;   // only show spinner for requests that take > 2.5 s
const STUCK_TIMEOUT_MS = 60000; // safety: force-hide if spinner stuck (raised to 60s — legit calls can exceed 30s under heavy local/K8s load)

/** Routes that fire too frequently to ever show a spinner (polling, streaming, NL, MCP tools). */
const SILENT_URL_PREFIXES = [
  '/api/auth/session',
  '/api/auth/oauth/status',
  '/api/auth/oauth/user/status',
  '/api/config/thresholds',
  '/api/app-events',
  '/api/mcp/flow-sse',
  '/api/mcp/sse',
  '/api/mcp/tool',
  '/api/mcp/inspector',
  '/api/nl',
  '/api/logs',
  '/api/activity',
  '/api/demo-agent',
  '/api/langchain',
  '/api/transactions/consent-challenge',
  '/api/accounts',
  '/api/transactions',
];

const isSilentUrl = (url) => SILENT_URL_PREFIXES.some(p => url.startsWith(p));

let _pending   = 0;
let _visible   = false;
let _showTimer = null;
let _hideTimer = null;
let _stuckTimer = null;
/** @type {{ message: string, color: string, endpoint: string|null }|null} */
let _current   = null;
const _listeners = new Set();

/** Notify all React subscribers */
function notify() {
  const state = { visible: _visible, ...(_current || {}) };
  _listeners.forEach(fn => { try { fn(state); } catch (_) {} });
}

/** Pick a random item from an array */
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

/**
 * Resolve the best human-readable message for a given method + URL.
 * Tries longest prefix match first so specific routes beat general ones.
 */
function resolveMessage(method, url) {
  const key = `${method} ${url}`;
  const match = Object.keys(API_MESSAGES)
    .filter(k => key.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return match ? API_MESSAGES[match] : pick(SPINNER_QUIPS);
}

/** Commit the spinner visible state and notify listeners */
function show(message, color, endpoint) {
  _showTimer = null;
  _visible = true;
  // Safety: force-hide if spinner stays visible too long (pending counter leak)
  if (_stuckTimer) clearTimeout(_stuckTimer);
  _stuckTimer = setTimeout(() => {
    if (_visible && _pending > 0) {
      console.warn('[spinner] Safety timeout: force-hiding after ' + STUCK_TIMEOUT_MS + 'ms (_pending was ' + _pending + ')');
      _pending = 0;
      _visible = false;
      _current = null;
      _stuckTimer = null;
      notify();
    }
  }, STUCK_TIMEOUT_MS);
  _current = { message, color, endpoint };
  notify();
}

/** Start hiding — immediately or after min display */
function scheduleHide(immediate) {
  if (_stuckTimer) { clearTimeout(_stuckTimer); _stuckTimer = null; }
  if (_hideTimer) return; // already scheduled
  const delay = immediate || !_visible ? 0 : MIN_DISPLAY_MS;
  _hideTimer = setTimeout(() => {
    _hideTimer = null;
    _visible = false;
    _current = null;
    notify();
  }, delay);
}

export const spinner = {
  /**
   * Called by interceptors on every request start.
   * Passes method + url so the service can look up a contextual message.
   * @param {string} [method]
   * @param {string} [url]
   */
  increment(method = 'GET', url = '') {
    // Spinner overlay disabled — too distracting on the dashboard
    return;

    _pending++;
    // Cancel any pending hide from a previous cycle
    if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }

    // Record every API call in the activity feed (lazy import avoids circular dep)
    if (method && url) {
      try {
        const { spinnerActivity } = require('./spinnerActivityService');
        spinnerActivity.addClientEvent(method.toUpperCase(), url);
      } catch (_) { /* spinnerActivityService not loaded yet */ }
    }

    if (!_visible && !_showTimer) {
      const message = resolveMessage(method.toUpperCase(), url);
      const color   = pick(SPINNER_COLORS);
      // Expand relative /api/* paths to the full absolute URL so the spinner
      // shows e.g. "GET https://banking-demo-puce.vercel.app/api/accounts/my"
      // rather than the bare relative path.
      const fullUrl = (typeof window !== 'undefined' && url && url.startsWith('/'))
        ? `${window.location.origin}${url}`
        : url;
      const endpoint = method && url ? `${method.toUpperCase()} ${fullUrl}` : null;
      _showTimer = setTimeout(() => show(message, color, endpoint), DEBOUNCE_MS);
    }
  },

  /**
   * Called by interceptors on every response (success or error).
   * @param {boolean} [isError] - if true, skip min display time so error toasts appear immediately
   */
  decrement(isError = false, url = '') {
    if (isSilentUrl(url)) return;
    _pending = Math.max(0, _pending - 1);
    if (_pending > 0) return;

    // Cancel debounce show if the request completed before it fired
    if (_showTimer) { clearTimeout(_showTimer); _showTimer = null; }

    scheduleHide(isError);
  },

  /**
   * Manual show for explicit blocking operations (OAuth redirects etc.).
   * Uses a random quip if no message given.
   * @param {string} [message]
   * @param {string} [sub] - shown as endpoint line (optional)
   */
  show(message, sub) {
    // Spinner overlay disabled
    return;
  },

  /** Manual hide — mirrors decrement but always fast */
  hide() {
    this.decrement(true);
  },

  /**
   * Subscribe to spinner state changes.
   * @param {(state: object) => void} fn
   * @returns {() => void} unsubscribe
   */
  subscribe(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  },

  /** @returns {{ visible: boolean, message?: string, color?: string, endpoint?: string }} */
  getState() {
    return { visible: _visible, ...(_current || {}) };
  },
};
