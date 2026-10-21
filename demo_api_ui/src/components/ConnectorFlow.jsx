import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import apiClient from '../services/apiClient';
import EmbeddedFlowDiagram from './EmbeddedFlowDiagram';
import { buildConnectorSteps } from '../utils/connectorSteps';
import { CONNECTOR_EDGES, CONNECTOR_FOOTNOTE, CONNECTOR_GROUPS, CONNECTOR_NODES, CONNECTOR_STEPS } from '../config/connectorFlowDiagram';
import './ConnectorFlow.css';

const BASE = '/api/connector-sandbox';
const CLIENTS = { chatgpt: 'ChatGPT', claude: 'Claude' };
const errorText = (err) => err?.response?.data?.error || err?.message || 'Request failed';
const pretty = (value) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));
const SIGN_IN_WAIT_MS = 180000;

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

const Empty = ({ text }) => <p className="cf-muted">{text}</p>;

/**
 * "Add this MCP server to ChatGPT / Claude": the 12-step connector flow, every leg run for real by the sandbox in
 * services/connectorSandbox.js (CIMD client, authorization code + PKCE, consent record, private_key_jwt assertion,
 * audience-bound token, gateway checks, policy decision). The page only drives it and shows the recorded legs.
 */
export default function ConnectorFlow() {
  const [client, setClient] = useState('chatgpt');
  const [added, setAdded] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [run, setRun] = useState(null);
  const popup = useRef(null);
  const alive = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const connect = useCallback(async () => {
    setError(''); setRun(null);
    try {
      setBusy('Steps 1-3: asking the gateway for a tool without a token, then reading its discovery documents…');
      const started = await apiClient.post(`${BASE}/runs`, {});
      setRun(started.data.run);

      setBusy(`Steps 4-6: sign in and decide in the window that opened (the browser, not ${CLIENTS[client]}, talks to the identity service)…`);
      popup.current = window.open(started.data.authUrl, 'pa-connector', 'width=520,height=720,left=240,top=100');
      if (!popup.current) setError('The sign-in window was blocked. Allow pop-ups for this site and connect again.');

      const id = started.data.run.id;
      const began = Date.now();
      let current = started.data.run;
      while (alive.current && !['code_received', 'denied'].includes(current.status)) {
        if (Date.now() - began > SIGN_IN_WAIT_MS) throw new Error('Consent was not completed within 3 minutes.');
        await new Promise((r) => setTimeout(r, 1200));
        current = (await apiClient.get(`${BASE}/runs/${id}`)).data.run;
        setRun(current);
      }
      if (!alive.current) return;
      if (current.status === 'denied') { setError('You denied access. No code was issued, so the client has no way to get a token.'); return; }

      setBusy('Steps 7-8: exchanging the code with PKCE and a signed client assertion…');
      const exchanged = await apiClient.post(`${BASE}/runs/${id}/token`, {});
      setRun(exchanged.data.run);
    } catch (err) {
      if (alive.current) setError(errorText(err));
    } finally {
      if (alive.current) setBusy('');
    }
  }, [client]);

  const callTool = useCallback(async (tool) => {
    if (!run) return;
    setBusy(`Steps 9-12: calling ${tool} with the bearer token…`);
    setError('');
    try {
      const { data } = await apiClient.post(`${BASE}/runs/${run.id}/call`, { tool });
      setRun(data.run);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy('');
    }
  }, [run]);

  const steps = useMemo(() => buildConnectorSteps({ run }), [run]);
  const trace = run?.trace || {};
  const claims = run?.token?.decoded?.payload;
  const result = trace['12a']?.response;
  const permitted = result?.status === 200;
  const tokenReady = Boolean(run?.token);

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
              <p className="cf-muted">The member installs nothing. They pick the connector from {CLIENTS[client]}&apos;s directory, or paste its MCP URL. {CLIENTS[client]} discovers the rest.</p>
              <div className="cf-directory__card">
                <div>
                  <strong>Member benefits</strong>
                  <code>{`${window.location.origin}${BASE}/mcp`}</code>
                </div>
                <button type="button" disabled={added} onClick={() => setAdded(true)}>{added ? 'Added' : 'Add'}</button>
              </div>
            </section>
            {added && (
              <section className="cf-ask">
                <p className="cf-bubble cf-bubble--user">Show my benefits.</p>
                {!tokenReady && <button type="button" className="cf-primary" disabled={Boolean(busy)} onClick={connect}>Connect {CLIENTS[client]} to the server</button>}
                {tokenReady && (
                  <div className="cf-tool">
                    <button type="button" className="cf-primary" disabled={Boolean(busy)} onClick={() => callTool('get_my_benefits')}>Show my benefits</button>
                    <button type="button" disabled={Boolean(busy)} onClick={() => callTool('get_other_member_benefits')}>Try another member&apos;s benefits</button>
                    <button type="button" disabled={Boolean(busy)} onClick={connect}>Start over</button>
                  </div>
                )}
              </section>
            )}
            {busy && <p className="cf-status" role="status">{busy}</p>}
            {error && <p className="cf-error" role="alert">{error}</p>}
            {trace['12b'] && <p className="cf-bubble cf-bubble--agent" data-testid="cf-result">{trace['12b'].text}</p>}
            {result && !permitted && <p className="cf-bubble cf-bubble--agent cf-bubble--deny" data-testid="cf-result">{result.body?.error_description || 'The gateway refused this call.'}</p>}
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
                  <span className="cf-step__state">{step.status === 'done' ? 'done' : step.status === 'error' ? 'stopped' : 'waiting'}</span>
                  {step.summary && <span className="cf-step__summary">{step.summary}</span>}
                </summary>
                {step.detail ? <Json value={step.detail} /> : <Empty text="Has not run yet." />}
              </details>
            </li>
          ))}
        </ol>

        <div className="cf-cards" data-testid="cf-token-cards">
          <Card title="Access token" step="8" testId="cf-card-access">
            {tokenReady ? (
              <>
                <TokenValue value={run.token.access_token} />
                <dl>
                  <dt>Format</dt><dd>JWT, RS256 (header kid {run.token.decoded?.header?.kid})</dd>
                  <dt>Audience</dt><dd>{claims?.aud}</dd>
                  <dt>Subject</dt><dd>{claims?.sub}</dd>
                  <dt>Scope</dt><dd>{claims?.scope}</dd>
                  <dt>Expires in</dt><dd>{run.token.expires_in}s</dd>
                </dl>
                <Json value={claims} />
              </>
            ) : <Empty text="Not issued yet." />}
          </Card>
          <Card title="Authorization request" step="4" testId="cf-card-authorize">
            {trace['4b'] ? <Json value={trace['4b'].request} /> : <Empty text="Not sent yet." />}
          </Card>
          <Card title="Client metadata (CIMD) and JWKS" step="5 / 8" testId="cf-card-cimd">
            {trace['5b'] ? <Json value={{ client_document: trace['5b'].response.body, jwks: trace['8b']?.response.body }} /> : <Empty text="Not fetched yet." />}
          </Card>
          <Card title="Client assertion" step="7" testId="cf-card-assertion">
            {trace['7a']?.clientAssertion ? <Json value={{ header: trace['7a'].clientAssertion.header, claims: trace['7a'].clientAssertion.payload, verified: trace['8c']?.response.status === 200 }} /> : <Empty text="Not sent yet." />}
          </Card>
          <Card title="Consent record" step="6" testId="cf-card-consent">
            {run?.consent ? <Json value={run.consent} /> : <Empty text={run?.status === 'denied' ? 'Denied: no consent record exists.' : 'No consent yet.'} />}
          </Card>
          <Card title="Gateway token checks" step="9" testId="cf-card-gateway">
            {trace['9v'] ? <Json value={trace['9v'].validation} /> : <Empty text="No call yet." />}
          </Card>
          <Card title="Policy decision" step="10" testId="cf-card-decision">
            {trace['10b'] ? <Json value={{ engine: trace['10a'].engine, input: trace['10a'].request, rules: trace['10a'].rules, decision: trace['10b'].response.decision }} /> : <Empty text="No decision yet." />}
          </Card>
        </div>

        <details className="cf-diagram" open>
          <summary>Diagram: how ChatGPT accesses member benefits</summary>
          <EmbeddedFlowDiagram
            testId="connector-flow-diagram"
            pingStyle
            title="How ChatGPT accesses member benefits"
            ariaLabel="Connector authorization flow diagram"
            diagramLabel="User, ChatGPT, MCP gateway, identity provider, PingOne Authorize and the benefits API"
            lede={`Illustrative proposed architecture. ${CONNECTOR_FOOTNOTE}`}
            config={{ GROUPS: CONNECTOR_GROUPS, NODES: CONNECTOR_NODES, EDGES: CONNECTOR_EDGES, STEPS: CONNECTOR_STEPS }}
          />
        </details>
      </div>
    </div>
  );
}
