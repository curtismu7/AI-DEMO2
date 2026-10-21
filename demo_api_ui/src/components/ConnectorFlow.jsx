import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import apiClient from '../services/apiClient';
import { buildConnectorSteps } from '../utils/connectorSteps';
import './ConnectorFlow.css';

const BASE = '/api/privilege-mcp';
const CLIENTS = { chatgpt: 'ChatGPT', claude: 'Claude' };
const errorText = (err) => err?.response?.data?.error || err?.message || 'Request failed';
const pretty = (value) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));

function Json({ value }) {
  return <pre className="cf-json">{pretty(value)}</pre>;
}

function TokenValue({ value }) {
  const [shown, setShown] = useState(false);
  const masked = value.length > 28 ? `${value.slice(0, 14)}…${value.slice(-8)}` : value;
  return (
    <div className="cf-token">
      <code className="cf-token__value" data-testid="cf-token-value">{shown ? value : masked}</code>
      <button type="button" onClick={() => setShown((s) => !s)}>{shown ? 'Hide' : 'Show'}</button>
      <button type="button" onClick={() => navigator.clipboard?.writeText(value)}>Copy</button>
    </div>
  );
}

function Card({ title, step, children, testId }) {
  return (
    <section className="cf-card" data-testid={testId}>
      <h4>{title}<span>step {step}</span></h4>
      {children}
    </section>
  );
}

/**
 * "Add this MCP server to ChatGPT / Claude": the real connector flow, step by step. Steps 1-3 are live calls, 4-8 are
 * the real OAuth code + PKCE sign-in (popup) with a CIMD client identity where the gateway supports it, 9-12 are a
 * real tools/call carrying the bearer token. Everything shown comes back from the BFF (/api/privilege-mcp/connector/*).
 */
export default function ConnectorFlow() {
  const [client, setClient] = useState('chatgpt');
  const [door, setDoor] = useState('');
  const [added, setAdded] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [trace, setTrace] = useState({});
  const [token, setToken] = useState(null);
  const [cimdDoc, setCimdDoc] = useState(null);
  const [tools, setTools] = useState([]);
  const [tool, setTool] = useState('');
  const [call, setCall] = useState(null);
  const popup = useRef(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    apiClient.get(`${BASE}/state`).then(({ data }) => setDoor(data?.config?.mcpUrl || '')).catch(() => {});
    return () => { cancelled.current = true; };
  }, []);

  const refresh = useCallback(async () => {
    const { data } = await apiClient.get(`${BASE}/connector/trace`);
    setTrace(data.trace || {});
    setToken(data.token || null);
    return data;
  }, []);

  const loadClientDocument = useCallback(async (clientId) => {
    // The identity service fetches this document; we show the same document from our own origin.
    try {
      const path = new URL(clientId).pathname;
      if (!path.startsWith('/api/cimd/')) return;
      const { data } = await apiClient.get(path);
      setCimdDoc(data);
    } catch { /* not a client-document id (DCR) or unreadable: the step says so */ }
  }, []);

  // Wait for the sign-in popup: it lands back on /personal-agent and closes itself; the token it left in the BFF is what we poll for.
  const waitForSignIn = useCallback(() => new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(async () => {
      if (cancelled.current) { clearInterval(timer); reject(new Error('cancelled')); return; }
      try {
        const data = await refresh();
        if (data.token) { clearInterval(timer); resolve(data); return; }
      } catch { /* keep polling */ }
      if (Date.now() - started > 180000) { clearInterval(timer); reject(new Error('Sign-in was not completed within 3 minutes.')); }
    }, 1500);
  }), [refresh]);

  const connect = useCallback(async () => {
    setError(''); setNotice(''); setCall(null); setCimdDoc(null); setTools([]); setTool(''); setToken(null); setTrace({});
    try {
      setBusy('Steps 1-3: asking the server for a token it will not give us yet…');
      const probe = await apiClient.post(`${BASE}/connector/probe`, {});
      setTrace(probe.data.trace || {});

      setBusy('Step 4: starting the browser authorization…');
      let start;
      try {
        await apiClient.post(`${BASE}/client-identity`, { mode: 'cimd' });
        start = await apiClient.post(`${BASE}/auth/start`, { returnTo: '/personal-agent' });
      } catch (err) {
        // The gateway cannot take a client document (or cannot reach ours): register dynamically instead and say so.
        setNotice(`Client metadata (CIMD) was not usable here - ${errorText(err)} Using dynamic registration instead.`);
        await apiClient.post(`${BASE}/client-identity`, { mode: 'dcr' });
        start = await apiClient.post(`${BASE}/auth/start`, { returnTo: '/personal-agent' });
      }
      if (start.data.noAuthRequired) {
        setNotice('This door does not require sign-in, so there is no OAuth flow to show.');
        await refresh();
        return;
      }
      const afterStart = await refresh();
      if (afterStart.trace?.authorize?.params?.client_id) loadClientDocument(afterStart.trace.authorize.params.client_id);

      setBusy(`Steps 5-8: sign in and approve in the window that opened (the browser, not ${CLIENTS[client]}, talks to the identity service)…`);
      popup.current = window.open(start.data.authUrl, 'pa-connector', 'width=520,height=720,left=240,top=100');
      if (!popup.current) setNotice('The sign-in window was blocked. Allow pop-ups for this site and connect again.');
      await waitForSignIn();

      setBusy('Step 9: asking the gateway what this token can reach…');
      const listed = await apiClient.post(`${BASE}/tools/list`, {});
      const names = (listed.data?.tools || []).map((t) => t.name);
      setTools(names);
      setTool(names[0] || '');
    } catch (err) {
      if (err.message !== 'cancelled') setError(errorText(err));
    } finally {
      setBusy('');
    }
  }, [client, loadClientDocument, refresh, waitForSignIn]);

  const runTool = useCallback(async () => {
    if (!tool) return;
    setBusy(`Steps 9-12: calling ${tool} with the bearer token…`);
    setError('');
    try {
      const { data, status } = await apiClient.post(`${BASE}/tools/call`, { name: tool, arguments: {} }, { validateStatus: () => true });
      setCall({ ok: status >= 200 && status < 300 && !data?.error, status, body: data });
    } catch (err) {
      setCall({ ok: false, status: err.response?.status || 0, body: { error: errorText(err) } });
    } finally {
      setBusy('');
    }
  }, [tool]);

  const steps = useMemo(
    () => buildConnectorSteps({ trace, token, cimdDoc, signedIn: Boolean(token), call }),
    [trace, token, cimdDoc, call],
  );
  const claims = token?.claims;
  const authorize = trace.authorize;
  const tokenStep = trace.token;

  return (
    <div className="cf" data-testid="connector-flow">
      <div className="cf-col cf-col--client">
        <div role="group" aria-label="Chat client" className="cf-clients">
          {Object.entries(CLIENTS).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={client === id} onClick={() => setClient(id)}>{label}</button>
          ))}
        </div>
        <div className={`cf-chat cf-chat--${client}`}>
          <header>{CLIENTS[client]}</header>
          <div className="cf-chat__body">
            <section className="cf-directory" aria-label="Connector directory">
              <h4>Connectors</h4>
              <p className="cf-muted">A user does not install anything. They pick the connector from {CLIENTS[client]}&apos;s directory or paste its MCP URL. {CLIENTS[client]} then discovers everything else.</p>
              <div className="cf-directory__card">
                <div>
                  <strong>Protected MCP server</strong>
                  <code>{door || 'loading…'}</code>
                </div>
                <button type="button" disabled={added || !door} onClick={() => setAdded(true)}>{added ? 'Added' : 'Add'}</button>
              </div>
            </section>
            {added && (
              <section className="cf-ask">
                <p className="cf-bubble cf-bubble--user">Use the connector to get my data.</p>
                {!token && <button type="button" className="cf-primary" disabled={Boolean(busy)} onClick={connect}>Connect {CLIENTS[client]} to the server</button>}
                {token && (
                  <div className="cf-tool">
                    <label>
                      Tool
                      <select value={tool} onChange={(e) => setTool(e.target.value)} disabled={Boolean(busy)}>
                        {tools.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                    <button type="button" className="cf-primary" disabled={Boolean(busy) || !tool} onClick={runTool}>Call tool</button>
                    <button type="button" onClick={connect} disabled={Boolean(busy)}>Start over</button>
                  </div>
                )}
              </section>
            )}
            {busy && <p className="cf-status" role="status">{busy}</p>}
            {notice && <p className="cf-notice" role="status">{notice}</p>}
            {error && <p className="cf-error" role="alert">{error}</p>}
            {call && (
              <p className={`cf-bubble cf-bubble--agent${call.ok ? '' : ' cf-bubble--deny'}`} data-testid="cf-result">
                {call.ok ? 'Authorized result received (see step 12).' : `The gateway refused this call (${call.status}). The tool did not run.`}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="cf-col cf-col--flow">
        <ol className="cf-steps" data-testid="cf-steps">
          {steps.map((step) => (
            <li key={step.n} className={`cf-step cf-step--${step.status}`} data-status={step.status}>
              <details>
                <summary>
                  <span className="cf-step__n">{step.n}</span>
                  <span className="cf-step__title">{step.title}</span>
                  <span className="cf-step__state">{step.status === 'done' ? 'done' : step.status === 'error' ? 'refused' : 'waiting'}</span>
                  {step.summary && <span className="cf-step__summary">{step.summary}</span>}
                </summary>
                {step.detail ? <Json value={step.detail} /> : <p className="cf-muted">Has not run yet.</p>}
              </details>
            </li>
          ))}
        </ol>

        <div className="cf-cards" data-testid="cf-token-cards">
          <Card title="Access token" step="8" testId="cf-card-access">
            {token ? (
              <>
                <TokenValue value={token.value} />
                <dl>
                  <dt>Format</dt><dd>{token.kind === 'jwt' ? 'JWT' : 'Opaque (introspect to read it)'}</dd>
                  <dt>Scope</dt><dd>{token.scope || 'not stated'}</dd>
                  <dt>Expires</dt><dd>{token.expiresAt ? new Date(token.expiresAt).toLocaleTimeString() : 'not stated'}</dd>
                  <dt>Refresh token</dt><dd>{token.hasRefreshToken ? 'held by the BFF' : 'none issued'}</dd>
                  {claims && <><dt>Audience</dt><dd>{[].concat(claims.aud || 'none').join(', ')}</dd><dt>Subject</dt><dd>{claims.sub || 'none'}</dd></>}
                </dl>
                {claims && <Json value={claims} />}
              </>
            ) : <p className="cf-muted">Not issued yet.</p>}
          </Card>
          <Card title="Authorization request" step="4" testId="cf-card-authorize">
            {authorize ? <Json value={{ endpoint: authorize.endpoint, ...authorize.params }} /> : <p className="cf-muted">Not sent yet.</p>}
          </Card>
          <Card title="Client metadata document" step="5" testId="cf-card-cimd">
            {cimdDoc ? <Json value={cimdDoc} /> : <p className="cf-muted">{authorize ? 'No client document for this sign-in.' : 'Not fetched yet.'}</p>}
          </Card>
          <Card title="Token request" step="7" testId="cf-card-token-request">
            {tokenStep ? <Json value={{ endpoint: tokenStep.endpoint, ...tokenStep.request }} /> : <p className="cf-muted">Not sent yet.</p>}
          </Card>
          <Card title="Consent record" step="6" testId="cf-card-consent">
            {token ? <Json value={{ granted_scope: token.scope || tokenStep?.response?.scope || '', resource: trace.resource?.response?.body?.resource || door, decided_at: tokenStep?.at }} /> : <p className="cf-muted">No consent yet.</p>}
          </Card>
          <Card title="Policy decision" step="10" testId="cf-card-decision">
            {call ? <Json value={{ decision: call.ok ? 'Permit' : `Deny (${call.status})`, body: call.body }} /> : <p className="cf-muted">No decision yet.</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}
