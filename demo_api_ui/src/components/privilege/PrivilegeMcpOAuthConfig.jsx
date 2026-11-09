// demo_api_ui/src/components/privilege/PrivilegeMcpOAuthConfig.jsx
//
// Illustrative OAuth config admin UI for banking-mcp (see
// docs/mocks/mcp-oauth-config-mock.html and demo_api_server/routes/mcpOAuthConfig.js).
// Auth Mode OAuth is a documented platform blocker on the live Privilege
// gateway (privilege/CURRENT-CONFIGURATION.md) — this page shows the config
// shape and reports the live Test Connection result honestly, it doesn't
// pretend that path works.
//
// Buttons: the page that mounts this (PrivilegeDemoPage) decides which one is the primary and passes the
// class names in (saveClassName / testClassName), the same way PrivilegeLiveCheck takes buttonClassName.
// The defaults are both secondaries, so a mount that says nothing adds no primary of its own.
import { useCallback, useEffect, useState } from 'react';
import { Card, StatusChip, KvList } from '../pingUi';
import './PrivilegeMcpOAuthConfig.css';

const API_BASE = process.env.REACT_APP_API_BASE || '';
const CONFIG_URL = `${API_BASE}/api/mcp-oauth-config`;

const EMPTY_FORM = {
  clientId: '', clientSecret: '', issuer: '', tokenEndpoint: '', scopes: '', audience: '',
};

export default function PrivilegeMcpOAuthConfig({ saveClassName = 'pu-btn', testClassName = 'pu-btn' }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [hasClientSecret, setHasClientSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    fetch(CONFIG_URL, { credentials: 'include' })
      .then((res) => res.json())
      .then((config) => {
        setForm((prev) => ({ ...prev, ...config, clientSecret: '' }));
        setHasClientSecret(!!config.hasClientSecret);
      })
      .catch(() => {});
  }, []);

  const handleChange = useCallback((field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }, []);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch(CONFIG_URL, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const saved = await res.json();
      if (!res.ok) throw new Error(saved.error || `HTTP ${res.status}`);
      setHasClientSecret(!!saved.hasClientSecret);
      setForm((prev) => ({ ...prev, clientSecret: '' }));
      setSaveResult({ ok: true, msg: 'Saved' });
    } catch (e) {
      setSaveResult({ ok: false, msg: e.message });
    } finally {
      setSaving(false);
    }
  }, [form, saving]);

  const handleTest = useCallback(async () => {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${CONFIG_URL}/test`, { method: 'POST', credentials: 'include' });
      const result = await res.json();
      setTestResult(result);
    } catch (e) {
      setTestResult({ error: e.message });
    } finally {
      setTesting(false);
    }
  }, [testing]);

  const testChip = testResult && testChipFor(testResult);

  return (
    <div className="poc">
      <Card tone="warn" data-testid="poc-blocker" role="note">
        <p className="pu-status-line">
          <StatusChip tone="warn">Known blocker</StatusChip>
          <strong>Auth Mode OAuth is a documented platform blocker</strong>, not a config gap.
        </p>
        <p className="pu-note">
          It was already tried against the live Privilege gateway and made discovery worse than
          Auth Mode None. See <code>privilege/CURRENT-CONFIGURATION.md</code>. This form is
          illustrative; Test Connection shows the real, currently-failing result rather than a
          simulated one.
        </p>
      </Card>

      <Card title="Current registration" tone="neutral" data-testid="poc-registration">
        <p className="pu-status-line">
          <StatusChip tone="neutral">Auth Mode None</StatusChip>
          Written here from <code>privilege/CURRENT-CONFIGURATION.md</code>, not read from the gateway.
        </p>
        <KvList
          items={[
            { label: 'Application Name', value: 'banking-mcp' },
            { label: 'MCP Server URL', value: 'http://mcp-resource-server.ping-devops-cmuir.svc.cluster.local:8081/mcp', mono: true },
            { label: 'Agent Privilege', value: 'ai-demo-cmuir \u2014 https://mcpgw.ai-demo.ping-devops.com' },
            { label: 'Mesh Cluster', value: 'ai-demo-cmuir' },
          ]}
        />
      </Card>

      <Card title="OAuth configuration" data-testid="poc-form">
        <p className="pu-status-line">
          <StatusChip tone="info">Illustrative</StatusChip>
          Auth Mode OAuth. Save stores these values on this machine&apos;s BFF; the secret is never shown again.
        </p>

        <div className="poc__field">
          <label className="pu-label" htmlFor="poc-client-id">Client ID</label>
          <input id="poc-client-id" className="poc__input" type="text" value={form.clientId} onChange={handleChange('clientId')} />
        </div>

        <div className="poc__field">
          <label className="pu-label" htmlFor="poc-client-secret">Client Secret</label>
          <input
            id="poc-client-secret"
            className="poc__input"
            type="password"
            value={form.clientSecret}
            onChange={handleChange('clientSecret')}
            placeholder={hasClientSecret ? 'Saved — leave blank to keep it' : ''}
          />
        </div>

        <div className="poc__field-row">
          <div className="poc__field">
            <label className="pu-label" htmlFor="poc-issuer">Authorization Server / Issuer</label>
            <input id="poc-issuer" className="poc__input" type="text" value={form.issuer} onChange={handleChange('issuer')} />
          </div>
          <div className="poc__field">
            <label className="pu-label" htmlFor="poc-token-endpoint">Token Endpoint</label>
            <input id="poc-token-endpoint" className="poc__input" type="text" value={form.tokenEndpoint} onChange={handleChange('tokenEndpoint')} />
          </div>
        </div>

        <div className="poc__field-row">
          <div className="poc__field">
            <label className="pu-label" htmlFor="poc-scopes">Scopes</label>
            <input id="poc-scopes" className="poc__input" type="text" value={form.scopes} onChange={handleChange('scopes')} />
          </div>
          <div className="poc__field">
            <label className="pu-label" htmlFor="poc-audience">Resource / Audience</label>
            <input id="poc-audience" className="poc__input" type="text" value={form.audience} onChange={handleChange('audience')} />
          </div>
        </div>

        <div className="pu-actions">
          <button type="button" className={saveClassName} onClick={handleSave} aria-disabled={saving ? 'true' : undefined}>{saving ? 'Saving…' : 'Save'}</button>
          <button type="button" className={testClassName} onClick={handleTest} aria-disabled={testing ? 'true' : undefined}>{testing ? 'Testing…' : 'Test Connection'}</button>
        </div>

        {saveResult && (
          <p className="pu-status-line poc__result-line" role="status">
            <StatusChip tone={saveResult.ok ? 'ok' : 'danger'}>{saveResult.ok ? 'Saved' : 'Not saved'}</StatusChip>
            {saveResult.ok ? 'Stored on this machine.' : saveResult.msg}
          </p>
        )}

        {testResult && (
          <div data-testid="poc-test-result">
            <p className="pu-status-line poc__result-line" role="status">
              <StatusChip tone={testChip.tone}>{testChip.word}</StatusChip>
              {testChip.note}
            </p>
            <pre className="poc__result">
              {testResultText(testResult)}
            </pre>
          </div>
        )}
      </Card>
    </div>
  );
}

// "<step> · status <n>" on a first line when the server reported one, then the body as it came back.
function testResultText(result) {
  const head = [
    result.step ? `${result.step} · ` : '',
    result.status !== undefined ? `status ${result.status}` : '',
  ].join('');
  const body = JSON.stringify(result.body ?? result, null, 2);
  return head ? `${head}\n${body}` : body;
}

// The chip carries a word, never the number (the status is in the result block below it). A 2xx from the
// gateway is the only success; anything else, or a call that never ran, is said plainly.
function testChipFor(result) {
  if (result.status === undefined) {
    return { tone: 'warn', word: 'Not completed', note: 'The test did not run to the end. Real response below.' };
  }
  if (result.status >= 200 && result.status < 300) {
    return { tone: 'ok', word: 'Accepted', note: `The ${result.step} step succeeded. Real response below.` };
  }
  return { tone: 'danger', word: 'Refused', note: `The ${result.step} step was refused. Real response below.` };
}
