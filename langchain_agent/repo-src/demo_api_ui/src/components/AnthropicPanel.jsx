// demo_api_ui/src/components/AnthropicPanel.jsx
import { useState, useEffect } from 'react';
import apiClient from '../services/apiClient';
import { notifySuccess, notifyError } from '../utils/appToast';
import './LlmConfig.css';

const MODELS = [
  'claude-opus-4-5',
  'claude-sonnet-4-5',
  'claude-3-5-haiku-20241022',
];
const DEFAULT_MODEL = 'claude-3-5-haiku-20241022';

export default function AnthropicPanel() {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [baseUrl, setBaseUrl] = useState('');
  const [keySet, setKeySet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    apiClient.get('/api/langchain/config/status')
      .then(res => {
        const cfg = res.data;
        setKeySet(!!(cfg.key_set?.anthropic));
        setModel(cfg.model || DEFAULT_MODEL);
      })
      .catch(err => console.warn('[AnthropicPanel] config load failed:', err.message));
  }, []);

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      const body = { key_type: 'anthropic', key: apiKey.trim(), provider: 'anthropic', model };
      if (baseUrl.trim()) body.anthropic_base_url = baseUrl.trim();
      const res = await apiClient.post('/api/langchain/config', body);
      setKeySet(!!(res.data?.key_set?.anthropic));
      setApiKey('');
      notifySuccess('Anthropic API key saved');
    } catch (err) {
      notifyError(`Failed to save key: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async () => {
    setClearing(true);
    try {
      await apiClient.delete('/api/langchain/config/key/anthropic');
      setKeySet(false);
      notifySuccess('Anthropic API key cleared');
    } catch (err) {
      notifyError(`Failed to clear key: ${err.message}`);
    } finally {
      setClearing(false);
    }
  };

  const handleSaveModel = async () => {
    setSaving(true);
    try {
      await apiClient.post('/api/langchain/config', { provider: 'anthropic', model });
      notifySuccess(`Model set to ${model}`);
    } catch (err) {
      notifyError(`Failed to save model: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cfg-card">
      {/* Card header */}
      <div className="cfg-card-header">
        <div>
          <p className="cfg-card-title">Anthropic Configuration</p>
          <p className="cfg-card-sub">
            Cloud API ·{' '}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">
              console.anthropic.com ↗
            </a>
          </p>
        </div>
        <span className={`cfg-badge${keySet ? ' cfg-badge--active' : ' cfg-badge--unconfigured'}`}>
          {keySet ? 'Configured' : 'Unconfigured'}
        </span>
      </div>

      {/* Card body */}
      <div className="cfg-card-body">
        <div className="cfg-grid">
          {/* API Key */}
          <div className="cfg-field cfg-field--full">
            <label className="cfg-label" htmlFor="anthropic-api-key">API Key</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                id="anthropic-api-key"
                type="password"
                className="cfg-input"
                placeholder={keySet ? 'Key saved — enter new key to rotate' : 'sk-ant-…'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <button
                type="button"
                className="cfg-btn cfg-btn--primary"
                style={{ flexShrink: 0 }}
                disabled={saving || !apiKey.trim()}
                onClick={handleSaveKey}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
            <p className="cfg-hint">
              {keySet ? '✅ API key is configured' : '⚠️ No API key — get one at console.anthropic.com'}
            </p>
            <p className="cfg-hint">Key is stored server-side only — never sent to the browser.</p>
          </div>

          {/* Model */}
          <div className="cfg-field cfg-field--full">
            <label className="cfg-label" htmlFor="anthropic-model">Model</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <select
                id="anthropic-model"
                className="cfg-select"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <button
                type="button"
                className="cfg-btn cfg-btn--secondary"
                style={{ flexShrink: 0 }}
                disabled={saving}
                onClick={handleSaveModel}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
            <p className="cfg-hint">Claude 4 models require Claude 4 API access.</p>
          </div>

          {/* Base URL override */}
          <div className="cfg-field cfg-field--full">
            <label className="cfg-label" htmlFor="anthropic-base-url">
              Base URL Override
              <span className="cfg-label-opt">(optional)</span>
            </label>
            <input
              id="anthropic-base-url"
              type="text"
              className="cfg-input"
              placeholder="Leave blank to use api.anthropic.com (default)"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <p className="cfg-hint">
              Set to <code>http://localhost:1234</code> to route through LM Studio locally.
            </p>
          </div>
        </div>

        {/* Info box */}
        <div className="cfg-info-panel">
          <strong>Two modes</strong>
          <ul>
            <li><strong>Cloud</strong> — real API key, blank Base URL → calls api.anthropic.com</li>
            <li><strong>Local proxy</strong> — any key value, Base URL = <code>http://localhost:1234</code> → routes through LM Studio</li>
          </ul>
        </div>

        <hr className="cfg-divider" style={{ marginTop: '1.25rem' }} />

        <div className="cfg-actions">
          {keySet && (
            <button
              type="button"
              className="cfg-btn cfg-btn--danger"
              disabled={clearing}
              onClick={handleClearKey}
            >
              {clearing ? '…' : 'Clear Key'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
