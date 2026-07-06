import React, { useState, useEffect } from 'react';
import './LlmConfigPanel.css';

/**
 * LlmConfigPanel — Configuration UI for LLM provider selection and fallback chain
 *
 * Features:
 * - Provider selector with status badges (✅ Available, ⚠️ Unconfigured, ❌ Unreachable)
 * - Provider-specific config fields (API keys, base URL)
 * - Editable fallback chain with drag-to-reorder (or up/down buttons)
 * - Real-time status checks for each provider
 * - Session persistence (config saved to session on dropdown/save)
 */
export default function LlmConfigPanel() {
  const [currentProvider, setCurrentProvider] = useState('groq');
  const [currentModel, setCurrentModel] = useState('');
  const [providerModels, setProviderModels] = useState({});
  const [defaultModels, setDefaultModels] = useState({});
  const [keySet, setKeySet] = useState({});
  const [apiKeys, setApiKeys] = useState({});
  const [fallbackChain, setFallbackChain] = useState(['groq', 'anthropic', 'openai', 'google']);
  const [providerStatus, setProviderStatus] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [draggedItem, setDraggedItem] = useState(null);
  const [tiers, setTiers] = useState(null);
  const [prewarming, setPrewarming] = useState(null);

  const PROVIDERS = ['groq', 'openai', 'anthropic', 'google'];

  // Load config on mount
  useEffect(() => {
    loadConfig();
    loadTiers();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load config from API
  const loadConfig = async () => {
    try {
      const response = await fetch('/api/langchain/config/status');
      if (!response.ok) throw new Error('Failed to load config');

      const config = await response.json();
      setCurrentProvider(config.provider || 'groq');
      setCurrentModel(config.model || '');
      setProviderModels(config.provider_models || {});
      setDefaultModels(config.default_models || {});
      setKeySet(config.key_set || {});
      if (Array.isArray(config.fallback_order) && config.fallback_order.length) {
        setFallbackChain(config.fallback_order);
      }

      // Load provider status for each provider
      await loadProviderStatuses();
    } catch (error) {
      console.error('[LlmConfigPanel] Failed to load config:', error);
      setMessage('Error loading configuration');
    } finally {
      setLoading(false);
    }
  };

  // Load provider status for all providers
  const loadProviderStatuses = async () => {
    const statuses = {};
    for (const provider of PROVIDERS) {
      try {
        const response = await fetch(`/api/langchain/provider/${provider}/status`);
        if (response.ok) {
          const data = await response.json();
          statuses[provider] = data;
        }
      } catch (error) {
        console.error(`[LlmConfigPanel] Failed to load status for ${provider}:`, error);
        statuses[provider] = { status: 'unreachable', reason: 'Status check failed' };
      }
    }
    setProviderStatus(statuses);
  };

  // Load local llama.cpp tier state (swap mode: one model loaded at a time).
  // Section stays hidden when the local proxy isn't running.
  const loadTiers = async () => {
    try {
      const response = await fetch('/api/langchain/llamacpp/tiers');
      if (response.ok) setTiers(await response.json());
    } catch {
      /* local LLM proxy not running — tier section hidden */
    }
  };

  // A tier counts as loaded for a pick-list model if a healthy tier's name
  // shares the model's family prefix (e.g. phi-4-mini-instruct ↔ phi-4-mini).
  const isTierLoaded = (model) => {
    if (!tiers?.models) return false;
    const family = model.replace(/-it$/, '');
    return tiers.models.some(m => m.healthy && (m.name.startsWith(family) || family.startsWith(m.name)));
  };

  // Pre-warm: swap the requested model in NOW so the next demo request
  // doesn't pay the model-load pause. Idle decay still drops back to the
  // smallest tier after ~5 quiet minutes.
  const handlePrewarm = async (model) => {
    try {
      setPrewarming(model);
      setMessage(`Loading ${model}… (can take up to ~30s cold)`);
      const response = await fetch('/api/langchain/llamacpp/prewarm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      if (!response.ok) throw new Error('Pre-warm failed');
      setMessage(`✓ ${model} loaded and serving`);
      setTimeout(() => setMessage(''), 4000);
    } catch (error) {
      console.error('[LlmConfigPanel] Pre-warm failed:', error);
      setMessage(`Error pre-warming ${model}`);
    } finally {
      setPrewarming(null);
      loadTiers();
    }
  };

  // Save provider selection
  const handleProviderSelect = async (provider) => {
    setCurrentProvider(provider);
    // Switch to the new provider's default model — keeping the previous
    // provider's model would post an invalid provider/model pair (e.g. a Groq
    // model name to OpenAI). Only fall back to the existing model if the new
    // provider has no known default.
    const model = defaultModels[provider] || currentModel || '';
    setCurrentModel(model);

    try {
      setSaving(true);
      const response = await fetch('/api/langchain/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model }),
      });

      if (!response.ok) throw new Error('Failed to save provider');

      setMessage(`✓ Switched to ${provider}`);
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error('[LlmConfigPanel] Failed to save provider:', error);
      setMessage('Error saving provider');
    } finally {
      setSaving(false);
    }
  };

  // Save API key
  const handleSaveKey = async (keyType) => {
    const key = apiKeys[keyType];

    if (!key) {
      setMessage(`${keyType} key is empty`);
      return;
    }

    try {
      setSaving(true);
      const response = await fetch('/api/langchain/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key_type: keyType, key }),
      });

      if (!response.ok) throw new Error('Failed to save key');

      setKeySet(prev => ({ ...prev, [keyType]: true }));
      setApiKeys(prev => ({ ...prev, [keyType]: '' })); // Clear input after save
      setMessage(`✓ ${keyType} API key saved`);
      setTimeout(() => setMessage(''), 3000);

      // Refresh status
      await loadProviderStatuses();
    } catch (error) {
      console.error('[LlmConfigPanel] Failed to save key:', error);
      setMessage('Error saving API key');
    } finally {
      setSaving(false);
    }
  };

  // Clear API key
  const handleClearKey = async (keyType) => {
    try {
      setSaving(true);
      const response = await fetch(`/api/langchain/config/key/${keyType}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to clear key');

      setKeySet(prev => ({ ...prev, [keyType]: false }));
      setMessage(`✓ ${keyType} API key cleared`);
      setTimeout(() => setMessage(''), 3000);

      // Refresh status
      await loadProviderStatuses();
    } catch (error) {
      console.error('[LlmConfigPanel] Failed to clear key:', error);
      setMessage('Error clearing API key');
    } finally {
      setSaving(false);
    }
  };

  // Save all current settings (provider + model + fallback chain)
  const handleSaveAll = async () => {
    try {
      setSaving(true);
      const body = { provider: currentProvider, model: currentModel, fallback_order: fallbackChain };
      const response = await fetch('/api/langchain/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error('Failed to save configuration');
      setMessage('✓ Configuration saved');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error('[LlmConfigPanel] Failed to save all:', error);
      setMessage('Error saving configuration');
    } finally {
      setSaving(false);
    }
  };

  // Save model selection
  const handleModelChange = async (model) => {
    setCurrentModel(model);

    try {
      setSaving(true);
      const response = await fetch('/api/langchain/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });

      if (!response.ok) throw new Error('Failed to save model');

      setMessage(`✓ Model updated`);
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error('[LlmConfigPanel] Failed to save model:', error);
      setMessage('Error saving model');
    } finally {
      setSaving(false);
    }
  };

  // Drag-and-drop handlers for fallback chain
  const handleDragStart = (index) => {
    setDraggedItem(index);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (index) => {
    if (draggedItem === null || draggedItem === index) return;

    const newChain = [...fallbackChain];
    const [removed] = newChain.splice(draggedItem, 1);
    newChain.splice(index, 0, removed);

    setFallbackChain(newChain);
    setDraggedItem(null);

    // Save fallback chain to session
    saveFallbackChain(newChain);
  };

  // Save fallback chain
  const saveFallbackChain = async (chain) => {
    try {
      const response = await fetch('/api/langchain/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fallback_order: chain }),
      });

      if (!response.ok) console.error('Failed to save fallback chain');
    } catch (error) {
      console.error('[LlmConfigPanel] Failed to save fallback chain:', error);
    }
  };

  const getStatusBadge = (provider) => {
    const status = providerStatus[provider];
    if (!status) return '○ Loading';

    if (status.status === 'available') return '✅ Available';
    if (status.status === 'unconfigured') return '⚠️ Unconfigured';
    if (status.status === 'unreachable') return '❌ Unreachable';
    return '○ Unknown';
  };

  const getStatusColor = (provider) => {
    const status = providerStatus[provider];
    if (!status) return '#ccc'; // gray

    if (status.status === 'available') return '#28a745'; // green
    if (status.status === 'unconfigured') return '#ffc107'; // yellow
    if (status.status === 'unreachable') return '#dc3545'; // red
    return '#ccc';
  };

  if (loading) {
    return <div className="llm-config-panel"><p>Loading configuration...</p></div>;
  }

  return (
    <div className="llm-config-panel">
      {/* Header */}
      <div className="config-header">
        <h2>LLM Provider Configuration</h2>
        <p style={{ margin: '0.5em 0 0 0', color: '#666', fontSize: '0.9em' }}>
          Currently using: <strong>{currentProvider}</strong> / <strong>{currentModel}</strong>
        </p>
      </div>

      {/* Status message */}
      {message && (
        <div className={`config-message ${message.startsWith('✓') ? 'success' : 'error'}`}>
          {message}
        </div>
      )}

      {/* Provider selector */}
      <div className="config-section">
        <h3>Select Provider</h3>
        <div className="provider-buttons">
          {PROVIDERS.map(provider => (
            <button
              key={provider}
              className={`provider-btn ${currentProvider === provider ? 'active' : ''}`}
              onClick={() => handleProviderSelect(provider)}
              disabled={saving}
              title={providerStatus[provider]?.reason || ''}
            >
              <span>{provider.toUpperCase()}</span>
              <span
                className="status-badge"
                style={{ backgroundColor: getStatusColor(provider) }}
              >
                {getStatusBadge(provider)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Model selector */}
      {currentProvider && providerModels[currentProvider] && (
        <div className="config-section">
          <h3>Model</h3>
          <select
            className="config-select"
            value={currentModel}
            onChange={e => handleModelChange(e.target.value)}
            disabled={saving}
          >
            {providerModels[currentProvider].map(model => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Provider-specific config */}
      {currentProvider && (
        <div className="config-section">
          <h3>Configuration</h3>

          <div className="config-field">
            <label>{currentProvider.toUpperCase()} API Key</label>
            <div className="key-input-row">
              <input
                type="password"
                className="config-input"
                placeholder={keySet[currentProvider] ? 'Key configured (enter new key to update)' : 'Enter API key'}
                value={apiKeys[currentProvider] || ''}
                onChange={e => setApiKeys(prev => ({ ...prev, [currentProvider]: e.target.value }))}
                disabled={saving}
              />
              <button
                className="btn-small btn-primary"
                onClick={() => handleSaveKey(currentProvider)}
                disabled={saving || !apiKeys[currentProvider]}
              >
                Save Key
              </button>
              {keySet[currentProvider] && (
                <button
                  className="btn-small btn-danger"
                  onClick={() => handleClearKey(currentProvider)}
                  disabled={saving}
                >
                  Clear
                </button>
              )}
            </div>
            <small>
              {keySet[currentProvider] ? '✓ Key configured' : '⚠️ No key configured'}
            </small>
          </div>
        </div>
      )}

      {/* Local model tiers (llama.cpp swap mode) */}
      {tiers?.models && (
        <div className="config-section">
          <h3>Local Model Tiers (llama.cpp)</h3>
          <p style={{ fontSize: '0.9em', color: '#666' }}>
            Swap mode: one model loaded at a time. Pre-warm a bigger model before a
            demo so the first request doesn't wait for it to load — after ~5 idle
            minutes it decays back to the smallest tier.
          </p>
          <div className="fallback-chain">
            {(tiers.prewarmable || []).map(model => {
              const loaded = isTierLoaded(model);
              return (
                <div key={model} className="fallback-item">
                  <span
                    className="status-dot"
                    style={{ backgroundColor: loaded ? '#28a745' : '#ccc' }}
                    title={loaded ? 'Loaded' : 'Not loaded'}
                  />
                  <span className="provider-name">{model}</span>
                  <button
                    type="button"
                    className="btn-small btn-primary"
                    onClick={() => handlePrewarm(model)}
                    disabled={loaded || prewarming !== null}
                    style={{ marginLeft: 'auto' }}
                  >
                    {prewarming === model ? 'Loading…' : loaded ? 'Loaded' : 'Pre-warm'}
                  </button>
                </div>
              );
            })}
          </div>
          {tiers.swapping && (
            <small>Currently swapping to: {tiers.swapping}</small>
          )}
        </div>
      )}

      {/* Fallback chain */}
      <div className="config-section">
        <h3>Fallback Chain</h3>
        <p style={{ fontSize: '0.9em', color: '#666' }}>
          If the first provider fails, the agent automatically tries the next in order. Drag to reorder.
        </p>
        <div className="fallback-chain">
          {fallbackChain.map((provider, index) => (
            <div
              key={`${provider}-${index}`}
              className={`fallback-item ${draggedItem === index ? 'dragging' : ''}`}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(index)}
            >
              <span className="order-num">{index + 1}</span>
              <span className="provider-name">{provider}</span>
              <span
                className="status-dot"
                style={{ backgroundColor: getStatusColor(provider) }}
                title={getStatusBadge(provider)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Info */}
      <div className="config-section info-section">
        <h3>About</h3>
        <ul>
          <li>API keys are stored server-side only — never sent to browser</li>
          <li>Provider status checks run on page load</li>
          <li>Fallback chain order is saved to your session config</li>
        </ul>
      </div>

      {/* Sticky save bar */}
      <div className="llm-save-bar">
        <button
          className="llm-save-btn"
          onClick={handleSaveAll}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save Configuration'}
        </button>
        <span className="llm-save-hint">
          Saves provider, model, and fallback chain to your session.
        </span>
      </div>
    </div>
  );
}
