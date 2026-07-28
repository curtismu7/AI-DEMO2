// demo_api_ui/src/components/BulkDecisionPanel.jsx
//
// "Bulk Decisions" tab of the P1AZ Inspector — sends up to 20 decision
// requests to ONE PingOne Authorize decision endpoint in a single bulk call
// (POST /api/authorize/evaluate-endpoint-bulk) and shows the per-item
// verdicts, correlated by one correlationId. Always calls live PingOne, same
// as the Live Policy Console this tab sits beside — no simulated fallback.
//
// Scaffolded from scratch on InspectorShell/InspectorListItem/InspectorTabs
// (inspector-template skill, Path 2) rather than copied from PingOneAuthorizePage's
// EvaluatePanel, so it owns no console-tab state and fetches its own endpoint list.
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import bffAxios from '../services/bffAxios';
import JsonHighlight from './shared/JsonHighlight';
import InspectorShell from './shared/InspectorShell';
import InspectorListItem from './shared/InspectorListItem';
import InspectorTabs from './shared/InspectorTabs';
import { BULK_DECISION_BUNDLES, findBulkDecisionBundle } from '../config/bulkDecisionBundles';

const MAX_ITEMS = 20;

const DECISION_COLORS = {
  PERMIT: { bg: '#dcfce7', fg: '#166534' },
  DENY: { bg: '#fee2e2', fg: '#991b1b' },
  STEP_UP: { bg: '#fef9c3', fg: '#854d0e' },
  CONSENT: { bg: '#fef9c3', fg: '#854d0e' },
  INDETERMINATE: { bg: '#f3e8ff', fg: '#6b21a8' },
};

function decisionBadgeStyle(d) {
  const c = DECISION_COLORS[d] || { bg: '#f3f4f6', fg: '#374151' };
  return {
    display: 'inline-block', padding: '2px 8px', borderRadius: '20px',
    fontSize: '10px', fontWeight: 700, background: c.bg, color: c.fg,
  };
}

/** Mirrors PingOneAuthorizePage's displayDecision — obligations win over the raw decision. */
function displayDecision(r) {
  if (!r) return '?';
  if (r.stepUpRequired) return 'STEP_UP';
  if (r.consentRequired || r.hitlRequired) return 'CONSENT';
  return r.decision || '?';
}

function endpointLabel(ep) {
  return `${ep.name || '(unnamed)'} — ${ep.id}`;
}

/** Parse + validate the decisionRequests JSON textarea. Never throws. */
function parseItemsText(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { items: null, error: `Invalid JSON: ${e.message}` };
  }
  if (!Array.isArray(parsed)) {
    return { items: null, error: 'decisionRequests must be a JSON array.' };
  }
  for (let i = 0; i < parsed.length; i += 1) {
    const item = parsed[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { items: null, error: `Item ${i} must be an object.` };
    }
    if (!item.parameters || typeof item.parameters !== 'object' || Array.isArray(item.parameters)) {
      return { items: null, error: `Item ${i}.parameters must be an object.` };
    }
  }
  return { items: parsed, error: null };
}

export default function BulkDecisionPanel() {
  const [endpoints, setEndpoints] = useState([]);
  const [loadingEndpoints, setLoadingEndpoints] = useState(true);
  const [selectedEndpointId, setSelectedEndpointId] = useState('');

  const [bundleKey, setBundleKey] = useState(null);
  const [itemsText, setItemsText] = useState('[]');
  const [truncatedNote, setTruncatedNote] = useState(null);
  const [loadingTools, setLoadingTools] = useState(false);

  const [outputTab, setOutputTab] = useState('results');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await bffAxios.get('/api/authorize/pingone-live-policy');
        if (cancelled) return;
        const eps = res.data?.endpoints || [];
        setEndpoints(eps);
        const def = res.data?.mcpEndpointId || res.data?.transactionEndpointId || eps[0]?.id || '';
        setSelectedEndpointId((prev) => prev || def);
      } catch {
        // leave endpoints empty — the picker shows "No decision endpoints found".
      } finally {
        if (!cancelled) setLoadingEndpoints(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const { items: parsedItems, error: parseError } = useMemo(() => parseItemsText(itemsText), [itemsText]);
  const overCap = !!parsedItems && parsedItems.length > MAX_ITEMS;

  const loadBundle = useCallback((bundle) => {
    setBundleKey(bundle.key);
    setItemsText(JSON.stringify(bundle.build(), null, 2));
    setTruncatedNote(null);
    setResult(null);
    setErr(null);
  }, []);

  const loadMcpTools = useCallback(async () => {
    setLoadingTools(true);
    try {
      const res = await bffAxios.get('/api/mcp/inspector/tools');
      const names = (res.data?.tools || []).map((t) => t.name).filter(Boolean);
      const bundle = findBulkDecisionBundle('mcp-tool-sweep');
      setItemsText(JSON.stringify(bundle.build(names), null, 2));
      setBundleKey('mcp-tool-sweep');
      setTruncatedNote(names.length > MAX_ITEMS ? `Showing first ${MAX_ITEMS} of ${names.length} tools.` : null);
      setResult(null);
      setErr(null);
    } catch (e) {
      setErr(e.response?.data?.message || e.message);
    } finally {
      setLoadingTools(false);
    }
  }, []);

  const run = useCallback(async () => {
    if (!selectedEndpointId || !parsedItems || parsedItems.length === 0 || overCap) return;
    setRunning(true); setErr(null); setResult(null); setOutputTab('results');
    try {
      const res = await bffAxios.post('/api/authorize/evaluate-endpoint-bulk', {
        endpointId: selectedEndpointId,
        decisionRequests: parsedItems,
      });
      setResult(res.data);
    } catch (e) {
      setErr(e.response?.data?.message || e.response?.data?.error || e.message);
    } finally {
      setRunning(false);
    }
  }, [selectedEndpointId, parsedItems, overCap]);

  const runDisabled = running || loadingEndpoints || !selectedEndpointId
    || !!parseError || !parsedItems || parsedItems.length === 0 || overCap;

  const left = (
    <>
      <div className="inspector-shell-tree-header">Bundles</div>
      <div className="inspector-shell-tree-body">
        {BULK_DECISION_BUNDLES.map((bundle) => (
          <InspectorListItem
            key={bundle.key}
            label={bundle.label}
            active={bundleKey === bundle.key}
            onClick={() => loadBundle(bundle)}
          />
        ))}
      </div>
    </>
  );

  const middle = (
    <>
      <div className="inspector-shell-form-header">
        <div className="inspector-shell-form-header__name">Batch decision requests</div>
        <div className="inspector-shell-form-header__desc">
          {bundleKey
            ? (findBulkDecisionBundle(bundleKey)?.description || '')
            : 'Pick a bundle, click "Load MCP tools", or edit the JSON tab directly.'}
        </div>
      </div>
      <div className="inspector-shell-form-body">
        <div className="inspector-shell-field">
          <label>Decision endpoint<span className="req">*</span></label>
          {loadingEndpoints ? (
            <div className="inspector-shell-form-empty">Loading endpoints…</div>
          ) : endpoints.length === 0 ? (
            <div className="inspector-shell-form-empty">No decision endpoints found in this environment.</div>
          ) : (
            <select value={selectedEndpointId} onChange={(e) => setSelectedEndpointId(e.target.value)}>
              {endpoints.map((ep) => <option key={ep.id} value={ep.id}>{endpointLabel(ep)}</option>)}
            </select>
          )}
        </div>

        <div className="inspector-shell-field">
          <label>Test data</label>
          <button type="button" className="inspector-shell-btn-clear" onClick={loadMcpTools} disabled={loadingTools}>
            {loadingTools ? 'Loading MCP tools…' : 'Load MCP tools'}
          </button>
          {truncatedNote && <span className="type"> {truncatedNote}</span>}
        </div>

        <div className="inspector-shell-field">
          <label>Items</label>
          <span className={overCap ? 'type' : undefined} style={overCap ? { color: '#991b1b', fontWeight: 700 } : undefined}>
            {parsedItems ? parsedItems.length : '—'}/{MAX_ITEMS}{overCap ? ' — exceeds the bulk limit, edit the JSON tab' : ''}
          </span>
        </div>

        {parseError && <div className="inspector-shell-form-error">{parseError}</div>}
      </div>
      <div className="inspector-shell-form-actions">
        <button type="button" className="inspector-shell-btn-call" onClick={run} disabled={runDisabled}>
          {running ? 'Running…' : 'Run bulk decision'}
        </button>
      </div>
    </>
  );

  const results = result?.results || [];

  const right = (
    <>
      <InspectorTabs
        tabs={[
          { key: 'results', label: 'Results' },
          { key: 'response', label: 'Response' },
          { key: 'request', label: 'Request' },
          { key: 'json', label: 'JSON' },
        ]}
        activeKey={outputTab}
        onChange={setOutputTab}
      />
      <div className="inspector-shell-output-body">
        {err && <div className="inspector-shell-form-error">{err}</div>}

        {outputTab === 'results' && (
          result ? (
            <>
              <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '10px' }}>
                correlationId <code>{result.correlationId || '—'}</code>
                {' · '}
                {result.summary?.successful ?? '—'}/{result.summary?.requested ?? '—'} successful
                {result.summary?.errors ? `, ${result.summary.errors} errors` : ''}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '6px' }}>#</th>
                    <th style={{ textAlign: 'left', padding: '6px' }}>Label</th>
                    <th style={{ textAlign: 'left', padding: '6px' }}>Decision</th>
                    <th style={{ textAlign: 'left', padding: '6px' }}>Step-up</th>
                    <th style={{ textAlign: 'left', padding: '6px' }}>Consent</th>
                    <th style={{ textAlign: 'left', padding: '6px' }}>Elapsed µs</th>
                    <th style={{ textAlign: 'left', padding: '6px' }}>Decision ID</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i}>
                      <td style={{ padding: '6px' }}>{r.index + 1}</td>
                      <td style={{ padding: '6px' }}>{r.label || '—'}</td>
                      <td style={{ padding: '6px' }}><span style={decisionBadgeStyle(displayDecision(r))}>{displayDecision(r)}</span></td>
                      <td style={{ padding: '6px' }}>{String(!!r.stepUpRequired)}</td>
                      <td style={{ padding: '6px' }}>{String(!!(r.consentRequired || r.hitlRequired))}</td>
                      <td style={{ padding: '6px' }}>{r.elapsedMicroseconds ?? '—'}</td>
                      <td style={{ padding: '6px', fontFamily: 'monospace' }}>{r.decisionId || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className="inspector-shell-output-empty">Run a batch to see per-item verdicts here.</div>
          )
        )}

        {outputTab === 'response' && (
          result?.pingoneResponse
            ? <pre className="inspector-shell-output-code jh-dark"><JsonHighlight value={result.pingoneResponse} deep /></pre>
            : <div className="inspector-shell-output-empty">No response yet — run a batch first.</div>
        )}

        {outputTab === 'request' && (
          result?.pingoneRequest
            ? <pre className="inspector-shell-output-code jh-dark"><JsonHighlight value={result.pingoneRequest} deep /></pre>
            : <div className="inspector-shell-output-empty">No request yet — run a batch first.</div>
        )}

        {outputTab === 'json' && (
          <>
            <textarea
              value={itemsText}
              onChange={(e) => { setItemsText(e.target.value); setBundleKey(null); }}
              spellCheck={false}
              style={{
                width: '100%', minHeight: '360px', fontFamily: 'monospace', fontSize: '12px',
                padding: '10px', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box',
              }}
            />
          </>
        )}
      </div>
    </>
  );

  return (
    <InspectorShell
      title="Bulk Decisions"
      statusOn={!!selectedEndpointId}
      statusText="LIVE · calls real PingOne"
      fullHeight={false}
      left={left}
      middle={middle}
      right={right}
    />
  );
}
