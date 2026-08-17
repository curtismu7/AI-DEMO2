import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../services/apiClient';
import './OASDemoPage.css';

const LOGIN_URL = '/api/auth/oauth/user/login?return_to=/oas-demo';

// Mirrors McpInspectorPage.jsx's coerceParam — same shape, kept local since
// it's a small pure function and the two pages aren't otherwise coupled.
function coerceParam(raw, type) {
  if (raw === '') return undefined;
  if (type === 'number' || type === 'integer') {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  if (type === 'boolean') return raw === 'true' || raw === '1';
  if (type === 'object' || type === 'array') {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

/**
 * Execute panel for one operation — real request/response against the hosted
 * PingOne MCP server via the same admin-gated pipeline McpInspectorPage's
 * "PingOne MCP" tab uses (GET pingone-tools / POST pingone-invoke). The OAS
 * operationId matches the hosted tool name 1:1 (listUsers, createUser, ...).
 */
function TryItOut({ operationId, user, pingoneTools }) {
  const [paramValues, setParamValues] = useState(null); // null = not yet seeded
  const [calling, setCalling] = useState(false);
  const [result, setResult] = useState(null);
  const [callError, setCallError] = useState(null);

  const tool = pingoneTools?.tools?.find((t) => t.name === operationId) || null;

  useEffect(() => {
    if (!tool || paramValues !== null) return;
    const props = tool.inputSchema?.properties || {};
    const defaults = pingoneTools?.paramDefaults || {};
    const seeded = {};
    for (const key of Object.keys(props)) {
      if (defaults[key] != null) seeded[key] = String(defaults[key]);
    }
    setParamValues(seeded);
  }, [tool, paramValues, pingoneTools]);

  if (!user) {
    return (
      <div className="oas-tryitout oas-tryitout--locked">
        <a className="oas-tryitout-btn oas-tryitout-btn--disabled" href={LOGIN_URL}>
          Sign in to try this
        </a>
      </div>
    );
  }

  if (!pingoneTools) {
    return <div className="oas-tryitout oas-tryitout--loading">Loading available tools…</div>;
  }

  if (!pingoneTools.enabled || pingoneTools.error) {
    return (
      <div className="oas-tryitout oas-tryitout--unavailable">
        {pingoneTools.reason || 'PingOne MCP tools are unavailable right now.'}
      </div>
    );
  }

  if (!tool) {
    return (
      <div className="oas-tryitout oas-tryitout--unavailable">
        Not available via the hosted PingOne MCP server in this demo.
      </div>
    );
  }

  const props = tool.inputSchema?.properties || {};
  const required = new Set(tool.inputSchema?.required || []);
  const paramKeys = Object.keys(props);

  const runTool = async () => {
    const missing = [...required].filter((key) => !(paramValues?.[key] ?? '').trim());
    if (missing.length > 0) {
      setCallError(`Required: ${missing.join(', ')}`);
      return;
    }
    setCalling(true);
    setCallError(null);
    const params = {};
    for (const [key, schema] of Object.entries(props)) {
      const coerced = coerceParam((paramValues?.[key] ?? '').trim(), schema?.type);
      if (coerced !== undefined) params[key] = coerced;
    }
    try {
      const res = await apiClient.post('/api/mcp/inspector/pingone-invoke', { tool: operationId, params });
      if (res.data?.error) {
        setCallError(res.data.reason || 'Request failed');
        setResult(null);
      } else {
        setResult(res.data?.response?.result ?? res.data);
      }
    } catch (e) {
      setCallError(e?.response?.data?.message || e?.message || 'Request failed');
      setResult(null);
    } finally {
      setCalling(false);
    }
  };

  return (
    <div className="oas-tryitout">
      {paramKeys.length > 0 && (
        <div className="oas-tryitout-params">
          {paramKeys.map((key) => (
            <label key={key} className="oas-tryitout-field">
              <span>{key}{required.has(key) ? ' *' : ''}</span>
              <input
                type="text"
                value={paramValues?.[key] ?? ''}
                onChange={(e) => setParamValues((prev) => ({ ...(prev || {}), [key]: e.target.value }))}
                placeholder={props[key]?.type || 'string'}
              />
            </label>
          ))}
        </div>
      )}
      <button
        type="button"
        className="oas-tryitout-btn"
        onClick={runTool}
        disabled={calling}
      >
        {calling ? 'Running…' : 'Try it out'}
      </button>
      {callError && <div className="oas-tryitout-error">{callError}</div>}
      {result && (
        <pre className="oas-tryitout-result">{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  );
}

const METHOD_COLORS = {
  GET:    '#22c55e',
  POST:   '#3b82f6',
  PUT:    '#f59e0b',
  PATCH:  '#a855f7',
  DELETE: '#ef4444',
};

const PERMISSION_SCOPE_MAP = {
  'Identity Admin':    'read',
  'Environment Admin': 'read',
};

function MethodBadge({ method }) {
  return (
    <span
      className="oas-method-badge"
      style={{ background: METHOD_COLORS[method] || '#6b7280' }}
    >
      {method}
    </span>
  );
}

function PermissionBadge({ permission }) {
  if (!permission) return null;
  return <span className="oas-permission-badge">{permission}</span>;
}

function ScopeBadge({ scope }) {
  return <span className="oas-scope-badge">{scope}</span>;
}

function PublicApiBadge({ value }) {
  if (!value) return null;
  return <span className="oas-public-badge">x-public-api: {value}</span>;
}

function OperationRow({ pathKey, method, op, expanded, onToggle, user, pingoneTools }) {
  const scope = PERMISSION_SCOPE_MAP[op['x-permission']] || 'read';
  const params = (op.parameters || []).filter(p => p.in === 'path');

  return (
    <div className={`oas-op-row${expanded ? ' oas-op-row--expanded' : ''}`}>
      <button className="oas-op-header" onClick={onToggle} aria-expanded={expanded}>
        <MethodBadge method={method.toUpperCase()} />
        <code className="oas-op-path">{pathKey}</code>
        <span className="oas-op-summary">{op.summary}</span>
        <div className="oas-op-badges">
          <PermissionBadge permission={op['x-permission']} />
          <ScopeBadge scope={scope} />
        </div>
        <span className="oas-op-chevron">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="oas-op-detail">
          <div className="oas-op-detail-grid">
            <div className="oas-op-detail-col">
              <h4>Security Contract</h4>
              <dl className="oas-op-dl">
                <dt>operationId</dt>
                <dd><code>{op.operationId}</code></dd>
                <dt>x-permission</dt>
                <dd><PermissionBadge permission={op['x-permission']} /></dd>
                <dt>x-public-api</dt>
                <dd><PublicApiBadge value={op['x-public-api']} /></dd>
                <dt>Required OAuth Scope</dt>
                <dd><ScopeBadge scope={scope} /></dd>
              </dl>
            </div>
            {params.length > 0 && (
              <div className="oas-op-detail-col">
                <h4>Path Parameters</h4>
                <dl className="oas-op-dl">
                  {params.map(p => (
                    <React.Fragment key={p.name}>
                      <dt><code>{p.name}</code></dt>
                      <dd>{p.schema?.format || p.schema?.type || 'string'}{p.required ? ' (required)' : ''}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              </div>
            )}
            <div className="oas-op-detail-col">
              <h4>Responses</h4>
              <dl className="oas-op-dl">
                {Object.entries(op.responses || {}).map(([code, resp]) => (
                  <React.Fragment key={code}>
                    <dt><code className={`oas-status-code oas-status-code--${code.startsWith('2') ? 'ok' : code.startsWith('4') ? 'err' : 'warn'}`}>{code}</code></dt>
                    <dd>{resp.description}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </div>
          </div>
          <div className="oas-op-detail-col oas-op-detail-col--tryitout">
            <h4>Try it out</h4>
            <TryItOut operationId={op.operationId} user={user} pingoneTools={pingoneTools} />
          </div>
        </div>
      )}
    </div>
  );
}

function SecurityFlowDiagram() {
  return (
    <div className="oas-flow">
      <div className="oas-flow-step oas-flow-step--spec">
        <div className="oas-flow-icon">📄</div>
        <div className="oas-flow-label">OAS 3.1 Spec</div>
        <div className="oas-flow-detail"><code>x-permission</code></div>
      </div>
      <div className="oas-flow-arrow">→</div>
      <div className="oas-flow-step oas-flow-step--ai">
        <div className="oas-flow-icon">🤖</div>
        <div className="oas-flow-label">AI Agent Reads Spec</div>
        <div className="oas-flow-detail">list_pingone_tools</div>
      </div>
      <div className="oas-flow-arrow">→</div>
      <div className="oas-flow-step oas-flow-step--scope">
        <div className="oas-flow-icon">🔑</div>
        <div className="oas-flow-label">OAuth Scope Mapped</div>
        <div className="oas-flow-detail">Identity Admin → <code>read</code></div>
      </div>
      <div className="oas-flow-arrow">→</div>
      <div className="oas-flow-step oas-flow-step--gateway">
        <div className="oas-flow-icon">🛡️</div>
        <div className="oas-flow-label">Gateway Enforces</div>
        <div className="oas-flow-detail">RFC 8693 token exchange</div>
      </div>
      <div className="oas-flow-arrow">→</div>
      <div className="oas-flow-step oas-flow-step--call">
        <div className="oas-flow-icon">✅</div>
        <div className="oas-flow-label">API Call Permitted</div>
        <div className="oas-flow-detail">call_pingone_tool</div>
      </div>
    </div>
  );
}

export default function OASDemoPage({ user }) {
  const navigate = useNavigate();
  const [spec, setSpec] = useState(null);
  const [error, setError] = useState(null);
  const [expandedOp, setExpandedOp] = useState(null);
  const [showRawSpec, setShowRawSpec] = useState(false);
  const [filterTag, setFilterTag] = useState('All');
  const [pingoneTools, setPingoneTools] = useState(null);

  useEffect(() => {
    fetch('/api/oas/pingone-fragment', { credentials: 'include' })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setSpec)
      .catch(e => setError(e.message));
  }, []);

  // "Try it out" needs the real hosted PingOne MCP tool list (param schemas,
  // defaults) once, up front — not per-row, since every row's Try It Out
  // panel reads from the same list.
  useEffect(() => {
    if (!user) return;
    apiClient.get('/api/mcp/inspector/pingone-tools')
      .then((r) => setPingoneTools(r.data))
      .catch(() => setPingoneTools({ enabled: false, tools: [], reason: 'Failed to load PingOne MCP tools.' }));
  }, [user]);

  const allOperations = spec
    ? Object.entries(spec.paths || {}).flatMap(([pathKey, pathItem]) =>
        ['get', 'post', 'put', 'patch', 'delete']
          .filter(m => pathItem[m])
          .map(m => ({ pathKey, method: m, op: pathItem[m] }))
      )
    : [];

  const allTags = ['All', ...new Set(allOperations.flatMap(({ op }) => op.tags || []))];
  const visibleOps = filterTag === 'All'
    ? allOperations
    : allOperations.filter(({ op }) => (op.tags || []).includes(filterTag));

  const handleLaunchAgent = () => {
    // navigate state, not query params: nothing anywhere reads `?vertical=`/`msg=`
    // (the old form silently dropped the prompt on every click). AIAgent.js:966
    // consumes location.state.triggerText and auto-sends it.
    navigate('/dashboard', {
      state: { triggerText: 'Show me the tools available from the PingOne MCP server' },
    });
  };

  return (
    <div className="oas-demo">
      {/* ── Header ── */}
      <div className="oas-demo-header">
        <div className="oas-demo-header-left">
          <span className="oas-demo-badge">OpenAPI 3.1</span>
          <h1 className="oas-demo-title">PingOne API Security Contract</h1>
          <p className="oas-demo-subtitle">
            Machine-readable API definitions governing what AI agents can discover and call.
            Each operation carries <code>x-permission</code> and <code>x-public-api</code> annotations
            that map directly to OAuth scopes enforced at the MCP gateway.
          </p>
        </div>
        <button className="oas-demo-launch-btn" onClick={handleLaunchAgent}>
          Launch AI Agent →
        </button>
      </div>

      {/* ── Security Flow ── */}
      <div className="oas-demo-section">
        <h2 className="oas-demo-section-title">How it works</h2>
        <SecurityFlowDiagram />
      </div>

      {/* ── Spec Metadata ── */}
      {spec && (
        <div className="oas-demo-section">
          <h2 className="oas-demo-section-title">Spec Info</h2>
          <div className="oas-spec-meta">
            <div className="oas-spec-meta-grid">
              <div className="oas-spec-meta-item">
                <span className="oas-spec-meta-label">Title</span>
                <span className="oas-spec-meta-value">{spec.info.title}</span>
              </div>
              <div className="oas-spec-meta-item">
                <span className="oas-spec-meta-label">Version</span>
                <span className="oas-spec-meta-value">{spec.info.version}</span>
              </div>
              <div className="oas-spec-meta-item">
                <span className="oas-spec-meta-label">OpenAPI</span>
                <span className="oas-spec-meta-value">{spec.openapi}</span>
              </div>
              <div className="oas-spec-meta-item">
                <span className="oas-spec-meta-label">Operations</span>
                <span className="oas-spec-meta-value">{allOperations.length}</span>
              </div>
            </div>
            <p className="oas-spec-meta-desc">{spec.info.description}</p>
          </div>
        </div>
      )}

      {/* ── Operations ── */}
      <div className="oas-demo-section">
        <div className="oas-ops-header">
          <h2 className="oas-demo-section-title">
            Operations
            <span className="oas-ops-count">{visibleOps.length}</span>
          </h2>
          <div className="oas-tag-filter">
            {allTags.map(tag => (
              <button
                key={tag}
                className={`oas-tag-btn${filterTag === tag ? ' oas-tag-btn--active' : ''}`}
                onClick={() => setFilterTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="oas-error">
            Failed to load spec: {error}
          </div>
        )}

        {!spec && !error && (
          <div className="oas-loading">Loading OpenAPI spec…</div>
        )}

        <div className="oas-ops-list">
          {visibleOps.map(({ pathKey, method, op }) => {
            const key = `${method}:${pathKey}`;
            return (
              <OperationRow
                key={key}
                pathKey={pathKey}
                method={method}
                op={op}
                expanded={expandedOp === key}
                onToggle={() => setExpandedOp(expandedOp === key ? null : key)}
                user={user}
                pingoneTools={pingoneTools}
              />
            );
          })}
        </div>
      </div>

      {/* ── Security Scheme ── */}
      {spec?.components?.securitySchemes?.bearerAuth && (
        <div className="oas-demo-section">
          <h2 className="oas-demo-section-title">Security Scheme</h2>
          <div className="oas-scheme-card">
            <div className="oas-scheme-header">
              <span className="oas-scheme-name">bearerAuth</span>
              <span className="oas-scheme-type">
                {spec.components.securitySchemes.bearerAuth.scheme} / {spec.components.securitySchemes.bearerAuth.bearerFormat}
              </span>
            </div>
            <p className="oas-scheme-desc">
              {spec.components.securitySchemes.bearerAuth.description}
            </p>
          </div>
        </div>
      )}

      {/* ── Raw Spec Toggle ── */}
      {spec && (
        <div className="oas-demo-section">
          <button
            className="oas-raw-toggle"
            onClick={() => setShowRawSpec(s => !s)}
          >
            {showRawSpec ? '▲ Hide' : '▼ View'} Raw OAS Spec
          </button>
          {showRawSpec && (
            <pre className="oas-raw-spec">{JSON.stringify(spec, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
}
