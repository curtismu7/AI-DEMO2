/**
 * ClientRegistrationPage.js
 *
 * Admin-only page that presents a CIMD-style client metadata form,
 * calls POST /api/clients/register on the backend, and displays
 * the resulting PingOne credentials plus the hosted CIMD document URL.
 *
 * Ping UI Standard (src/styles/ping-ui.css): banner first, cards, kv list, word-bearing chips, one primary per view.
 * Primary button per state: form = "Register Client" (the only action that changes anything);
 * result = none on purpose: Copy and "Register another client" are secondaries, because the second one discards
 * the one-time secret on screen and must not read as the next step.
 */
import React, { useState, useCallback, useRef, useEffect, useId, cloneElement } from 'react';
import apiClient from '../services/apiClient';
import { notifySuccess, notifyError } from '../utils/appToast';
import { useEducationUI } from '../context/EducationUIContext';
import { EDU } from './education/educationIds';
import AdminSubPageShell from './AdminSubPageShell';
import PageNav from './PageNav';
import { PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList } from './pingUi';
import './ClientRegistrationPage.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseLines(str) {
  return str.split('\n').map(s => s.trim()).filter(Boolean);
}

// ── Field components ──────────────────────────────────────────────────────────
// Every control carries an id from its Field, so the label names it and the hint describes it.

function Field({ label, required, hint, group, children }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const labelText = (
    <>
      {label}
      {required ? <span className="crp-req" aria-hidden="true"> *</span> : null}
    </>
  );
  return (
    <div className="crp-field">
      {group ? (
        <div role="group" aria-labelledby={`${id}-label`} aria-describedby={hintId}>
          <span id={`${id}-label`} className="pu-label crp-field-label">{labelText}</span>
          {children}
        </div>
      ) : (
        <>
          <label htmlFor={id} className="pu-label crp-field-label">{labelText}</label>
          {cloneElement(children, { id, 'aria-describedby': hintId, 'aria-required': required ? 'true' : undefined })}
        </>
      )}
      {hint && <p id={hintId} className="crp-field-hint">{hint}</p>}
    </div>
  );
}

// While a registration is in flight the fields are locked, not disabled: a disabled control drops keyboard focus.
function Input({ value, onChange, placeholder, locked, ...rest }) {
  return (
    <input
      type="text"
      className="crp-input"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      readOnly={locked}
      {...rest}
    />
  );
}

function Textarea({ value, onChange, placeholder, locked, rows = 3, ...rest }) {
  return (
    <textarea
      className="crp-textarea"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      readOnly={locked}
      rows={rows}
      {...rest}
    />
  );
}

function Select({ value, onChange, options, locked, ...rest }) {
  return (
    <select
      className="pu-select"
      value={value}
      onChange={e => { if (!locked) onChange(e.target.value); }}
      aria-disabled={locked ? 'true' : undefined}
      {...rest}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function CheckboxGroup({ options, selected, onChange, locked }) {
  const toggle = (val) => {
    if (locked) return;
    onChange(selected.includes(val) ? selected.filter(v => v !== val) : [...selected, val]);
  };
  return (
    <div className="crp-checkbox-group">
      {options.map(o => (
        <label key={o} className="crp-checkbox-label">
          <input
            type="checkbox"
            checked={selected.includes(o)}
            onChange={() => toggle(o)}
            aria-disabled={locked ? 'true' : undefined}
          />
          <code className="crp-checkbox-code">{o}</code>
        </label>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const GRANT_TYPE_OPTIONS = [
  'authorization_code',
  'client_credentials',
  'refresh_token',
  'implicit',
];

const APP_TYPE_OPTIONS = [
  { value: 'web',     label: 'Web application' },
  { value: 'native',  label: 'Native / mobile app' },
  { value: 'service', label: 'Service / worker (machine-to-machine)' },
];

const TOKEN_AUTH_OPTIONS = [
  { value: 'client_secret_basic', label: 'client_secret_basic (Authorization header)' },
  { value: 'client_secret_post',  label: 'client_secret_post (request body)' },
  { value: 'none',                label: 'none (public client / PKCE only)' },
];

export default function ClientRegistrationPage({ user, onLogout }) {
  const { openPanel } = useEducationUI();

  // Form fields
  const [clientName,         setClientName]         = useState('');
  const [clientDescription,  setClientDescription]  = useState('');
  const [applicationType,    setApplicationType]    = useState('web');
  const [grantTypes,         setGrantTypes]         = useState(['authorization_code']);
  const [redirectUris,       setRedirectUris]       = useState('');
  const [postLogoutUris,     setPostLogoutUris]     = useState('');
  const [tokenAuthMethod,    setTokenAuthMethod]    = useState('client_secret_basic');
  const [scope,              setScope]              = useState('openid profile email');
  const [contacts,           setContacts]           = useState('');
  const [logoUri,            setLogoUri]            = useState('');
  const [clientUri,          setClientUri]          = useState('');

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [result,     setResult]     = useState(null);
  const [error,      setError]      = useState(null);
  const nameRef = useRef(null);
  const resetFocusRef = useRef(false);

  const canSubmit = Boolean(clientName.trim()) && !submitting;

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    // aria-disabled keeps the button focusable, so the guard lives here instead of `disabled`.
    if (submitting || !clientName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        client_name:                clientName.trim(),
        client_description:         clientDescription.trim(),
        application_type:           applicationType,
        grant_types:                grantTypes,
        response_types:             grantTypes.includes('implicit') ? ['token', 'id_token'] : ['code'],
        redirect_uris:              parseLines(redirectUris),
        post_logout_redirect_uris:  parseLines(postLogoutUris),
        token_endpoint_auth_method: tokenAuthMethod,
        scope,
        contacts:                   parseLines(contacts),
        ...(logoUri.trim()   && { logo_uri:   logoUri.trim() }),
        ...(clientUri.trim() && { client_uri: clientUri.trim() }),
      };
      const resp = await apiClient.post('/api/clients/register', payload);
      setResult(resp.data);
      notifySuccess('Client registered successfully in PingOne!');
    } catch (err) {
      const msg = err.response?.data?.detail || err.response?.data?.error || err.message;
      setError(`Registration failed: ${msg}`);
      notifyError(`Registration failed: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }, [submitting, clientName, clientDescription, applicationType, grantTypes, redirectUris,
      postLogoutUris, tokenAuthMethod, scope, contacts, logoUri, clientUri]);

  const handleReset = useCallback(() => {
    resetFocusRef.current = true;
    setResult(null);
    setError(null);
    setClientName('');
    setClientDescription('');
    setApplicationType('web');
    setGrantTypes(['authorization_code']);
    setRedirectUris('');
    setPostLogoutUris('');
    setTokenAuthMethod('client_secret_basic');
    setScope('openid profile email');
    setContacts('');
    setLogoUri('');
    setClientUri('');
  }, []);

  // The reset button unmounts with the result: put focus on the first field of the fresh form.
  useEffect(() => {
    if (!result && resetFocusRef.current) {
      resetFocusRef.current = false;
      nameRef.current?.focus();
    }
  }, [result]);

  return (
    <PingPage className="crp-page" data-testid="client-registration-page">
      <SimBanner data-testid="crp-banner">
        <strong>Live, not simulated.</strong> Register Client calls the PingOne Management API and creates a real
        application in the connected PingOne environment (admin only), then hosts its CIMD document from this app.
        Each registration creates another application; nothing here is mocked and there is no dry run.
      </SimBanner>
      <AdminSubPageShell
        title="CIMD Simulation"
        lead={(
          <>
            Fill in client metadata using the <strong>Client ID Metadata Document (CIMD)</strong> format.
            The backend creates the application in PingOne and hosts the CIMD document for you.
          </>
        )}
        wide={false}
      >
        <PageNav user={user} onLogout={onLogout} title="CIMD Simulation" />
        <div className="app-page-toolbar app-page-toolbar--start">
          <button
            type="button"
            className="app-page-toolbar-btn"
            onClick={() => openPanel(EDU.CIMD, 'what')}
          >
            Learn: CIMD
          </button>
        </div>

        <PageFrame>
          <Card tone="neutral" title="How this works" data-testid="crp-how">
            <p className="pu-note crp-how-text">
              You define the metadata below (CIMD format). The server calls the PingOne Management API to create
              the OAuth application, then hosts the CIMD document at <code>/.well-known/oauth-client/&#123;app-id&#125;</code>.
              That URL becomes the <code>client_id</code> for any CIMD-aware AS.
            </p>
          </Card>

          {/* Result or Form */}
          {result ? (
            <ResultCard result={result} onReset={handleReset} />
          ) : (
            <form onSubmit={handleSubmit} aria-busy={submitting ? 'true' : undefined} noValidate>
              <Section id="crp-describe" kicker="1 · Describe" title="Describe the client">
                <CardGrid>
                  <Card title="Client identity">
                    <Field label="Client Name" required hint="Human-readable name shown on consent screens.">
                      <Input ref={nameRef} value={clientName} onChange={setClientName} placeholder="My Integration" locked={submitting} />
                    </Field>
                    <Field label="Description" hint="Optional description stored in PingOne.">
                      <Input value={clientDescription} onChange={setClientDescription} placeholder="Brief description of this OAuth client" locked={submitting} />
                    </Field>
                    <Field label="Application Type" hint="web = server-side web app, native = mobile/desktop, service = M2M worker.">
                      <Select value={applicationType} onChange={setApplicationType} options={APP_TYPE_OPTIONS} locked={submitting} />
                    </Field>
                    <Field label="Client URI" hint="Optional URL to the application's home page.">
                      <Input value={clientUri} onChange={setClientUri} placeholder="https://app.example.com" locked={submitting} />
                    </Field>
                    <Field label="Logo URI" hint="Optional HTTPS URL to a square logo image.">
                      <Input value={logoUri} onChange={setLogoUri} placeholder="https://app.example.com/logo.png" locked={submitting} />
                    </Field>
                  </Card>

                  <Card title="OAuth flow">
                    <Field label="Grant Types" required group hint="Select all flows this client will use.">
                      <CheckboxGroup options={GRANT_TYPE_OPTIONS} selected={grantTypes} onChange={setGrantTypes} locked={submitting} />
                    </Field>
                    <Field label="Token Endpoint Auth Method">
                      <Select value={tokenAuthMethod} onChange={setTokenAuthMethod} options={TOKEN_AUTH_OPTIONS} locked={submitting} />
                    </Field>
                    <Field label="Scopes" hint="Space-separated list of requested scopes.">
                      <Input value={scope} onChange={setScope} placeholder="openid profile email" locked={submitting} />
                    </Field>
                  </Card>
                </CardGrid>
              </Section>

              <Section id="crp-redirects" kicker="2 · Where it signs in" title="Redirects and contact">
                <CardGrid>
                  <Card title="Redirect URIs">
                    <Field label="Redirect URIs" hint="One URI per line. Must be HTTPS (localhost allowed for dev).">
                      <Textarea
                        value={redirectUris}
                        onChange={setRedirectUris}
                        placeholder={`https://app.example.com/callback\nhttps://app.example.com/auth`}
                        locked={submitting}
                        rows={3}
                      />
                    </Field>
                    <Field label="Post-Logout Redirect URIs" hint="One URI per line.">
                      <Textarea
                        value={postLogoutUris}
                        onChange={setPostLogoutUris}
                        placeholder="https://app.example.com/loggedout"
                        locked={submitting}
                        rows={2}
                      />
                    </Field>
                  </Card>

                  <Card title="Contact (optional)">
                    <Field label="Contact Emails" hint="One email per line. Included in the CIMD document.">
                      <Textarea
                        value={contacts}
                        onChange={setContacts}
                        placeholder="dev@example.com"
                        locked={submitting}
                        rows={2}
                      />
                    </Field>
                  </Card>
                </CardGrid>
              </Section>

              <Section id="crp-register" kicker="3 · Register" title="Register the client">
                <Card tone="neutral" className="crp-submit-box" data-testid="crp-submit-box">
                  <p className="pu-note crp-submit-hint">
                    Submitting will call the PingOne Management API to create this application
                    and host the CIMD document at <code>/.well-known/oauth-client/&#123;id&#125;</code>.
                  </p>
                  <p className="pu-status-line" role="status" data-testid="crp-status">
                    {submitting ? (
                      <><StatusChip tone="info">Registering</StatusChip><span>Calling PingOne…</span></>
                    ) : error ? null : (
                      <><StatusChip tone="neutral">Not registered</StatusChip><span>Nothing has been sent to PingOne yet.</span></>
                    )}
                  </p>
                  {error && (
                    <p className="pu-status-line crp-error" role="alert" data-testid="crp-error">
                      <StatusChip tone="danger">Failed</StatusChip><span>{error}</span>
                    </p>
                  )}
                  <div className="pu-actions">
                    <button
                      type="submit"
                      aria-disabled={canSubmit ? undefined : 'true'}
                      aria-describedby={clientName.trim() ? undefined : 'crp-submit-reason'}
                      className="pu-btn pu-btn--primary"
                    >
                      {submitting ? 'Registering in PingOne…' : 'Register Client'}
                    </button>
                  </div>
                  {!clientName.trim() && (
                    <p id="crp-submit-reason" className="pu-note">Enter a client name to register.</p>
                  )}
                </Card>
              </Section>
            </form>
          )}
        </PageFrame>
      </AdminSubPageShell>
    </PingPage>
  );
}

// ── Result card ───────────────────────────────────────────────────────────────

function ResultCard({ result, onReset }) {
  const [copied, setCopied] = useState(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const regionRef = useRef(null);
  const hasSecret = Boolean(result.client_secret);

  // The form this replaces held focus: move it to the result so a keyboard user lands on what happened.
  useEffect(() => { regionRef.current?.focus(); }, []);

  const copy = useCallback((text, key) => {
    setCopyFailed(false);
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(() => {
        setCopied(key);
        setTimeout(() => setCopied(null), 2000);
      })
      .catch(() => { setCopied(null); setCopyFailed(true); });
  }, []);

  const fields = [
    { key: 'pingone_id', label: 'PingOne App ID (client_id)', value: result.pingone_client_id },
    { key: 'secret',     label: 'Client Secret (shown once)', value: result.client_secret || '(not available — check PingOne console)', copyable: hasSecret },
    { key: 'cimd_url',   label: 'CIMD Document URL', value: result.cimd_url },
  ];

  return (
    <div ref={regionRef} tabIndex={-1} role="region" aria-label="Registration result" className="crp-result" data-testid="crp-result">
      <Card tone="ok" title="Client registered in PingOne">
        <p className="pu-status-line">
          <StatusChip tone="ok">Registered</StatusChip>
          <span>PingOne returned the new application and this app is now hosting its CIMD document.</span>
        </p>

        <KvList
          items={fields.map(({ key, label, value, copyable = true }) => ({
            label,
            mono: true,
            value: (
              <span className="crp-value-row">
                <code>{value}</code>
                {copyable && (
                  <button
                    type="button"
                    onClick={() => copy(value, key)}
                    aria-label={`Copy ${label}`}
                    className="pu-btn crp-copy-btn"
                  >
                    {copied === key ? '✓ Copied' : 'Copy'}
                  </button>
                )}
              </span>
            ),
          }))}
        />
        <p role="status" className="pu-note crp-copy-status">
          {copied ? 'Copied to the clipboard.' : copyFailed ? 'Copy failed: select the value and copy it by hand.' : ''}
        </p>

        <details className="crp-cimd-details">
          <summary className="crp-cimd-summary">View CIMD document JSON</summary>
          <pre className="crp-cimd-pre" tabIndex={0} aria-label="CIMD document JSON">
            {JSON.stringify(result.cimd_document, null, 2)}
          </pre>
        </details>

        {hasSecret && (
          <p className="crp-warning-box" data-testid="crp-secret-warning">
            <StatusChip tone="warn">Shown once</StatusChip>
            <span><strong>Save the client secret now</strong> — it will not be shown again.</span>
          </p>
        )}

        <div className="pu-actions">
          <button type="button" onClick={onReset} className="pu-btn">
            Register another client
          </button>
        </div>
      </Card>
    </div>
  );
}
