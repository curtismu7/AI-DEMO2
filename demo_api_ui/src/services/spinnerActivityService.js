// banking_api_ui/src/services/spinnerActivityService.js
/**
 * Spinner activity feed service — polls /api/admin/app-events while the spinner
 * is visible, collecting server-side events (OAuth, token exchange, MCP, JWKS, etc.)
 * into a compact feed displayed inside the spinner overlay.
 *
 * Also accepts client-side events (API calls in-flight) so they appear instantly.
 *
 * Uses a private axios instance WITHOUT interceptors to avoid triggering the spinner
 * recursively (which would cause an infinite loop).
 */
import axios from 'axios';
import { resolveApiBaseUrl } from '../utils/resolveApiBaseUrl';

const POLL_INTERVAL_MS = 1500;
const MAX_EVENTS = 20;
const IDLE_TIMEOUT_MS = 15000; // stop polling after 15s with no server events

/** Category → emoji icon mapping */
const CATEGORY_ICONS = {
  oauth:          '🔑',
  token_exchange: '🔄',
  session:        '',
  jwks:           '🛡️',
  mcp:            '🤖',
  auth_lifecycle: '🔐',
  client:         '📡',
  authorization:  '⚖️',
  config:         '⚙️',
  agent:          '🧠',
};

/** Routes that are background polls — skip from the activity feed */
const SILENT_ROUTES = new Set([
  '/api/auth/oauth/user/status',
  '/api/auth/oauth/status',
  '/api/auth/ciba/status',
  '/api/auth/session',
  '/api/token-chain/current',
  '/api/tokens/session-preview',
  '/api/admin/config',
  '/api/config/vertical',
  '/api/app-events',
  '/api/app-events',
]);

/** Friendly labels for client-side API calls (longest-prefix match wins) */
const CLIENT_LABELS = {
  'POST /api/mcp/tool':             'Calling MCP tool',
  'GET /api/mcp':                   'Connecting to MCP server',
  'POST /api/transactions':         'Submitting transaction',
  'GET /api/transactions':          'Loading transactions',
  'GET /api/accounts':              'Loading accounts',
  'POST /api/auth/ciba':            'Initiating CIBA push',
  'POST /api/tokens':               'Exchanging tokens',
  'GET /api/tokens':                '🔑 Loading token info',
  'GET /api/token-chain':           'Loading token chain',
  'POST /api/delegated':            'Requesting delegated access',
  'GET /api/authorize':             'Checking authorization',
  'POST /api/authorize':            'Evaluating access policy',
  'POST /api/admin/setup':          'Running PingOne setup',
  'GET /api/admin/setup':           'Checking PingOne config',
  'POST /api/clients':              '🔐 Creating OAuth app in PingOne',
};

function resolveClientLabel(method, url) {
  const key = `${method} ${url}`;
  const match = Object.keys(CLIENT_LABELS)
    .filter(k => key.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return match ? CLIENT_LABELS[match] : null;
}

/** Private axios instance — no spinner interceptors */
const _http = axios.create({
  baseURL: resolveApiBaseUrl(),
  timeout: 5000,
  withCredentials: true,
});

let _events = [];
let _pollTimer = null;
let _startedAt = null;
let _sinceTimestamp = null;
let _stopped = false;
let _lastServerEventAt = null;
let _idleCheckCount = 0;
const _listeners = new Set();
// Bumped by start()/stop(). A poll() already in flight when the session is
// stopped and quickly restarted only checked `_stopped` before its await —
// never after — so its response could still land on (and corrupt) a new
// session's state. Captured at the top of poll() and re-checked after the
// await, before any side effects.
let _generation = 0;

function notify() {
  const snapshot = [..._events];
  _listeners.forEach(fn => { try { fn(snapshot); } catch (_) {} });
}

function timeDelta(eventTimestamp) {
  if (!_startedAt) return '+0.0s';
  const delta = (new Date(eventTimestamp).getTime() - _startedAt) / 1000;
  return `+${Math.max(0, delta).toFixed(1)}s`;
}

function iconFor(category) {
  return CATEGORY_ICONS[category] || '📋';
}

/** Strip origin (https://host:port) from URLs to save horizontal space */
function stripOrigin(url) {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch (_) {
    return url; // not a full URL, return as-is
  }
}

function truncate(str, max = 120) {
  if (!str) return '';
  if (typeof str !== 'string') return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function pushEvent(evt) {
  _events.push(evt);
  if (_events.length > MAX_EVENTS) _events = _events.slice(-MAX_EVENTS);
  notify();
}

async function poll() {
  if (_stopped) return;
  const gen = _generation;
  try {
    const params = { limit: 20 };
    if (_sinceTimestamp) params.since = _sinceTimestamp;
    const res = await _http.get('/api/app-events', { params });
    if (gen !== _generation) return; // session stopped/restarted while this was in flight
    const serverEvents = res.data?.events || [];

    for (const e of serverEvents) {
      // Dedup by id
      if (_events.some(x => x.id === e.id)) continue;
      pushEvent({
        id: e.id,
        icon: iconFor(e.category),
        timeDelta: timeDelta(e.timestamp),
        message: truncate(e.message),
        source: 'server',
      });
    }

    // Advance since cursor to latest event
    if (serverEvents.length > 0) {
      _sinceTimestamp = serverEvents[serverEvents.length - 1].timestamp;
      _lastServerEventAt = Date.now();
      _idleCheckCount = 0;
    } else {
      _idleCheckCount++;
      // Auto-stop polling if no events for IDLE_TIMEOUT_MS
      if (_lastServerEventAt === null && _idleCheckCount > (IDLE_TIMEOUT_MS / POLL_INTERVAL_MS)) {
        spinnerActivity.stop();
        return;
      }
    }
  } catch (err) {
    if (gen !== _generation) return; // stale error from an ended/replaced session
    const status = err?.response?.status;
    // Non-admin or unauthenticated — silently stop, no retries
    if (status === 401 || status === 403) {
      spinnerActivity.stop();
      return;
    }
    // Other errors: ignore silently (network blip, server down)
  }
}

let _clientEventId = 0;

export const spinnerActivity = {
  /**
   * Start polling. Called when spinner becomes visible.
   */
  start() {
    if (_pollTimer) return; // already running
    _generation++;
    _stopped = false;
    // Preserve events buffered by addClientEvent before start()
    if (!_startedAt) {
      _startedAt = Date.now();
      _events = [];
      _clientEventId = 0;
    }
    _lastServerEventAt = null;
    _idleCheckCount = 0;
    // Look back 5 seconds to catch events that triggered the spinner
    _sinceTimestamp = new Date(_startedAt - 5000).toISOString();
    notify();

    // First poll immediately, then on interval
    poll();
    _pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  },

  /**
   * Stop polling. Called when spinner hides.
   */
  stop() {
    _generation++;
    _stopped = true;
    _startedAt = null;
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
  },

  /**
   * Add a client-side event (e.g. in-flight API call) instantly.
   * Auto-initializes timing if called before start() (race with debounce).
   * @param {string} method - HTTP method
   * @param {string} url - Request URL
   */
  addClientEvent(method, url) {
    // Skip background polling routes — they're noise, not signal
    const path = stripOrigin(url).split('?')[0];
    if (SILENT_ROUTES.has(path)) return;

    // Auto-initialize if called before start() (spinner debounce hasn't fired yet)
    if (!_startedAt) {
      _startedAt = Date.now();
      _stopped = false;
      _events = [];
      _clientEventId = 0;
    }
    if (_stopped) return;
    _clientEventId++;
    const label = resolveClientLabel(method.toUpperCase(), path)
      || truncate(`${method.toUpperCase()} ${path}`);
    pushEvent({
      id: `client-${_clientEventId}`,
      icon: iconFor('client'),
      timeDelta: timeDelta(new Date().toISOString()),
      message: label,
      source: 'client',
    });
  },

  /**
   * Subscribe to event changes. Returns unsubscribe function.
   * @param {function} fn - Callback receiving event array
   */
  subscribe(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  },

  getEvents() {
    return [..._events];
  },
};
