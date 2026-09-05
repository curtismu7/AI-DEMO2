// demo_api_ui/src/pages/LlmTestPage.jsx
//
// A REST client for the Privilege LLM gateway. Pick a lane, edit the path and the
// JSON body, send it, read exactly what came back — status, latency, raw response.
//
// Deliberately unopinionated, which is what separates it from /llm-gateway: the
// console interprets the outcome (denied by policy / provider refused / answered),
// while this page interprets nothing. When the two disagree, this one is right, and
// that is the point of having it.
//
// The virtual key never reaches the browser. The server injects it and echoes the
// Authorization header masked, so the snippet below the form is faithful without
// being usable.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useThemeOptional } from '../context/ThemeContext';
import './LlmTestPage.css';

const API_BASE = process.env.REACT_APP_API_URL || '/api/privilege-mcp';

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
      err.status = r.status;
      if (data.code) err.code = data.code;
      throw err;
    }
    return data;
  });
}

const TITLES = { anthropic: 'Anthropic', google: 'Google', openai: 'OpenAI' };

// Ping's integration snippet points the OpenAI SDK at {gateway}/llm/<provider>/v1,
// so /chat/completions is the shape people arrive with. Anthropic's native Messages
// route is offered too because our own service calls it.
function pathsFor(lane) {
  const v1 = lane.route.replace(/\/(messages|chat\/completions)$/, '');
  const paths = [`${v1}/chat/completions`];
  if (lane.provider === 'anthropic') paths.push(`${v1}/messages`);
  return paths;
}

function bodyFor(path, model) {
  const messages = [{ role: 'user', content: 'What is the capital of France? Answer in one word.' }];
  return path.endsWith('/messages')
    ? { model, max_tokens: 64, messages }
    : { model, messages, max_tokens: 64 };
}

export default function LlmTestPage() {
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const [lanes, setLanes] = useState([]);
  const [gatewayUrl, setGatewayUrl] = useState('');
  const [provider, setProvider] = useState('anthropic');
  const [path, setPath] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [bodyError, setBodyError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  // The direct key lives only in this component's state for as long as the tab is
  // open. It is sent with the comparison request and never persisted anywhere —
  // not localStorage, not the server. Closing the page forgets it.
  const [directKey, setDirectKey] = useState('');
  const [cmp, setCmp] = useState(null);
  const [cmpBusy, setCmpBusy] = useState(false);
  const [cmpError, setCmpError] = useState('');

  const lane = lanes.find((l) => l.provider === provider);

  useEffect(() => {
    let cancelled = false;
    api('/llm/config')
      .then((cfg) => {
        if (cancelled) return;
        setGatewayUrl(cfg.gatewayUrl || '');
        setLanes(cfg.lanes || []);
        const first = (cfg.lanes || []).find((l) => l.keyConfigured) || (cfg.lanes || [])[0];
        if (first) setProvider(first.provider);
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'Could not read the gateway configuration.'); });
    return () => { cancelled = true; };
  }, []);

  // Changing lane resets path and body to that lane's defaults — editing a body for
  // one wire shape and sending it at another is the mistake this page should not help
  // you make silently.
  useEffect(() => {
    if (!lane) return;
    const next = pathsFor(lane)[0];
    setPath(next);
    setBodyText(JSON.stringify(bodyFor(next, lane.model), null, 2));
    setResult(null);
    setError('');
    setBodyError('');
  }, [lane]);

  const onPath = useCallback((next) => {
    setPath(next);
    if (lane) setBodyText(JSON.stringify(bodyFor(next, lane.model), null, 2));
  }, [lane]);

  const send = useCallback(async () => {
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch (err) {
      setBodyError(`Body is not valid JSON — ${err.message}`);
      return;
    }
    setBodyError('');
    setBusy(true);
    setResult(null);
    setError('');
    try {
      setResult(await api('/llm/raw', { method: 'POST', body: { provider, path, body } }));
    } catch (err) {
      setError(err.message || 'Request failed');
    } finally {
      setBusy(false);
    }
  }, [bodyText, provider, path]);

  const runCompare = useCallback(async () => {
    // The server's own key covers the direct side when it has one; the field is an
    // override for trying a different key without an .env edit and a restart.
    if (!directKey.trim() && !lane?.directKeyConfigured) {
      setCmpError('No key for the direct side. Paste one, or set it on the server.');
      return;
    }
    setCmpBusy(true);
    setCmp(null);
    setCmpError('');
    let model;
    try { model = JSON.parse(bodyText).model; } catch { model = lane?.model; }
    try {
      setCmp(await api('/llm/compare', {
        method: 'POST',
        body: { provider, directKey: directKey.trim() || undefined, model },
      }));
    } catch (err) {
      setCmpError(err.message || 'Comparison failed');
    } finally {
      setCmpBusy(false);
    }
  }, [directKey, provider, bodyText, lane]);

  const snippet = useMemo(() => {
    const base = `${gatewayUrl || '{gateway_url}'}${path.replace(/\/(messages|chat\/completions)$/, '')}`;
    let model = lane?.model || 'model';
    try { model = JSON.parse(bodyText).model || model; } catch { /* keep the lane default */ }
    return [
      '# OpenAI SDK — point base_url at the gateway, use the virtual key',
      'from openai import OpenAI',
      'client = OpenAI(',
      `    base_url="${base}",`,
      '    api_key="sk-orion-…",  # your Privilege virtual key',
      ')',
      'resp = client.chat.completions.create(',
      `    model="${model}",`,
      '    messages=[{"role":"user","content":"Hello"}],',
      ')',
    ].join('\n');
  }, [gatewayUrl, path, lane, bodyText]);

  const status = result?.response?.status;
  const tone = status === undefined ? '' : status < 300 ? 'ok' : status < 500 ? 'warn' : 'bad';

  return (
    <div className="lt">
      <header className="lt-bar">
        <div>
          <h1>LLM Gateway Test</h1>
          <p>Send a request straight at the Privilege gateway and read exactly what comes back.
            Nothing here interprets the result &mdash; the virtual key is injected server-side and
            never reaches this page.</p>
        </div>
        <div className="lt-bar__side">
          {gatewayUrl ? <code className="lt-origin">{gatewayUrl}</code> : null}
          <button
            type="button"
            className="lt-theme"
            onClick={toggleDarkMode}
            title="Switch this page between light and dark"
            aria-pressed={darkMode}
          >
            {darkMode ? '☀️ Light mode' : '🌙 Dark mode'}
          </button>
        </div>
      </header>

      {error ? <p className="lt-error" role="alert">{error}</p> : null}

      <div className="lt-body">
        <section className="lt-req" aria-label="Request">
          <div className="lt-row">
            <label htmlFor="lt-provider">Lane</label>
            <select id="lt-provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
              {lanes.map((l) => (
                <option key={l.provider} value={l.provider}>
                  {TITLES[l.provider] || l.provider}{l.keyConfigured ? '' : ' — no key'}
                </option>
              ))}
            </select>
          </div>

          <div className="lt-row">
            <label htmlFor="lt-path">Path</label>
            <select id="lt-path" value={path} onChange={(e) => onPath(e.target.value)}>
              {(lane ? pathsFor(lane) : []).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div className="lt-row lt-row--stack">
            <label htmlFor="lt-body">Request body</label>
            <textarea
              id="lt-body"
              spellCheck="false"
              rows={14}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
            />
            {bodyError ? <p className="lt-badjson" role="alert">{bodyError}</p> : null}
          </div>

          <div className="lt-actions">
            <button type="button" className="lt-send" onClick={send} disabled={busy || !lane?.keyConfigured}>
              {busy ? 'Sending…' : 'Send request'}
            </button>
            {lane && !lane.keyConfigured ? <span className="lt-note">{lane.keyEnv} is not set</span> : null}
          </div>

          <div className="lt-snippet">
            <span className="lt-k">Equivalent client</span>
            <pre>{snippet}</pre>
          </div>
        </section>

        <section className="lt-res" aria-label="Response">
          {!result ? (
            <p className="lt-empty">Send a request and the raw response appears here &mdash; status, timing
              and the exact JSON the gateway returned.</p>
          ) : (
            <>
              <div className="lt-resline">
                <span className={`lt-pill is-${tone}`} data-testid="lt-status">HTTP {status}</span>
                <span className="lt-ms">{result.latencyMs} ms</span>
                <code className="lt-url">{result.request?.url}</code>
              </div>

              <div className="lt-pane">
                <span className="lt-k">Response</span>
                <pre data-testid="lt-response">
                  {result.response?.json
                    ? JSON.stringify(result.response.json, null, 2)
                    : result.response?.raw || '(empty body)'}
                </pre>
              </div>

              <div className="lt-pane">
                <span className="lt-k">Request as sent</span>
                <pre>{JSON.stringify(result.request, null, 2)}</pre>
              </div>
            </>
          )}
        </section>
      </div>

      <section className="lt-cmp" aria-label="Direct vs gateway">
        <div className="lt-cmp__head">
          <span className="lt-k">Direct vs through Privilege</span>
          <span className="lt-cmp__why">
            {lane?.directKeyConfigured
              ? `The direct side uses ${lane.directKeyEnv} on the server. Paste a key here to run it with a different one — a pasted key is used for this request only and never stored.`
              : 'This app holds no provider key of its own — that is the point of a virtual key. Paste one to run the unmediated side. It is used for this request only and never stored.'}
          </span>
        </div>

        <div className="lt-cmp__form">
          <label htmlFor="lt-directkey">Provider API key</label>
          <input
            id="lt-directkey"
            type="password"
            autoComplete="off"
            spellCheck="false"
            placeholder={lane?.directKeyConfigured
              ? `using ${lane.directKeyEnv} — paste to override`
              : `your real ${TITLES[provider] || provider} key`}
            value={directKey}
            onChange={(e) => setDirectKey(e.target.value)}
          />
          <button type="button" className="lt-send" onClick={runCompare} disabled={cmpBusy}>
            {cmpBusy ? 'Comparing…' : 'Compare'}
          </button>
        </div>

        {cmpError ? <p className="lt-badjson" role="alert">{cmpError}</p> : null}

        {cmp ? (
          <div className="lt-cmp__out" data-testid="lt-compare">
            <div className="lt-cmp__grid">
              <span className="lt-cmp__hk" />
              <span className="lt-cmp__hk">Direct to provider</span>
              <span className="lt-cmp__hk">Through Privilege</span>

              <span className="lt-cmp__rk">Models visible</span>
              <span className="lt-cmp__v">{cmp.models.direct.count} <em>HTTP {cmp.models.direct.status ?? '—'}</em></span>
              <span className="lt-cmp__v">{cmp.models.gateway.count} <em>HTTP {cmp.models.gateway.status ?? '—'}</em></span>

              <span className="lt-cmp__rk">Completion</span>
              <span className="lt-cmp__v">
                HTTP {cmp.completion.direct.status ?? '—'} <em>{cmp.completion.direct.latencyMs} ms</em>
              </span>
              <span className="lt-cmp__v">
                HTTP {cmp.completion.gateway.status ?? '—'} <em>{cmp.completion.gateway.latencyMs} ms</em>
              </span>
            </div>

            <p className="lt-cmp__verdict" data-testid="lt-compare-verdict">
              {cmp.models.direct.count === 0
                ? 'The direct call returned no model list — check the key and read the raw responses below.'
                : cmp.models.identical
                  ? 'Identical model lists. Privilege constrains what the key may CALL, not what it can SEE.'
                  : `Lists differ — ${cmp.models.onlyDirect.length} only direct, ${cmp.models.onlyGateway.length} only via the gateway.`}
            </p>

            {cmp.models.onlyDirect.length ? (
              <div className="lt-pane">
                <span className="lt-k">Visible only without the gateway</span>
                <pre>{cmp.models.onlyDirect.join('\n')}</pre>
              </div>
            ) : null}

            <div className="lt-cmp__pair">
              <div className="lt-pane">
                <span className="lt-k">Direct response</span>
                <pre>{JSON.stringify(cmp.completion.direct.json ?? cmp.completion.direct.error ?? cmp.completion.direct.raw, null, 2)}</pre>
              </div>
              <div className="lt-pane">
                <span className="lt-k">Gateway response</span>
                <pre>{JSON.stringify(cmp.completion.gateway.json ?? cmp.completion.gateway.error ?? cmp.completion.gateway.raw, null, 2)}</pre>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
