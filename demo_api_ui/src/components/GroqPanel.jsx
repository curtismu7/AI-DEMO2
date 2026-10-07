// demo_api_ui/src/components/GroqPanel.jsx
import { useState, useEffect } from 'react';
import apiClient from '../services/apiClient';
import { notifySuccess, notifyError } from '../utils/appToast';
import './LlmConfig.css';

const DEFAULT_MODEL = 'openai/gpt-oss-20b';

export default function GroqPanel() {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [models, setModels] = useState([DEFAULT_MODEL]);
  const [keySet, setKeySet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    apiClient.get('/api/langchain/config/status')
      .then(res => {
        const cfg = res.data;
        setKeySet(!!(cfg.key_set?.groq));
        // The server owns the model list; cfg.model belongs to whichever provider is active.
        const list = cfg.provider_models?.groq?.length ? cfg.provider_models.groq : [DEFAULT_MODEL];
        setModels(list);
        setModel(list.includes(cfg.model) ? cfg.model : (cfg.default_models?.groq || DEFAULT_MODEL));
      })
      .catch(err => console.warn('[GroqPanel] config load failed:', err.message));
  }, []);

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      const res = await apiClient.post('/api/langchain/config', {
        key_type: 'groq',
        key: apiKey.trim(),
        provider: 'groq',
        model,
      });
      setKeySet(!!(res.data?.key_set?.groq));
      setApiKey('');
      notifySuccess('Groq API key saved');
    } catch (err) {
      notifyError(`Failed to save key: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async () => {
    setClearing(true);
    try {
      await apiClient.delete('/api/langchain/config/key/groq');
      setKeySet(false);
      notifySuccess('Groq API key cleared');
    } catch (err) {
      notifyError(`Failed to clear key: ${err.message}`);
    } finally {
      setClearing(false);
    }
  };

  const handleSaveModel = async () => {
    setSaving(true);
    try {
      await apiClient.post('/api/langchain/config', { provider: 'groq', model });
      notifySuccess(`Model set to ${model}`);
    } catch (err) {
      notifyError(`Failed to save model: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cfg-card">
      <div className="cfg-card-header">
        <div>
          <p className="cfg-card-title">Groq Configuration</p>
          <p className="cfg-card-sub">
            GroqCloud API ·{' '}
            <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">
              console.groq.com ↗
            </a>
          </p>
        </div>
        <span className={`cfg-badge${keySet ? ' cfg-badge--active' : ' cfg-badge--unconfigured'}`}>
          {keySet ? 'Configured' : 'Unconfigured'}
        </span>
      </div>

      <div className="cfg-card-body">
        <div className="cfg-grid">
          <div className="cfg-field cfg-field--full">
            <label className="cfg-label" htmlFor="groq-api-key">API Key</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                id="groq-api-key"
                type="password"
                className="cfg-input"
                placeholder={keySet ? 'Key saved — enter new key to rotate' : 'gsk_…'}
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
              {keySet ? '✅ API key is configured' : '⚠️ No API key — get one at the Groq console'}
            </p>
            <p className="cfg-hint">Key is stored server-side only — never sent to the browser.</p>
          </div>

          <div className="cfg-field cfg-field--full">
            <label className="cfg-label" htmlFor="groq-model">Model</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <select
                id="groq-model"
                className="cfg-select"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
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
          </div>
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
