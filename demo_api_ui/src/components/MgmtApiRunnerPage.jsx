// demo_api_ui/src/components/MgmtApiRunnerPage.jsx
//
// Management API Runner — admin inspector for the read/create-cleanup
// operations catalog exposed by demo_api_server's /api/admin/mgmt-api route
// (GET /operations, POST /run). Built on the shared InspectorShell template
// (see .claude/skills/inspector-template): left = operation tree grouped by
// op.group, middle = param form, right = Response/curl tabs.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import InspectorShell from './shared/InspectorShell';
import InspectorTabs from './shared/InspectorTabs';
import InspectorListItem from './shared/InspectorListItem';
import JsonHighlight from './shared/JsonHighlight';
import './shared/InspectorShell.css';

const OPERATIONS_URL = '/api/admin/mgmt-api/operations';
const RUN_URL = '/api/admin/mgmt-api/run';

/** Build the initial param values for a newly-selected operation, resolving
 * the `<ts>` sentinel in text defaults to the current time. */
function buildDefaultParams(op) {
  const values = {};
  for (const p of op.params || []) {
    if (p.type === 'select') {
      values[p.name] = p.options ? (p.default || p.options[0] || '') : '';
    } else {
      values[p.name] = String(p.default || '').replace('<ts>', Date.now());
    }
  }
  return values;
}

export default function MgmtApiRunnerPage() {
  const [operations, setOperations] = useState([]);
  const [opsLoading, setOpsLoading] = useState(true);
  const [opsError, setOpsError] = useState(null);
  const [needsLogin, setNeedsLogin] = useState(false);

  const [selectedKey, setSelectedKey] = useState(null);
  const [paramValues, setParamValues] = useState({});

  const [populations, setPopulations] = useState({ loading: false, loaded: false, options: [], error: null });

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState(null);
  const [result, setResult] = useState(null);
  const [outputTab, setOutputTab] = useState('response');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(OPERATIONS_URL, { credentials: 'include' });
        if (res.status === 401) {
          if (!cancelled) { setNeedsLogin(true); setOpsLoading(false); }
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) { setOperations(data || []); setOpsLoading(false); }
      } catch (e) {
        if (!cancelled) { setOpsError(e.message); setOpsLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Group operations by op.group, preserving catalog order.
  const groups = useMemo(() => {
    const order = [];
    const byGroup = {};
    for (const op of operations) {
      if (!byGroup[op.group]) { byGroup[op.group] = []; order.push(op.group); }
      byGroup[op.group].push(op);
    }
    return order.map((group) => ({ group, ops: byGroup[group] }));
  }, [operations]);

  const selectedOp = useMemo(
    () => operations.find((o) => o.key === selectedKey) || null,
    [operations, selectedKey],
  );

  const loadPopulations = useCallback(async () => {
    setPopulations((p) => ({ ...p, loading: true, error: null }));
    try {
      const res = await fetch(RUN_URL, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operationKey: 'populations_list', params: {} }),
      });
      if (res.status === 401) {
        setNeedsLogin(true);
        setPopulations({ loading: false, loaded: true, options: [], error: null });
        return;
      }
      const data = await res.json();
      const list = data?.response?.populations || [];
      setPopulations({
        loading: false, loaded: true, error: null,
        options: list.map((pop) => ({ value: pop.id, label: pop.name })),
      });
    } catch (e) {
      setPopulations({ loading: false, loaded: true, options: [], error: e.message });
    }
  }, []);

  const selectOperation = useCallback((op) => {
    setSelectedKey(op.key);
    setParamValues(buildDefaultParams(op));
    setResult(null);
    setRunError(null);
    setOutputTab('response');
    const needsPopulations = (op.params || []).some((p) => p.optionsFrom === 'populations_list');
    if (needsPopulations && !populations.loaded && !populations.loading) {
      loadPopulations();
    }
  }, [populations.loaded, populations.loading, loadPopulations]);

  const setParam = (name, value) => setParamValues((v) => ({ ...v, [name]: value }));

  const run = useCallback(async () => {
    if (!selectedOp) return;
    setRunning(true);
    setRunError(null);
    try {
      const res = await fetch(RUN_URL, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operationKey: selectedOp.key, params: paramValues }),
      });
      if (res.status === 401) { setNeedsLogin(true); return; }
      const data = await res.json();
      setResult(data);
      setOutputTab('response');
    } catch (e) {
      setRunError(e.message);
    } finally {
      setRunning(false);
    }
  }, [selectedOp, paramValues]);

  const copyCurl = useCallback(() => {
    if (!result?.curl) return;
    navigator.clipboard.writeText(result.curl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [result]);

  if (needsLogin) {
    return (
      <InspectorShell
        title="Management API Runner"
        statusOn={false}
        statusText="Sign in required"
        left={<div className="inspector-shell-tree-header"><span>Operations</span></div>}
        middle={<div className="inspector-shell-form-empty">Please sign in as admin.</div>}
        right={<div className="inspector-shell-output-empty">Please sign in as admin.</div>}
      />
    );
  }

  const statusOn = !opsLoading && !opsError;
  const statusText = opsError ? opsError : opsLoading ? 'Loading…' : 'Ready';

  return (
    <InspectorShell
      title="Management API Runner"
      statusOn={statusOn}
      statusText={statusText}
      left={
        <>
          <div className="inspector-shell-tree-header"><span>Operations ({operations.length})</span></div>
          <div className="inspector-shell-tree-body">
            {opsLoading ? (
              <div style={{ padding: '20px 16px', color: '#64748b', fontSize: 13 }}>Loading…</div>
            ) : opsError ? (
              <div style={{ padding: '20px 16px', color: '#991b1b', fontSize: 13 }}>⚠️ {opsError}</div>
            ) : groups.length === 0 ? (
              <div style={{ padding: '20px 16px', color: '#64748b', fontSize: 13 }}>No operations available.</div>
            ) : (
              groups.map(({ group, ops }) => (
                <div key={group}>
                  <div className="inspector-shell-tree-group__label">{group} ({ops.length})</div>
                  {ops.map((op) => (
                    <InspectorListItem
                      key={op.key}
                      label={op.label}
                      active={selectedKey === op.key}
                      dot={op.mutates ? 'write' : 'default'}
                      badges={op.mutates ? ['write'] : []}
                      onClick={() => selectOperation(op)}
                    />
                  ))}
                </div>
              ))
            )}
          </div>
        </>
      }
      middle={
        selectedOp ? (
          <>
            <div className="inspector-shell-form-header">
              <div className="inspector-shell-form-header__name">{selectedOp.label}</div>
              <div className="inspector-shell-form-header__desc">{selectedOp.method} {selectedOp.path}</div>
            </div>
            <div className="inspector-shell-form-body">
              {(selectedOp.params || []).map((p) => (
                <div className="inspector-shell-field" key={p.name}>
                  <label htmlFor={`mgmt-api-param-${p.name}`}>{p.name}</label>
                  {p.type === 'select' ? (
                    <select
                      id={`mgmt-api-param-${p.name}`}
                      value={paramValues[p.name] ?? ''}
                      onChange={(e) => setParam(p.name, e.target.value)}
                    >
                      {p.optionsFrom === 'populations_list' ? (
                        <>
                          <option value="">
                            {populations.loading ? 'Loading populations…' : 'Select a population'}
                          </option>
                          {populations.options.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </>
                      ) : (
                        (p.options || []).map((o) => <option key={o} value={o}>{o}</option>)
                      )}
                    </select>
                  ) : (
                    <input
                      id={`mgmt-api-param-${p.name}`}
                      type="text"
                      value={paramValues[p.name] ?? ''}
                      onChange={(e) => setParam(p.name, e.target.value)}
                    />
                  )}
                </div>
              ))}
              {(selectedOp.params || []).length === 0 && (
                <div style={{ color: '#64748b', fontSize: 13 }}>No parameters required.</div>
              )}
              {populations.error && (selectedOp.params || []).some((p) => p.optionsFrom === 'populations_list') && (
                <div style={{ color: '#991b1b', fontSize: 12, marginTop: 8 }}>
                  ⚠️ Failed to load populations: {populations.error}
                </div>
              )}
            </div>
            <div className="inspector-shell-form-actions">
              <button type="button" className="inspector-shell-btn-call" onClick={run} disabled={running}>
                {running ? 'Running…' : 'Execute'}
              </button>
              {runError && <span className="inspector-shell-form-error">⚠️ {runError}</span>}
            </div>
          </>
        ) : (
          <div className="inspector-shell-form-empty">Select an operation from the tree to run it.</div>
        )
      }
      right={
        <>
          <InspectorTabs
            tabs={[{ key: 'response', label: 'Response' }, { key: 'curl', label: 'curl' }]}
            activeKey={outputTab}
            onChange={setOutputTab}
          />
          <div className="inspector-shell-output-body">
            {outputTab === 'response' ? (
              result ? (
                <>
                  {result.cleanedUp === false && result.warning && (
                    <div
                      style={{
                        background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b',
                        borderRadius: 6, padding: '10px 14px', marginBottom: 12, fontSize: 13,
                      }}
                    >
                      {result.warning}
                    </div>
                  )}
                  {(result.steps || []).map((step) => (
                    <div key={step.label} style={{ marginBottom: 16 }}>
                      <div style={{ fontFamily: "'SF Mono', monospace", fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                        {step.label} &rarr; {step.status}
                      </div>
                      <pre className="inspector-shell-output-code">
                        <JsonHighlight value={step.body} deep />
                      </pre>
                    </div>
                  ))}
                </>
              ) : (
                <div className="inspector-shell-output-empty">Select an operation and click Execute to see the response here.</div>
              )
            ) : (
              result ? (
                <>
                  <button type="button" className="inspector-shell-btn-clear" onClick={copyCurl} style={{ marginBottom: 10 }}>
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                  <pre className="inspector-shell-output-code">{result.curl}</pre>
                </>
              ) : (
                <div className="inspector-shell-output-empty">Execute an operation to see the equivalent curl command.</div>
              )
            )}
          </div>
        </>
      }
    />
  );
}
