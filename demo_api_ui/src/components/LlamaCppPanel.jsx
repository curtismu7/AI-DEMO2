// demo_api_ui/src/components/LlamaCppPanel.jsx
import { useState, useEffect, useCallback } from 'react';
import apiClient from '../services/apiClient';
import { notifySuccess, notifyError } from '../utils/appToast';
import './LlmConfig.css';

// Model ids reported by llama-server via /v1/models (the model it was launched
// with). Small models with native tool-calling — qwen3-8b is the recommended
// default for this demo.
const MODELS = ['qwen3-8b', 'qwen3-4b', 'qwen3-14b', 'llama-3.1-8b-instruct'];
const DEFAULT_MODEL = 'qwen3-8b';

export default function LlamaCppPanel() {
  const [status, setStatus] = useState(null);   // null | 'available' | 'unconfigured' | 'unreachable'
  const [reason, setReason] = useState('');
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);

  const checkStatus = useCallback(async () => {
    setChecking(true);
    try {
      const res = await apiClient.get('/api/langchain/provider/llamacpp/status');
      setStatus(res.data?.status ?? null);
      setReason(res.data?.reason ?? '');
    } catch (err) {
      setStatus('unreachable');
      setReason(err.message);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    apiClient.get('/api/langchain/config/status')
      .then(res => { if (res.data?.provider === 'llamacpp' && res.data?.model) setSelectedModel(res.data.model); })
      .catch(() => {});
    checkStatus();
  }, [checkStatus]);

  const handleSaveModel = async () => {
    setSaving(true);
    try {
      await apiClient.post('/api/langchain/config', { provider: 'llamacpp', model: selectedModel });
      notifySuccess(`Model set to ${selectedModel}`);
      await checkStatus();
    } catch (err) {
      notifyError(`Failed to save model: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const statusLabel =
    status === 'available'   ? '✅ Running — model available' :
    status === 'unconfigured' ? '⚠️ Running — no model loaded' :
    status === 'unreachable'  ? '❌ Not reachable' :
    checking ? '…' : '⚠️ Unknown';

  const badgeClass =
    status === 'available'   ? ' cfg-badge--active' :
    status === 'unreachable' ? ' cfg-badge--unreachable' :
    ' cfg-badge--loading';

  return (
    <div className="cfg-card">
      <div className="cfg-card-header">
        <div>
          <p className="cfg-card-title">llama.cpp Configuration</p>
          <p className="cfg-card-sub">
            Local small LLM with native tool-calling ·{' '}
            <a href="https://github.com/ggml-org/llama.cpp" target="_blank" rel="noopener noreferrer">
              llama.cpp ↗
            </a>
          </p>
        </div>
        <span className={`cfg-badge${badgeClass}`}>
          {status === 'available'   && 'Running'}
          {status === 'unconfigured' && 'No model'}
          {status === 'unreachable'  && 'Unreachable'}
          {(!status || checking)     && '…'}
        </span>
      </div>

      <div className="cfg-card-body">
        {status !== 'available' && (
          <div className="cfg-setup-box">
            <p>Getting started with llama.cpp</p>
            <ol>
              <li>
                Install from{' '}
                <a href="https://github.com/ggml-org/llama.cpp" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>
                  github.com/ggml-org/llama.cpp
                </a>{' '}(or <code>brew install llama.cpp</code>)
              </li>
              <li>Start the server on port 8090: <code className="cfg-code">llama-server -hf {selectedModel} --port 8090</code></li>
              <li>It exposes an OpenAI-compatible <code>/v1</code> API; the model is whatever you launch it with.</li>
              <li>Click <strong>Check Status</strong> below.</li>
            </ol>
          </div>
        )}

        <div className="cfg-status-row">
          <span className={`cfg-badge${badgeClass}`} style={{ borderRadius: '8px' }}>
            {statusLabel}
          </span>
          <button type="button" className="cfg-btn cfg-btn--secondary" onClick={checkStatus} disabled={checking}>
            {checking ? '…' : 'Check Status'}
          </button>
        </div>
        {reason && <p className="cfg-hint" style={{ marginTop: '0.5rem' }}>{reason}</p>}

        <div className="cfg-grid" style={{ marginTop: '1.25rem', marginBottom: '1rem' }}>
          <div className="cfg-field cfg-field--full">
            <label htmlFor="llamacpp-model" className="cfg-label">Model</label>
            <select
              id="llamacpp-model"
              className="cfg-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <p className="cfg-hint">Must match the model llama-server was launched with (its <code>/v1/models</code> id).</p>
          </div>
        </div>

        <hr className="cfg-divider" />
        <div className="cfg-actions">
          <button type="button" className="cfg-btn cfg-btn--secondary" onClick={handleSaveModel} disabled={saving}>
            {saving ? 'Saving…' : 'Save Model'}
          </button>
        </div>

        <div className="cfg-info-panel" style={{ marginTop: '1.25rem' }}>
          <strong>OpenAI-compatible endpoint</strong>
          <code className="cfg-code">http://127.0.0.1:8090/v1</code>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: '#94a3b8' }}>
            No API key required. Set <code>LLAMACPP_BASE_URL</code> (origin only) / <code>LLAMACPP_MODEL</code> in the
            agent service env to override the defaults.
          </p>
        </div>
      </div>
    </div>
  );
}
