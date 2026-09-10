// demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx
// Cursor-IDE-styled MCP client for PingOne Privilege MCP Gateway.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { FootprintSkinPicker } from '../components/aiFootprintMocks/FootprintSkinPicker';
import ToolsTable from '../components/privilege/ToolsTable';
import JsonHighlight from '../components/shared/JsonHighlight';
import JsonFormView from '../components/shared/JsonFormView';
import DraggableModal from '../components/DraggableModal';
import PrivilegeMcpLearningPage from './PrivilegeMcpLearningPage';
import './PrivilegeMcpClientPage.css';

const API_BASE = '/api/privilege-mcp';
// Deep link for the "grant access" hint on a policy denial. The env must be the
// PingOne tenant that OWNS the gateway the door points at, or the link opens a
// console with no such Agentic App in it. Kept in step with PRIVILEGE_SSO_ENV_ID
// / the gateway's ENV_PROXY_TOKEN tenant — 0428ba4f ("AI Agent") since the
// 2026-09-01 rebuild onto mcpgw.ai-demo.ping-devops.com. It pointed at the
// retired 01d89b06 tenant until then, which sent people to the wrong console.
const PRIVILEGE_CONSOLE_URL =
  'https://console.login.privilege.pingone.com/?env=0428ba4f-169c-436b-aff9-b230496e0e3b';
// An empty Explorer panel reads as a failed fetch. Usually it is not: the BFF
// only issues prompts/list or resources/list when the server advertised that
// capability in its initialize response, so an empty panel most often means the
// server has none to give. Say which of the two it is.
// The banking backend, for example, advertises only {tools, logging}.
// The AI Gateway routes on the application name: /<door>/mcp. Our own façade
// routes are nested one level deeper (/mcp-facade/<door>/mcp), so the first
// segment there is always the meaningless "mcp-facade" — skip it.
//
// privilege-gateway is itself a multiApp door: /mcp-facade/privilege-gateway/
// <app>/mcp resolves to <gateway>/<app>/mcp (mcpFacade.js DOORS.privilege-gateway).
// Naming by the door here would collapse every registered Agentic App
// (opensearch22, opensearch, brave, ...) to the same "privilege-gateway"
// label — name by the APP segment instead when one is present.
function doorName(mcpUrl) {
  try {
    const segments = new URL(mcpUrl).pathname.split('/').filter(Boolean);
    let idx = 0;
    if (segments[idx] === 'mcp-facade') idx += 1;
    if (segments[idx] === 'privilege-gateway' && segments.length > idx + 2) idx += 1;
    return segments[idx] || null;
  } catch { return null; }
}

// Every string value anywhere in an undocumented object.
function specStrings(value, out = []) {
  if (typeof value === 'string') out.push(value.toLowerCase());
  else if (Array.isArray(value)) value.forEach((v) => specStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => specStrings(v, out));
  return out;
}

// The pacpolicy Spec schema is undocumented, so we do NOT parse it — we compare
// against whole string values inside it. Whole values, not substrings: the door
// "cmuir" is a substring of the principal "cmuir+demo@pingone.com", so
// JSON.stringify(...).includes() marked every policy as mentioning every door.
// This says a policy MENTIONS a name, never that it grants access — the UI
// wording has to stay that careful or it states something it cannot know.
function policyMentions(policy, needle) {
  if (!needle) return false;
  return specStrings(policy.spec || {}).includes(String(needle).toLowerCase());
}

// NotAfter is a top-level PacPolicy field (not in the Spec), so unlike the
// "mentions" heuristic this is a fact. Time-boxed policies are common, and an
// expired one denies exactly like a missing one.
function policyExpired(policy) {
  const t = Date.parse(policy.notAfter || '');
  return Number.isFinite(t) && t < Date.now();
}

function capabilityNote(declared, kind) {
  return declared
    ? `Server advertises ${kind} but returned none.`
    : `Server does not advertise ${kind}.`;
}

const MCP_METHOD_TEMPLATES = {
  'resources/read': { uri: '' },
  'prompts/get': { name: '', arguments: {} },
  'completion/complete': { ref: { type: 'ref/prompt', name: '' }, argument: { name: '', value: '' } },
  'tasks/get': { taskId: '' },
  'tasks/update': { taskId: '', action: 'input', input: {} },
};

// Sign-in behaviour for every MCP door, in the order the radio shows them.
// The BFF owns the mode→OIDC-params mapping (services/mcpBrokerPrompt.js); this
// list only has to name and explain the choices.
const BROKER_PROMPT_MODES = [
  {
    value: 'once',
    label: 'Once per session',
    hint: 'Sign in at the first door; the rest reuse it (OIDC max_age).',
  },
  {
    value: 'login',
    label: 'Every time',
    hint: 'Force a fresh sign-in on every door (prompt=login).',
  },
  {
    value: 'select_account',
    label: 'Pick the account',
    hint: "Show PingOne's account chooser each time (prompt=select_account).",
  },
  {
    value: 'off',
    label: 'Off',
    hint: 'Send nothing — PingOne silently reuses the browser session.',
  },
];

// These two live outside API_BASE (/api/privilege-mcp): the read is on the
// façade so both brokers can fetch it unauthenticated, and the write is on the
// admin config surface because this page is public.
const BROKER_PROMPT_READ = '/mcp-facade/broker-prompt';
const BROKER_PROMPT_WRITE = '/api/admin/config/mcp-broker-prompt';

// The façade's RFC 8693 next-hop exchange. It is a normal feature flag
// (FLAG_REGISTRY is the source of truth for what flags exist), surfaced here as
// well because what it changes — the token.exchange hop — is visible in THIS
// page's TRACE panel. Same endpoint the Feature Flags page uses.
const UPSTREAM_EXCHANGE_FLAG = 'ff_facade_upstream_exchange';
const FEATURE_FLAGS_API = '/api/admin/feature-flags';

function api(path, options = {}) {
  return fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'include',
  }).then(async (r) => {
    const text = await r.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!r.ok) {
      const err = new Error(data.error || text || `HTTP ${r.status}`);
      // The STATUS, not just the prose. The message is data.error -- a code like
      // 'unauthenticated', which contains neither '401' nor 'bearer token
      // required', so a challenge detected by substring alone was invisible and
      // the raw JSON reached the operator with no sign-in offered. The LLM lane
      // table reads it too, to name WHICH layer refused: 400 the caller, 403
      // Privilege policy, 503 missing config, 502 the provider.
      err.status = r.status;
      // Extra flags alongside the error string (never instead of it) — e.g.
      // pingoneAdminLocalHandler's delegated-PKCE login requirement carries a
      // loginUrl a caller can act on instead of just showing the message.
      if (data.loginUrl) err.loginUrl = data.loginUrl;
      // A Privilege LLM denial is a structured outcome the panel renders as the
      // security story, so its fields must survive rather than flatten to text.
      if (data.code) err.code = data.code;
      if (data.reason) err.reason = data.reason;
      if (data.provider) err.provider = data.provider;
      if (data.route) err.route = data.route;
      throw err;
    }
    return data;
  });
}


function scopeColor(scope) {
  if (scope.startsWith('mcp:')) return 'scope-mcp';
  if (scope.startsWith('p1:')) return 'scope-p1';
  if (scope === 'openid' || scope === 'profile' || scope === 'email') return 'scope-oidc';
  if (scope.includes('read')) return 'scope-read';
  if (scope.includes('write') || scope.includes('admin') || scope.includes('manage')) return 'scope-write';
  return 'scope-default';
}

function isGatewayAuthChallenge(error) {
  // Status first: every 401 is a challenge, whatever the body happens to say.
  // The substring tests remain for errors raised without one -- a challenge
  // parsed out of a WWW-Authenticate header, or thrown by our own code.
  if (error?.status === 401) return true;
  const message = String(error?.message || '').toLowerCase();
  return message.includes('401') || message.includes('bearer token required') || message.includes('authorization_uri');
}

/**
 * A 401 does not say WHICH sign-in it wants, and this page has two.
 *
 * The PingOne Admin door needs a delegated PKCE login of its own
 * (routes/mcpPingOneAdminAuth.js), which the façade advertises by attaching a
 * loginUrl to the challenge. Everything else needs this page's gateway OAuth.
 * Sending an operator to the gateway modal for a door that cannot use it is
 * a dead end, so the loginUrl always wins when present.
 *
 * Returns the action taken so a caller can word its own message.
 */
function authChallengeKind(error, { alreadyReturnedFromAdminLogin = false } = {}) {
  if (!isGatewayAuthChallenge(error) && !error?.loginUrl) return null;
  // Never bounce twice: coming back from that round trip still unauthenticated
  // means the login did not take, and a second redirect is a loop.
  if (error?.loginUrl && !alreadyReturnedFromAdminLogin) return 'pingone-admin-login';
  return isGatewayAuthChallenge(error) ? 'gateway-signin' : null;
}

// The three ways to reach the same MCP server. Each says what the audience is
// meant to notice, because the whole page is a comparison.
//
// This replaced an Agent/Agentless pair on 2026-09-02: there is one AI Gateway
// now, and the agent-mode frontend the old option named has nothing behind it.
// The mode is authoritative — it used to be sniffed from the URL, which guessed
// wrong the moment two paths shared a hostname, as the façade and direct doors do.
const GATEWAY_MODES = {
  direct: {
    key: 'direct',
    title: 'Direct to MCP',
    // The door still authenticates — every façade door sets requireBearer, so
    // "nobody checks who asked" was never true here and read as a bug once the
    // 401 became visible. What Direct actually leaves out is Privilege: no
    // per-tool policy, no denial, no record of the call.
    detail: 'No Privilege in this path. The door still checks who you are, but no per-tool policy is applied, nothing is denied, and nothing is recorded.',
  },
  privilege: {
    key: 'privilege',
    title: 'Privilege AI Gateway',
    detail: 'The gateway authenticates the user and applies per-tool policy. The client registers with the gateway, so a gateway restart breaks it.',
  },
  facade: {
    key: 'facade',
    title: 'Privilege — through the façade',
    detail: 'Same policy, same user token upstream, but the client registers with our own authorization server and survives a gateway restart.',
  },
};

// The Path picker carries two kinds of route. The three above are MCP paths — they
// change which gateway the TOOL calls traverse. These three are LLM paths: the chat
// prompt goes to a model through a Privilege virtual key instead of to the MCP agent
// loop, so the thing under policy is the PROMPT, not a tool. Prefixed 'llm:' in the
// select so one control can offer both without two dropdowns.
const LLM_PATHS = {
  anthropic: { key: 'anthropic', title: 'LLM — Anthropic through Privilege', detail: 'The prompt goes to Claude through a Privilege virtual key. Privilege injects the provider key and can deny the call before the model ever sees it.' },
  google: { key: 'google', title: 'LLM — Google through Privilege', detail: 'The prompt goes to Gemini through a Privilege virtual key. Privilege injects the provider key and can deny the call before the model ever sees it.' },
  openai: { key: 'openai', title: 'LLM — OpenAI through Privilege', detail: 'The prompt goes to GPT through a Privilege virtual key. Privilege injects the provider key and can deny the call before the model ever sees it.' },
};

// Which surfaces each view mode shows. Demo keeps Tools (its Run buttons and
// Present mode ARE a demo move) and RESULTS (the returned data is half of what
// you are showing), so the split is narrower than "chat vs everything else".
const VIEW_TABS = {
  demo: ['chat', 'tools'],
  inspect: ['mcp', 'rpc', 'policies'],
};
const VIEW_TERMINAL_TABS = {
  demo: ['trace', 'results'],
  inspect: ['events', 'trace', 'scopes', 'results'],
};
const TAB_LABELS = [
  ['chat', 'Agent Chat'],
  ['tools', 'Tools'],
  ['mcp', 'MCP Explorer'],
  ['rpc', 'Raw RPC'],
  ['policies', 'Policies'],
];

function gatewayModeDetails(mode, mcpUrl) {
  const known = GATEWAY_MODES[mode];
  if (!known) return { key: 'unknown', title: 'Connection not selected', detail: 'Pick a path in Settings.' };
  return { ...known, url: mcpUrl };
}

/**
 * Every JSON output on this page — MCP responses, raw JSON-RPC, tool results,
 * trace frames — through one Form/JSON toggle, matching /llm-gateway's idiom.
 * Form wins by default: an MCP tools/call response is nested enough that the
 * raw text is the harder read, and the raw text is one click away.
 * Each pane owns its own toggle state so switching the Explorer to JSON does
 * not silently reformat the trace log someone is mid-read of.
 */
function JsonPane({ value, deep = false, emptyMessage, label = 'Output view' }) {
  const [view, setView] = useState('form');
  return (
    <>
      <div className="cur-viewtoggle" role="group" aria-label={label}>
        <button
          type="button"
          className={view === 'form' ? 'is-active' : ''}
          aria-pressed={view === 'form'}
          onClick={() => setView('form')}
        >
          Form
        </button>
        <button
          type="button"
          className={view === 'json' ? 'is-active' : ''}
          aria-pressed={view === 'json'}
          onClick={() => setView('json')}
        >
          JSON
        </button>
      </div>
      {view === 'form'
        ? <div className="cur-formview"><JsonFormView value={value} emptyMessage={emptyMessage} /></div>
        : <pre className="cur-code-output jh-dark"><JsonHighlight value={value} deep={deep} /></pre>}
    </>
  );
}

export default function PrivilegeMcpClientPage() {
  // The setter matters as much as the getter here: `auth` used to be left in the
  // URL forever, and the mount effect below treats ANY `auth` param as "we just
  // came back from a round trip, do not retry silently". So a bookmarked or
  // shared `?auth=success` link suppressed silent sign-in permanently and went
  // straight to a sign-in prompt on a session that was perfectly able to sign in
  // by itself. It is consumed once, then stripped.
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [config, setConfig] = useState({ mcpUrl: '', clientId: '', scopes: 'openid profile email', llmUrl: 'http://127.0.0.1:11434', llmModel: 'llama3.2:1b' });
  // Per-mode "what actually supplies the OAuth client", from /state. Only read
  // when the Client ID field is blank, which is the normal state for every door
  // shipped here (they all self-advertise and register their own client).
  const [clientHints, setClientHints] = useState({});
  const [gatewayMode, setGatewayMode] = useState('privilege');
  // '' = an MCP path is active. Non-empty = chat goes to that LLM lane instead.
  const [llmPath, setLlmPath] = useState('');
  const [gatewaySession, setGatewaySession] = useState(null);
  // The provider lanes, their probes and the prove-the-policy prompt all live on
  // /llm-gateway now — this page kept a second copy of them for months. What
  // stays is the gateway URL, because the mode switcher's LLM path still routes
  // the CHAT through it and the connection rail prints where that goes.
  const [llmGatewayUrl, setLlmGatewayUrl] = useState('');
  const [rearmError, setRearmError] = useState('');
  const [preflight, setPreflight] = useState(null);
  const [preflightError, setPreflightError] = useState('');
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [gatewayConfigs, setGatewayConfigs] = useState({ direct: {}, privilege: {}, facade: {} });
  const [presets, setPresets] = useState([]);
  const [gatewayStateLoaded, setGatewayStateLoaded] = useState(false);
  // Path switch in flight. The sessionStorage flag lets
  // the overlay survive the OAuth redirect and show again from first paint on
  // the ?auth=success return, until tools are rediscovered from the new gateway.
  const savedMcpUrlRef = useRef('');
  const [switching, setSwitching] = useState(() => {
    try { return sessionStorage.getItem('cur_priv_switching') === '1'; } catch { return false; }
  });
  const clearSwitching = useCallback(() => {
    setSwitching(false);
    try { sessionStorage.removeItem('cur_priv_switching'); } catch { /* storage disabled */ }
  }, []);
  const [authenticated, setAuthenticated] = useState(false);
  const [mainAppAuthenticated, setMainAppAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [grantedScopes, setGrantedScopes] = useState([]);
  const [tools, setTools] = useState([]);
  // Discovery goes out to the AI Gateway, which can take several seconds before
  // it returns a tool list. Without a visible wait state the sidebar just reads
  // "No tools discovered yet" the whole time, which looks like a failure.
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolPolicy, setToolPolicy] = useState({ total: 0, permitted: 0, filtered: 0, filteredTools: [] });
  const [mcpCatalog, setMcpCatalog] = useState({ prompts: [], resources: [], resourceTemplates: [] });
  const [mcpProtocol, setMcpProtocol] = useState(null);
  const [mcpMethod, setMcpMethod] = useState('resources/read');
  const [mcpParams, setMcpParams] = useState(JSON.stringify(MCP_METHOD_TEMPLATES['resources/read'], null, 2));
  const [mcpResult, setMcpResult] = useState('');
  const [mcpInputRequired, setMcpInputRequired] = useState(null);
  const [mcpInputResponses, setMcpInputResponses] = useState('[]');
  const [subscriptionActive, setSubscriptionActive] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [events, setEvents] = useState([]);
  const [rawRpc, setRawRpc] = useState('{\n  "jsonrpc": "2.0",\n  "id": 1,\n  "method": "tools/list",\n  "params": {}\n}');
  const [rawRpcResult, setRawRpcResult] = useState('');
  const [showBlockedModal, setShowBlockedModal] = useState(false);
  const [showSignInModal, setShowSignInModal] = useState(false);
  // The gateway answers a policy denial with a bare "Forbidden" and writes
  // nothing to its own log, so the modal has to assemble its own evidence:
  // the door and identity we already know, plus a live probe of the other doors.
  // Only the upstream error is captured here — the door is derived at RENDER
  // time (deniedDoor, below) because refreshTools closes over `config` from the
  // render that defined it, which on the auth=success remount is still the
  // empty default. Storing it here printed Door "(unknown)" in every live
  // denial; no amount of effect reordering fixes a stale closure.
  const [blockedDetail, setBlockedDetail] = useState(null);
  const [doorProbe, setDoorProbe] = useState({ running: false, results: null });
  // Privilege console inventory — only populated once an auth_token is pasted.
  const [consoleToken, setConsoleToken] = useState('');
  const [consoleData, setConsoleData] = useState(null);
  // The BFF persists every console read (privilegeDoorStore.lmdb) and ships the
  // summary on /state, so the door list and its policy mentions outlive the ~1h
  // token that produced them. Without this the Policies tab asks for a token it
  // does not need to answer "which policies name this door" — the answer is
  // already on disk. Names only: the raw Specs are not persisted.
  const [doorDiscovery, setDoorDiscovery] = useState(null);
  // Which policy the operator is reading. Purely a viewer: selecting one cannot
  // change which policy Privilege applies — that is resolved server-side from
  // (user, door, tool), which is why this is not offered as a control anywhere
  // near the connection settings.
  const [selectedPolicy, setSelectedPolicy] = useState('');
  const [consoleBusy, setConsoleBusy] = useState(false);
  const [consoleError, setConsoleError] = useState(null);
  // Derived every render, so it reflects the config the page actually holds by
  // the time the denial modal paints — not whatever was in scope when the 403
  // arrived. See the blockedDetail comment above.
  const deniedDoor = doorName(config.mcpUrl);
  // Was a blocking modal. It is now a line on the connection rail's "Gateway
  // identity" row, next to the Sign in button it is explaining — a demo that
  // has just been refused should keep its trace, tools and denial band on
  // screen, not have them covered by a dialog whose only action is the button
  // already sitting in the rail.
  const [signInReason, setSignInReason] = useState('');
  // "No Privilege in the path" (GATEWAY_MODES above) describes what Direct
  // mode adds on top of a door, not whether the door itself needs a bearer —
  // opensearch and brave still façade-challenge (requireBearer, see
  // mcpFacade.js's DOORS), so a 401 there is exactly as real as it is under
  // Façade/Privilege. Every isGatewayAuthChallenge() call site routes through
  // here instead of the raw setter so this stays in one place, not seven.
  const requestSignIn = (reason) => {
    // The rail note alone lost the room: it renders three rows down from the
    // failure and reads as description, not as the next action. Raise a modal
    // over it too -- the note stays, so nothing that keys on it changes.
    setShowSignInModal(true);
    setSignInReason(
      reason
        || 'This gateway is its own authorization server, so it issues its own token '
           + 'rather than reusing your app session. Silent sign-in did not complete, so '
           + 'this one may ask for your credentials.',
    );
  };
  /**
   * Act on an auth challenge, whichever sign-in it turns out to want.
   * Returns true when it handled the error, so a caller can skip its own
   * error reporting rather than double-reporting.
   */
  const handleAuthChallenge = (err, { silent = false } = {}) => {
    const kind = authChallengeKind(err, {
      alreadyReturnedFromAdminLogin: searchParams.get('pingone_admin_login') === 'success',
    });
    if (kind === 'pingone-admin-login') {
      if (!silent) appendChat('system', 'Signing in for PingOne Admin access...');
      window.location.href = err.loginUrl;
      return true;
    }
    if (kind === 'gateway-signin') {
      requestSignIn();
      return true;
    }
    return false;
  };
  const [showFlowModal, setShowFlowModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [toolSearch, setToolSearch] = useState('');
  const [activeTab, setActiveTab] = useState('chat');
  // How hard the MCP OAuth brokers make PingOne re-authenticate. Server-owned
  // (BFF key mcp_broker_prompt) because BOTH brokers read it — including the one
  // LM Studio talks to, which never loads this page.
  const [brokerPrompt, setBrokerPrompt] = useState(null);
  const [brokerPromptBusy, setBrokerPromptBusy] = useState(false);
  const [brokerPromptError, setBrokerPromptError] = useState('');
  const [upstreamExchange, setUpstreamExchange] = useState(null);
  const [upstreamExchangeBusy, setUpstreamExchangeBusy] = useState(false);
  const [upstreamExchangeError, setUpstreamExchangeError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(BROKER_PROMPT_READ, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (!cancelled) setBrokerPrompt(d.mode); })
      .catch(() => { if (!cancelled) setBrokerPromptError('Could not read the current setting.'); });
    return () => { cancelled = true; };
  }, []);

  // Read on mount, like the broker prompt above: the panel this switch lives in
  // is one tab away, and any session can flip the flag, so a value read once at
  // load is the same freshness guarantee the neighbouring control gives.
  useEffect(() => {
    let cancelled = false;
    fetch(FEATURE_FLAGS_API, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (cancelled) return;
        const flag = (d.flags || []).find((f) => f.id === UPSTREAM_EXCHANGE_FLAG);
        setUpstreamExchange(flag ? flag.value === true : null);
        setUpstreamExchangeError(flag ? '' : 'Flag not found on the server.');
      })
      .catch(() => { if (!cancelled) setUpstreamExchangeError('Could not read the current setting.'); });
    return () => { cancelled = true; };
  }, []);

  const saveUpstreamExchange = useCallback(async (next) => {
    const previous = upstreamExchange;
    setUpstreamExchange(next);      // optimistic: the switch must feel immediate
    setUpstreamExchangeBusy(true);
    setUpstreamExchangeError('');
    try {
      const r = await fetch(FEATURE_FLAGS_API, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: { [UPSTREAM_EXCHANGE_FLAG]: next } }),
        credentials: 'include',
      });
      const data = await r.json().catch(() => ({}));
      // Reads are open so the switch renders for anyone; writes go through
      // authenticateToken. Say that, rather than showing the raw
      // "authentication_required" to a visitor who is simply not signed in.
      if (r.status === 401 || r.status === 403) throw new Error('Sign in to change this.');
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      // Trust the server's read-back for the same reason as the broker prompt
      // below: an unrecognised id is dropped, and an optimistic switch would
      // happily show a write that never landed.
      const flag = (data.flags || []).find((f) => f.id === UPSTREAM_EXCHANGE_FLAG);
      if (flag) setUpstreamExchange(flag.value === true);
    } catch (err) {
      setUpstreamExchange(previous);
      setUpstreamExchangeError(err.message || 'Could not save.');
    } finally {
      setUpstreamExchangeBusy(false);
    }
  }, [upstreamExchange]);

  const saveBrokerPrompt = useCallback(async (mode) => {
    const previous = brokerPrompt;
    setBrokerPrompt(mode);          // optimistic: the radio must feel immediate
    setBrokerPromptBusy(true);
    setBrokerPromptError('');
    try {
      const r = await fetch(BROKER_PROMPT_WRITE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: mode }),
        credentials: 'include',
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      // Trust the server's read-back, not the click: mcp_broker_prompt has to be
      // registered in configStore's FIELD_DEFS or setConfig drops it silently,
      // and an optimistic radio would happily show a write that never landed.
      setBrokerPrompt(data.prompt);
    } catch (err) {
      setBrokerPrompt(previous);
      setBrokerPromptError(
        err.message === 'unauthorized' || /401/.test(String(err.message))
          ? 'Admin sign-in required to change this.'
          : err.message || 'Could not save.',
      );
    } finally {
      setBrokerPromptBusy(false);
    }
  }, [brokerPrompt]);
  const [showPresent, setShowPresent] = useState(false);
  const jumpedToToolsRef = useRef(false);
  const silentAuthAttempted = useRef(false);
  const [silentAuthPending, setSilentAuthPending] = useState(false);
  // Page-local light/dark, independent of the app theme. The page ships a fixed
  // Cursor-IDE dark look; this lets it flip to light without touching app wiring.
  const [pageTheme, setPageTheme] = useState(() => {
    try { return localStorage.getItem('cur_priv_theme') || 'dark'; } catch { return 'dark'; }
  });
  useEffect(() => {
    try { localStorage.setItem('cur_priv_theme', pageTheme); } catch { /* storage disabled */ }
  }, [pageTheme]);

  // Demo vs Inspect. Two audiences share this page: a customer watching the
  // chain do what it was told, and whoever is working out why it did not.
  // Nothing is removed by the split — every tab, pane and modal stays mounted
  // behind this one flag — it just stops the debugging surfaces competing for
  // the room during a demo.
  //
  // Persisted for the same reason pageTheme is: a mode that resets on every
  // reload gets re-clicked on every reload, which reads as broken rather than
  // minimal. `mode` is already taken by the gateway path above.
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem('cur_priv_view') === 'inspect' ? 'inspect' : 'demo'; } catch { return 'demo'; }
  });
  useEffect(() => {
    try { localStorage.setItem('cur_priv_view', viewMode); } catch { /* storage disabled */ }
  }, [viewMode]);
  const inspecting = viewMode === 'inspect';
  // Each mode remembers where you were, so flipping across to check a policy
  // and back does not dump you on Agent Chat with your place lost.
  const [lastTab, setLastTab] = useState({ demo: 'chat', inspect: 'mcp' });
  const chooseTab = (tab) => {
    setActiveTab(tab);
    setLastTab((prev) => ({ ...prev, [viewMode]: tab }));
  };
  const switchViewMode = (next) => {
    if (next === viewMode) return;
    setViewMode(next);
    setActiveTab(lastTab[next]);
  };

  const [terminalTab, setTerminalTab] = useState('events');
  // Derived rather than corrected, so nothing has to police setActiveTab /
  // setTerminalTab. Two callers set a terminal tab from elsewhere on the page
  // (a scope pill, a subscription start) and both live on Inspect-only
  // surfaces — but a stored 'inspect' view on a fresh mount would otherwise
  // land on activeTab's 'chat' default, which is not an Inspect tab at all.
  const visibleTab = VIEW_TABS[viewMode].includes(activeTab) ? activeTab : lastTab[viewMode];
  const visibleTerminalTab = VIEW_TERMINAL_TABS[viewMode].includes(terminalTab) ? terminalTab : 'trace';
  const mode = llmPath
    ? { ...LLM_PATHS[llmPath], url: llmGatewayUrl }
    : gatewayModeDetails(gatewayMode, config.mcpUrl);
  // ONE answer to "are we signed in to the gateway", read by the rail, the
  // status bar and nothing else. It deliberately does not consider
  // mainAppAuthenticated: the app token is aud: enduser.ping.demo and is
  // accepted by exactly zero doors, so counting it as gateway auth is what made
  // three surfaces disagree with each other and with the sign-in prompt.
  const gatewayAuth = authenticated ? 'signed-in' : silentAuthPending ? 'connecting' : 'needed';
  // The latest tool-call result shown in the RESULTS terminal tab. resultNonce
  // bumps on each new result to flash the tab so the user notices output arrived.
  const [toolResults, setToolResults] = useState([]);
  const [resultNonce, setResultNonce] = useState(0);
  // Scope picked in the left rail — echoed/highlighted in the right SCOPES table.
  // With a long granted-scope list, clicking a pill on the left jumps to its row.
  const [selectedScope, setSelectedScope] = useState(null);
  const scopeRowRef = useRef(null);
  // Tool picked in the left rail — the right Tools table scrolls to and expands
  // it. The nonce lets the same tool re-trigger the reveal on a second click.
  const [selectedTool, setSelectedTool] = useState(null);
  const [toolSelectNonce, setToolSelectNonce] = useState(0);
  const selectTool = useCallback((name) => {
    setSelectedTool(name);
    setToolSelectNonce((n) => n + 1);
    setActiveTab('tools');
  }, []);
  // Fresh-demo reset: wipe chat, events, results, and discovered tools but keep
  // the Privilege sign-in and gateway config. The empty /config POST resets the
  // server-side MCP session (resetMcpState) without changing any config value.
  const clearActivity = useCallback(() => {
    setChatMessages([]);
    setChatInput('');
    setEvents([]);
    setToolResults([]);
    setRawRpcResult('');
    setTools([]);
    setToolPolicy({ total: 0, permitted: 0, filtered: 0, filteredTools: [] });
    setSelectedTool(null);
    setSelectedScope(null);
    setToolSearch('');
    api('/config', { method: 'POST', body: {} }).catch(() => { /* page state already cleared */ });
  }, []);
  const [envVars, setEnvVars] = useState(null);
  const [envDirty, setEnvDirty] = useState(false);
  const chatEndRef = useRef(null);
  const sidebarRef = useRef(null);
  const terminalRef = useRef(null);
  const bodyRef = useRef(null);

  // Drag cleanup refs so an unmount mid-drag (route change with the button
  // held) can also remove the listeners — same class of leak useDividerDrag
  // guards against for its callers.
  const dragCleanupRef = useRef(null);

  const startSidebarDrag = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarRef.current.offsetWidth;
    const onMove = (ev) => {
      const next = Math.max(200, Math.min(1000, startW + ev.clientX - startX));
      sidebarRef.current.style.width = `${next}px`;
    };
    // Pointer capture keeps pointermove/pointerup delivered to this element
    // even if the cursor leaves the document (taskbar, another window, an
    // iframe) — a plain document mouseup listener never fires there, which
    // used to leave onMove permanently attached.
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      try { e.target.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      dragCleanupRef.current = null;
    };
    try { e.target.setPointerCapture(e.pointerId); } catch { /* environment without Pointer Capture support */ }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    dragCleanupRef.current = onUp;
  };

  const startTerminalDrag = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = terminalRef.current.offsetHeight;
    const onMove = (ev) => {
      const next = Math.max(80, Math.min(500, startH - (ev.clientY - startY)));
      terminalRef.current.style.height = `${next}px`;
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      try { e.target.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      dragCleanupRef.current = null;
    };
    try { e.target.setPointerCapture(e.pointerId); } catch { /* environment without Pointer Capture support */ }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    dragCleanupRef.current = onUp;
  };

  useEffect(() => () => { dragCleanupRef.current?.(); }, []);

  useEffect(() => {
  }, [activeTab, authenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll the message list itself, never the window: scrollIntoView() walked up
  // to the document and pushed the title bar (and its Skin picker) off-screen on
  // first paint.
  useEffect(() => {
    const list = chatEndRef.current?.parentElement;
    if (list) list.scrollTop = list.scrollHeight;
  }, [chatMessages]);

  const appendChat = useCallback((role, content, extra = null) => {
    setChatMessages((prev) => [...prev, { role, content, extra, ts: Date.now() }]);
  }, []);

  const appendEvent = useCallback((entry) => {
    setEvents((prev) => [entry, ...prev].slice(0, 200));
  }, []);

  useEffect(() => {
    api('/state').then((s) => {
      setConfig(s.config || config);
      setGatewayMode(s.gatewayMode || 'privilege');
      setGatewaySession(s.gatewaySession || null);
      setGatewayConfigs(s.gatewayConfigs || { direct: {}, privilege: {}, facade: {} });
      savedMcpUrlRef.current = s.config?.mcpUrl || '';
      setPresets(Array.isArray(s.presets) ? s.presets : []);
      setDoorDiscovery(s.doorDiscovery?.persisted ? s.doorDiscovery : null);
      setClientHints(s.clientHints || {});
      setAuthenticated(Boolean(s.oauth?.authenticated));
      setMainAppAuthenticated(Boolean(s.mainAppAuthenticated));
      setUser(s.user || null);
      if (s.oauth?.scope) setGrantedScopes(s.oauth.scope.split(' ').filter(Boolean));
      setTools(s.tools || []);
      setToolPolicy(s.policy || { total: (s.tools || []).length, permitted: (s.tools || []).length, filtered: 0, filteredTools: [] });
      setMcpProtocol(s.mcp || null);
      setSubscriptionActive(Boolean(s.mcp?.subscriptionActive));
      setGatewayStateLoaded(true);
      // Auto-connect Privilege using the active PingOne session when the main app
      // is already logged in. The gateway is its own Authorization Server, so the
      // banking token can never be reused directly — but prompt=none on the BFF
      // (see privilegeMcpClient.js beginOAuthFlow) completes off the existing
      // PingOne session, so this costs one redirect and no login page.
      //
      // NEVER auto-retry once an attempt has already come back: by then the BFF
      // has set privilegePromptNoneFailed, so a second /auth/start drops the user
      // on a real PingOne login page they never asked for. Any `auth` param means
      // we are returning from a round trip — hand back to the modal instead.
      // Use s.gatewayMode (this response), not the gatewayMode state variable —
      // this effect has an empty dep array, so that closure only ever sees the
      // mount-time value, never a fresh one.
      //
      // Direct is NOT excluded, for the same reason requestSignIn above stopped
      // excluding it: "no Privilege in the path" describes what Direct leaves
      // out, not whether the door needs a bearer. Every direct door is a façade
      // door with requireBearer (mcpFacade.js DOORS), so without this Direct
      // could never obtain a token at all and every one of its doors answered
      // "Not authenticated" forever. It signs in against our OWN broker here,
      // never Privilege — which is exactly what keeps Direct "direct".
      // NO automatic sign-in on load. This page used to redirect to the IdP by
      // itself the moment it mounted unauthenticated — on stage that reads as
      // the demo breaking and navigating away on its own, even when it is
      // working. The rail's "Gateway identity" row shows a Sign in button
      // instead, and nothing leaves this page until someone presses it.
      //
      // Returning from a round trip (?auth=...) still hands back to the modal:
      // that redirect was user-initiated, so reporting its outcome is expected
      // rather than surprising.
      if (s.mainAppAuthenticated && !s.oauth?.authenticated && searchParams.get('auth')) {
        requestSignIn();
      }

    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const es = new EventSource(`${API_BASE}/events`, { withCredentials: true });
    const handler = (type) => (e) => {
      try { appendEvent({ type, ...JSON.parse(e.data) }); } catch {}
    };
    es.addEventListener('relay', handler('relay'));
    es.addEventListener('oauth', handler('oauth'));
    es.addEventListener('config', handler('config'));
    es.addEventListener('mcp', handler('mcp'));
    es.addEventListener('subscription', handler('subscription'));
    es.addEventListener('error', handler('error'));
    return () => es.close();
  }, [appendEvent]);

  useEffect(() => {
    const authResult = searchParams.get('auth');
    const reason = searchParams.get('reason');
    if (authResult === 'success') {
      appendChat('system', 'OAuth completed. Press "Get MCP Tools" to discover tools.');
      api('/state').then((s) => {
        if (s.oauth?.authenticated) {
          setAuthenticated(true);
          // The app shell owns the top banner; notify it after this page's
          // gateway callback establishes the shared BFF session.
          window.dispatchEvent(new CustomEvent('userAuthenticated'));
        }
        if (s.oauth?.scope) setGrantedScopes(s.oauth.scope.split(' ').filter(Boolean));
      })
        // NO automatic discovery on the sign-in return trip. Signing in says
        // who you are; it does not say which door you meant to probe, and
        // firing tools/list at whatever door happened to be selected spends a
        // real call — and on a denying door pops the denial modal — before the
        // presenter has touched anything. "Get MCP Tools" is the one control
        // that discovers, so the page never calls a door nobody asked for.
        //
        // clearSwitching used to ride on refreshTools().finally; it has to run
        // on its own now or the switching overlay would never lift.
        //
        // (History, still true of the button path: discovery must not race
        // /state. They used to run concurrently, so a 403 arriving first was
        // rendered against an empty config — the denial modal said Door
        // "(unknown)" and the door probe had no presets to try, the two facts
        // that modal exists to supply.)
        .catch(() => {})
        .finally(clearSwitching);
    } else {
      // Stale switch flag (auth error, silent_failed, or back-button out of the
      // redirect) — never leave the overlay stuck.
      clearSwitching();
    }
    if (authResult === 'error') {
      appendChat('system', `OAuth failed: ${reason ? decodeURIComponent(reason) : 'Unknown'}`);
    }
    // silent_failed: prompt=none couldn't reuse a PingOne session — show the
    // manual Sign In button without an error message.
    // (no-op here; the /state effect already guards on authParam !== 'silent_failed')

    // Return trip from the pingone-admin door's separate delegated-PKCE login
    // (routes/mcpPingOneAdminAuth.js) — refresh so the newly-usable token gets
    // exercised right away instead of waiting for another manual click.
    const pingoneAdminLogin = searchParams.get('pingone_admin_login');
    if (pingoneAdminLogin === 'success') {
      appendChat('system', 'Signed in for PingOne Admin access. Refreshing tools...');
      refreshTools();
    } else if (pingoneAdminLogin === 'error') {
      appendChat('system', `PingOne Admin sign-in failed: ${reason ? decodeURIComponent(reason) : 'Unknown'}`);
    }

    // Consume the round-trip markers so a reload, a bookmark or a shared link
    // is treated as a fresh visit and gets the silent prompt=none path. The
    // /state effect above still sees them on THIS mount — its closure captured
    // the pre-strip snapshot and has an empty dep array — so the "do not
    // auto-retry after a round trip" guard is untouched for the trip we are
    // actually returning from.
    //
    // pingone_admin_login is deliberately NOT stripped: handleAuthChallenge
    // reads it on every render as its "already came back from the admin login"
    // loop guard, so removing it here would re-arm the redirect loop it exists
    // to break.
    if (authResult || reason) {
      const next = new URLSearchParams(searchParams);
      next.delete('auth');
      next.delete('reason');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveConfig = async () => {
    const urlChanged = Boolean(config.mcpUrl) && config.mcpUrl !== savedMcpUrlRef.current;
    try {
      const saved = await api('/config', { method: 'POST', body: { ...config, gatewayMode } });
      savedMcpUrlRef.current = config.mcpUrl;
      setGatewayConfigs(saved.gatewayConfigs || gatewayConfigs);
      // Direct has no auth front door at all — re-auth is meaningless there,
      // and would send the browser to /auth/start with nothing configured to
      // authenticate against.
      if (!urlChanged || gatewayMode === 'direct') {
        appendChat('system', 'Configuration saved.');
        return;
      }
      // The path changed, and the three paths have different OAuth front doors —
      // Direct and Façade authenticate against our broker, Privilege against the
      // gateway itself — so the credential for the old one does not carry over.
      // Say so and stop; the rail's Sign in button is the way forward. Sending
      // the browser to the IdP from a dropdown change is what made this page
      // look broken mid-demo.
      setTools([]);
      setSelectedTool(null);
      setAuthenticated(false);
    } catch (err) {
      clearSwitching();
      appendChat('system', `Save failed: ${err.message}`);
    }
  };

  // /auth/start answering 200 with no authUrl — a misconfigured door, or a
  // changed body shape — used to send the browser to the literal string
  // "undefined": blank page, no error, nothing logged. Every caller redirects
  // through here so that failure surfaces as an exception their catch reports.
  const startAuthRedirect = async () => {
    const data = await api('/auth/start', { method: 'POST' });
    // An ungated door (mcpFacade.js DOORS.banking) has no authorization server
    // to redirect to. Its tools load with no token, so fetch them rather than
    // navigating — and say so, because a Sign in button that appears to do
    // nothing reads as broken.
    if (data?.noAuthRequired) {
      appendChat('system', 'This door needs no sign-in — its upstream owns identity. Loading tools.');
      await refreshTools();
      return;
    }
    if (!data?.authUrl) throw new Error('sign-in did not return an authorization URL');
    window.location.href = data.authUrl;
  };

  const switchGatewayMode = async (nextMode, { forceReauth = false } = {}) => {
    if (nextMode === gatewayMode && !forceReauth) return;
    const savedConfig = gatewayConfigs[nextMode] || {};
    const nextConfig = { ...config, ...savedConfig };
    const prevMode = gatewayMode;
    const prevConfig = config;

    setGatewayMode(nextMode);
    setConfig(nextConfig);
    setTools([]);
    setSelectedTool(null);
    try {
      const saved = await api('/config', {
        method: 'POST',
        body: { ...nextConfig, gatewayMode: nextMode },
      });
      savedMcpUrlRef.current = nextConfig.mcpUrl;
      setGatewayConfigs(saved.gatewayConfigs || gatewayConfigs);
      // Direct is NOT exempt. It used to return here on the reading that it has
      // "no auth front door", but every direct door is a façade door with
      // requireBearer (mcpFacade.js DOORS) — the same wrong reading the
      // 2026-09-07 fix already removed from mount-time auto-connect. Switching
      // INTO Direct nulls the token slot for the destination key, so returning
      // early left every direct door answering "Not authenticated" forever.
      // The shared check below covers it: a restored token skips the redirect.
      // The BFF restores this mode's own token if it was signed in before
      // (session.oauth is a single slot shared across modes — see POST
      // /config) — skip the full re-auth redirect instead of always forcing
      // one, which used to show the sign-in modal on every switch back to a
      // mode you were already authenticated in.
      // forceReauth skips this: a re-arm exists precisely because the gateway
      // session is dead while session.oauth may still hold a restored token.
      // Taking the shortcut there would switch mode, arm nothing, and say
      // nothing — the same dead-end button Ruling 5 removed by another route.
      if (saved.oauth?.authenticated && !forceReauth) {
        setAuthenticated(true);
        // No auto-discovery on a path switch. Choosing a path says which lane
        // to use, not that you want it probed — and probing spends a real call
        // on whatever door is selected, which on a denying one pops the denial
        // modal for a switch nobody asked to test. Drop the previous path's
        // tools so the panel cannot show results that belong to a lane you just
        // left, and let "Get MCP Tools" be the one thing that fetches.
        setTools([]);
        setSelectedTool(null);
        return;
      }
      // forceReauth IS the button: it only ever comes from the re-arm control
      // on a dead gateway session, so redirecting is what the user just asked
      // for. The no-automatic-navigation rule is about switches nobody clicked
      // "sign in" for — it is not a ban on the sign-in button working.
      if (forceReauth) {
        setSwitching(true);
        try { sessionStorage.setItem('cur_priv_switching', '1'); } catch { /* storage disabled */ }
        await startAuthRedirect();
        return;
      }
      // An ordinary switch with no credential: surface it and wait for the
      // Sign in button rather than navigating off the page.
      setAuthenticated(false);
      setTools([]);
      setSelectedTool(null);
    } catch (err) {
      clearSwitching();
      // The mode was set optimistically above. Leaving it on failure makes the
      // UI claim a mode the BFF never accepted — and unmounts the facade-only
      // banner, taking the error message with it.
      setGatewayMode(prevMode);
      setConfig(prevConfig);
      const msg = `Gateway switch failed: ${err.message}`;
      appendChat('system', msg);
      // Returned so a caller with its own error surface (the re-arm banner) can
      // show it inline; callers that ignore the return value are unaffected.
      return msg;
    }
  };

  // The façade's gateway leg is a server-side token that dies with the BFF
  // process, and the gateway offers no client_credentials grant — only a human
  // browser sign-in can mint a new one.
  //
  // It MUST be a Privilege-mode sign-in. privilegeMcpClient.js only remembers
  // the gateway session when the token exchange hit the real gateway's own
  // token endpoint (tokenOrigin === gatewayOrigin). A Façade-mode sign-in mints
  // a token from OUR broker, whose resource identifier collides by name with
  // the real gateway's, and is deliberately NOT remembered — so re-arming from
  // Façade mode would authenticate successfully and arm nothing.
  const rearmGatewaySession = useCallback(async () => {
    setRearmError('');
    setRearmError((await switchGatewayMode('privilege', { forceReauth: true })) || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [switchGatewayMode]);

  // Reuses /doors/probe — it already initializes an MCP session per URL with
  // the operator's token and returns a tool count, which is the only honest
  // proof a door works for a real caller. Goes through api() rather than a raw
  // fetch so a 401 ("Not authenticated.") arrives as an Error carrying the
  // server's message, instead of a body with no `results` that would render as
  // an empty list — a failed preflight that looks exactly like a clean one.
  const runPreflight = useCallback(async () => {
    setPreflightBusy(true);
    setPreflightError('');
    setPreflight(null);
    try {
      const urls = presets.map((p) => p.url).filter(Boolean);
      const data = await api('/doors/probe', { method: 'POST', body: { urls } });
      setPreflight(Array.isArray(data.results) ? data.results : []);
    } catch (err) {
      setPreflightError(err.message || 'Preflight failed');
    } finally {
      setPreflightBusy(false);
    }
  }, [presets]);


  // Load the lanes so the table prefills with what the SERVER actually calls,
  // rather than a path copied into the UI that can drift out of step with it.
  useEffect(() => {
    let cancelled = false;
    api('/llm/config')
      .then((cfg) => {
        if (cancelled) return;
        setLlmGatewayUrl(cfg.gatewayUrl || '');
      })
      .catch(() => { /* the rail just shows no URL for the LLM path */ });
    return () => { cancelled = true; };
  }, []);

  const loadEnv = async () => {
    try {
      const data = await api('/env');
      setEnvVars(data.vars || {});
      setEnvDirty(false);
    } catch { setEnvVars({}); }
  };

  const saveEnv = async () => {
    try {
      await api('/env', { method: 'PUT', body: { vars: envVars } });
      setEnvDirty(false);
      appendChat('system', 'Gateway .env saved. Restart mcpgw container to apply.');
    } catch (err) {
      appendChat('system', `Env save failed: ${err.message}`);
    }
  };

  const startAuth = async () => {
    try {
      await api('/config', { method: 'POST', body: config });
      await startAuthRedirect();
    } catch (err) {
      appendChat('system', `OAuth start failed: ${err.message}`);
    }
  };

  const refreshTools = async (silent = false) => {
    setToolsLoading(true);
    try {
      const data = await api('/tools/list', { method: 'POST' });
      const nextTools = data.tools || [];
      // A successful list is the only thing that clears a denial — the band has
      // to outlive a dismissed modal, but must not outlive the grant that fixes it.
      setBlockedDetail(null);
      setTools(nextTools);
      setToolPolicy(data.policy || { total: nextTools.length, permitted: nextTools.length, filtered: 0, filteredTools: [] });
      api('/catalog').then((catalog) => {
        setMcpCatalog({
          prompts: catalog.prompts || [],
          resources: catalog.resources || [],
          resourceTemplates: catalog.resourceTemplates || [],
        });
        setMcpProtocol(catalog.protocol || null);
      }).catch(() => { /* tools remain usable when optional primitives fail */ });
      setAuthenticated(true);
      if (!silent) appendChat('system', `Discovered ${nextTools.length} tools from MCP server.`);
    } catch (err) {
      setTools([]);
      // pingoneAdminLocalHandler's own auth requirement — a separate,
      // delegated-PKCE login (routes/mcpPingOneAdminAuth.js), not this page's
      // OAuth. Auto-navigate there once; if searchParams already carries
      // pingone_admin_login=success we just came back from exactly that round
      // trip and it still didn't work, so fall through to the plain error
      // instead of bouncing the browser in a loop.
      const challengeKind = authChallengeKind(err, {
        alreadyReturnedFromAdminLogin: searchParams.get('pingone_admin_login') === 'success',
      });
      if (challengeKind === 'pingone-admin-login') {
        if (!silent) appendChat('system', 'Signing in for PingOne Admin access...');
        window.location.href = err.loginUrl;
        return;
      }
      if (challengeKind === 'gateway-signin' || err.message?.toLowerCase().includes('not authenticated')) {
        setAuthenticated(false);
        requestSignIn();
        return;
      } else if (
        err.message?.toLowerCase().includes('not authorized') ||
        err.message?.includes('403') ||
        err.message?.toLowerCase().includes("doesn't have access") ||
        err.message?.toLowerCase().includes('does not have access')
      ) {
        setBlockedDetail({ upstream: err.message });
        setShowBlockedModal(true);
        if (!silent) appendChat('system', 'Access blocked by policy.');
        return;
      }
      if (!silent) appendChat('system', `Refresh failed: ${err.message}`);
    } finally {
      // finally, not a trailing line — the 403 branch returns early.
      setToolsLoading(false);
    }
  };

  const connectConsole = async () => {
    const authToken = consoleToken.trim();
    if (!authToken) return;
    setConsoleBusy(true);
    setConsoleError(null);
    try {
      const data = await api('/console/connect', { method: 'POST', body: { authToken } });
      adoptConsoleData(data);
      setConsoleToken('');   // the BFF holds it now; don't keep a copy in the DOM
    } catch (err) {
      setConsoleError(err.message);
      setConsoleData(null);
    } finally {
      setConsoleBusy(false);
    }
  };

  // Open on the policy that mentions the current door: during a denial that is
  // the one the room is asking about, and hunting a long list on stage is the
  // failure mode this avoids. Falls back to no selection rather than guessing.
  const adoptConsoleData = (data) => {
    setConsoleData(data);
    const door = doorName(config.mcpUrl);
    const match = door && (data?.policies || []).find((p) => policyMentions(p, door));
    setSelectedPolicy(match ? match.name : '');
  };

  const refreshConsole = async () => {
    setConsoleBusy(true);
    setConsoleError(null);
    try {
      adoptConsoleData(await api('/console/inventory'));
    } catch (err) {
      setConsoleError(err.message);
    } finally {
      setConsoleBusy(false);
    }
  };

  const disconnectConsole = async () => {
    await api('/console/disconnect', { method: 'POST' }).catch(() => {});
    setConsoleData(null);
    setSelectedPolicy('');
    setConsoleError(null);
  };

  const switchDoor = async (mcpUrl) => {
    const next = { ...config, mcpUrl };
    try {
      const saved = await api('/config', { method: 'POST', body: next });
      setConfig(next);
      setShowBlockedModal(false);
      appendChat('system', `Switched to door: ${doorName(mcpUrl) || mcpUrl}`);
      // session.oauth is a single slot keyed mode::mcpUrl (privilegeMcpClient.js
      // oauthKey), so selecting a door this session has never signed into leaves
      // it nulled and every later tools/list answers 401 "Not authenticated" —
      // no matter which door is picked. /config reports the DESTINATION key's
      // state; act on it rather than fetching tools with a credential the BFF
      // has just told us does not exist. Same branch switchGatewayMode uses.
      if (!saved?.oauth?.authenticated && mainAppAuthenticated) {
        // Selecting a door this session has no credential for is not an error
        // and not a reason to navigate. Show it as not signed in and let the
        // rail's Sign in button do it — most switches no longer need one at
        // all, since every door on our own origin shares a single token.
        setAuthenticated(false);
        setTools([]);
        setSelectedTool(null);
        return;
      }
      setAuthenticated(Boolean(saved?.oauth?.authenticated));
      // Same rule as the path switch above: selecting a door is not a request to
      // probe it. The tools from the door you just left are cleared so the panel
      // never shows another door's results, and "Get MCP Tools" fetches.
      setTools([]);
      setSelectedTool(null);
    } catch (err) {
      appendChat('system', `Failed to switch door: ${err.message}`);
    }
  };

  // Every Privilege door we know of: what the console reports when a token is
  // connected, falling back to the configured presets when one is not.
  //
  // includeCurrent splits the two callers. The denial probe wants "somewhere
  // ELSE to try", so it excludes the door that just failed. The header picker
  // has to include it, or the control cannot show what is currently selected.
  const knownDoors = (includeCurrent = false) => {
    // Each app carries its own URL per lane because the lanes reach it
    // differently: the gateway serves /<app>/mcp, the façade serves
    // /mcp-facade/privilege-gateway/<app>/mcp.
    //
    // Both are derived server-side from configuration, NOT from the door that
    // happened to be selected when the console was read -- consoleData outlives
    // a mode switch, so discovering in Direct mode and then switching to
    // Privilege used to leave this offering <public-origin>/<app>/mcp, which
    // never reaches the gateway. `mcpUrl` is that mode-relative value and is
    // deliberately not used here.
    //
    // Direct mode contributes NOTHING from the console. A discovered app is a
    // Privilege Agentic App; "direct" means no Privilege in the path at all, and
    // the direct doors are this demo's own façade doors, which the presets below
    // already supply. Offering a gateway URL here would let the denial probe --
    // which does not apply the picker's origin filter -- switch the client to a
    // gateway door while it is still in Direct mode, mismatching mode and auth.
    // Offering the mode-relative mcpUrl instead is no better: it is whatever
    // origin happened to be selected when the console was read.
    const fromConsole = gatewayMode === 'direct'
      ? []
      : (consoleData?.applications || [])
        .map((a) => (gatewayMode === 'facade' ? a.facadeUrl : a.gatewayUrl))
        .filter(Boolean);
    // The direct-mode presets are excluded UNLESS the active mode can actually
    // reach them: sameGatewayDoors() below groups by origin, and Direct's
    // presets (banking/brave/opensearch/pingone-admin — plain façade doors,
    // no Privilege in the path) share PUBLIC_APP_ORIGIN with Façade's own
    // presets, so Façade mode gets the same base door set as Direct — plus
    // whatever Privilege-gated multiApp targets it has of its own. Privilege
    // mode (the raw AI Gateway, a different host entirely) does not: without
    // this check they would leak into every non-direct door picker.
    const fromPresets = presets
      .filter((p) => p.mode !== 'direct' || gatewayMode === 'direct' || gatewayMode === 'facade')
      .map((p) => p.url);
    const all = [...new Set([...fromConsole, ...fromPresets, ...(includeCurrent ? [config.mcpUrl] : [])])];
    return all.filter((u) => u && (includeCurrent || u !== config.mcpUrl));
  };

  // Doors on the CURRENT gateway only — what /<door>/mcp actually means.
  //
  // The Privilege preset list also carries the audit facade
  // (http://localhost:3002/mcp-facade/audit/mcp), which is this demo's own
  // door, not a Privilege application: different host, and doorName() renders
  // it as the meaningless "mcp-facade". Offering it in a Privilege door picker
  // would misdescribe what switching does. The denial probe still tries it —
  // there "is there anywhere else this identity works" is a fair question.
  const sameGatewayDoors = () => {
    let origin;
    try { origin = new URL(config.mcpUrl).origin; } catch { return []; }
    return knownDoors(true).filter((u) => {
      try { return new URL(u).origin === origin; } catch { return false; }
    });
  };

  const probeDoors = async () => {
    const urls = knownDoors();
    if (urls.length === 0) { setDoorProbe({ running: false, results: [] }); return; }
    setDoorProbe({ running: true, results: null });
    try {
      const data = await api('/doors/probe', { method: 'POST', body: { urls } });
      setDoorProbe({ running: false, results: data.results || [] });
    } catch (err) {
      setDoorProbe({ running: false, results: [], error: err.message });
    }
  };

  // Probe as soon as the denial modal opens: the answer to "is my grant missing
  // or am I on the wrong door?" is the first thing anyone wants, and the gateway
  // will not say. Reset on close so a later denial re-probes rather than showing
  // a stale verdict.
  useEffect(() => {
    if (showBlockedModal) probeDoors();
    else setDoorProbe({ running: false, results: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBlockedModal]);

  const sendChat = async () => {
    const prompt = chatInput.trim();
    if (!prompt) return;
    appendChat('user', prompt);
    setChatInput('');
    setThinking(true);

    // LLM path: the prompt goes to a model through a Privilege virtual key, not
    // through the MCP agent loop. A denial is the demo, so it is spoken in the
    // transcript rather than thrown into the page-level error channel where the
    // conversation would just stop with no explanation.
    if (llmPath) {
      try {
        const data = await api('/llm/call', { method: 'POST', body: { provider: llmPath, prompt } });
        appendChat('assistant', data.reply, { steps: [`${llmPath} · ${data.route} · ${data.latencyMs} ms`] });
      } catch (err) {
        if (err.code === 'llm_policy_denied') {
          appendChat('assistant', `⚠️ Privilege denied this call. ${err.reason || err.message}`, {
            steps: [`${err.provider || llmPath} · ${err.route || ''} · denied by policy`],
          });
        } else {
          appendChat('assistant', `❌ ${err.message}`, { steps: [`${llmPath} · call failed`] });
        }
      } finally {
        setThinking(false);
      }
      return;
    }

    try {
      await api('/config', { method: 'POST', body: config });
      const data = await api('/chat', { method: 'POST', body: { prompt } });
      if (data.authUrl) {
        window.open(data.authUrl, '_blank', 'noopener,noreferrer');
        appendChat('assistant', `${data.reply} (Opened OAuth in new tab)`, data.steps || null);
      } else {
        appendChat('assistant', data.reply || 'Done.', {
          available_tools: (data.tools || []).map((t) => t.name),
          suggested_tools: data.suggested_tools || [],
          policy: data.policy || null,
          decision: data.decision || null,
          execution: data.execution || null,
          steps: data.steps || [],
        });
        if (data.tools) {
          setTools(data.tools);
          setToolPolicy(data.policy || { total: data.tools.length, permitted: data.tools.length, filtered: 0, filteredTools: [] });
          setAuthenticated(true);
        }
        if (data.decision?.tool && data.execution) {
          recordResult(data.decision.tool, JSON.stringify(data.execution, null, 2), data.decision.outcome === 'ALLOWED');
        }
      }
    } catch (err) {
      if (handleAuthChallenge(err)) {
        // handleAuthChallenge already said what it was doing for the admin-login
        // case; only the gateway branch needs a line of its own here.
        if (!err.loginUrl) appendChat('system', 'Sign in is required to access the gateway.');
      } else {
        appendChat('assistant', `Error: ${err.message}`);
      }
    } finally {
      setThinking(false);
    }
  };

  // Per-row executor for the Tools table: returns the pretty-printed result and
  // also records it in the RESULTS terminal tab (which flashes so the user sees
  // fresh output land).
  const recordResult = useCallback((name, result, ok) => {
    setToolResults([{ tool: name, result, ok, ts: new Date().toISOString() }]);
    setResultNonce((n) => n + 1);
    setTerminalTab('results');
  }, []);

  const executeToolCall = async (name, argsStr) => {
    let out;
    let ok = true;
    try {
      const args = JSON.parse(argsStr || '{}');
      const data = await api('/tools/call', { method: 'POST', body: { name, arguments: args } });
      out = JSON.stringify(data, null, 2);
      ok = !data?.error && !data?.result?.isError;
    } catch (err) {
      const handled = handleAuthChallenge(err, { silent: true });
      out = JSON.stringify({ error: handled ? 'Sign in is required for this door.' : err.message }, null, 2);
      ok = false;
    }
    recordResult(name, out, ok);
    return out;
  };

  // Land on the Tools tab the first time tools are discovered — it is the point
  // of the page. Only once, so it never fights later navigation.
  useEffect(() => {
    if (tools.length > 0 && !jumpedToToolsRef.current) {
      jumpedToToolsRef.current = true;
      setActiveTab('tools');
    }
  }, [tools.length]);

  // Scroll the picked scope's row into view once the SCOPES table is showing it.
  useEffect(() => {
    if (selectedScope && terminalTab === 'scopes' && scopeRowRef.current) {
      scopeRowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedScope, terminalTab]);

  // Esc closes Present mode.
  useEffect(() => {
    if (!showPresent) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setShowPresent(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showPresent]);

  const sendRawRpcCall = async () => {
    try {
      const body = JSON.parse(rawRpc);
      const data = await api('/rpc', { method: 'POST', body });
      setRawRpcResult(JSON.stringify(data, null, 2));
    } catch (err) {
      setRawRpcResult(JSON.stringify({ error: err.message }, null, 2));
    }
  };

  const chooseMcpMethod = (method) => {
    setMcpMethod(method);
    setMcpParams(JSON.stringify(MCP_METHOD_TEMPLATES[method] || {}, null, 2));
    setMcpResult('');
  };

  const sendMcpRequest = async () => {
    try {
      const params = JSON.parse(mcpParams || '{}');
      const data = await api('/request', { method: 'POST', body: { method: mcpMethod, params } });
      setMcpResult(JSON.stringify(data, null, 2));
      const result = data?.result;
      if (result?.resultType === 'input_required') {
        const responses = (result.inputRequests || []).map((input) => (
          input.method === 'elicitation/create'
            ? { action: 'accept', content: {} }
            : { error: { code: -32601, message: `Unsupported input request: ${input.method}` } }
        ));
        setMcpInputRequired({ method: mcpMethod, params, requestState: result.requestState });
        setMcpInputResponses(JSON.stringify(responses, null, 2));
      } else {
        setMcpInputRequired(null);
      }
    } catch (err) {
      const handled = handleAuthChallenge(err, { silent: true });
      setMcpResult(JSON.stringify({ error: handled ? 'Sign in is required for this door.' : err.message }, null, 2));
    }
  };

  const continueMcpRequest = async () => {
    if (!mcpInputRequired) return;
    try {
      const inputResponses = JSON.parse(mcpInputResponses || '[]');
      const params = {
        ...mcpInputRequired.params,
        requestState: mcpInputRequired.requestState,
        inputResponses,
      };
      const data = await api('/request', {
        method: 'POST', body: { method: mcpInputRequired.method, params },
      });
      setMcpResult(JSON.stringify(data, null, 2));
      if (data?.result?.resultType !== 'input_required') setMcpInputRequired(null);
    } catch (err) {
      const handled = handleAuthChallenge(err, { silent: true });
      setMcpResult(JSON.stringify({ error: handled ? 'Sign in is required for this door.' : err.message }, null, 2));
    }
  };

  const toggleSubscriptions = async () => {
    try {
      if (subscriptionActive) {
        await api('/subscriptions', { method: 'DELETE' });
        setSubscriptionActive(false);
      } else {
        await api('/subscriptions/start', { method: 'POST' });
        setSubscriptionActive(true);
        setTerminalTab('events');
      }
    } catch (err) {
      setMcpResult(JSON.stringify({ error: err.message }, null, 2));
    }
  };

  return (
    <div className="cur-ide" data-cur-theme={pageTheme}>
      {switching && (
        <div className="cur-modal-overlay cur-switch-overlay" role="status" aria-label="Switching gateway">
          <div className="cur-switch-box">
            <div className="cur-thinking-dots"><span /><span /><span /></div>
            <span>Switching gateway...</span>
          </div>
        </div>
      )}
      {showPresent && (
        <div className="ptt-present-overlay">
          <ToolsTable tools={tools} presentMode onClose={() => setShowPresent(false)} />
        </div>
      )}
      {showSignInModal && gatewayAuth !== 'signed-in' && (
        <div className="cur-modal-overlay" onClick={() => setShowSignInModal(false)}>
          <div className="cur-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Sign in to the gateway</h2>
            <p className="cur-denial-note">{signInReason}</p>
            <div className="cur-btn-row">
              <button
                className="cur-btn cur-btn--primary"
                onClick={() => { setShowSignInModal(false); startAuth(); }}
              >Sign in</button>
              <button className="cur-btn" onClick={() => setShowSignInModal(false)}>Not now</button>
            </div>
          </div>
        </div>
      )}
      {showBlockedModal && (
        <div className="cur-modal-overlay" onClick={() => setShowBlockedModal(false)}>
          <div className="cur-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Access Denied</h2>
            <dl className="cur-denial-facts">
              <dt>Door</dt><dd>{deniedDoor || '(unknown)'}</dd>
              <dt>Identity</dt><dd>{user?.email || '(unknown)'}</dd>
              <dt>Gateway said</dt><dd>{blockedDetail?.upstream || '403 Forbidden'}</dd>
            </dl>
            <p className="cur-denial-note">
              The gateway does not disclose which policy denied this — it returns a bare
              403 and logs nothing — so the policy name below cannot be confirmed as the
              one that blocked you.
            </p>
            {consoleData ? (() => {
              const covering = (consoleData.policies || []).filter((p) => policyMentions(p, deniedDoor));
              const naming = covering.filter((p) => policyMentions(p, user?.email));
              return (
                <p className="cur-denial-note">
                  {covering.length === 0
                    ? `No policy mentions "${deniedDoor}". That is the likeliest reason.`
                    : `Policies mentioning "${deniedDoor}": ${covering.map((p) => p.name).join(', ')}. `
                      + (naming.length === 0
                        ? `None of them mention ${user?.email || 'this user'}.`
                        : (() => {
                          const names = naming.map((p) => p.name).join(', ');
                          const expired = naming.filter(policyExpired);
                          if (expired.length === naming.length) return `${names} also mention this user, and all of them have expired. That is the likeliest reason.`;
                          if (naming.some((p) => p.notAfter)) return `${names} also mention this user${expired.length ? ` (expired: ${expired.map((p) => p.name).join(', ')})` : ''}.`;
                          return `${names} also mention this user — check the grant has not expired.`;
                        })())}
                </p>
              );
            })() : (() => {
              // No live token, but the last console read is persisted and already
              // answers the question the room asks first. It cannot answer the
              // second one (does a policy name THIS user) — only names survive.
              const known = (doorDiscovery?.applications || []).find((a) => a.name === deniedDoor);
              if (!known) {
                return (
                  <p className="cur-denial-note">
                    Connect a console token in the Policies tab to see which policies cover this door.
                  </p>
                );
              }
              return (
                <p className="cur-denial-note">
                  {known.policies.length === 0
                    ? `No policy mentioned "${deniedDoor}" at the last console read. That is the likeliest reason.`
                    : `Policies mentioning "${deniedDoor}" at the last console read: ${known.policies.join(', ')}.`}
                  {' '}Connect a console token in the Policies tab to check whether any of them mention you.
                </p>
              );
            })()}
            {doorProbe.running && <p className="cur-denial-note">Trying the other doors with this identity...</p>}
            {doorProbe.results && (
              <div className="cur-denial-probe">
                {doorProbe.results.length === 0 && <p className="cur-denial-note">No other doors to try.</p>}
                {/* The BFF already returns `error` for a failed probe; showing
                    only the status made a 500 unreadable. 500 here is not "the
                    server errored" — relayFailureStatus maps anything WITHOUT a
                    4xx upstream status to 500, so it means the relay never got
                    an HTTP answer, and the reason is only in this string. */}
                {/* needsAuth is NOT a failure: the gateway issues one token per
                    application, so a door this session has never signed into has
                    no token to present. Showing it as a bare 401 read as "your
                    identity is dead everywhere" and sent people back through a
                    sign-in they did not need. Offer the switch instead — picking
                    the door is what starts its own sign-in. */}
                {doorProbe.results.map((r) => (
                  <div key={r.url} className="cur-denial-probe-row">
                    <span className={r.ok ? 'cur-denial-ok' : (r.needsAuth ? 'cur-denial-auth' : 'cur-denial-bad')}>
                      {r.ok ? `${r.tools} tools` : (r.needsAuth ? 'sign-in needed' : (r.status || 'failed'))}
                    </span>
                    <span className="cur-denial-door">{doorName(r.url) || r.url}</span>
                    {!r.ok && !r.needsAuth && r.error && <span className="cur-denial-probe-why" title={r.error}>{r.error}</span>}
                    {(r.ok || r.needsAuth) && (
                      <button className="cur-btn" onClick={() => switchDoor(r.url)}>
                        {r.ok ? 'Switch' : 'Use this door'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p className="cur-denial-note">
              Grant access in the{' '}
              <a href={PRIVILEGE_CONSOLE_URL} target="_blank" rel="noreferrer">Privilege console</a>.
              Policies are time-boxed — an expired one fails exactly like a missing one.
            </p>
            <div className="cur-btn-row">
              <button className="cur-btn" onClick={() => { setShowBlockedModal(false); refreshTools(); }}>Retry</button>
              <button className="cur-btn" onClick={probeDoors} disabled={doorProbe.running}>
                {doorProbe.running ? 'Probing...' : 'Try other doors'}
              </button>
              <button className="cur-btn cur-btn--primary" onClick={() => setShowBlockedModal(false)}>Dismiss</button>
            </div>
          </div>
        </div>
      )}

      {/* Flow Topology Modal */}
      {showFlowModal && (
        <div className="cur-modal-overlay" onClick={() => setShowFlowModal(false)}>
          <div className="cur-flow-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cur-flow-header">
              <span className="cur-flow-title">AI Agent Gateway — Request Flow</span>
              <button className="cur-flow-close" onClick={() => setShowFlowModal(false)}>&#x2715;</button>
            </div>
            <div className="cur-flow-body">
              <div className="cur-flow-label">END-TO-END DELEGATION CHAIN</div>
              <div className="cur-flow-row">
                {/* Node 1: Browser / Cursor IDE */}
                <div className="cur-flow-node">
                  <div className="cur-flow-box cur-flow-box--browser">
                    <span className="cur-flow-icon">&#x1F5A5;</span>
                    <span className="cur-flow-name">Browser</span>
                    <span className="cur-flow-sub">Cursor IDE Client</span>
                  </div>
                  <div className="cur-flow-claims">
                    <div className="cur-flow-claim"><span className="cur-flow-ck">action</span><span className="cur-flow-cv">OIDC login (PKCE)</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">scopes</span><span className="cur-flow-cv cur-flow-cv--hi">openid profile email</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">grant</span><span className="cur-flow-cv">authorization_code</span></div>
                  </div>
                </div>

                <div className="cur-flow-conn">
                  <div className="cur-flow-line" /><span className="cur-flow-arrow">&#x25B6;</span>
                  <span className="cur-flow-conn-label">PingOne token</span>
                </div>

                {/* Node 2: BFF */}
                <div className="cur-flow-node">
                  <div className="cur-flow-box cur-flow-box--bff">
                    <span className="cur-flow-icon">&#x2699;</span>
                    <span className="cur-flow-name">BFF Relay</span>
                    <span className="cur-flow-sub">privilegeMcpClient.js</span>
                  </div>
                  <div className="cur-flow-claims">
                    <div className="cur-flow-claim"><span className="cur-flow-ck">stores</span><span className="cur-flow-cv">access_token (session)</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">adds</span><span className="cur-flow-cv cur-flow-cv--ok">x-procyon-session-id</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">relay</span><span className="cur-flow-cv">JSON-RPC → MCP GW</span></div>
                  </div>
                </div>

                <div className="cur-flow-conn">
                  <div className="cur-flow-line" /><span className="cur-flow-arrow">&#x25B6;</span>
                  <span className="cur-flow-conn-label">Bearer + headers</span>
                </div>

                {/* Node 3: Privilege Proxy */}
                <div className="cur-flow-node">
                  <div className="cur-flow-box cur-flow-box--privilege">
                    <span className="cur-flow-icon">&#x1F6E1;</span>
                    <span className="cur-flow-name">Privilege Proxy</span>
                    <span className="cur-flow-sub">PingOne Privilege Cloud</span>
                  </div>
                  <div className="cur-flow-claims">
                    <div className="cur-flow-claim"><span className="cur-flow-ck">validates</span><span className="cur-flow-cv">JWT signature (JWKS)</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">enforces</span><span className="cur-flow-cv cur-flow-cv--ok">tool-level policy</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">upstream</span><span className="cur-flow-cv">OAuth or Static Token</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">frontend</span><span className="cur-flow-cv cur-flow-cv--aud">{config.mcpUrl?.split('/')[2]?.split(':')[0]?.slice(0, 24) || 'privilege.pingone.com'}</span></div>
                  </div>
                </div>

                <div className="cur-flow-conn">
                  <div className="cur-flow-line" /><span className="cur-flow-arrow">&#x25B6;</span>
                  <span className="cur-flow-conn-label">forward RPC</span>
                </div>

                {/* Node 4: Demo MCP Server */}
                <div className="cur-flow-node">
                  <div className="cur-flow-box cur-flow-box--mcp">
                    <span className="cur-flow-icon">&#x1F527;</span>
                    <span className="cur-flow-name">Demo MCP Server</span>
                    <span className="cur-flow-sub">:8080/mcp</span>
                  </div>
                  <div className="cur-flow-claims">
                    <div className="cur-flow-claim"><span className="cur-flow-ck">discovery</span><span className="cur-flow-cv">unauthenticated</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">tools/call</span><span className="cur-flow-cv cur-flow-cv--hi">bearer required</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">scopes</span><span className="cur-flow-cv cur-flow-cv--ok">accounts:read txn:read txn:write sensitive:read</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">exchange</span><span className="cur-flow-cv">RFC 8693 per tool</span></div>
                  </div>
                </div>
              </div>

              {/* Auth flow section */}
              <div className="cur-flow-label" style={{ marginTop: 20 }}>OAUTH AUTHENTICATION</div>
              <div className="cur-flow-row">
                <div className="cur-flow-node">
                  <div className="cur-flow-box cur-flow-box--auth">
                    <span className="cur-flow-icon">&#x1F511;</span>
                    <span className="cur-flow-name">PingOne AS</span>
                    <span className="cur-flow-sub">auth.pingone.com</span>
                  </div>
                  <div className="cur-flow-claims">
                    <div className="cur-flow-claim"><span className="cur-flow-ck">env</span><span className="cur-flow-cv cur-flow-cv--aud">{config.clientId?.slice(0, 8) || '...'}</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">PKCE</span><span className="cur-flow-cv cur-flow-cv--ok">S256 required</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">method</span><span className="cur-flow-cv">client_secret_post</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">callback</span><span className="cur-flow-cv">/api/privilege-mcp/auth/callback</span></div>
                  </div>
                </div>

                <div className="cur-flow-conn">
                  <div className="cur-flow-line" /><span className="cur-flow-arrow">&#x25B6;</span>
                  <span className="cur-flow-conn-label">issues JWT</span>
                </div>

                <div className="cur-flow-node">
                  <div className="cur-flow-box cur-flow-box--token">
                    <span className="cur-flow-icon">&#x1F4DC;</span>
                    <span className="cur-flow-name">Access Token</span>
                    <span className="cur-flow-sub">RS256 / kid: default</span>
                  </div>
                  <div className="cur-flow-claims">
                    <div className="cur-flow-claim"><span className="cur-flow-ck">iss</span><span className="cur-flow-cv">auth.pingone.com/{'{env}'}</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">aud</span><span className="cur-flow-cv cur-flow-cv--aud">{config.clientId?.slice(0, 12) || 'client_id'}...</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">scope</span><span className="cur-flow-cv cur-flow-cv--hi">{grantedScopes.join(' ') || 'openid profile email'}</span></div>
                  </div>
                </div>

                <div className="cur-flow-conn">
                  <div className="cur-flow-line" /><span className="cur-flow-arrow">&#x25B6;</span>
                  <span className="cur-flow-conn-label">Bearer</span>
                </div>

                <div className="cur-flow-node">
                  <div className="cur-flow-box cur-flow-box--privilege">
                    <span className="cur-flow-icon">&#x1F6E1;</span>
                    <span className="cur-flow-name">Privilege Proxy</span>
                    <span className="cur-flow-sub">validates via JWKS</span>
                  </div>
                  <div className="cur-flow-claims">
                    <div className="cur-flow-claim"><span className="cur-flow-ck">jwks</span><span className="cur-flow-cv">auth.pingone.com/{'{env}'}/as/jwks</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">kid</span><span className="cur-flow-cv cur-flow-cv--ok">matched from JWKS</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">policy</span><span className="cur-flow-cv">tool access per user</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Learning Guide — draggable/resizable modal instead of a page navigation */}
      <DraggableModal
        isOpen={showGuide}
        onClose={() => setShowGuide(false)}
        title="AI Agent Gateway Guide"
        defaultWidth={960}
        defaultHeight={720}
        storageKey="privilege-guide-modal"
      >
        <PrivilegeMcpLearningPage />
      </DraggableModal>

      {/* Settings Modal */}
      {showSettings && (
        <div className="cur-modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="cur-settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cur-flow-header">
              <span className="cur-flow-title">&#x2699; Settings</span>
              <button className="cur-flow-close" onClick={() => setShowSettings(false)}>&#x2715;</button>
            </div>
            <div className="cur-settings-body">
              <div className="cur-settings-section">
                <h4 className="cur-settings-section-title">MCP Connection</h4>
                {presets.length > 0 && (
                  <label className="cur-field">
                    <span className="cur-field-label">Gateway Preset</span>
                    <select
                      className="cur-input"
                      value={presets.find((p) => p.url === config.mcpUrl)?.url || ''}
                      onChange={(e) => {
                        const preset = presets.find((p) => p.url === e.target.value);
                        if (!preset) return;
                        const nextMode = preset.mode || gatewayMode;
                        const savedConfig = gatewayConfigs[nextMode] || {};
                        setGatewayMode(nextMode);
                        setConfig({ ...config, ...savedConfig, mcpUrl: preset.url });
                      }}
                    >
                      <option value="">Custom</option>
                      {presets.map((p) => (
                        <option key={p.url} value={p.url}>{p.label}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="cur-field">
                  <span className="cur-field-label">MCP URL</span>
                  <input className="cur-input" value={config.mcpUrl} onChange={(e) => setConfig({ ...config, mcpUrl: e.target.value })} placeholder="https://mcpgw.example.com/mcp" />
                </label>
                <label className="cur-field">
                  <span className="cur-field-label">OAuth Client ID</span>
                  <input className="cur-input" value={config.clientId} onChange={(e) => setConfig({ ...config, clientId: e.target.value })} placeholder="supplied automatically — see below" />
                </label>
                {/* An empty Client ID is the NORMAL state for every door shipped
                    here: they all advertise their own AS, so the client is
                    registered rather than configured. Saying which one avoids
                    reading the blank field as missing config — the old default
                    filled it with the Privilege SSO worker client, which cannot
                    complete a browser flow and produced a bare PingOne
                    NOT_FOUND page when a broken door fell through to it. */}
                {!config.clientId?.trim() && clientHints[gatewayMode] && (
                  <p className="cur-denial-note">
                    Client ID is optional here — this path&apos;s client is {clientHints[gatewayMode]}.
                    Set it only for a gateway that does not advertise dynamic client registration.
                  </p>
                )}
                <label className="cur-field">
                  <span className="cur-field-label">Requested Scopes</span>
                  <input className="cur-input" value={config.scopes} onChange={(e) => setConfig({ ...config, scopes: e.target.value })} />
                </label>
              </div>
              {gatewayMode !== 'direct' && (
                <>
              <div className="cur-settings-section">
                <h4 className="cur-settings-section-title">Local LLM</h4>
                <label className="cur-field">
                  <span className="cur-field-label">Ollama URL</span>
                  <input className="cur-input" value={config.llmUrl} onChange={(e) => setConfig({ ...config, llmUrl: e.target.value })} />
                </label>
                <label className="cur-field">
                  <span className="cur-field-label">Model</span>
                  <input className="cur-input" value={config.llmModel} onChange={(e) => setConfig({ ...config, llmModel: e.target.value })} />
                </label>
              </div>
              <div className="cur-settings-section">
                <h4 className="cur-settings-section-title">Privilege Gateway .env</h4>
                {envVars === null ? (
                  <button className="cur-btn" onClick={loadEnv}>Load pingone.env</button>
                ) : (
                  <>
                    {['SERVER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_AUTH_URL', 'OIDC_TOKEN_URL', 'OIDC_USER_URL', 'OIDC_SCOPES'].map((key) => (
                      <label className="cur-field" key={key}>
                        <span className="cur-field-label">{key}</span>
                        <input className="cur-input" value={envVars[key] || ''} onChange={(e) => { setEnvVars({ ...envVars, [key]: e.target.value }); setEnvDirty(true); }} />
                      </label>
                    ))}
                    <div className="cur-btn-row" style={{ marginTop: 8 }}>
                      <button className="cur-btn cur-btn--primary" onClick={saveEnv} disabled={!envDirty}>Save .env</button>
                      <button className="cur-btn" onClick={loadEnv}>Reload</button>
                    </div>
                  </>
                )}
              </div>
                </>
              )}
              <div className="cur-btn-row" style={{ marginTop: 16 }}>
                <button className="cur-btn cur-btn--primary" onClick={() => { saveConfig(); setShowSettings(false); }}>Save</button>
                <button className="cur-btn" onClick={() => setShowSettings(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Title bar */}
      <header className="cur-titlebar">
        <div className="cur-titlebar-left">
          <div className="cur-traffic-lights">
            <span className="cur-dot cur-dot--red" />
            <span className="cur-dot cur-dot--yellow" />
            <span className="cur-dot cur-dot--green" />
          </div>
          <span className="cur-titlebar-title">AI Agent Gateway Client — PingOne</span>
        </div>
        <div className="cur-titlebar-center">
          <div className={`cur-status ${gatewayAuth === 'signed-in' ? 'cur-status--ok' : ''}`}>
            <span className="cur-status-dot" />
            {gatewayAuth === 'signed-in' ? 'Connected' : gatewayAuth === 'connecting' ? 'Connecting…' : 'Disconnected'}
          </div>
        </div>
        {/* Path and Door moved to the connection rail — they are the two
            controls that decide where a call goes, and they belong next to the
            identity and tool count that answer for the result, not in a strip
            of view toggles. */}
        {/* Demo keeps what you would touch with an audience watching: the theme
            toggle, Clear, Guide, Flow, Settings. The skin picker and the
            cross-page link are workbench chrome and move to Inspect — nothing is
            removed, it is one toggle away.

            Light/Dark and the skin picker are NOT gated. Both were, briefly,
            and both were wrong for the same reason: flipping to light for a
            projector, and switching costume to show the same chain inside VS
            Code or Claude Desktop, are the two most demo-ish controls on this
            bar. Burying them behind Inspect meant reaching for a debugging mode
            to do a presentation job — and the skin picker is the ONLY route to
            the other three client shells, so gating it hid three whole demos. */}
        <div className="cur-titlebar-right">
          <FootprintSkinPicker className="cur-skin-picker" />
          <button
            type="button"
            className="cur-flow-trigger"
            onClick={() => setPageTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title={pageTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {pageTheme === 'dark' ? 'Light' : 'Dark'}
          </button>
          <button className="cur-flow-trigger" onClick={clearActivity} title="Clear chat, events, and results for a fresh demo">Clear</button>
          <button className="cur-flow-trigger" onClick={() => setShowGuide(true)} title="Learning Guide">Guide</button>
          <button className="cur-flow-trigger cur-settings-gear" onClick={() => setShowSettings(true)} title="Settings">Settings</button>
          <button className="cur-flow-trigger" onClick={() => setShowFlowModal(true)}>Flow</button>
          {/* The provider lanes, their probes and the prove-the-policy prompt
              that used to sit on this page in a second copy now live only on
              /llm-gateway. This is the link that used to be buried in that
              panel's header. */}
          {inspecting && (
            <button
              type="button"
              className="cur-flow-trigger"
              onClick={() => navigate('/llm-gateway')}
              title="Provider lanes, model checks and policy proofs live there"
            >
              LLM Gateway
            </button>
          )}
          {inspecting && config.llmModel && <span className="cur-model-badge">{config.llmModel}</span>}
        </div>
      </header>

      {/* A policy denial is the point of this demo, so it does not live only in
          a dismissible modal and a grey chat line — dismiss the modal and the
          page just looks empty, which reads as "broken", not "refused". This
          band stays up until a call actually succeeds. */}
      {blockedDetail && (
        <section className="cur-blocked-band" role="alert" aria-label="Blocked by policy">
          <span className="cur-blocked-band__mark" aria-hidden="true">⚠️</span>
          <div className="cur-blocked-band__text">
            <div className="cur-blocked-band__title">Blocked by policy</div>
            <div className="cur-blocked-band__detail">
              PingOne Privilege refused this call
              {doorName(config.mcpUrl) ? <> on <strong>{doorName(config.mcpUrl)}</strong></> : null}
              {user?.email ? <> for <strong>{user.email}</strong></> : null}
              {'. '}
              The tools exist — this identity is not permitted to use them.
            </div>
          </div>
          <button className="cur-btn cur-blocked-band__btn" onClick={() => setShowBlockedModal(true)}>
            Why?
          </button>
        </section>
      )}

      <div className="cur-body" ref={bodyRef}>
        {/* Sidebar */}
        <aside className="cur-sidebar" ref={sidebarRef}>
          <div className="cur-sidebar-header">
            <span className="cur-sidebar-title">CONNECTION</span>
          </div>
          {/* The rail, in the order the connection is actually established:
              app session, then gateway identity, then where the call goes, then
              what came back. It replaced a debug block, an auth-badge block, a
              gateway banner, a session warning and a bare "Run preflight"
              button that were five separate strips saying overlapping things.

              Rows 1 and 2 are separate on purpose. They are two different
              identities and the page used to claim otherwise in three places at
              once — the footer said "Authenticated" whenever EITHER was signed
              in, the badge here said it off the app session alone, and the
              debug line right above said "unauthenticated" — while a modal
              demanded a sign-in. That contradiction is the whole of "it asks me
              to sign in when I am already signed in". */}
          <ol className="cur-rail">
            <li className="cur-rail__row">
              <span className="cur-rail__n">1</span>
              <span className="cur-rail__k">App session</span>
              <span className="cur-rail__v">
                {mainAppAuthenticated
                  ? (
                    <>
                      <span aria-hidden="true">✅</span> {user?.email || 'signed in'}
                    </>
                  )
                  : <><span aria-hidden="true">❌</span> Not signed in</>}
              </span>
            </li>

            <li className="cur-rail__row">
              <span className="cur-rail__n">2</span>
              <span className="cur-rail__k">Gateway identity</span>
              <span className="cur-rail__v" data-testid="rail-gateway-identity">
                {gatewayAuth === 'signed-in' && (
                  <>
                    <span aria-hidden="true">✅</span> {user?.email || 'token held'}
                  </>
                )}
                {gatewayAuth === 'connecting' && <><span className="cur-spinner" aria-hidden="true" /> Signing in…</>}
                {gatewayAuth === 'needed' && (
                  <>
                    <span aria-hidden="true">⚠️</span> Not signed in
                    <button className="cur-btn cur-btn--primary cur-rail__btn" onClick={startAuth}>Sign in</button>
                  </>
                )}
              </span>
              {signInReason && gatewayAuth !== 'signed-in' && (
                <p className="cur-rail__note" role="status" data-testid="sign-in-prompt">{signInReason}</p>
              )}
            </li>

            <li className="cur-rail__row">
              <span className="cur-rail__n">3</span>
              <span className="cur-rail__k">Path</span>
              <span className="cur-rail__v">
                <select
                  aria-label="Connection path"
                  value={llmPath ? `llm:${llmPath}` : gatewayMode}
                  disabled={!gatewayStateLoaded || switching}
                  onChange={(event) => {
                    const v = event.target.value;
                    // Switching to an LLM lane leaves the MCP connection exactly as it
                    // is — it is a different destination for the PROMPT, not a
                    // reconnection, so no /config write and no re-auth.
                    if (v.startsWith('llm:')) { setLlmPath(v.slice(4)); return; }
                    setLlmPath('');
                    switchGatewayMode(v);
                  }}
                >
                  <optgroup label="MCP path (tools)">
                    <option value="direct">Direct</option>
                    <option value="privilege">Privilege</option>
                    <option value="facade">Façade</option>
                  </optgroup>
                  <optgroup label="LLM path (prompt)">
                    <option value="llm:anthropic">Anthropic</option>
                    <option value="llm:google">Google</option>
                    <option value="llm:openai">OpenAI</option>
                  </optgroup>
                </select>
              </span>
              <p className="cur-rail__note">{mode.detail}</p>
            </li>

            {/* Door picker. Always shown once state has loaded — even with a
                single known backend at the current origin (see
                sameGatewayDoors()), it doubles as a live readout of what
                target the client is actually pointed at, not just a switcher.
                For Privilege it picks the DOOR, never a policy: Privilege
                resolves the policy server-side from (user, door, tool), so a
                policy control could only mislead about what it does. */}
            <li className="cur-rail__row">
              <span className="cur-rail__n">4</span>
              <span className="cur-rail__k">Door</span>
              <span className="cur-rail__v">
                {sameGatewayDoors().length > 0 ? (
                  <select
                    aria-label="MCP backend (door)"
                    value={config.mcpUrl || ''}
                    disabled={switching || toolsLoading}
                    onChange={(event) => switchDoor(event.target.value)}
                  >
                    {sameGatewayDoors().map((url) => (
                      <option key={url} value={url}>{doorName(url) || url}</option>
                    ))}
                  </select>
                ) : (doorName(config.mcpUrl) || '—')}
                {/* Was an unlabelled "Run preflight" button on its own strip.
                    It probes the OTHER configured doors with this identity —
                    /doors/probe deliberately skips the door already selected —
                    so it is named for that and sits on the row it is about.
                    Inspect-only: it answers "why is this door refusing me",
                    which is not a question you ask on stage. */}
                {inspecting && (
                  <button
                    type="button"
                    className="cur-btn cur-rail__btn"
                    onClick={runPreflight}
                    disabled={preflightBusy}
                  >
                    {preflightBusy ? 'Probing…' : 'Probe other doors'}
                  </button>
                )}
              </span>
              {mode.url && <code className="cur-rail__url">{mode.url}</code>}
              {inspecting && preflightError && <p className="cur-rail__note cur-rail__note--bad" role="alert">{preflightError}</p>}
              {/* An empty result set is a real outcome — /doors/probe skips the
                  currently-selected door and caps the fan-out at 12 — so it is
                  reported rather than rendered as an empty list that reads clean. */}
              {inspecting && preflight && preflight.length === 0 && (
                <p className="cur-rail__note">
                  No other doors to probe. The selected door is skipped; add a preset for another one.
                </p>
              )}
              {inspecting && preflight && preflight.length > 0 && (
                <ul className="cur-rail__probe">
                  {preflight.map((r) => (
                    <li key={r.url} className={r.ok ? 'cur-rail__probe--ok' : 'cur-rail__probe--bad'}>
                      <span aria-hidden="true">{r.ok ? '✅' : '❌'}</span>
                      <span className="cur-rail__probe-door">{doorName(r.url) || r.url}</span>
                      <span>{r.ok ? `${r.tools} tools` : `${r.status || ''} ${r.error || ''}`.trim() || 'failed'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>

            <li className="cur-rail__row">
              <span className="cur-rail__n">5</span>
              <span className="cur-rail__k">Tools</span>
              <span className="cur-rail__v">
                {toolPolicy.total > 0
                  ? <><strong>{toolPolicy.total}</strong> catalog · <strong className="cur-rail__ok-text">{toolPolicy.permitted}</strong> permitted · <strong className="cur-rail__bad-text">{toolPolicy.filtered}</strong> filtered</>
                  : '—'}
              </span>
              {/* Façade relays on a server-side token that does not survive a
                  restart, so this is a property of the connection, not a
                  page-wide alarm — it belongs on the row whose tool count it
                  explains.

                  NOT gated behind Inspect, unlike the door probe above. This is
                  the reason the tool count is zero; hide it in Demo and the
                  rail reads "broken" instead of "the session lapsed, press
                  this" — the same failure the blocked-policy band exists to
                  prevent. A one-click recovery is worth more on stage than off. */}
              {gatewayMode === 'facade' && gatewaySession && !gatewaySession.ready && (
                <p className="cur-rail__note cur-rail__note--warn" role="status">
                  <span aria-hidden="true">⚠️</span>{' '}
                  Gateway session {gatewaySession.reason === 'expired' ? 'expired' : 'not established'}.
                  <button
                    type="button"
                    className="cur-btn cur-rail__btn"
                    onClick={rearmGatewaySession}
                    disabled={switching}
                  >
                    {switching ? 'Re-arming…' : 'Re-arm'}
                  </button>
                  {rearmError && <span className="cur-rail__bad-text" role="alert"> {rearmError}</span>}
                </p>
              )}
            </li>
          </ol>

          <div className="cur-sidebar-content">

            {inspecting && grantedScopes.length > 0 && (
              <div className="cur-scopes-section">
                <div className="cur-sidebar-header">
                  <span className="cur-sidebar-title">GRANTED SCOPES</span>
                  <span className="cur-scope-count">{grantedScopes.length}</span>
                </div>
                <div className="cur-scopes-grid">
                  {grantedScopes.map((s) => (
                    <span
                      key={s}
                      role="button"
                      tabIndex={0}
                      className={`cur-scope-pill ${scopeColor(s)}${s === selectedScope ? ' cur-scope-pill--selected' : ''}`}
                      title={`Show ${s} in the scopes table`}
                      onClick={() => { setSelectedScope(s); setTerminalTab('scopes'); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedScope(s); setTerminalTab('scopes'); } }}
                    >{s}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="cur-sidebar-header" style={{ marginTop: 12 }}>
              <span className="cur-sidebar-title">MCP TOOLS</span>
              {toolsLoading
                ? <span className="cur-spinner" role="status" aria-label="Discovering tools" />
                : <span className="cur-scope-count">{tools.length}</span>}
            </div>
            {tools.length > 0 && (
              <input
                className="cur-input cur-tool-search"
                placeholder="Filter tools..."
                value={toolSearch}
                onChange={(e) => setToolSearch(e.target.value)}
                style={{ margin: '4px 8px', width: 'calc(100% - 16px)' }}
              />
            )}
            {tools.length > 0 ? (() => {
              const q = toolSearch.trim().toLowerCase();
              const filtered = q ? tools.filter((t) => t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q)) : tools;
              return filtered.length > 0 ? (
                <div className="cur-tools-list">
                  {filtered.map((t) => {
                    const n = Object.keys(t.inputSchema?.properties || {}).length;
                    return (
                    <div key={t.name} className={`cur-tool-row${t.name === selectedTool ? ' cur-tool-row--selected' : ''}`} onClick={() => selectTool(t.name)} title={t.description || t.name}>
                      <span className="cur-tool-row-name">{t.name}</span>
                      <span className="cur-tool-row-meta">{n} param{n === 1 ? '' : 's'}</span>
                    </div>
                    );
                  })}
                </div>
              ) : <div className="cur-empty-state">No tools match &quot;{toolSearch}&quot;</div>;
            })() : toolsLoading ? (
              <div className="cur-tools-waiting">
                <span className="cur-spinner" aria-hidden="true" />
                <span>Waiting for the AI Gateway to return tools...</span>
              </div>
            ) : blockedDetail ? (
              // Say WHY the list is empty. "No tools discovered yet" for a
              // policy denial is the single most misleading state on this page.
              <div className="cur-empty-state cur-empty-state--blocked">
                <strong>No tools — blocked by policy.</strong>
                <span>Privilege returned 403 before any tool was listed.</span>
              </div>
            ) : (
              <div className="cur-empty-state">No tools discovered yet</div>
            )}
            {/* One action cluster. These used to be scattered: discovery here,
                "Retry tools" and two different "Sign out"s up in the rail at
                cur-rail__btn size (3px/8px padding, --font-size-2xs) — small
                enough to read as metadata rather than controls, and far from the
                one button a presenter actually needs.
                The rail is now purely status; every action lives here at one
                size. Both sign-outs NAME what they end, because two controls
                labelled "Sign out" side by side is a coin toss. */}
            <div className="cur-actions">
              <button
                className="cur-btn cur-btn--primary cur-btn--refresh"
                onClick={() => refreshTools(false)}
                disabled={toolsLoading}
              >
                {toolsLoading ? 'Discovering...' : 'Get MCP Tools'}
              </button>
              {(gatewayAuth === 'signed-in' || mainAppAuthenticated) && (
                <div className="cur-actions__row">
                  {gatewayAuth === 'signed-in' && (
                    <>
                      <button className="cur-btn cur-actions__btn" onClick={() => refreshTools()}>
                        Retry tools
                      </button>
                      <button
                        className="cur-btn cur-actions__btn"
                        onClick={async () => {
                          await api('/auth/logout', { method: 'POST' }).catch(() => {});
                          setAuthenticated(false);
                          setGrantedScopes([]);
                          setTools([]);
                        }}
                      >Sign out of gateway</button>
                    </>
                  )}
                  {mainAppAuthenticated && (
                    /* Navigates to /logout rather than POSTing a logout here: that
                       route is the app's ONE sign-out path (App.js, the same one
                       AdminSideNav uses), so it stays correct if app logout ever
                       changes. Deliberately does NOT also drop the gateway
                       identity — that is the button beside it, and silently
                       clearing both would hide which identity actually went. */
                    <button
                      className="cur-btn cur-actions__btn"
                      onClick={() => navigate('/logout')}
                    >Sign out of app</button>
                  )}
                </div>
              )}
            </div>
          </div>
        </aside>

        <div className="cur-resize-handle cur-resize-handle--v" onPointerDown={startSidebarDrag} />

        {/* Main editor area */}
        <main className="cur-main">
          <div className="cur-tabs">
            {TAB_LABELS.filter(([key]) => VIEW_TABS[viewMode].includes(key)).map(([key, label]) => (
              <button
                key={key}
                className={`cur-tab ${visibleTab === key ? 'cur-tab--active' : ''}`}
                onClick={() => chooseTab(key)}
              >{label}</button>
            ))}
            <div className="cur-viewmode" role="group" aria-label="View mode">
              <button
                type="button"
                className={!inspecting ? 'is-active' : ''}
                aria-pressed={!inspecting}
                onClick={() => switchViewMode('demo')}
                title="Chat, tools and the trace — what you drive in front of someone"
              >Demo</button>
              <button
                type="button"
                className={inspecting ? 'is-active' : ''}
                aria-pressed={inspecting}
                onClick={() => switchViewMode('inspect')}
                title="Explorer, raw RPC, policies, relay log and scopes"
              >Inspect</button>
            </div>
          </div>

          <div className="cur-editor-area">
            {visibleTab === 'chat' && (
              <div className="cur-chat-panel">
                <div className="cur-chat-messages">
                  {chatMessages.length === 0 && (
                    <div className="cur-chat-empty">
                      <div className="cur-chat-empty-icon">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                      </div>
                      <p>Ask the agent to interact with MCP tools</p>
                      <span className="cur-chat-hint">Try: "List available tools" or "What can you do?"</span>
                    </div>
                  )}
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={`cur-msg cur-msg--${msg.role}`}>
                      <div className="cur-msg-header">
                        <span className="cur-msg-role">{msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'Agent' : 'System'}</span>
                      </div>
                      <div className="cur-msg-body">{msg.content}</div>
                      {msg.extra?.decision && (
                        <div className={`cur-policy-decision cur-policy-decision--${msg.extra.decision.outcome.toLowerCase()}`}>
                          <strong>{msg.extra.decision.outcome}</strong>
                          <code>{msg.extra.decision.tool}</code>
                          <span>{msg.extra.decision.reason}</span>
                        </div>
                      )}
                      {msg.extra && (
                        <pre className="cur-msg-meta">{typeof msg.extra === 'string' ? msg.extra : JSON.stringify(msg.extra, null, 2)}</pre>
                      )}
                    </div>
                  ))}
                  {thinking && (
                    <div className="cur-msg cur-msg--thinking">
                      <div className="cur-thinking-dots"><span /><span /><span /></div>
                      <span>Thinking...</span>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
                <div className="cur-composer">
                  <textarea
                    className="cur-composer-input"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); sendChat(); } }}
                    placeholder="Ask the agent... (Cmd+Enter to send)"
                    rows={2}
                  />
                  <button className="cur-composer-send" onClick={sendChat} disabled={thinking} aria-label="Send message">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                  </button>
                </div>
              </div>
            )}

            {visibleTab === 'tools' && (
              <ToolsTable
                tools={tools}
                onExecute={executeToolCall}
                onPresent={() => setShowPresent(true)}
                selectedTool={selectedTool}
                selectNonce={toolSelectNonce}
              />
            )}

            {visibleTab === 'mcp' && (
              <div className="cur-rpc-panel cur-mcp-explorer">
                <div className="cur-tools-header">
                  <h3>Server Capabilities</h3>
                  <div className="cur-btn-row">
                    <button className="cur-btn" onClick={toggleSubscriptions}>
                      {subscriptionActive ? 'Stop Subscriptions' : 'Listen for Changes'}
                    </button>
                    <button className="cur-btn" onClick={() => refreshTools(false)} disabled={toolsLoading}>
                      {toolsLoading ? 'Discovering...' : 'Rediscover'}
                    </button>
                  </div>
                </div>
                <div className="cur-mcp-protocol">
                  <span>{mcpProtocol?.serverInfo?.name || 'MCP server'}</span>
                  <span>{mcpProtocol?.era || 'not connected'} · {mcpProtocol?.version || 'version unknown'}</span>
                </div>
                {mcpProtocol?.instructions && <p className="cur-mcp-instructions">{mcpProtocol.instructions}</p>}
                <div className="cur-mcp-catalog-grid">
                  <section>
                    <h4>Prompts ({mcpCatalog.prompts.length})</h4>
                    {mcpCatalog.prompts.length === 0 ? (
                      <p className="cur-mcp-empty">{capabilityNote(mcpProtocol?.capabilities?.prompts, 'prompts')}</p>
                    ) : mcpCatalog.prompts.map((prompt) => (
                      <button key={prompt.name} className="cur-mcp-item" onClick={() => {
                        chooseMcpMethod('prompts/get');
                        setMcpParams(JSON.stringify({ name: prompt.name, arguments: {} }, null, 2));
                      }}>{prompt.name}</button>
                    ))}
                  </section>
                  <section>
                    <h4>Resources ({mcpCatalog.resources.length})</h4>
                    {mcpCatalog.resources.length === 0 ? (
                      <p className="cur-mcp-empty">{capabilityNote(mcpProtocol?.capabilities?.resources, 'resources')}</p>
                    ) : mcpCatalog.resources.map((resource) => (
                      <button key={resource.uri} className="cur-mcp-item" onClick={() => {
                        chooseMcpMethod('resources/read');
                        setMcpParams(JSON.stringify({ uri: resource.uri }, null, 2));
                      }}>{resource.name || resource.uri}</button>
                    ))}
                  </section>
                  <section>
                    <h4>Templates ({mcpCatalog.resourceTemplates.length})</h4>
                    {mcpCatalog.resourceTemplates.length === 0 ? (
                      <p className="cur-mcp-empty">{capabilityNote(mcpProtocol?.capabilities?.resources, 'resource templates')}</p>
                    ) : mcpCatalog.resourceTemplates.map((template) => (
                      <div key={template.uriTemplate} className="cur-mcp-item cur-mcp-item--static">
                        {template.name || template.uriTemplate}
                      </div>
                    ))}
                  </section>
                </div>
                <label className="cur-field">
                  <span className="cur-field-label">MCP Method</span>
                  <select className="cur-input" value={mcpMethod} onChange={(event) => chooseMcpMethod(event.target.value)}>
                    {Object.keys(MCP_METHOD_TEMPLATES).map((method) => <option key={method}>{method}</option>)}
                  </select>
                </label>
                <label className="cur-field">
                  <span className="cur-field-label">Parameters</span>
                  <textarea className="cur-input cur-input--code" rows={8} value={mcpParams} onChange={(event) => setMcpParams(event.target.value)} />
                </label>
                <button className="cur-btn cur-btn--primary" onClick={sendMcpRequest}>Send MCP Request</button>
                {mcpInputRequired && (
                  <div className="cur-mcp-input-required">
                    <h4>Input Required</h4>
                    <p>Review the server request above, then accept, decline, or cancel each input request.</p>
                    <textarea className="cur-input cur-input--code" rows={8} value={mcpInputResponses} onChange={(event) => setMcpInputResponses(event.target.value)} />
                    <button className="cur-btn cur-btn--primary" onClick={continueMcpRequest}>Continue Request</button>
                  </div>
                )}
                {mcpResult && (
                  <div className="cur-result-block">
                    <span className="cur-result-label">Response</span>
                    <JsonPane value={mcpResult} deep label="MCP response view" />
                  </div>
                )}
              </div>
            )}

            {visibleTab === 'rpc' && (
              <div className="cur-rpc-panel">
                <div className="cur-tools-header"><h3>Raw MCP JSON-RPC</h3></div>
                <label className="cur-field">
                  <span className="cur-field-label">Request Body</span>
                  <textarea className="cur-input cur-input--code" rows={8} value={rawRpc} onChange={(e) => setRawRpc(e.target.value)} />
                </label>
                <button className="cur-btn cur-btn--primary" onClick={sendRawRpcCall}>Send RPC</button>
                {rawRpcResult && (
                  <div className="cur-result-block">
                    <span className="cur-result-label">Response</span>
                    <JsonPane value={rawRpcResult} deep label="Raw RPC response view" />
                  </div>
                )}
              </div>
            )}

            {visibleTab === 'policies' && (
              <div className="cur-rpc-panel">
                <div className="cur-tools-header">
                  <h3>Privilege Console — doors and policies</h3>
                  {consoleData && (
                    <div className="cur-btn-row">
                      <button className="cur-btn" onClick={refreshConsole} disabled={consoleBusy}>
                        {consoleBusy ? 'Reading...' : 'Refresh'}
                      </button>
                      <button className="cur-btn" onClick={disconnectConsole}>Disconnect</button>
                    </div>
                  )}
                </div>

                {/* Applies to EVERY MCP door, not just this page's connection —
                    including the ones LM Studio opens, which never load this UI.
                    Shown to everyone (this route is public) but saving needs an
                    admin session; the error says so rather than hiding the control. */}
                <fieldset className="cur-prompt-mode">
                  <legend>Sign-in behaviour for MCP doors</legend>
                  <p className="cur-denial-note">
                    Without this, PingOne silently reuses whatever session your browser
                    already holds, so a door can adopt the wrong user with no sign-in shown.
                  </p>
                  {BROKER_PROMPT_MODES.map((mode) => (
                    <label key={mode.value} className="cur-prompt-mode__row">
                      <input
                        type="radio"
                        name="mcp-broker-prompt"
                        value={mode.value}
                        checked={brokerPrompt === mode.value}
                        disabled={brokerPrompt === null || brokerPromptBusy}
                        onChange={() => saveBrokerPrompt(mode.value)}
                      />
                      <span className="cur-prompt-mode__label">{mode.label}</span>
                      <span className="cur-prompt-mode__hint">{mode.hint}</span>
                    </label>
                  ))}
                  {brokerPrompt === null && !brokerPromptError && (
                    <p className="cur-denial-note">Reading the current setting...</p>
                  )}
                  {brokerPromptError && <p className="cur-prompt-mode__err">{brokerPromptError}</p>}
                </fieldset>

                {/* Lives here as well as on the Feature Flags page: what it
                    changes is the token.exchange hop in this page's own TRACE
                    panel, so the switch and its evidence sit together. */}
                <fieldset className="cur-prompt-mode">
                  <legend>Next-hop token exchange (RFC 8693)</legend>
                  <p className="cur-denial-note">
                    A door whose upstream is a resource server must present a token audienced to
                    that upstream. Turn this off to forward the gateway-audience token instead and
                    watch the upstream refuse it with D-05, then turn it back on to see the
                    exchange fix it. TRACE records a token.exchange hop either way, naming both
                    audiences.
                  </p>
                  <label className="cur-prompt-mode__row">
                    <input
                      type="checkbox"
                      checked={upstreamExchange === true}
                      disabled={upstreamExchange === null || upstreamExchangeBusy}
                      onChange={(e) => saveUpstreamExchange(e.target.checked)}
                    />
                    <span className="cur-prompt-mode__label">Exchange before forwarding</span>
                    <span className="cur-prompt-mode__hint">
                      On by default. Affects doors that declare an upstream audience (banking);
                      the gateway-upstream doors are untouched either way.
                    </span>
                  </label>
                  {upstreamExchange === null && !upstreamExchangeError && (
                    <p className="cur-denial-note">Reading the current setting...</p>
                  )}
                  {upstreamExchangeError && <p className="cur-prompt-mode__err">{upstreamExchangeError}</p>}
                </fieldset>

                {!consoleData && doorDiscovery && (
                  <>
                    <h4 className="cur-console-heading">
                      Last console read — {doorDiscovery.appCount} doors, {doorDiscovery.policyCount} policies
                    </h4>
                    <p className="cur-denial-note">
                      Read {new Date(doorDiscovery.discoveredAt).toLocaleString()}
                      {doorDiscovery.gatewayOrigin ? ` from ${doorDiscovery.gatewayOrigin}` : ''}. Persisted
                      by the BFF, so it survives the token that produced it. Policy <em>names</em> only —
                      connect a token below to read a policy&apos;s contents, to check whether one mentions
                      you, or to refresh this list.
                    </p>
                    <div className="cur-console-list">
                      {doorDiscovery.applications.map((app) => (
                        <div
                          key={app.name}
                          className={`cur-console-row${app.name === doorName(config.mcpUrl) ? ' cur-console-row--active' : ''}`}
                        >
                          <span className="cur-console-name">{app.name}</span>
                          <span className="cur-console-meta">
                            {app.policies.length
                              ? `mentioned by ${app.policies.join(', ')}`
                              : 'no policy mentions it'}
                            {app.status ? ` · ${app.status}` : ''}
                          </span>
                          {app.name === doorName(config.mcpUrl) && <span className="cur-console-current">current</span>}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {!consoleData && (
                  <>
                    <p className="cur-denial-note">
                      The console API lists the MCP applications (the doors this gateway routes
                      to) and the policies that grant access to them. It authenticates with a
                      console browser session, not with the gateway token this page already
                      holds, so it needs one value pasted from the console: the
                      <code> auth_token </code> cookie. It is held in this session only, is
                      never written to disk, and expires on its own in about an hour.
                    </p>
                    <p className="cur-denial-note">
                      Privilege console &rarr; DevTools &rarr; Application &rarr; Cookies &rarr;
                      copy the value of <code>auth_token</code>.
                    </p>
                    <label className="cur-field">
                      <span className="cur-field-label">Console auth_token</span>
                      <input
                        className="cur-input"
                        type="password"
                        value={consoleToken}
                        onChange={(e) => setConsoleToken(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') connectConsole(); }}
                        placeholder="paste the auth_token cookie value"
                      />
                    </label>
                    <button className="cur-btn cur-btn--primary" onClick={connectConsole} disabled={consoleBusy || !consoleToken.trim()}>
                      {consoleBusy ? 'Connecting...' : 'Connect'}
                    </button>
                  </>
                )}

                {consoleError && <p className="cur-denial-note cur-denial-bad">{consoleError}</p>}

                {consoleData && (
                  <>
                    <h4 className="cur-console-heading">Doors ({consoleData.applications.length})</h4>
                    <div className="cur-console-list">
                      {consoleData.applications.map((app) => (
                        <div key={app.name} className={`cur-console-row${app.mcpUrl === config.mcpUrl ? ' cur-console-row--active' : ''}`}>
                          <span className="cur-console-name">{app.name}</span>
                          <span className="cur-console-meta">
                            {app.backends.join(', ') || 'no backend'}{app.status ? ` · ${app.status}` : ''}
                            {app.tools?.length ? ` · ${app.tools.length} tools` : ''}
                            {app.authMode ? ` · auth ${app.authMode}` : ''}
                            {app.lastDiscoveredAt ? ` · discovered ${new Date(app.lastDiscoveredAt).toLocaleString()}` : ''}
                          </span>
                          {app.aiGuard?.enabled && (
                            <span className="cur-console-tag">AI Guard{app.aiGuard.failClosed ? ' · fail-closed' : ''}</span>
                          )}
                          {app.mcpUrl === config.mcpUrl
                            ? <span className="cur-console-current">current</span>
                            : <button className="cur-btn" onClick={() => switchDoor(app.mcpUrl)}>Use</button>}
                        </div>
                      ))}
                    </div>

                    <h4 className="cur-console-heading">Policies ({consoleData.policies.length})</h4>
                    <p className="cur-denial-note">
                      Selecting a policy does not change the decision — Privilege resolves that
                      server-side from (user, door, tool), and more than one policy can cover a
                      door. But each app has its own URL, so you can jump to the door a policy
                      covers. The Spec schema is undocumented, so the matches below are on whole
                      string values: &quot;mentions&quot; is not the same as &quot;grants&quot;.
                    </p>
                    <label className="cur-field">
                      <span className="cur-field-label">Inspect a policy</span>
                      <select
                        className="cur-input"
                        aria-label="Inspect a policy"
                        value={selectedPolicy}
                        onChange={(e) => setSelectedPolicy(e.target.value)}
                      >
                        <option value="">Select a policy…</option>
                        {consoleData.policies.map((p) => {
                          // Surface the two facts a presenter is asked about, in the
                          // option itself — otherwise finding the relevant policy in a
                          // long list means opening them one at a time.
                          const tags = [
                            policyMentions(p, doorName(config.mcpUrl)) ? 'this door' : null,
                            policyMentions(p, user?.email) ? 'you' : null,
                          ].filter(Boolean);
                          return (
                            <option key={p.name} value={p.name}>
                              {p.name}{tags.length ? ` — mentions ${tags.join(' + ')}` : ''}{policyExpired(p) ? ' — expired' : ''}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    {(() => {
                      const picked = consoleData.policies.find((p) => p.name === selectedPolicy);
                      if (!picked) {
                        return <p className="cur-denial-note">Pick a policy to read what it actually contains.</p>;
                      }
                      // Which registered apps this policy names. Each app is its own
                      // door with its own URL, so this is the one genuinely actionable
                      // thing a policy tells us: where to go to exercise it.
                      const coveredApps = (consoleData.applications || [])
                        .filter((app) => policyMentions(picked, app.name));
                      return (
                        <div className="cur-console-policy-detail">
                          <div className="cur-console-policy-tags">
                            <span className="cur-console-name">{picked.name}</span>
                            {policyMentions(picked, doorName(config.mcpUrl)) && <span className="cur-console-tag">mentions this door</span>}
                            {policyMentions(picked, user?.email) && <span className="cur-console-tag">mentions you</span>}
                          </div>
                          {picked.notAfter && (
                            <p className={`cur-denial-note${policyExpired(picked) ? ' cur-denial-bad' : ''}`}>
                              {policyExpired(picked)
                                ? `Expired ${new Date(picked.notAfter).toLocaleString()} — an expired policy denies exactly like a missing one.`
                                : `Valid until ${new Date(picked.notAfter).toLocaleString()}.`}
                            </p>
                          )}
                          {coveredApps.length > 0 ? (
                            <div className="cur-console-list">
                              {coveredApps.map((app) => (
                                <div key={app.name} className="cur-console-row">
                                  <span className="cur-console-name">{app.name}</span>
                                  <span className="cur-console-meta">{app.mcpUrl || 'no client URL'}</span>
                                  {app.mcpUrl === config.mcpUrl
                                    ? <span className="cur-console-current">current</span>
                                    : app.mcpUrl && <button className="cur-btn" onClick={() => switchDoor(app.mcpUrl)}>Use this door</button>}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="cur-denial-note">
                              This policy names no registered app, so there is no door to jump to.
                            </p>
                          )}
                          <JsonPane value={picked.spec} deep label="Policy spec view" />
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            )}

          </div>

          {/* Terminal panel */}
          <div className="cur-resize-handle cur-resize-handle--h" onPointerDown={startTerminalDrag} />
          <div className="cur-terminal" ref={terminalRef}>
            {/* RELAY LOG and SCOPES are Inspect-only; TRACE and RESULTS carry
                the demo, so they stay in both. */}
            <div className="cur-terminal-tabs">
              {inspecting && <button className={`cur-terminal-tab ${visibleTerminalTab === 'events' ? 'cur-terminal-tab--active' : ''}`} onClick={() => setTerminalTab('events')}>RELAY LOG</button>}
              <button className={`cur-terminal-tab ${visibleTerminalTab === 'trace' ? 'cur-terminal-tab--active' : ''}`} onClick={() => setTerminalTab('trace')}>TRACE</button>
              {inspecting && <button className={`cur-terminal-tab ${visibleTerminalTab === 'scopes' ? 'cur-terminal-tab--active' : ''}`} onClick={() => setTerminalTab('scopes')}>SCOPES</button>}
              <button
                key={`results-tab-${resultNonce}`}
                className={`cur-terminal-tab ${visibleTerminalTab === 'results' ? 'cur-terminal-tab--active' : ''}${resultNonce > 0 && visibleTerminalTab !== 'results' ? ' cur-terminal-tab--flash' : ''}`}
                onClick={() => setTerminalTab('results')}
              >
                RESULTS{toolResults.length > 0 && <span className="cur-terminal-tab-badge">{toolResults.length}</span>}
              </button>
              {visibleTerminalTab === 'trace' && <button className="cur-terminal-tab" style={{marginLeft:'auto',opacity:0.6}} onClick={() => setEvents([])}>Clear</button>}
              {visibleTerminalTab === 'results' && toolResults.length > 0 && <button className="cur-terminal-tab" style={{marginLeft:'auto',opacity:0.6}} onClick={() => setToolResults([])}>Clear</button>}
            </div>
            <div className="cur-terminal-content">
              {visibleTerminalTab === 'trace' && (
                <div className="cur-terminal-log">
                  {events.length === 0 && <span className="cur-terminal-empty">No events yet — sign in or call a tool</span>}
                  {events.slice(0, 100).map((e, i) => {
                    const rest = { ...e, ts: undefined, type: undefined };
                    let label = e.type;
                    let color = '#888';
                    if (e.type === 'relay' && e.direction === 'client->mcp') { label = `→ MCP ${e.method || ''} ${e.url || ''}`; color = '#7ec8e3'; }
                    if (e.type === 'relay' && e.direction === 'mcp->client') { label = `← MCP ${e.status >= 400 ? '❌' : '✅'} ${e.status}`; color = e.status >= 400 ? '#ff6b6b' : '#a8e6cf'; }
                    if (e.type === 'oauth') { label = `OAuth: ${e.phase}`; color = '#ffd93d'; }
                    if (e.type === 'mcp') { label = `MCP: ${e.phase}`; color = '#c3aed6'; }
                    if (e.type === 'error') { label = `ERROR: ${e.scope}`; color = '#ff6b6b'; }
                    if (e.type === 'config') { label = 'Config updated'; color = '#b2bec3'; }
                    return (
                      <details key={i} style={{borderBottom:'1px solid #222',padding:'2px 0'}}>
                        <summary style={{cursor:'pointer',color,listStyle:'none',display:'flex',gap:8,alignItems:'center'}}>
                          <span className="cur-trace-ts">{e.ts?.slice(11,23)||''}</span>
                          <span>{label}</span>
                          {e.type === 'error' && <span style={{color:'#ff6b6b'}}>{e.message}</span>}
                        </summary>
                        <pre className="cur-trace-json">
                          {JSON.stringify(rest, null, 2)}
                        </pre>
                      </details>
                    );
                  })}
                </div>
              )}
              {visibleTerminalTab === 'events' && (
                <div className="cur-terminal-log">
                  {events.length === 0 && <span className="cur-terminal-empty">Waiting for events...</span>}
                  {events.slice(0, 50).map((e, i) => (
                    <div key={i} className={`cur-terminal-line cur-terminal-line--${e.type}`}>
                      <span className="cur-terminal-ts">{e.ts?.slice(11, 19) || ''}</span>
                      <span className={`cur-terminal-badge cur-terminal-badge--${e.type}`}>{e.type}</span>
                      <span className="cur-terminal-msg">{JSON.stringify({ ...e, ts: undefined, type: undefined }, null, 0)}</span>
                    </div>
                  ))}
                </div>
              )}
              {visibleTerminalTab === 'scopes' && (
                <div className="cur-terminal-scopes">
                  {grantedScopes.length === 0 ? (
                    <span className="cur-terminal-empty">No scopes granted yet — sign in first</span>
                  ) : (
                    <div className="cur-scopes-detail">
                      <div className="cur-scopes-summary">
                        <span className="cur-scopes-count-large">{grantedScopes.length}</span>
                        <span className="cur-scopes-count-label">scopes granted</span>
                      </div>
                      <table className="cur-scopes-table">
                        <thead><tr><th>Scope</th><th>Category</th></tr></thead>
                        <tbody>
                          {grantedScopes.map((s) => (
                            <tr
                              key={s}
                              ref={s === selectedScope ? scopeRowRef : null}
                              className={s === selectedScope ? 'cur-scope-row--selected' : ''}
                              onClick={() => setSelectedScope(s)}
                            >
                              <td><code className={`cur-scope-pill ${scopeColor(s)}`}>{s}</code></td>
                              <td className="cur-scope-cat">
                                {s.startsWith('mcp:') ? 'MCP' : s.startsWith('p1:') ? 'PingOne' : (s === 'openid' || s === 'profile' || s === 'email') ? 'OIDC' : s.includes('read') ? 'Read' : s.includes('write') || s.includes('admin') ? 'Write' : 'Custom'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
              {visibleTerminalTab === 'results' && (
                <div className="cur-terminal-results">
                  {toolResults.length === 0 ? (
                    <span className="cur-terminal-empty">No results yet — run a tool to see its output here</span>
                  ) : (
                    toolResults.map((r, i) => (
                      <div key={`${r.ts}-${i}`} className="cur-result-item">
                        <div className="cur-result-item-head">
                          <span className={`cur-result-item-badge ${r.ok ? 'cur-result-item-badge--ok' : 'cur-result-item-badge--err'}`}>{r.ok ? '✓' : '❌'}</span>
                          <span className="cur-result-item-tool">{r.tool}</span>
                          <span className="cur-result-item-ts">{r.ts.slice(11, 19)}</span>
                        </div>
                        <JsonPane value={r.result} deep label={`${r.tool} result view`} />
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Status bar */}
      <footer className="cur-statusbar">
        <div className="cur-statusbar-left">
          <span className="cur-statusbar-item">MCP Protocol {mcpProtocol?.version || 'not negotiated'}</span>
          <span className="cur-statusbar-item">{tools.length} tools</span>
          {blockedDetail && <span className="cur-statusbar-item cur-statusbar-item--blocked">Blocked by policy</span>}
        </div>
        <div className="cur-statusbar-right">
          <span className="cur-statusbar-item">{config.llmModel || 'No LLM'}</span>
          <span className="cur-statusbar-item">{gatewayAuth === 'signed-in' ? 'Gateway: signed in' : gatewayAuth === 'connecting' ? 'Gateway: signing in…' : 'Gateway: not signed in'}</span>
        </div>
      </footer>
    </div>
  );
}
