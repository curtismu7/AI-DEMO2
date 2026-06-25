// demo_api_ui/src/components/OllamaPanel.jsx
import { useState, useEffect, useCallback } from 'react';
import apiClient from '../services/apiClient';
import { notifySuccess, notifyError } from '../utils/appToast';
import './LlmConfig.css';

// Ollama tags (run `ollama pull <model>` first). Small models with native
// tool-calling — qwen3:8b is the recommended default for this demo.
const MODELS = ['qwen3:8b', 'qwen3:4b', 'qwen3:14b', 'llama3.1:8b'];
const DEFAULT_MODEL = 'qwen3:8b';

export default function OllamaPanel() {
  const [status, setStatus] = useState(null);   // null | 'available' | 'unconfigured' | 'unreachable'
  const [reason, setReason] = useState('');
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);

  const checkStatus = useCallback(async () => {
    setChecking(true);
    try {
      const res = await apiClient.get('/api/langchain/provider/ollama/status');
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
      .then(res => { if (res.data?.provider === 'ollama' && res.data?.model) setSelectedModel(res.data.model); })
      .catch(() => {});
    checkStatus();
  }, [checkStatus]);

  const handleSaveModel = async () => {
    setSaving(true);
    try {
      await apiClient.post('/api/langchain/config', { provider: 'ollama', model: selectedModel });
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
    status === 'unconfigured' ? '⚠️ Running — model not pulled' :
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
          <p className="cfg-card-title">Ollama Configuration</p>
          <p className="cfg-card-sub">
            Local small LLM with native tool-calling ·{' '}
            <a href="https://ollama.com/download" target="_blank" rel="noopener noreferrer">
              ollama.com ↗
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
            <p>Getting started with Ollama</p>
            <ol>
              <li>
                Install from{' '}
                <a href="https://ollama.com/download" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>
                  ollama.com/download
                </a>{' '}(or <code>brew install ollama</code>)
              </li>
              <li>Start the daemon: <code className="cfg-code">ollama serve</code> (or <code>brew services start ollama</code>)</li>
              <li>Pull the model: <code className="cfg-code">ollama pull {selectedModel}</code></li>
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
            <label htmlFor="ollama-model" className="cfg-label">Model</label>
            <select
              id="ollama-model"
              className="cfg-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <p className="cfg-hint">Must be pulled locally first: <code>ollama pull {selectedModel}</code></p>
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
          <code className="cfg-code">http://127.0.0.1:11434</code>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: '#94a3b8' }}>
            No API key required. Set <code>OLLAMA_BASE_URL</code> / <code>OLLAMA_MODEL</code> in the
            agent service env to override the defaults.
          </p>
        </div>
      </div>
    </div>
  );
}
