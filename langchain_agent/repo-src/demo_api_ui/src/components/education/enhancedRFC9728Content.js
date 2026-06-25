import React from 'react';
import RfcLink from '../shared/RfcLink';

const FIELD_ANNOTATIONS = {
  resource:                 { required: 'REQUIRED',     note: 'Canonical URI of this resource server' },
  authorization_servers:    { required: 'RECOMMENDED',  note: 'AS issuer URIs — tells clients which AS issues tokens' },
  bearer_methods_supported: { required: 'OPTIONAL',     note: 'How to send the bearer token (typically ["header"])' },
  scopes_supported:         { required: 'OPTIONAL',     note: 'Scopes this RS accepts — helps clients request the right scopes' },
  resource_documentation:   { required: 'OPTIONAL',     note: 'Link to API docs (OpenAPI, README, etc.)' },
  resource_name:            { required: 'OPTIONAL',     note: 'Human-readable display name for this RS' },
};

const STATUS_COLORS = {
  ok:          { bg: '#f0fdf4', border: '#86efac', text: '#166534', label: '● reachable' },
  unreachable: { bg: '#fef3c7', border: '#fcd34d', text: '#92400e', label: '◌ unreachable' },
  error:       { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b', label: '✕ error' },
};

const SERVICE_NAMES = {
  bff:       { label: 'BFF (this server)', port: process.env.REACT_APP_API_PORT || 3001 },
  mcp_olb:   { label: 'MCP OLB Server',   port: 8080 },
  mcp_gw:    { label: 'Ping Agent Gateway',      port: 3005 },
  mcp_invest: { label: 'MCP Invest',      port: 8081 },
};

function StatusBadge({ status }) {
  const s = STATUS_COLORS[status] || STATUS_COLORS.unreachable;
  return (
    <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: 999, background: s.bg, border: `1px solid ${s.border}`, color: s.text, fontWeight: 600 }}>
      {s.label}
    </span>
  );
}

function ServiceCard({ serviceKey, data }) {
  const [open, setOpen] = React.useState(serviceKey === 'bff');
  const svc = SERVICE_NAMES[serviceKey] || { label: serviceKey, port: '?' };
  const status = data._status || 'unreachable';

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, marginBottom: 10, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#f8fafc', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '0.82rem', fontWeight: 600 }}
      >
        <span style={{ flex: 1 }}>{svc.label}</span>
        <code style={{ fontSize: '0.72rem', color: '#374151' }}>:{svc.port}</code>
        <StatusBadge status={status} />
        <span style={{ fontSize: '0.75rem', color: '#374151', marginLeft: 4 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ padding: '10px 14px', fontSize: '0.8rem' }}>
          {status !== 'ok' ? (
            <p style={{ color: '#92400e', margin: 0 }}>
              {status === 'unreachable' ? 'Service not running or unreachable. Start it to see live data.' : `Error: ${data._error || 'unknown'}`}
            </p>
          ) : (
            <table className="edu-table" style={{ marginTop: 0 }}>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Value</th>
                  <th>RFC 9728 §3.2</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data)
                  .filter(([k]) => !k.startsWith('_'))
                  .map(([k, v]) => {
                    const ann = FIELD_ANNOTATIONS[k] || {};
                    return (
                      <tr key={k}>
                        <td><code>{k}</code></td>
                        <td style={{ maxWidth: 180, wordBreak: 'break-all', fontSize: '0.72rem' }}>{Array.isArray(v) ? v.join(', ') : String(v)}</td>
                        <td><span style={{ fontSize: '0.68rem', fontWeight: 600, color: ann.required === 'REQUIRED' ? '#166534' : ann.required === 'RECOMMENDED' ? '#1e40af' : '#64748b' }}>{ann.required || 'OPTIONAL'}</span></td>
                        <td style={{ fontSize: '0.72rem', color: '#374151' }}>{ann.note || ''}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export function RFC9728Content() {
  const [allData, setAllData]   = React.useState(null);
  const [fetching, setFetching] = React.useState(false);
  const [fetchErr, setFetchErr] = React.useState(null);

  const handleFetch = () => {
    setFetching(true);
    setFetchErr(null);
    fetch('/api/rfc9728/all')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => { setAllData(data); setFetching(false); })
      .catch(e => { setFetchErr(e.message); setFetching(false); });
  };

  return (
    <>
      <h3 style={{ marginTop: 0 }}>OAuth 2.0 Protected Resource Metadata — <RfcLink rfc="RFC_9728" /></h3>
      <p>
        RFC 9728 (IETF Standards Track, April 2025) defines a well-known discovery document every
        OAuth protected resource publishes. It lets clients and AI agents auto-discover which
        authorization server issues tokens for a resource — without hard-coded config.
      </p>

      <h4>Why it matters for MCP &amp; AI agents</h4>
      <p>
        When an agent gets a <code>401 WWW-Authenticate: Bearer resource_metadata=…</code> response,
        it can fetch that URL, learn which AS to use, and bootstrap the OAuth flow automatically.
        This is how agentic workflows discover new resource servers at runtime.
      </p>

      <h4>Well-known URL pattern</h4>
      <pre className="edu-code">{`GET /.well-known/oauth-protected-resource
Host: api.bank.com

# Response
{
  "resource":              "https://api.bank.com/api",     // REQUIRED
  "authorization_servers": ["https://auth.pingone.com/…"], // RECOMMENDED
  "bearer_methods_supported": ["header"],                  // OPTIONAL
  "scopes_supported": ["read", "write"],   // OPTIONAL
  "resource_name":         "Super Banking Banking API",    // OPTIONAL
  "resource_documentation": "https://…"                   // OPTIONAL
}`}</pre>

      <h4>Security: resource identifier validation (<RfcLink rfc="RFC_9728" section="§3.3" />)</h4>
      <p>
        Clients <strong>MUST</strong> verify the <code>resource</code> field matches the URL they queried.
        This prevents impersonation attacks where an attacker publishes fraudulent metadata.
      </p>
      <pre className="edu-code">{`if (metadata.resource !== requestedUrl) {
  throw new Error('Resource identifier mismatch — possible impersonation');
}`}</pre>

      <h4>Live Metadata — All Services</h4>
      <p style={{ fontSize: '0.82rem', color: '#374151' }}>
        Fetches <code>/.well-known/oauth-protected-resource</code> from the BFF and all downstream MCP services (server-side proxy, no CORS).
      </p>
      <button
        type="button"
        onClick={handleFetch}
        disabled={fetching}
        style={{ marginBottom: 12, padding: '6px 16px', background: '#1e3a5f', color: '#fff', border: 'none', borderRadius: 4, fontSize: '0.82rem', cursor: fetching ? 'default' : 'pointer', opacity: fetching ? 0.7 : 1 }}
      >
        {fetching ? 'Fetching…' : '⟳ Fetch Live Metadata'}
      </button>
      {fetchErr && <p style={{ color: '#b91c1c', fontSize: '0.82rem' }}>Error: {fetchErr}</p>}
      {allData && Object.entries(allData).map(([key, data]) => (
        <ServiceCard key={key} serviceKey={key} data={data} />
      ))}
      {!allData && !fetchErr && (
        <p style={{ fontSize: '0.78rem', color: '#374151' }}>Click the button to fetch live metadata from all running services.</p>
      )}
    </>
  );
}
