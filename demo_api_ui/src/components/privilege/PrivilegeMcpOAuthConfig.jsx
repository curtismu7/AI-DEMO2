// demo_api_ui/src/components/privilege/PrivilegeMcpOAuthConfig.jsx
//
// Illustrative OAuth config admin UI for banking-mcp (see
// docs/mocks/mcp-oauth-config-mock.html and demo_api_server/routes/mcpOAuthConfig.js).
// Auth Mode OAuth is a documented platform blocker on the live Privilege
// gateway (privilege/CURRENT-CONFIGURATION.md) — this page shows the config
// shape and reports the live Test Connection result honestly, it doesn't
// pretend that path works.
import { useCallback, useEffect, useState } from 'react';
import './PrivilegeMcpOAuthConfig.css';

const API_BASE = process.env.REACT_APP_API_BASE || '';
const CONFIG_URL = `${API_BASE}/api/mcp-oauth-config`;

const EMPTY_FORM = {
  clientId: '', clientSecret: '', issuer: '', tokenEndpoint: '', scopes: '', audience: '',
};

export default function PrivilegeMcpOAuthConfig() {
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
  }, [form]);

  const handleTest = useCallback(async () => {
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
  }, []);

  return (
    <div className="poc">
      <div className="poc__callout" role="note">
        <span aria-hidden="true">⚠️</span>
        <p>
          <strong>Auth Mode OAuth is a documented platform blocker</strong>, not a config gap —
          it was already tried against the live Privilege gateway and made discovery worse than
          Auth Mode None. See <code>privilege/CURRENT-CONFIGURATION.md</code>. This form is
          illustrative; Test Connection shows the real, currently-failing result rather than a
          simulated one.
        </p>
      </div>

      <section className="poc__panel">
        <h3>Current registration <span className="poc__badge poc__badge--live">Live &middot; Auth Mode None</span></h3>
        <dl className="poc__kv">
          <dt>Application Name</dt><dd>banking-mcp</dd>
          <dt>MCP Server URL</dt><dd>http://mcp-resource-server.ping-devops-cmuir.svc.cluster.local:8081/mcp</dd>
          <dt>AI Gateway</dt><dd>ai-demo-cmuir &mdash; https://mcpgw.ai-demo.ping-devops.com</dd>
          <dt>Mesh Cluster</dt><dd>ai-demo-cmuir</dd>
        </dl>
      </section>

      <section className="poc__panel">
        <h3>OAuth configuration <span className="poc__badge">Auth Mode OAuth</span></h3>

        <div className="poc__field">
          <label htmlFor="poc-client-id">Client ID</label>
          <input id="poc-client-id" type="text" value={form.clientId} onChange={handleChange('clientId')} />
        </div>

        <div className="poc__field">
          <label htmlFor="poc-client-secret">Client Secret</label>
          <input
            id="poc-client-secret"
            type="password"
            value={form.clientSecret}
            onChange={handleChange('clientSecret')}
            placeholder={hasClientSecret ? 'Saved — leave blank to keep it' : ''}
          />
        </div>

        <div className="poc__field-row">
          <div className="poc__field">
            <label htmlFor="poc-issuer">Authorization Server / Issuer</label>
            <input id="poc-issuer" type="text" value={form.issuer} onChange={handleChange('issuer')} />
          </div>
          <div className="poc__field">
            <label htmlFor="poc-token-endpoint">Token Endpoint</label>
            <input id="poc-token-endpoint" type="text" value={form.tokenEndpoint} onChange={handleChange('tokenEndpoint')} />
          </div>
        </div>

        <div className="poc__field-row">
          <div className="poc__field">
            <label htmlFor="poc-scopes">Scopes</label>
            <input id="poc-scopes" type="text" value={form.scopes} onChange={handleChange('scopes')} />
          </div>
          <div className="poc__field">
            <label htmlFor="poc-audience">Resource / Audience</label>
            <input id="poc-audience" type="text" value={form.audience} onChange={handleChange('audience')} />
          </div>
        </div>

        <div className="poc__actions">
          <button type="button" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          <button type="button" onClick={handleTest} disabled={testing}>{testing ? 'Testing…' : 'Test Connection'}</button>
        </div>

        {saveResult && (
          <p className={saveResult.ok ? 'poc__status poc__status--ok' : 'poc__status poc__status--error'}>
            {saveResult.msg}
          </p>
        )}

        {testResult && (
          <pre className="poc__result">
            {testResult.step ? `${testResult.step} · ` : ''}
            {testResult.status !== undefined ? `status ${testResult.status}` : ''}
            {'\n'}
            {JSON.stringify(testResult.body ?? testResult, null, 2)}
          </pre>
        )}
      </section>
    </div>
  );
}
