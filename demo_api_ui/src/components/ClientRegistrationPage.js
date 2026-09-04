/**
 * ClientRegistrationPage.js
 *
 * Admin-only page that presents a CIMD-style client metadata form,
 * calls POST /api/clients/register on the backend, and displays
 * the resulting PingOne credentials plus the hosted CIMD document URL.
 */
import React, { useState, useCallback } from 'react';
import apiClient from '../services/apiClient';
import { notifySuccess, notifyError } from '../utils/appToast';
import { useEducationUI } from '../context/EducationUIContext';
import { EDU } from './education/educationIds';
import AdminSubPageShell from './AdminSubPageShell';
import PageNav from './PageNav';
import './ClientRegistrationPage.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseLines(str) {
  return str.split('\n').map(s => s.trim()).filter(Boolean);
}

// ── Field components ──────────────────────────────────────────────────────────

function Field({ label, hint, children }) {
  return (
    <div className="crp-field">
      <label className="crp-field-label">{label}</label>
      {children}
      {hint && <p className="crp-field-hint">{hint}</p>}
    </div>
  );
}

function Input({ value, onChange, placeholder, disabled }) {
  return (
    <input
      type="text"
      className="crp-input"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
    />
  );
}

function Textarea({ value, onChange, placeholder, disabled, rows = 3 }) {
  return (
    <textarea
      className="crp-textarea"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      rows={rows}
    />
  );
}

function Select({ value, onChange, options, disabled }) {
  return (
    <select className="crp-select" value={value} onChange={e => onChange(e.target.value)} disabled={disabled}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function CheckboxGroup({ options, selected, onChange, disabled }) {
  const toggle = (val) => {
    onChange(selected.includes(val) ? selected.filter(v => v !== val) : [...selected, val]);
  };
  return (
    <div className="crp-checkbox-group">
      {options.map(o => (
        <label key={o} className="crp-checkbox-label" style={{ cursor: disabled ? 'default' : 'pointer' }}>
          <input
            type="checkbox"
            checked={selected.includes(o)}
            onChange={() => toggle(o)}
            disabled={disabled}
          />
          <code className="crp-checkbox-code">{o}</code>
        </label>
      ))}
    </div>
  );
}

// ── Result card ───────────────────────────────────────────────────────────────

function ResultCard({ result, onReset }) {
  const [copied, setCopied] = useState(null);

  const copy = useCallback((text, key) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  }, []);

  return (
    <div className="crp-result">
      <div className="crp-result-header">
        <span className="crp-result-icon">✅</span>
        <h3>Client registered in PingOne</h3>
      </div>

      {[
        { key: 'pingone_id', label: 'PingOne App ID (client_id)', value: result.pingone_client_id },
        { key: 'secret',     label: 'Client Secret (shown once)', value: result.client_secret || '(not available — check PingOne console)' },
        { key: 'cimd_url',   label: 'CIMD Document URL', value: result.cimd_url },
      ].map(({ key, label, value }) => (
        <div key={key} className="crp-result-field">
          <div className="crp-result-field-label">{label}</div>
          <div className="crp-result-value-row">
            <code>{value}</code>
            <button
              onClick={() => copy(value, key)}
              title="Copy"
              className={`crp-copy-btn${copied === key ? ' crp-copy-btn--copied' : ''}`}
            >
              {copied === key ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        </div>
      ))}

      <details className="crp-cimd-details">
        <summary className="crp-cimd-summary">View CIMD document JSON</summary>
        <pre className="crp-cimd-pre">
          {JSON.stringify(result.cimd_document, null, 2)}
        </pre>
      </details>

      <div className="crp-warning-box">
        ⚠️ <strong>Save the client secret now</strong> — it will not be shown again.
      </div>

      <button onClick={onReset} className="crp-reset-btn">
        Register another client
      </button>
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

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setSubmitting(true);
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
      notifyError(`Registration failed: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }, [clientName, clientDescription, applicationType, grantTypes, redirectUris,
      postLogoutUris, tokenAuthMethod, scope, contacts, logoUri, clientUri]);

  const handleReset = useCallback(() => {
    setResult(null);
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

  return (
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

      <div className="crp-body">
        <div className="crp-info-box">
          <strong>How this works:</strong> You define the metadata below (CIMD format). The server
          calls the PingOne Management API to create the OAuth application, then hosts the
          CIMD document at <code>/.well-known/oauth-client/&#123;app-id&#125;</code>.
          That URL becomes the <code>client_id</code> for any CIMD-aware AS.
        </div>

      {/* Result or Form */}
      {result ? (
        <ResultCard result={result} onReset={handleReset} />
      ) : (
        <form onSubmit={handleSubmit}>
          {/* ── Section: Identity ───────────────────────────────────── */}
          <section className="crp-section">
            <h2 className="crp-section-heading">Client Identity</h2>
            <Field label="Client Name *" hint="Human-readable name shown on consent screens.">
              <Input value={clientName} onChange={setClientName} placeholder="My Integration" disabled={submitting} />
            </Field>
            <Field label="Description" hint="Optional description stored in PingOne.">
              <Input value={clientDescription} onChange={setClientDescription} placeholder="Brief description of this OAuth client" disabled={submitting} />
            </Field>
            <Field label="Application Type" hint="web = server-side web app, native = mobile/desktop, service = M2M worker.">
              <Select value={applicationType} onChange={setApplicationType} options={APP_TYPE_OPTIONS} disabled={submitting} />
            </Field>
            <Field label="Client URI" hint="Optional URL to the application's home page.">
              <Input value={clientUri} onChange={setClientUri} placeholder="https://app.example.com" disabled={submitting} />
            </Field>
            <Field label="Logo URI" hint="Optional HTTPS URL to a square logo image.">
              <Input value={logoUri} onChange={setLogoUri} placeholder="https://app.example.com/logo.png" disabled={submitting} />
            </Field>
          </section>

          {/* ── Section: OAuth Flow ─────────────────────────────────── */}
          <section className="crp-section">
            <h2 className="crp-section-heading">OAuth Flow</h2>
            <Field label="Grant Types *" hint="Select all flows this client will use.">
              <CheckboxGroup options={GRANT_TYPE_OPTIONS} selected={grantTypes} onChange={setGrantTypes} disabled={submitting} />
            </Field>
            <Field label="Token Endpoint Auth Method">
              <Select value={tokenAuthMethod} onChange={setTokenAuthMethod} options={TOKEN_AUTH_OPTIONS} disabled={submitting} />
            </Field>
            <Field label="Scopes" hint="Space-separated list of requested scopes.">
              <Input value={scope} onChange={setScope} placeholder="openid profile email" disabled={submitting} />
            </Field>
          </section>

          {/* ── Section: Redirect URIs ──────────────────────────────── */}
          <section className="crp-section">
            <h2 className="crp-section-heading">Redirect URIs</h2>
            <Field label="Redirect URIs" hint="One URI per line. Must be HTTPS (localhost allowed for dev).">
              <Textarea
                value={redirectUris}
                onChange={setRedirectUris}
                placeholder={`https://app.example.com/callback\nhttps://app.example.com/auth`}
                disabled={submitting}
                rows={3}
              />
            </Field>
            <Field label="Post-Logout Redirect URIs" hint="One URI per line.">
              <Textarea
                value={postLogoutUris}
                onChange={setPostLogoutUris}
                placeholder="https://app.example.com/loggedout"
                disabled={submitting}
                rows={2}
              />
            </Field>
          </section>

          {/* ── Section: Contact ────────────────────────────────────── */}
          <section className="crp-section">
            <h2 className="crp-section-heading">Contact (optional)</h2>
            <Field label="Contact Emails" hint="One email per line. Included in the CIMD document.">
              <Textarea
                value={contacts}
                onChange={setContacts}
                placeholder="dev@example.com"
                disabled={submitting}
                rows={2}
              />
            </Field>
          </section>

          {/* ── Submit ──────────────────────────────────────────────── */}
          <div className="crp-submit-box">
            <div className="crp-submit-hint">
              Submitting will call the PingOne Management API to create this application
              and host the CIMD document at <code>/.well-known/oauth-client/&#123;id&#125;</code>.
            </div>
            <button
              type="submit"
              disabled={submitting || !clientName.trim()}
              className="crp-submit-btn"
            >
              {submitting ? '⏳ Registering in PingOne…' : 'Register Client'}
            </button>
          </div>
        </form>
      )}
      </div>
    </AdminSubPageShell>
  );
}
