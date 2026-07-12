import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './OASDemoPage.css';

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

function OperationRow({ pathKey, method, op, expanded, onToggle }) {
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

export default function OASDemoPage() {
  const navigate = useNavigate();
  const [spec, setSpec] = useState(null);
  const [error, setError] = useState(null);
  const [expandedOp, setExpandedOp] = useState(null);
  const [showRawSpec, setShowRawSpec] = useState(false);
  const [filterTag, setFilterTag] = useState('All');

  useEffect(() => {
    fetch('/api/oas/pingone-fragment', { credentials: 'include' })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setSpec)
      .catch(e => setError(e.message));
  }, []);

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
    navigate('/?vertical=pingone-admin&msg=' + encodeURIComponent('Show me the tools available from the PingOne MCP server'));
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
