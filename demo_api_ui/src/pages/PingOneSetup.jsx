// PingOne MCP Setup (/pingone-setup) — checks a PingOne worker app's credentials against the real thing.
//
// Honesty: nothing here is simulated. "Run setup and test" posts the three values to the demo server, which asks the
// environment's PingOne token endpoint for a worker token and then calls tools/list on the hosted PingOne MCP server
// with it. Every step result on the page is what that server reported. The POST needs a signed-in session; when the
// server answers 401/403 the page says so and that nothing reached PingOne.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md) on the shared
// primitives (components/pingUi, docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards, P5 kv, P7 chips,
// P9 buttons. Skipped: P6 (not an inspector), P8 (no diagram). The standalone shell bar is not added (the app has its
// own), and the page's own dark/light toggle is gone: the app header already carries one.
//
// P9, one primary per view state: "Run setup and test" is the only primary in every state (idle, running, passed,
// incomplete, signed out, failed). It is aria-disabled, not disabled, while a field is empty or a run is in flight, so
// it keeps keyboard focus; the reason is printed under it. The button name never changes: progress is announced in the
// status line.
import React, { useEffect, useState } from 'react';
import PageHeader from '../components/common/PageHeader';
import { PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList } from '../components/pingUi';
import '../styles/PingOneSetup.css';

const FIELDS = [
  { name: 'environmentId', label: 'Environment ID', type: 'text', placeholder: 'e.g., 01d89b06-66d5-430e-9f28-65636843788b' },
  { name: 'clientId', label: 'Worker App Client ID', type: 'text', placeholder: 'e.g., 89ad8921-2e90-4b58-93bd-9ec72bd33ad5' },
  { name: 'clientSecret', label: 'Worker App Client Secret', type: 'password', placeholder: 'Paste your client secret' },
];

const readToken = () => {
  try {
    return sessionStorage.getItem('id_token') || localStorage.getItem('id_token');
  } catch {
    return null;
  }
};

// One step of the server's report. A step the server never reached (an earlier step failed) comes back with
// success false and no error: that is "Not run", not "Failed: null".
const stepView = (step) => {
  if (step?.success) return { tone: 'ok', word: 'Passed' };
  if (step?.error) return { tone: 'danger', word: 'Failed' };
  return { tone: 'neutral', word: 'Not run' };
};

export default function PingOneSetup() {
  const [credentials, setCredentials] = useState({ environmentId: '', clientId: '', clientSecret: '' });
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [ranFor, setRanFor] = useState('');
  const [error, setError] = useState(null); // { kind: 'auth' | 'server' | 'network', message }
  // 'pending' until the defaults request settles, then 'filled' (server sent values), 'none' (server answered, no
  // values), 'signedout' (401/403) or 'failed' (any other non-ok answer, or the request never completed).
  const [defaults, setDefaults] = useState('pending');

  // Pre-fill the form with the worker credentials configured on the server.
  // These remain fully editable; the fetch just seeds them for convenience.
  useEffect(() => {
    const token = readToken();
    fetch('/api/pingone/setup/defaults', {
      headers: { ...(token && { Authorization: `Bearer ${token}` }) },
    })
      .then((res) => {
        if (res.status === 401 || res.status === 403) return 'signedout';
        if (!res.ok) return 'failed';
        return res.json().catch(() => 'failed');
      })
      .then((data) => {
        if (data === 'signedout' || data === 'failed') {
          setDefaults(data);
        } else if (data && (data.environmentId || data.clientId || data.clientSecret)) {
          setCredentials({
            environmentId: data.environmentId || '',
            clientId: data.clientId || '',
            clientSecret: data.clientSecret || '',
          });
          setDefaults('filled');
        } else {
          setDefaults('none');
        }
      })
      .catch(() => setDefaults('failed'));
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setCredentials((prev) => ({ ...prev, [name]: value }));
  };

  const complete = Boolean(credentials.environmentId && credentials.clientId && credentials.clientSecret);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading || !complete) return; // aria-disabled: the button keeps focus but does nothing
    setLoading(true);
    setError(null);
    setResults(null);
    setRanFor(credentials.environmentId);

    try {
      const token = readToken();
      const response = await fetch('/api/pingone/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify(credentials),
      });

      if (response.status === 401 || response.status === 403) {
        setError({ kind: 'auth', message: 'You are not signed in, or your session has ended.' });
        return;
      }
      const data = await response.json().catch(() => null);
      if (response.ok && data?.steps) {
        setResults(data);
      } else {
        setError({ kind: 'server', message: data?.error || `The server answered HTTP ${response.status}.` });
      }
    } catch (err) {
      setError({ kind: 'network', message: err.message || 'Network error' });
    } finally {
      setLoading(false);
    }
  };

  const steps = results
    ? [
        { key: 'token', title: 'Worker token', step: results.steps.tokenAcquisition, ok: 'A worker token was acquired from the PingOne token endpoint.' },
        { key: 'mcp', title: 'Hosted MCP connectivity', step: results.steps.gatewayConnectivity, ok: 'The hosted PingOne MCP server accepted the worker token.' },
        {
          key: 'tools',
          title: 'Tool call',
          step: results.steps.toolCall,
          ok: `tools/list returned ${results.steps.toolCall?.toolsFound ?? 0} tools.`,
        },
      ]
    : [];
  const passedCount = steps.filter((s) => s.step?.success).length;

  // The always-mounted status line: one sentence for every state, so a screen reader hears each change.
  let status;
  if (loading) {
    status = { tone: 'info', word: 'Running', text: 'Contacting PingOne, then the hosted MCP server.' };
  } else if (error?.kind === 'auth') {
    status = { tone: 'danger', word: 'Sign-in needed', text: `${error.message} Nothing was sent to PingOne. Sign in from the header, then run again.` };
  } else if (error?.kind === 'network') {
    status = { tone: 'danger', word: 'Failed', text: `Could not reach the demo server: ${error.message}` };
  } else if (error) {
    status = { tone: 'danger', word: 'Failed', text: `The demo server reported: ${error.message}` };
  } else if (results?.success) {
    status = { tone: 'ok', word: 'Passed', text: 'All three checks passed.' };
  } else if (results) {
    status = { tone: 'warn', word: 'Incomplete', text: `${passedCount} of 3 checks passed. See the steps below.` };
  } else {
    status = { tone: 'neutral', word: 'Not run', text: 'Nothing has been sent yet.' };
  }

  const mcpUrl = `https://mcp.pingone.com/admin/${credentials.environmentId || '{envId}'}/mcp`;

  return (
    <PingPage className="p1setup-page">
      <SimBanner data-testid="p1setup-banner">
        <strong>LIVE, NOT SIMULATED</strong> — &ldquo;Run setup and test&rdquo; sends the credentials below to this demo
        server, which asks your PingOne environment for a worker token and then calls the hosted PingOne MCP server with
        it. Each result is what those two systems answered. Running it needs you to be signed in to this app; if you are
        not, the server refuses the request before anything reaches PingOne.
      </SimBanner>
      <PageHeader
        className="p1setup-hero"
        eyebrow="Ping products · PingOne MCP"
        title="PingOne MCP Setup"
        summary="Check a PingOne worker app's credentials for MCP connectivity: can it get a token, reach the hosted MCP server and list its tools."
      />
      <PageFrame>
        <Section id="p1setup-credentials" kicker="1 · Credentials" title="Enter the worker app's credentials">
          <CardGrid>
            <Card title="Worker app credentials" data-testid="p1setup-form-card">
              <p
                className="pu-note p1setup-defaults"
                role="status"
                data-testid="p1setup-defaults"
              >
                {defaults === 'filled' && 'Pre-filled from the demo server’s configured worker credentials. Edit any field if needed.'}
                {defaults === 'none' && 'The server returned no default credentials, so the fields start empty.'}
                {defaults === 'signedout' && 'Default credentials were not loaded because you are not signed in. The fields start empty; type the values, or sign in and reload.'}
                {defaults === 'failed' && 'Default credentials could not be loaded from the demo server, so the fields start empty. You can still type the values.'}
              </p>
              <form onSubmit={handleSubmit} className="p1setup-form" data-testid="p1setup-form" aria-describedby="p1setup-hint">
                {FIELDS.map((f) => (
                  <div className="p1setup-field" key={f.name}>
                    <label className="pu-label" htmlFor={f.name}>{f.label}</label>
                    <input
                      className="p1setup-input"
                      type={f.type}
                      id={f.name}
                      name={f.name}
                      value={credentials[f.name]}
                      onChange={handleInputChange}
                      placeholder={f.placeholder}
                      required
                      readOnly={loading}
                      autoComplete="off"
                      spellCheck={false}
                      data-testid={`p1setup-${f.name}`}
                    />
                  </div>
                ))}
                <div className="pu-actions">
                  <button
                    type="submit"
                    className="pu-btn pu-btn--primary"
                    data-testid="p1setup-submit"
                    aria-disabled={loading || !complete ? 'true' : undefined}
                  >
                    Run setup and test
                  </button>
                </div>
                <p className="pu-note" id="p1setup-hint" data-testid="p1setup-hint">
                  {loading
                    ? 'A run is in progress. The fields are locked until it finishes.'
                    : complete
                      ? 'Ready. This sends the three values to PingOne through the demo server.'
                      : 'Fill in all three fields to run the check.'}
                </p>
              </form>
            </Card>

            <Card tone="neutral" title="Where to find your credentials" data-testid="p1setup-help">
              <KvList
                items={[
                  { label: 'Environment ID', value: 'PingOne Admin Console → Environment → Settings' },
                  { label: 'Client ID and secret', value: 'PingOne Admin Console → Applications → your worker app → Credentials' },
                  { label: 'Admin roles', value: 'The app needs the Environment Admin and Identity Data Admin roles.' },
                ]}
              />
            </Card>
          </CardGrid>
        </Section>

        <Section id="p1setup-result" kicker="2 · Result" title="What PingOne and the hosted MCP server answered">
          <p className="pu-status-line p1setup-status" role="status" data-testid="p1setup-status">
            <StatusChip tone={status.tone}>{status.word}</StatusChip>
            <span>{status.text}</span>
          </p>

          {error && error.kind !== 'auth' && (
            <Card tone="danger" title="Setup request failed" data-testid="p1setup-error">
              <p className="pu-status-line"><StatusChip tone="danger">Failed</StatusChip> {error.message}</p>
              <p className="pu-note" data-testid="p1setup-error-hint">
                {error.kind === 'network'
                  ? 'The request did not reach the demo server, so nothing was checked. Make sure the server is running, then run again.'
                  : 'The demo server could not complete the run. This is not a verdict on the credentials; run again, or check the server log.'}
              </p>
            </Card>
          )}

          {results && (
            <>
              <Card tone={results.success ? 'ok' : 'warn'} title="Setup summary" data-testid="p1setup-summary">
                <p className="pu-status-line">
                  <StatusChip tone={results.success ? 'ok' : 'warn'}>{results.success ? 'Passed' : 'Incomplete'}</StatusChip>
                  {results.success ? 'The worker credentials work end to end.' : 'The worker credentials did not pass every check.'}
                </p>
                <KvList
                  items={[
                    { label: 'Environment', value: ranFor, mono: true },
                    { label: 'Checks passed', value: `${passedCount} of 3` },
                    { label: 'Tools listed', value: String(results.steps.toolCall?.toolsFound ?? 0) },
                  ]}
                />
              </Card>

              <CardGrid>
                {steps.map(({ key, title, step, ok }) => {
                  const view = stepView(step);
                  const detail =
                    view.tone === 'ok'
                      ? ok
                      : view.tone === 'danger'
                        ? step.error
                        : 'Skipped, because an earlier step did not pass.';
                  const tools = key === 'tools' ? step?.tools || [] : [];
                  return (
                    <Card tone={view.tone} title={title} key={key} data-testid={`p1setup-step-${key}`}>
                      <p className="pu-status-line">
                        <StatusChip tone={view.tone}>{view.word}</StatusChip>
                        <span className="p1setup-detail">{detail}</span>
                      </p>
                      {tools.length > 0 && (
                        <>
                          <p className="pu-label">Available tools</p>
                          <ul className="p1setup-tools" data-testid="p1setup-tools">
                            {tools.slice(0, 5).map((tool) => (
                              <li key={tool.name} className="pu-mono">{tool.name}</li>
                            ))}
                            {tools.length > 5 && <li>+ {tools.length - 5} more</li>}
                          </ul>
                        </>
                      )}
                    </Card>
                  );
                })}
              </CardGrid>

              {results.nextSteps && (
                <Card tone="neutral" title="Next steps" data-testid="p1setup-next">
                  <ol className="p1setup-next">
                    {results.nextSteps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </Card>
              )}
            </>
          )}

          {!results && !error && !loading && (
            <p className="pu-note pu-empty" data-testid="p1setup-empty">No result yet. Run the check above.</p>
          )}
        </Section>

        <Section id="p1setup-ide" kicker="3 · Optional" title="Connect an IDE to the hosted Remote MCP Server">
          <Card tone="neutral" title="Hosted admin MCP server" data-testid="p1setup-ide">
            <p className="pu-note">
              For interactive OAuth access from Claude Code, Cursor, or VS Code, separate from the worker credentials
              above, connect to PingOne&apos;s hosted admin MCP server. The address below is the .com region; the demo
              server builds its own from its configured PingOne region.
            </p>
            <code className="p1setup-url" data-testid="p1setup-url">{mcpUrl}</code>
          </Card>
        </Section>
      </PageFrame>
    </PingPage>
  );
}
