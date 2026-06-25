import React, { useState, useEffect } from 'react';

const WORKER_FIELDS = [
  { key: 'pingone_environment_id',    label: 'Environment ID',             secret: false, placeholder: 'PingOne Environment UUID' },
  { key: 'pingone_mgmt_client_id',    label: 'Management Worker Client ID', secret: false, placeholder: 'client_id with Management API access' },
  { key: 'pingone_mgmt_client_secret', label: 'Management Worker Secret',  secret: true,  placeholder: '••••••••••••' },
];

const inputStyle = {
  width: '100%', maxWidth: 480, padding: '8px 12px',
  border: '1px solid #d1d5db', borderRadius: 6,
  fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box',
};

export default function WorkerAppConfigTab() {
  const [values, setValues]   = useState({
    pingone_environment_id: '', pingone_mgmt_client_id: '',
    pingone_mgmt_client_secret: '', pingone_mgmt_token_auth_method: 'basic',
    pingone_mgmt_private_key: '',
  });
  const [saving, setSaving]   = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [readOnly, setReadOnly] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedPublicKey, setGeneratedPublicKey] = useState(null); // { publicKeyPem, jwk }

  useEffect(() => {
    fetch('/api/admin/config')
      .then(r => r.json())
      .then(data => {
        const cfg = data.config || {};
        if (data.readOnly) setReadOnly(true);
        setValues(v => ({
          ...v,
          pingone_environment_id:    cfg.pingone_environment_id || '',
          pingone_mgmt_client_id:    cfg.pingone_mgmt_client_id || '',
          pingone_mgmt_client_secret: '',
          pingone_mgmt_token_auth_method: cfg.pingone_mgmt_token_auth_method || 'basic',
          pingone_mgmt_private_key: '', // masked server-side
        }));
      })
      .catch(() => {});
  }, []);

  const handleChange = (key, val) => setValues(v => ({ ...v, [key]: val }));

  const handleSave = async () => {
    setSaving(true); setSaveMsg('');
    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      setSaveMsg(data.ok ? '✓ Saved' : `Error: ${data.message || 'save failed'}`);
    } catch (err) {
      setSaveMsg(`Error: ${err.message}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(''), 3000);
    }
  };

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch('/api/admin/config/worker-test');
      setTestResult(await res.json());
    } catch (err) {
      setTestResult({ ok: false, error: err.message });
    } finally {
      setTesting(false);
    }
  };

  const handleGenerateKeypair = async () => {
    setGenerating(true); setGeneratedPublicKey(null);
    try {
      const res = await fetch('/api/admin/config/generate-keypair', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setGeneratedPublicKey(data);
        // Private key is now saved server-side — reflect it locally
        setValues(v => ({ ...v, pingone_mgmt_private_key: '(generated — stored server-side)' }));
      } else {
        alert(`Key generation failed: ${data.error || 'unknown error'}`);
      }
    } catch (err) {
      alert(`Key generation failed: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const authMethod = values.pingone_mgmt_token_auth_method;
  const showPrivateKeyField = authMethod === 'private_key_jwt';

  return (
    <div style={{ padding: '24px 0' }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--brand-navy)', marginBottom: 4 }}>
        PingOne Management API — Worker App
      </h3>
      <p style={{ color: '#374151', fontSize: 13, marginBottom: readOnly ? 8 : 20 }}>
        Credentials for the PingOne worker app used for user provisioning, CIMD registration, and bootstrap operations.
      </p>
      {readOnly && (
        <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 6, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: '#92400e' }}>
          ⚠️ <strong>Session-only</strong> — this deployment does not have persistent KV storage.
          Changes will be lost when the server restarts. Set{' '}
          <code>PINGONE_MGMT_CLIENT_ID</code>, <code>PINGONE_MGMT_CLIENT_SECRET</code>,
          and <code>PINGONE_MGMT_TOKEN_AUTH_METHOD</code> as Vercel environment variables for permanent configuration.
        </div>
      )}

      {WORKER_FIELDS.map(({ key, label, secret, placeholder }) => (
        <div key={key} style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
            {label}
          </label>
          <input
            type={secret ? 'password' : 'text'}
            value={values[key]}
            onChange={e => handleChange(key, e.target.value)}
            placeholder={placeholder}
            aria-label={label}
            style={inputStyle}
          />
        </div>
      ))}

      {/* Token Endpoint Auth Method */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
          Token Endpoint Auth Method
        </label>
        <select
          value={authMethod}
          onChange={e => handleChange('pingone_mgmt_token_auth_method', e.target.value)}
          aria-label="Token Endpoint Auth Method"
          style={{ ...inputStyle, fontFamily: 'inherit', background: '#fff' }}
        >
          <option value="none">none (public client — no credentials)</option>
          <option value="basic">client_secret_basic (Authorization header)</option>
          <option value="post">client_secret_post (request body)</option>
          <option value="client_secret_jwt">client_secret_jwt (signed JWT, HS256)</option>
          <option value="private_key_jwt">private_key_jwt (signed JWT, RS256/ES256)</option>
        </select>
        <p style={{ fontSize: 12, color: '#374151', marginTop: 4 }}>
          Match the Token Endpoint Authentication setting in your PingOne worker app.
        </p>
      </div>

      {/* Private key field — only for private_key_jwt */}
      {showPrivateKeyField && (
        <div style={{ marginBottom: 16, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '14px 16px' }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
            Private Key (PEM)
          </label>
          <textarea
            value={values.pingone_mgmt_private_key}
            onChange={e => handleChange('pingone_mgmt_private_key', e.target.value)}
            placeholder={'-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'}
            aria-label="Private Key PEM"
            rows={6}
            style={{ ...inputStyle, maxWidth: 480, fontFamily: 'inherit', fontSize: 11, resize: 'vertical', lineHeight: 1.5 }}
          />
          <p style={{ fontSize: 12, color: '#374151', marginTop: 6, marginBottom: 10 }}>
            Paste an RSA 2048 or EC P-256 private key in PKCS#8 PEM format, or generate a new one below.
            The public key / JWK must be registered in PingOne (App → Keys tab).
          </p>
          <button
            type="button"
            onClick={handleGenerateKeypair}
            disabled={generating}
            style={{
              padding: '7px 16px', background: '#0f172a', color: '#fff',
              border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600,
              cursor: generating ? 'not-allowed' : 'pointer', opacity: generating ? 0.7 : 1,
            }}
          >
            {generating ? 'Generating…' : '⚙ Generate Key Pair'}
          </button>

          {generatedPublicKey && (
            <div style={{ marginTop: 14, background: '#fff', border: '1px solid #bfdbfe', borderRadius: 6, padding: '12px 14px' }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand-navy)', marginBottom: 8 }}>
                ✓ Key pair generated — private key saved to config.
              </p>
              <p style={{ fontSize: 12, color: '#374151', marginBottom: 6 }}>
                Register the public key in PingOne:<br />
                Application → Keys tab → Add Key → paste this JWK or PEM.
              </p>
              <div style={{ marginBottom: 10 }}>
                <strong style={{ fontSize: 11, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>JWK (paste into PingOne)</strong>
                <pre style={{ fontSize: 11, background: '#f1f5f9', borderRadius: 4, padding: '8px 10px', overflowX: 'auto', marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {JSON.stringify(generatedPublicKey.jwk, null, 2)}
                </pre>
              </div>
              <div>
                <strong style={{ fontSize: 11, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Public Key PEM (alternative)</strong>
                <pre style={{ fontSize: 11, background: '#f1f5f9', borderRadius: 4, padding: '8px 10px', overflowX: 'auto', marginTop: 4, whiteSpace: 'pre-wrap' }}>
                  {generatedPublicKey.publicKeyPem}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 20 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '8px 20px', background: 'var(--brand-navy)', color: '#fff',
            border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={handleTest}
          disabled={testing}
          style={{
            padding: '8px 20px', background: '#f3f4f6', color: '#374151',
            border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontWeight: 600,
            cursor: testing ? 'not-allowed' : 'pointer', opacity: testing ? 0.7 : 1,
          }}
        >
          {testing ? 'Testing…' : 'Test Connection'}
        </button>
        {saveMsg && (
          <span style={{ fontSize: 13, color: saveMsg.startsWith('✓') ? '#16a34a' : '#dc2626' }}>
            {saveMsg}
          </span>
        )}
      </div>

      {testResult && (
        <div style={{
          marginTop: 16, padding: '12px 16px', borderRadius: 8,
          background: testResult.ok ? '#f0fdf4' : '#fef2f2',
          border: `1px solid ${testResult.ok ? '#86efac' : '#fca5a5'}`,
          color: testResult.ok ? '#166534' : '#991b1b', fontSize: 13,
        }}>
          {testResult.ok
            ? `✓ Connected — Environment: ${testResult.environmentId} · App: ${testResult.appName} (${testResult.applicationCount} apps found)`
            : `✗ Connection failed: ${testResult.error || 'Unknown error'}${testResult.hint ? ` — ${testResult.hint}` : ''}`
          }
        </div>
      )}
    </div>
  );
}
