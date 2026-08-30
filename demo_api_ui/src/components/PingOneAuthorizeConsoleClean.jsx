import React, { useMemo } from 'react';
import { usePingOneAuthorizeConsole } from '../hooks/usePingOneAuthorizeConsole';
import './PingOneAuthorizeConsoleClean.css';

function filterPolicies(policies, query) {
  if (!query?.trim()) return policies;
  const q = query.toLowerCase();
  return policies.filter(p =>
    p.name?.toLowerCase().includes(q) ||
    p.description?.toLowerCase().includes(q)
  );
}

export default function PingOneAuthorizeConsoleClean({
  endpointId,
  policiesState,
  pendingTest,
  onClearPendingTest,
  onEvaluated,
  onTestRule,
  reel = [],
  onSelectReel,
}) {
  const {
    outputTab, setOutputTab,
    running, err, result, lastTrace, lastParameters, decision,
    preset, setPreset,
    policyQuery, setPolicyQuery,
    amount, setAmount,
    txType, setTxType,
    acr, setAcr,
    userId, setUserId,
    toolName, setToolName,
    tokenAudience, setTokenAudience,
    actClientId, setActClientId,
    mcpResourceUri, setMcpResourceUri,
    hitlApproved, setHitlApproved,
    customRows, setRow, removeRow,
    run, buildParameters,
    activeReelId, selectReelEntry,
  } = usePingOneAuthorizeConsole({
    endpointId,
    autoPreset: 'transaction',
    policiesState,
    pendingTest,
    onClearPendingTest,
    onEvaluated,
  });

  const { policies = [] } = policiesState;
  const filteredPolicies = useMemo(() => filterPolicies(policies, policyQuery), [policies, policyQuery]);

  const presetLabel = { transaction: 'Transaction', mcp: 'MCP First Tool', custom: 'Custom' }[preset];

  return (
    <div className="inspector-clean-page">
      {/* Header */}
      <div className="inspector-clean-header">
        <div className="inspector-clean-title">PingOne Authorize</div>
        <div className="inspector-clean-tabs">
          <div className="inspector-clean-tab active">Console</div>
          <div className="inspector-clean-tab">Bulk Decisions</div>
          <div className="inspector-clean-tab">Guided Scenarios</div>
          <div className="inspector-clean-tab">Mock Rules</div>
          <div className="inspector-clean-tab">Scopes</div>
          <div className="inspector-clean-tab">Snapshot</div>
        </div>
      </div>

      {/* Status Bar */}
      <div className="p1az-clean-statusbar">
        <div className="p1az-clean-statusbar-item">
          <span className="p1az-clean-statusbar-badge">LIVE</span>
        </div>
        <div className="p1az-clean-statusbar-item">
          <button className="p1az-clean-statusbar-button">🔄 Refresh</button>
        </div>
        <div className="p1az-clean-statusbar-item">
          Environment: <strong>01d89b06</strong>
        </div>
        <div className="p1az-clean-statusbar-item">
          Worker: demo-bff-mcp-client
        </div>
      </div>

      {/* Endpoint Bar */}
      <div className="p1az-clean-endpointbar">
        <div className="inspector-clean-field">
          <div className="inspector-clean-field-label">Policy Endpoint</div>
          <select style={{ padding: '8px 12px', border: '1px solid var(--th-border)', borderRadius: 'var(--radius-md)' }}>
            <option>Live Policy Endpoint (01d89b06)</option>
          </select>
        </div>
        <div className="p1az-clean-recording-status">
          📽️ Recording ({reel.length} decisions)
        </div>
      </div>

      {/* Main Content */}
      <div className="inspector-clean-content">
        <div className="inspector-clean-main">
          {/* Left: Policies */}
          <div className="inspector-clean-panel">
            <div className="inspector-clean-panel-header">
              <div className="inspector-clean-panel-label">Available Policies</div>
            </div>
            <div className="inspector-clean-panel-body">
              {policies.map((p, i) => (
                <div key={i} className="inspector-clean-item">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input type="checkbox" defaultChecked />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '12px', fontWeight: '600' }}>{p.name}</div>
                      <div style={{ fontSize: '10px', color: 'var(--th-text-muted)' }}>
                        v{p.version} · {p.ruleCount} rules
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Middle: Form */}
          <div className="inspector-clean-panel">
            <div className="inspector-clean-panel-header">
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <div
                  className={`inspector-clean-tab ${preset === 'transaction' ? 'active' : ''}`}
                  onClick={() => setPreset('transaction')}
                  style={{ cursor: 'pointer' }}
                >
                  Transaction
                </div>
                <div
                  className={`inspector-clean-tab ${preset === 'mcp' ? 'active' : ''}`}
                  onClick={() => setPreset('mcp')}
                  style={{ cursor: 'pointer' }}
                >
                  MCP First Tool
                </div>
                <div
                  className={`inspector-clean-tab ${preset === 'custom' ? 'active' : ''}`}
                  onClick={() => setPreset('custom')}
                  style={{ cursor: 'pointer' }}
                >
                  Custom
                </div>
              </div>
            </div>
            <div className="inspector-clean-panel-body">
              <div style={{ padding: '12px', background: 'var(--th-bg-inset)', borderBottom: '1px solid var(--th-border)', fontSize: '11px', marginBottom: '12px' }}>
                <strong>Selected:</strong> {policies.filter(p => p.checked).length} of {policies.length} policies
              </div>

              <div className="inspector-clean-form">
                {preset === 'transaction' && (
                  <>
                    <div className="inspector-clean-field">
                      <label className="inspector-clean-field-label">Amount <span className="inspector-clean-field-type">number</span></label>
                      <input type="text" value={amount} onChange={e => setAmount(e.target.value)} />
                    </div>
                    <div className="inspector-clean-field">
                      <label className="inspector-clean-field-label">Type <span className="inspector-clean-field-type">enum</span></label>
                      <select value={txType} onChange={e => setTxType(e.target.value)}>
                        <option>TRANSFER</option>
                        <option>WITHDRAWAL</option>
                        <option>DEPOSIT</option>
                      </select>
                    </div>
                    <div className="inspector-clean-field">
                      <label className="inspector-clean-field-label">ACR <span className="inspector-clean-field-type">string</span></label>
                      <input type="text" value={acr} onChange={e => setAcr(e.target.value)} placeholder="urn:mace:incommon:iap:silver" />
                    </div>
                    <div className="inspector-clean-field">
                      <label className="inspector-clean-field-label">User ID <span className="inspector-clean-field-type">string</span></label>
                      <input type="text" value={userId} onChange={e => setUserId(e.target.value)} />
                    </div>
                  </>
                )}

                {preset === 'mcp' && (
                  <>
                    <div className="inspector-clean-field">
                      <label className="inspector-clean-field-label">Tool Name <span className="inspector-clean-field-type">string</span></label>
                      <input type="text" value={toolName} onChange={e => setToolName(e.target.value)} />
                    </div>
                    <div className="inspector-clean-field">
                      <label className="inspector-clean-field-label">Token Audience <span className="inspector-clean-field-type">string</span></label>
                      <input type="text" value={tokenAudience} onChange={e => setTokenAudience(e.target.value)} />
                    </div>
                    <div className="inspector-clean-field">
                      <label className="inspector-clean-field-label">Act Client ID <span className="inspector-clean-field-type">string</span></label>
                      <input type="text" value={actClientId} onChange={e => setActClientId(e.target.value)} />
                    </div>
                    <div className="inspector-clean-field">
                      <label className="inspector-clean-field-label">MCP Resource URI <span className="inspector-clean-field-type">string</span></label>
                      <input type="text" value={mcpResourceUri} onChange={e => setMcpResourceUri(e.target.value)} />
                    </div>
                    <div className="inspector-clean-field">
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '500' }}>
                        <input type="checkbox" checked={hitlApproved} onChange={e => setHitlApproved(e.target.checked)} />
                        HITL Approved
                      </label>
                    </div>
                  </>
                )}

                {preset === 'custom' && (
                  <div style={{ fontSize: '12px' }}>
                    {customRows.map((row, i) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 30px', gap: '8px', marginBottom: '8px', alignItems: 'end' }}>
                        <input type="text" placeholder="Key" value={row.key} onChange={e => setRow(i, 'key', e.target.value)} style={{ padding: '8px', border: '1px solid var(--th-border)', borderRadius: 'var(--radius-sm)' }} />
                        <input type="text" placeholder="Value" value={row.value} onChange={e => setRow(i, 'value', e.target.value)} style={{ padding: '8px', border: '1px solid var(--th-border)', borderRadius: 'var(--radius-sm)' }} />
                        {row.key && <button onClick={() => removeRow(i)} style={{ padding: '4px 8px', background: '#fee2e2', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '12px' }}>✕</button>}
                      </div>
                    ))}
                  </div>
                )}

                <button className="inspector-clean-button" onClick={run} disabled={running}>
                  {running ? '⏳ Executing…' : '▶ Execute Policies'}
                </button>
              </div>
            </div>
          </div>

          {/* Right: Output Tabs */}
          <div className="inspector-clean-panel">
            <div className="inspector-clean-panel-header">
              <div className="inspector-clean-panel-label">Output</div>
            </div>
            <div className="inspector-clean-output">
              <div className="inspector-clean-output-tabs">
                {['Decision', 'Policies', 'Response', 'Request', 'Form', 'Timing', 'Diff'].map((tab, i) => (
                  <div
                    key={i}
                    className={`inspector-clean-output-tab ${outputTab === tab.toLowerCase() ? 'active' : ''}`}
                    onClick={() => setOutputTab(tab.toLowerCase())}
                  >
                    {tab}
                  </div>
                ))}
              </div>

              {/* Decision Tab */}
              {outputTab === 'decision' && result && (
                <div className="p1az-clean-verdict" style={{ '--verdict-color': decision === 'PERMIT' ? '#059669' : decision === 'DENY' ? '#dc2626' : '#f59e0b' }}>
                  <div className="p1az-clean-verdict-label">Decision</div>
                  <div className="p1az-clean-verdict-value" style={{ color: decision === 'PERMIT' ? '#059669' : decision === 'DENY' ? '#dc2626' : '#f59e0b' }}>
                    {decision}
                  </div>
                  <div className="p1az-clean-verdict-detail">
                    <strong>Risk Score:</strong> {result.riskScore?.toFixed(1) || 'N/A'}<br/>
                    <strong>Confidence:</strong> {result.confidenceScore ? (result.confidenceScore * 100).toFixed(0) + '%' : 'N/A'}<br/>
                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--th-border)', fontSize: '11px' }}>
                      {JSON.stringify(result, null, 2).split('\n').slice(0, 20).join('\n')}
                    </div>
                  </div>
                </div>
              )}
              {!result && !err && <div style={{ color: 'var(--th-text-muted)', fontSize: '12px', padding: '20px' }}>Execute policies to see results</div>}
              {err && <div style={{ color: '#dc2626', fontSize: '12px', padding: '20px' }}>❌ Error: {err}</div>}
            </div>
          </div>
        </div>

        {/* Movie Reel */}
        <div className="inspector-clean-reel">
          <div className="inspector-clean-reel-label">History</div>
          {reel.slice(-4).reverse().map((entry, i) => (
            <div
              key={i}
              className={`inspector-clean-reel-frame ${activeReelId === entry.id ? 'active' : ''}`}
              onClick={() => {
                selectReelEntry(entry);
                onSelectReel?.(entry.id);
              }}
              style={{ cursor: 'pointer' }}
            >
              {entry.preset} → {entry.decision} ({entry.timingsMs}ms)
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
