// MCP Inspector — Clean Design
// Modern minimal three-pane layout with movie reel history and expanded tabs
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import apiClient from '../services/apiClient';
import { notifyError } from '../utils/appToast';
import { formatAxiosError } from '../utils/formatAxiosError';
import JsonHighlight from './shared/JsonHighlight';
import './McpInspectorPage.clean.css';

const SOURCES = [
  { key: 'banking', label: 'AI Demo MCP' },
  { key: 'pingone', label: 'PingOne MCP' },
  { key: 'api', label: 'API Calls' },
  { key: 'custom', label: 'Custom Server' },
  { key: 'protocol', label: 'Protocol' },
];

const OUTPUT_TABS = [
  { key: 'response', label: 'Response' },
  { key: 'request', label: 'Request' },
  { key: 'schema', label: 'Schema' },
  { key: 'timing', label: 'Timing' },
  { key: 'headers', label: 'Headers' },
];

function McpInspectorPageClean() {
  const [searchParams] = useSearchParams();
  const [activeSource, setActiveSource] = useState(searchParams.get('source') || 'pingone');

  // Form state
  const [selectedMethod, setSelectedMethod] = useState(null);
  const [fieldValues, setFieldValues] = useState({});
  const [outputTab, setOutputTab] = useState('response');
  const [busy, setBusy] = useState(false);

  // Output state
  const [lastRequest, setLastRequest] = useState(null);
  const [lastResponse, setLastResponse] = useState(null);
  const [lastTiming, setLastTiming] = useState(null);
  const [lastHeaders, setLastHeaders] = useState(null);

  // Call history (movie reel)
  const [callHistory, setCallHistory] = useState([]);
  const [activeHistoryId, setActiveHistoryId] = useState(null);

  // Mock method list (replace with actual data source)
  const methods = useMemo(() => [
    {
      method: 'get_balance',
      fields: [
        { key: 'account_id', label: 'Account ID', type: 'string', required: true },
        { key: 'include_pending', label: 'Include Pending', type: 'boolean' },
      ],
    },
    {
      method: 'list_accounts',
      fields: [
        { key: 'limit', label: 'Limit', type: 'number' },
        { key: 'offset', label: 'Offset', type: 'number' },
      ],
    },
    {
      method: 'get_transaction',
      fields: [
        { key: 'transaction_id', label: 'Transaction ID', type: 'string', required: true },
      ],
    },
  ], []);

  const handleExecute = useCallback(async () => {
    if (!selectedMethod) return;

    setBusy(true);
    try {
      const start = performance.now();

      // Mock call for demo
      const mockRequest = {
        method: selectedMethod.method,
        params: fieldValues,
      };

      const mockResponse = {
        success: true,
        data: {
          message: `Called ${selectedMethod.method}`,
          timestamp: new Date().toISOString(),
        },
      };

      const duration = Math.round(performance.now() - start);

      setLastRequest(mockRequest);
      setLastResponse(mockResponse);
      setLastTiming({ ms: duration, error: false });
      setLastHeaders({ 'Authorization': 'Bearer token_xxx', 'Protocol-Version': '2.0' });
      setOutputTab('response');

      // Add to history
      const historyEntry = {
        id: Date.now(),
        method: selectedMethod.method,
        duration,
        status: '200 OK',
        request: mockRequest,
        response: mockResponse,
        headers: { 'Authorization': 'Bearer token_xxx', 'Protocol-Version': '2.0' },
      };

      setCallHistory(prev => [historyEntry, ...prev].slice(0, 20));
      setActiveHistoryId(historyEntry.id);
    } catch (err) {
      notifyError(formatAxiosError(err) || 'Call failed');
      setLastTiming({ error: true });
    } finally {
      setBusy(false);
    }
  }, [selectedMethod, fieldValues]);

  const selectHistoryEntry = useCallback((entryId) => {
    const entry = callHistory.find(h => h.id === entryId);
    if (entry) {
      setSelectedMethod(methods.find(m => m.method === entry.method));
      setLastRequest(entry.request);
      setLastResponse(entry.response);
      setLastHeaders(entry.headers);
      setLastTiming({ ms: entry.duration, error: false });
      setActiveHistoryId(entryId);
      setOutputTab('response');
    }
  }, [callHistory, methods]);

  const outputContent = useMemo(() => {
    switch (outputTab) {
      case 'response':
        return lastResponse ? JSON.stringify(lastResponse, null, 2) : null;
      case 'request':
        return lastRequest ? JSON.stringify(lastRequest, null, 2) : null;
      case 'schema':
        return selectedMethod ? JSON.stringify({
          inputs: selectedMethod.fields.reduce((acc, f) => {
            acc[f.key] = f.type;
            return acc;
          }, {}),
          outputs: { success: 'boolean', data: 'object' },
        }, null, 2) : null;
      case 'timing':
        return lastTiming ? `Duration: ${lastTiming.ms}ms\nParse: 2ms\nExecute: ${lastTiming.ms - 4}ms\nSerialize: 2ms` : null;
      case 'headers':
        return lastHeaders ? JSON.stringify(lastHeaders, null, 2) : null;
      default:
        return null;
    }
  }, [outputTab, lastResponse, lastRequest, lastTiming, lastHeaders, selectedMethod]);

  return (
    <div className="inspector-clean-page">
      <div className="inspector-clean-header">
        <h1 className="inspector-clean-title">MCP Inspector</h1>
        <div className="inspector-clean-tabs">
          {SOURCES.map((s) => (
            <button
              key={s.key}
              className={`inspector-clean-tab ${activeSource === s.key ? 'active' : ''}`}
              onClick={() => setActiveSource(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="inspector-clean-content">
        <div className="inspector-clean-main">
          {/* Left: Method Tree */}
          <div className="inspector-clean-panel">
            <div className="inspector-clean-panel-header">
              <div className="inspector-clean-panel-label">Methods</div>
            </div>
            <div className="inspector-clean-panel-body">
              {methods.map((m) => (
                <div key={m.method} className="inspector-clean-tree-group">
                  <div
                    className={`inspector-clean-item ${selectedMethod?.method === m.method ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedMethod(m);
                      setFieldValues({});
                      setLastRequest(null);
                      setLastResponse(null);
                    }}
                  >
                    {m.method}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Middle: Form */}
          <div className="inspector-clean-panel">
            <div className="inspector-clean-panel-header">
              <div className="inspector-clean-panel-label">Parameters</div>
            </div>
            <div className="inspector-clean-panel-body">
              {selectedMethod ? (
                <div className="inspector-clean-form">
                  <div className="inspector-clean-form-section">
                    <div className="inspector-clean-section-title">Call: {selectedMethod.method}</div>
                    {selectedMethod.fields.map((f) => (
                      <div key={f.key} className="inspector-clean-field">
                        <div className="inspector-clean-field-label">
                          <span>{f.label}{f.required ? ' *' : ''}</span>
                          <span className="inspector-clean-field-type">{f.type}</span>
                        </div>
                        <input
                          type="text"
                          placeholder={f.label}
                          value={fieldValues[f.key] || ''}
                          onChange={(e) => setFieldValues(prev => ({
                            ...prev,
                            [f.key]: e.target.value,
                          }))}
                        />
                      </div>
                    ))}
                  </div>
                  <button
                    className="inspector-clean-button"
                    onClick={handleExecute}
                    disabled={busy}
                  >
                    {busy ? 'Calling...' : 'Execute Call'}
                  </button>
                </div>
              ) : (
                <div style={{ color: 'var(--inspector-text-secondary)', padding: '20px', textAlign: 'center' }}>
                  Select a method to see parameters
                </div>
              )}
            </div>
          </div>

          {/* Right: Output */}
          <div className="inspector-clean-panel">
            <div className="inspector-clean-panel-header">
              <div className="inspector-clean-panel-label">Output</div>
            </div>
            <div className="inspector-clean-panel-body">
              <div className="inspector-clean-output">
                <div className="inspector-clean-output-tabs">
                  {OUTPUT_TABS.map((t) => (
                    <button
                      key={t.key}
                      className={`inspector-clean-output-tab ${outputTab === t.key ? 'active' : ''}`}
                      onClick={() => setOutputTab(t.key)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                {outputContent ? (
                  <>
                    <pre className="inspector-clean-code">{outputContent}</pre>
                    <div className="inspector-clean-meta">
                      <div className="inspector-clean-meta-item">
                        <div className="inspector-clean-meta-label">Status</div>
                        <div className="inspector-clean-meta-value">
                          {lastTiming?.error ? 'Error' : lastTiming ? '200 OK' : '-'}
                        </div>
                      </div>
                      <div className="inspector-clean-meta-item">
                        <div className="inspector-clean-meta-label">Duration</div>
                        <div className="inspector-clean-meta-value">
                          {lastTiming?.ms != null ? `${lastTiming.ms}ms` : '-'}
                        </div>
                      </div>
                      <div className="inspector-clean-meta-item">
                        <div className="inspector-clean-meta-label">Transport</div>
                        <div className="inspector-clean-meta-value">WebSocket</div>
                      </div>
                      <div className="inspector-clean-meta-item">
                        <div className="inspector-clean-meta-label">Size</div>
                        <div className="inspector-clean-meta-value">
                          {outputContent ? Math.ceil(outputContent.length / 10) * 10 + 'B' : '-'}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div style={{ color: 'var(--inspector-text-secondary)', padding: '20px', textAlign: 'center' }}>
                    {selectedMethod ? 'Click Execute to see the response' : 'Select and execute a method'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Movie Reel */}
        <div className="inspector-clean-reel">
          <div className="inspector-clean-reel-label">History</div>
          {callHistory.length === 0 ? (
            <div style={{ color: 'var(--inspector-text-tertiary)', fontSize: '11px' }}>No calls yet</div>
          ) : (
            callHistory.map((entry) => (
              <button
                key={entry.id}
                className={`inspector-clean-reel-frame ${activeHistoryId === entry.id ? 'active' : ''}`}
                onClick={() => selectHistoryEntry(entry.id)}
              >
                {entry.method} ({entry.duration}ms)
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default McpInspectorPageClean;
