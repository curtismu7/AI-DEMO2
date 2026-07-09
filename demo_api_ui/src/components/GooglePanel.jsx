// demo_api_ui/src/components/GooglePanel.jsx
import { useState, useEffect } from 'react';
import apiClient from '../services/apiClient';
import { notifySuccess, notifyError } from '../utils/appToast';
import './LlmConfig.css';

const MODELS = [
  'gemini-2.0-flash',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
];
const DEFAULT_MODEL = 'gemini-2.0-flash';

export default function GooglePanel() {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [keySet, setKeySet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    apiClient.get('/api/langchain/config/status')
      .then(res => {
        const cfg = res.data;
        setKeySet(!!(cfg.key_set?.google));
        setModel(cfg.model || DEFAULT_MODEL);
      })
      .catch(err => console.warn('[GooglePanel] config load failed:', err.message));
  }, []);

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      const res = await apiClient.post('/api/langchain/config', {
        key_type: 'google',
        key: apiKey.trim(),
        provider: 'google',
        model,
      });
      setKeySet(!!(res.data?.key_set?.google));
      setApiKey('');
      notifySuccess('Google API key saved');
    } catch (err) {
      notifyError(`Failed to save key: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async () => {
    setClearing(true);
    try {
      await apiClient.delete('/api/langchain/config/key/google');
      setKeySet(false);
      notifySuccess('Google API key cleared');
    } catch (err) {
      notifyError(`Failed to clear key: ${err.message}`);
    } finally {
      setClearing(false);
    }
  };

  const handleSaveModel = async () => {
    setSaving(true);
    try {
      await apiClient.post('/api/langchain/config', { provider: 'google', model });
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
          <p className="cfg-card-title">Google Configuration</p>
          <p className="cfg-card-sub">
            Gemini API ·{' '}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">
              aistudio.google.com ↗
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
            <label className="cfg-label" htmlFor="google-api-key">API Key</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                id="google-api-key"
                type="password"
                className="cfg-input"
                placeholder={keySet ? 'Key saved — enter new key to rotate' : 'AQ.… or AIza…'}
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
              {keySet ? '✅ API key is configured' : '⚠️ No API key — get one at Google AI Studio'}
            </p>
            <p className="cfg-hint">Key is stored server-side only — never sent to the browser.</p>
          </div>

          <div className="cfg-field cfg-field--full">
            <label className="cfg-label" htmlFor="google-model">Model</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <select
                id="google-model"
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
            <p className="cfg-hint">New AI Studio keys use the AQ. auth-key format.</p>
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
