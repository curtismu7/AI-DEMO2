// demo_api_ui/src/components/LlamaCppPanel.jsx
import { useState, useEffect, useCallback } from 'react';
import apiClient from '../services/apiClient';
import { notifySuccess, notifyError, notifyInfo } from '../utils/appToast';
import './LlmConfig.css';

const PIN_MODELS = ['gemma-3-4b-it', 'gemma-4-12b-it', 'starcoder2-15b-instruct', 'gpt-oss-20b'];
const DEFAULT_MODEL = 'gemma-3-4b-it';

function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function LlamaCppPanel() {
  const [proxyStatus, setProxyStatus] = useState(null);
  const [proxyReason, setProxyReason] = useState('');
  const [inventory, setInventory] = useState(null);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloadJobId, setDownloadJobId] = useState(null);
  const [downloadStatus, setDownloadStatus] = useState(null);
  const [downloadingTier, setDownloadingTier] = useState(null);
  const [deduping, setDeduping] = useState(false);

  const loadInventory = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/langchain/llamacpp/models');
      setInventory(res.data);
    } catch (err) {
      notifyError(`Failed to load model inventory: ${err.message}`);
    }
  }, []);

  const checkProxyStatus = useCallback(async () => {
    setChecking(true);
    try {
      const res = await apiClient.get('/api/langchain/provider/llamacpp/status');
      setProxyStatus(res.data?.status ?? null);
      setProxyReason(res.data?.reason ?? '');
    } catch (err) {
      setProxyStatus('unreachable');
      setProxyReason(err.message);
    } finally {
      setChecking(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadInventory(), checkProxyStatus()]);
  }, [loadInventory, checkProxyStatus]);

  useEffect(() => {
    apiClient.get('/api/langchain/config/status')
      .then((res) => {
        if (res.data?.provider === 'llamacpp' && res.data?.model) {
          setSelectedModel(res.data.model);
        }
      })
      .catch(() => {});
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!downloadJobId) return undefined;
    const interval = setInterval(async () => {
      try {
        const res = await apiClient.get(`/api/langchain/llamacpp/models/download/status?job_id=${downloadJobId}`);
        const d = res.data;
        setDownloadStatus(d);
        if (d.status === 'completed') {
          clearInterval(interval);
          setDownloadJobId(null);
          setDownloadingTier(null);
          notifySuccess('Model download complete');
          await refreshAll();
        } else if (d.status === 'failed') {
          clearInterval(interval);
          setDownloadJobId(null);
          setDownloadingTier(null);
          notifyError(`Download failed: ${d.error || 'unknown error'}`);
        }
      } catch (err) {
        clearInterval(interval);
        setDownloadJobId(null);
        setDownloadingTier(null);
        notifyError(`Download status check failed: ${err.message}`);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [downloadJobId, refreshAll]);

  const handleDownloadTier = async (tier) => {
    setDownloadingTier(tier.tier);
    setDownloadStatus(null);
    try {
      const res = await apiClient.post('/api/langchain/llamacpp/models/download', { tier: tier.tier });
      const d = res.data;
      if (d.status === 'already_present' || d.status === 'satisfied_by_alias') {
        setDownloadingTier(null);
        notifyInfo(`${tier.label} already on disk`);
        await refreshAll();
      } else if (d.status === 'already_running') {
        setDownloadJobId(d.jobId);
        notifyInfo(`Download already in progress for tier ${tier.tier}`);
      } else if (d.jobId) {
        setDownloadJobId(d.jobId);
        setDownloadStatus({ status: 'running', progress_pct: 0, total_size_bytes: d.totalSizeBytes });
        notifyInfo(`Downloading ${tier.label}… this may take several minutes`);
      } else {
        setDownloadingTier(null);
        notifyError(d.error || 'Download start failed');
      }
    } catch (err) {
      setDownloadingTier(null);
      notifyError(`Download failed: ${err.message}`);
    }
  };

  const handleDedupe = async () => {
    setDeduping(true);
    try {
      const res = await apiClient.post('/api/langchain/llamacpp/models/dedupe');
      const freed = res.data?.freedBytes ?? 0;
      notifySuccess(freed > 0 ? `Reclaimed ${formatBytes(freed)}` : 'No duplicate files to clean up');
      await refreshAll();
    } catch (err) {
      notifyError(`Cleanup failed: ${err.message}`);
    } finally {
      setDeduping(false);
    }
  };

  const handleSaveModel = async () => {
    setSaving(true);
    try {
      await apiClient.post('/api/langchain/config', { provider: 'llamacpp', model: selectedModel });
      notifySuccess(`Model set to ${selectedModel}`);
      await checkProxyStatus();
    } catch (err) {
      notifyError(`Failed to save model: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const statusLabel =
    proxyStatus === 'available' ? '✅ Running — model available' :
    proxyStatus === 'unconfigured' ? '⚠️ Running — no model loaded' :
    proxyStatus === 'unreachable' ? '❌ Not reachable' :
    checking ? '…' : '⚠️ Unknown';

  const badgeClass =
    proxyStatus === 'available' ? ' cfg-badge--active' :
    proxyStatus === 'unreachable' ? ' cfg-badge--unreachable' :
    ' cfg-badge--loading';

  const tiers = inventory?.tiers ?? [];
  const hasDupes = (inventory?.duplicateFiles?.length ?? 0) > 0 || (inventory?.cacheBytes ?? 0) > 0;

  return (
    <div className="cfg-card">
      <div className="cfg-card-header">
        <div>
          <p className="cfg-card-title">llama.cpp Configuration</p>
          <p className="cfg-card-sub">
            Local multi-tier LLM proxy · ports 8091–8096 ·{' '}
            <a href="https://github.com/ggml-org/llama.cpp" target="_blank" rel="noopener noreferrer">
              llama.cpp ↗
            </a>
          </p>
        </div>
        <span className={`cfg-badge${badgeClass}`}>
          {proxyStatus === 'available' && 'Running'}
          {proxyStatus === 'unconfigured' && 'No model'}
          {proxyStatus === 'unreachable' && 'Unreachable'}
          {(!proxyStatus || checking) && '…'}
        </span>
      </div>

      <div className="cfg-card-body">
        <div className="cfg-setup-box">
          <p>Local model tiers</p>
          <p className="cfg-hint" style={{ marginTop: '0.25rem' }}>
            Download GGUF files into{' '}
            <code className="cfg-code">{inventory?.modelsDir ?? '~/models'}</code>.
            Tier 1 alone (~2.2 GB) is enough for swap mode; download higher tiers as you need them.
          </p>
        </div>

        {inventory && (
          <div className="cfg-info-panel" style={{ marginTop: '1rem' }}>
            <strong>Disk usage</strong>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
              Models on disk: {formatBytes(inventory.totalBytesOnDisk)}
              {inventory.cacheBytes > 0 && ` · HF cache: ${formatBytes(inventory.cacheBytes)} (reclaimable)`}
              {hasDupes && ' · duplicate tier files detected'}
            </p>
            {hasDupes && (
              <button
                type="button"
                className="cfg-btn cfg-btn--secondary"
                style={{ marginTop: '0.5rem' }}
                onClick={handleDedupe}
                disabled={deduping}
              >
                {deduping ? 'Cleaning…' : 'Reclaim space (dedupe + clear cache)'}
              </button>
            )}
          </div>
        )}

        <div className="cfg-status-row" style={{ marginTop: '1rem' }}>
          <span className={`cfg-badge${badgeClass}`} style={{ borderRadius: '8px' }}>
            {statusLabel}
          </span>
          <button type="button" className="cfg-btn cfg-btn--secondary" onClick={refreshAll} disabled={checking}>
            {checking ? '…' : 'Refresh'}
          </button>
        </div>
        {proxyReason && <p className="cfg-hint" style={{ marginTop: '0.5rem' }}>{proxyReason}</p>}

        <div style={{ marginTop: '1.25rem' }}>
          <p className="cfg-label" style={{ marginBottom: '0.5rem' }}>Tier models</p>
          <table className="cfg-table" style={{ width: '100%', fontSize: '0.8rem' }}>
            <thead>
              <tr>
                <th>Tier</th>
                <th>Model</th>
                <th>Size</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier) => {
                const isDownloading = downloadingTier === tier.tier;
                const statusText = tier.present
                  ? (tier.aliased ? '✓ via alias' : '✓ on disk')
                  : (tier.skipDownload ? '✓ alias ready' : 'missing');
                return (
                  <tr key={tier.tier}>
                    <td>{tier.tier}</td>
                    <td>
                      <div>{tier.label}</div>
                      <code style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{tier.file}</code>
                    </td>
                    <td>{formatBytes(tier.sizeBytes)}</td>
                    <td>{statusText}</td>
                    <td>
                      {!tier.present && !tier.skipDownload && (
                        <button
                          type="button"
                          className="cfg-btn cfg-btn--purple"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                          onClick={() => handleDownloadTier(tier)}
                          disabled={isDownloading || Boolean(downloadJobId)}
                        >
                          {isDownloading ? '…' : 'Download'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {downloadStatus && downloadingTier != null && (
          <div className="cfg-progress-box" style={{ marginTop: '1rem' }}>
            <p>Downloading tier {downloadingTier}…</p>
            {downloadStatus.progress_pct != null && (
              <div className="cfg-progress-track">
                <div
                  className="cfg-progress-fill"
                  style={{ width: `${downloadStatus.progress_pct}%` }}
                />
              </div>
            )}
            <p className="cfg-progress-label">
              {downloadStatus.downloaded_bytes && downloadStatus.total_size_bytes
                ? `${formatBytes(downloadStatus.downloaded_bytes)} / ${formatBytes(downloadStatus.total_size_bytes)}`
                : 'Calculating…'}
              {downloadStatus.progress_pct != null ? ` (${downloadStatus.progress_pct}%)` : ''}
            </p>
          </div>
        )}

        <div className="cfg-grid" style={{ marginTop: '1.25rem', marginBottom: '1rem' }}>
          <div className="cfg-field cfg-field--full">
            <label htmlFor="llamacpp-model" className="cfg-label">Router pin (agent config)</label>
            <select
              id="llamacpp-model"
              className="cfg-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              {PIN_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <p className="cfg-hint">Pin name the LLM proxy uses when routing requests to a tier.</p>
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
            No API key required. Install with <code>brew install llama.cpp huggingface-cli</code> if downloads fail.
            Tier 4 reuses the Tier 2 Gemma-12B file when present — run dedupe to reclaim ~7 GB.
          </p>
        </div>
      </div>
    </div>
  );
}
