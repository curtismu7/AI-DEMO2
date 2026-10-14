import { useEffect, useState } from 'react';
import apiClient from '../../services/apiClient';
import InlineSpinner from '../shared/InlineSpinner';

const BASE = '/api/privilege-user-api-keys';
const READ_CONFIG = { _skipTrafficCapture: true };
const WRITE_CONFIG = { ...READ_CONFIG, headers: { 'x-privilege-user-api-csrf': '1' } };
const RUN_CONFIG = { ...WRITE_CONFIG, timeout: 25000 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGES = [
  ['encryption', 'Encryption'], ['token-request', 'Token request'],
  ['decryption', 'Decryption'], ['users-list', 'Users list'],
];
// Select fixed text by the server's code; never render exception diagnostics.
const ERRORS = {
  PRIVILEGE_USER_API_CREDENTIALS_REQUIRED: 'Provide an API key or API secret.',
  VAULT_PASSWORD_REQUIRED: 'The current vault password is required.',
  VAULT_AUTH_FAILED: 'Unable to unlock the vault.',
  VAULT_NOT_FOUND: 'The configured vault is unavailable.',
  VAULT_OPEN_FAILED: 'Unable to open the vault.',
  VAULT_SAVE_FAILED: 'Unable to save credentials to the vault.',
  VAULT_CACHE_REFRESH_FAILED: 'Credentials were saved, but the configuration cache could not be refreshed.',
  CREDENTIALS_REQUIRED: 'Privilege user API key and secret are required.',
  ENCRYPTION_FAILED: 'Token request encryption failed.',
  DECRYPTION_FAILED: 'Token response decryption failed.',
  NONCE_MISMATCH: 'Token response nonce did not match.',
  INVALID_TOKEN_RESPONSE: 'Privilege returned an invalid token response.',
  INVALID_UPSTREAM_JSON: 'Privilege returned invalid JSON.',
  UPSTREAM_TIMEOUT: 'Privilege request timed out.',
  UPSTREAM_NETWORK_ERROR: 'Privilege network or TLS request failed.',
  UPSTREAM_HTTP_ERROR: 'Privilege request returned an unsuccessful HTTP status.',
};
const safeHttp = value => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
const preview = value => typeof value === 'string' && /^.{0,4}(?:\*{4,}|•{4,}).{0,4}$/.test(value) ? value : 'Configured (masked)';
function errorMessage(data) {
  if (data?.code === 'UPSTREAM_HTTP_ERROR' && data?.httpStatus === 401
    && data?.stages?.some(item => item.stage === 'users-list' && item.status === 'error')) {
    return 'Privilege rejected the JWT; expiry is one possible cause. Verify the key, owning user, environment, and permissions, then run again.';
  }
  return ERRORS[data?.code] || 'Privilege user API request failed.';
}

const COMMANDS = [
  'go run main.go encrypt',
  `curl --request POST '<CONTROLLER_URL>/pubapi/<ENVIRONMENT_ID>/v1/appusertoken' \\
  --header 'Content-Type: application/json' \\
  --header 'x-procyon-session-id: <SESSION_UUID>' \\
  --data '{"ObjectMeta":{"Tenant":"<ENVIRONMENT_ID>","Namespace":"default","Name":"<USER_ID>"},"GuestMetaReq":{"APIKey":"<API_KEY>","Tenant":"<ENVIRONMENT_ID>","Namespace":"default","EncReqData":"<ENC_REQ_DATA>"}}'`,
  'go run main.go decrypt "<ENC_RES_DATA>"',
  `curl --request GET '<CONTROLLER_URL>/api/<ENVIRONMENT_ID>/v1/users' \\
  --header 'Authorization: Bearer <JWT>' \\
  --header 'x-procyon-session-id: <FRESH_SESSION_UUID>'`,
];

export default function PrivilegeUserApiKeysPanel() {
  const [vault, setVault] = useState(null);
  const [loading, setLoading] = useState(true);
  const [environmentId, setEnvironmentId] = useState('');
  const [userId, setUserId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    let active = true;
    apiClient.get(`${BASE}/status`, READ_CONFIG)
      .then(({ data }) => { if (active) setVault(data); })
      .catch(() => { if (active) setError('Unable to load vault status.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function saveCredentials(event) {
    event.preventDefault();
    setError(''); setNotice(''); setResult(null);
    setSaving(true);
    try {
      if (!apiKey.trim() && !apiSecret.trim()) {
        setError(ERRORS.PRIVILEGE_USER_API_CREDENTIALS_REQUIRED); return;
      }
      if (!password.trim()) { setError(ERRORS.VAULT_PASSWORD_REQUIRED); return; }
      const body = { current_password: password };
      if (apiKey.trim()) body.api_key = apiKey;
      if (apiSecret.trim()) body.api_secret = apiSecret;
      const { data } = await apiClient.post(`${BASE}/credentials`, body, WRITE_CONFIG);
      setVault(data); setNotice('Credentials saved to vault.');
    } catch (failure) {
      setError(errorMessage(failure.response?.data));
    } finally {
      setApiKey(''); setApiSecret(''); setPassword(''); setSaving(false);
    }
  }

  async function runFlow(event) {
    event.preventDefault();
    setError(''); setNotice(''); setResult(null);
    if (!UUID.test(environmentId)) { setError('Environment ID must be a UUID'); return; }
    if (!UUID.test(userId)) { setError('User ID must be a UUID'); return; }
    setRunning(true);
    try {
      const { data } = await apiClient.post(`${BASE}/run`, { environment_id: environmentId, user_id: userId }, RUN_CONFIG);
      // Keep only the sanitized route response here, never in the page trace.
      setResult(data);
      if (!data.ok) setError(errorMessage(data));
    } catch (failure) {
      setError(errorMessage(failure.response?.data));
    } finally { setRunning(false); }
  }

  const ready = vault?.apiKeySet && vault?.apiSecretSet;
  return (
    <section className="cur-user-api" aria-label="User API Key & Secrets">
      <header>
        <h3>User API Key &amp; Secrets</h3>
        <p>Generate a user token and list Privilege users with credentials saved in your vault.</p>
      </header>
      {error && <p className="cur-user-api__error" role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <section aria-label="Vault credentials" className="cur-user-api__section">
        <h4>Vault credentials</h4>
        {loading ? <p><InlineSpinner label="Loading vault status…" /></p> : vault && (
          <dl className="cur-user-api__vault">
            <div><dt>API key</dt><dd>{vault.apiKeySet ? preview(vault.apiKeyPreview) : 'Missing: PRIVILEGE_USER_API_KEY'}</dd></div>
            <div><dt>API secret</dt><dd>{vault.apiSecretSet ? preview(vault.apiSecretPreview) : 'Missing: PRIVILEGE_USER_API_SECRET'}</dd></div>
          </dl>
        )}
        {!vault?.canManage && vault && <p>Only administrators can change these credentials or run this flow.</p>}
        {vault?.canManage && <p>Leave either credential blank to keep its saved value. Enter the current vault password for each save.</p>}
        {vault?.canManage && <form onSubmit={saveCredentials} autoComplete="off">
          <div className="cur-user-api__fields">
            <label className="cur-field"><span className="cur-field-label">API key</span>
              <input className="cur-input" type="password" autoComplete="new-password" value={apiKey} onChange={event => setApiKey(event.target.value)} disabled={saving || running} />
            </label>
            <label className="cur-field"><span className="cur-field-label">API secret</span>
              <input className="cur-input" type="password" autoComplete="new-password" value={apiSecret} onChange={event => setApiSecret(event.target.value)} disabled={saving || running} />
            </label>
            <label className="cur-field"><span className="cur-field-label">Current vault password</span>
              <input className="cur-input" type="password" autoComplete="off" value={password} onChange={event => setPassword(event.target.value)} disabled={saving || running} />
            </label>
          </div>
          <button className="cur-btn" type="submit" disabled={saving || running}>{saving ? 'Saving…' : 'Save to Vault'}</button>
        </form>}
      </section>
      {vault?.canManage && <form onSubmit={runFlow} className="cur-user-api__section">
        <h4>Token and users request</h4>
        <div className="cur-user-api__fields">
          <label className="cur-field"><span className="cur-field-label">Environment ID</span>
            <input className="cur-input" value={environmentId} onChange={event => setEnvironmentId(event.target.value)} disabled={running} spellCheck="false" />
          </label>
          <label className="cur-field"><span className="cur-field-label">User ID</span>
            <input className="cur-input" value={userId} onChange={event => setUserId(event.target.value)} disabled={running} spellCheck="false" />
          </label>
        </div>
        <p>Use the UUID of the Privilege user who owns the API key. Namespace: default. Token TTL: 3600 seconds.</p>
        <button className="cur-btn cur-btn--primary" type="submit" disabled={!ready || running || saving}>{running ? 'Running…' : 'Run token and list users'}</button>
      </form>}
      <section className="cur-user-api__section" aria-label="Command sequence">
        <h4>Four command stages</h4>
        <p>Placeholders mask credentials, encrypted data, and tokens.</p>
        <ol className="cur-user-api__commands" aria-label="PDF commands">
          {COMMANDS.map((command, index) => <li key={command}><strong>{STAGES[index][1]}</strong><pre>{command}</pre></li>)}
        </ol>
        <ol className="cur-user-api__progress" aria-label="Token flow progress" aria-live="polite" aria-busy={running}>
          {STAGES.map(([key, label]) => {
            const stage = result?.stages?.find(item => item.stage === key);
            const status = stage?.status === 'success' ? 'Complete' : stage?.status === 'error' ? 'Failed' : running ? 'Awaiting server result' : 'Not run';
            return <li key={key}>{label}: {status}{safeHttp(stage?.httpStatus) && ` · HTTP ${stage.httpStatus}`}</li>;
          })}
        </ol>
        {safeHttp(result?.httpStatus) && <p>Privilege HTTP status: {result.httpStatus}</p>}
        {result?.ok && result.jwtPreview && <p>JWT preview: {preview(result.jwtPreview)}</p>}
      </section>
      {result?.ok && Object.hasOwn(result, 'users') && (
        <section aria-label="Users response" className="cur-user-api__section">
          <h4>Users response</h4>
          <pre className="cur-user-api__users">{JSON.stringify(result.users, null, 2)}</pre>
        </section>
      )}
    </section>
  );
}
