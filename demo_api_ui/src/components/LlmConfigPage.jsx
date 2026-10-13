// demo_api_ui/src/components/LlmConfigPage.jsx
import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import { notifyError, notifySuccess } from '../utils/appToast';
import AnthropicPanel from './AnthropicPanel';
import GroqPanel from './GroqPanel';
import HelixPanel from './HelixPanel';
import LmStudioPanel from './LmStudioPanel';
import LlamaCppPanel from './LlamaCppPanel';
import ProviderSelector from './ProviderSelector';
import './LlmConfig.css';

const PROVIDER_LABELS = {
  helix: 'Helix',
  'anthropic-lmstudio': 'LM Studio',
  llamacpp: 'llama.cpp',
  groq: 'Groq',
  anthropic: 'Anthropic',
};

/**
 * LlmConfigPage — LLM provider configuration
 *
 * Shows a provider selector (llama.cpp | Groq | Helix | LM Studio | Anthropic) at the
 * top, then the appropriate config panel below. Google was removed: its free tier
 * rate-limits under demo traffic (2026-10-13).
 */
export default function LlmConfigPage() {
  const [provider, setProvider] = useState('helix');
  const [helixStatus, setHelixStatus] = useState(null);
  const [lmstudioStatus, setLmstudioStatus] = useState(null);
  const [llamaCppStatus, setLlamaCppStatus] = useState(null);
  const [anthropicStatus, setAnthropicStatus] = useState(null);
  const [groqStatus, setGroqStatus] = useState(null);

  const fetchStatuses = useCallback(async () => {
    try {
      const [helixRes, lmstudioRes, llamaCppRes, anthropicRes, groqRes] = await Promise.all([
        apiClient.get('/api/langchain/provider/helix/status'),
        apiClient.get('/api/langchain/provider/anthropic-lmstudio/status'),
        apiClient.get('/api/langchain/provider/llamacpp/status'),
        apiClient.get('/api/langchain/provider/anthropic/status'),
        apiClient.get('/api/langchain/provider/groq/status'),
      ]);
      setHelixStatus(helixRes.data?.status ?? null);
      setLmstudioStatus(lmstudioRes.data?.status ?? null);
      setLlamaCppStatus(llamaCppRes.data?.status ?? null);
      setAnthropicStatus(anthropicRes.data?.status ?? null);
      setGroqStatus(groqRes.data?.status ?? null);
    } catch (err) {
      console.warn('[LlmConfigPage] Status fetch failed:', err.message);
    }
  }, []);

  useEffect(() => {
    apiClient.get('/api/langchain/config/status')
      .then(res => {
        const p = res.data?.provider;
        if (p && PROVIDER_LABELS[p]) setProvider(p);
      })
      .catch(err => console.warn('[LlmConfigPage] Config load failed:', err.message));

    fetchStatuses();
  }, [fetchStatuses]);

  const handleSelect = async (selected) => {
    if (selected === provider) return;
    setProvider(selected);
    try {
      await apiClient.post('/api/langchain/config', { provider: selected });
      notifySuccess(`Switched to ${PROVIDER_LABELS[selected] ?? selected}`);
      await fetchStatuses();
    } catch (err) {
      notifyError(`Failed to switch provider: ${err.message}`);
      setProvider(provider); // revert on failure
    }
  };

  const panel = provider === 'helix'
    ? <HelixPanel />
    : provider === 'groq'
        ? <GroqPanel />
      : provider === 'anthropic'
        ? <AnthropicPanel />
        : provider === 'llamacpp'
          ? <LlamaCppPanel />
          : <LmStudioPanel />;

  return (
    <div className="page-container">
      <div className="cfg-page-heading">
        <h2>LLM Provider</h2>
        <p>Select and configure the language model used by the banking agent.</p>
      </div>
      <ProviderSelector
        provider={provider}
        onSelect={handleSelect}
        helixStatus={helixStatus}
        lmstudioStatus={lmstudioStatus}
        llamaCppStatus={llamaCppStatus}
        anthropicStatus={anthropicStatus}
        groqStatus={groqStatus}
      />
      {panel}
    </div>
  );
}
