// demo_api_ui/src/components/LmStudioPanel.jsx
import { useState, useEffect, useCallback } from 'react';
import apiClient from '../services/apiClient';
import { notifySuccess, notifyError, notifyInfo } from '../utils/appToast';
import './LlmConfig.css';

const DEFAULT_MODEL = 'google/gemma-4-e2b';
const DEFAULT_BASE_URL = 'http://localhost:1234';

export default function LmStudioPanel() {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [serverStatus, setServerStatus] = useState(null); // null | 'running' | 'unreachable'
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  // Download state
  const [downloadJobId, setDownloadJobId] = useState(null);
  const [downloadStatus, setDownloadStatus] = useState(null); // null | { status, progress_pct, downloaded_bytes, total_size_bytes }
  const [downloading, setDownloading] = useState(false);
  // Load state
  const [loading, setLoading] = useState(false);

  const checkStatus = useCallback(async () => {
    setChecking(true);
    try {
      const res = await apiClient.get('/api/langchain/lmstudio/status');
      const d = res.data;
      setServerStatus(d.server_running ? 'running' : 'unreachable');
      if (d.server_running) {
        setModels(d.models || []);
        setBaseUrl(d.base_url || DEFAULT_BASE_URL);
        // Auto-select first loaded model if default isn't available
        const loadedModels = (d.models || []).filter(m => m.loaded);
        const hasDefault = (d.models || []).some(m => m.key === DEFAULT_MODEL);
        if (!hasDefault && loadedModels.length > 0) {
          setSelectedModel(loadedModels[0].key);
        }
      }
    } catch {
      setServerStatus('unreachable');
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const handleLoad = useCallback(async (model) => {
    setLoading(true);
    try {
      await apiClient.post('/api/langchain/lmstudio/load', { model: model || selectedModel });
      notifySuccess(`${model || selectedModel} loaded`);
      await checkStatus();
    } catch (err) {
      notifyError(`Load failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [checkStatus, selectedModel]);

  // Poll download progress when a job is running
  useEffect(() => {
    if (!downloadJobId) return;
    const interval = setInterval(async () => {
      try {
        const res = await apiClient.get(`/api/langchain/lmstudio/download/status?job_id=${downloadJobId}`);
        const d = res.data;
        setDownloadStatus(d);
        if (d.status === 'completed') {
          clearInterval(interval);
          setDownloadJobId(null);
          setDownloading(false);
          notifySuccess('Download complete — loading model…');
          await handleLoad(selectedModel);
          await checkStatus();
        } else if (d.status === 'failed') {
          clearInterval(interval);
          setDownloadJobId(null);
          setDownloading(false);
          notifyError(`Download failed: ${d.error || 'unknown error'}`);
        }
      } catch (err) {
        clearInterval(interval);
        setDownloadJobId(null);
        setDownloading(false);
        notifyError(`Download status check failed: ${err.message}`);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [downloadJobId, selectedModel, handleLoad, checkStatus]);

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadStatus(null);
    try {
      const res = await apiClient.post('/api/langchain/lmstudio/download', { model: selectedModel });
      const d = res.data;
      if (d.status === 'already_downloaded' || d.status === 'completed') {
        notifyInfo('Model already downloaded — loading…');
        setDownloading(false);
        await handleLoad(selectedModel);
        await checkStatus();
      } else if (d.job_id) {
        setDownloadJobId(d.job_id);
        setDownloadStatus(d);
        notifyInfo(`Downloading ${selectedModel}… this may take several minutes`);
      } else {
        setDownloading(false);
        notifyError(d.error || 'Download start failed');
      }
    } catch (err) {
      setDownloading(false);
      notifyError(`Download failed: ${err.message}`);
    }
  };

  const handleSaveModel = async () => {
    setSaving(true);
    try {
      await apiClient.post('/api/langchain/config', {
        provider: 'anthropic-lmstudio',
        model: selectedModel,
      });
      notifySuccess(`Model set to ${selectedModel}`);
    } catch (err) {
      notifyError(`Failed to save model: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // ── Derived state ──────────────────────────────────────────────────────────
  const loadedModels = models.filter(m => m.loaded);
  const selectedLoaded = models.find(m => m.key === selectedModel && m.loaded);
  const selectedDownloaded = models.find(m => m.key === selectedModel && !m.loaded);

  const statusLabel = serverStatus === 'running' ? '✅ Server running' : serverStatus === 'unreachable' ? '❌ Server not reachable' : checking ? '…' : '⚠️ Unknown';

  const formatBytes = (bytes) => {
    if (!bytes) return '';
    const gb = bytes / 1e9;
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1e6).toFixed(0)} MB`;
  };

  return (
    <div className="cfg-card">
      {/* Card header */}
      <div className="cfg-card-header">
        <div>
          <p className="cfg-card-title">LM Studio Configuration</p>
          <p className="cfg-card-sub">
            Local inference via Anthropic API format ·{' '}
            <a href="https://lmstudio.ai/download" target="_blank" rel="noopener noreferrer">
              lmstudio.ai ↗
            </a>
          </p>
        </div>
        <span className={`cfg-badge${
          serverStatus === 'running'     ? ' cfg-badge--active' :
          serverStatus === 'unreachable' ? ' cfg-badge--unreachable' :
          ' cfg-badge--loading'
        }`}>
          {serverStatus === 'running'     && 'Running'}
          {serverStatus === 'unreachable' && 'Unreachable'}
          {(!serverStatus || checking)    && '…'}
        </span>
      </div>

      {/* Card body */}
      <div className="cfg-card-body">

        {/* Setup instructions — shown when server is not running */}
        {serverStatus !== 'running' && (
          <div className="cfg-setup-box">
            <p>Getting started with LM Studio</p>
            <ol>
              <li>
                Download and install from{' '}
                <a href="https://lmstudio.ai/download" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>
                  lmstudio.ai/download
                </a>
              </li>
              <li>
                Open LM Studio → <strong>Developer</strong> tab → start local server
                <code className="cfg-code" style={{ marginTop: '0.4rem' }}>Default port: 1234</code>
              </li>
              <li>Click <strong>Check Status</strong> below, then <strong>Download &amp; Load</strong> to set up Gemma.</li>
            </ol>
          </div>
        )}

        {/* Status row */}
        <div className="cfg-status-row">
          <span className={`cfg-badge${
            serverStatus === 'running'     ? ' cfg-badge--active' :
            serverStatus === 'unreachable' ? ' cfg-badge--unreachable' :
            ' cfg-badge--loading'
          }`} style={{ borderRadius: '8px' }}>
            {statusLabel}
          </span>
          <button
            type="button"
            className="cfg-btn cfg-btn--secondary"
            onClick={checkStatus}
            disabled={checking}
          >
            {checking ? '…' : 'Check Status'}
          </button>
        </div>

        {/* Server URL */}
        <div className="cfg-grid" style={{ marginBottom: '1.25rem' }}>
          <div className="cfg-field cfg-field--full">
            <label htmlFor="lmstudio-url" className="cfg-label">LM Studio Server URL</label>
            <input
              id="lmstudio-url"
              type="text"
              className="cfg-input"
              value={baseUrl}
              placeholder={DEFAULT_BASE_URL}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <p className="cfg-hint">
              Default: {DEFAULT_BASE_URL} · Anthropic endpoint: <code>/v1/messages</code>
            </p>
          </div>
        </div>

        {/* Model section — only when server is running */}
        {serverStatus === 'running' && (
          <>
            {loadedModels.length > 0 && (
              <div className="cfg-loaded-box">
                ✅ Loaded in memory:{' '}
                {loadedModels.map((m) => m.display_name || m.key).join(', ')}
              </div>
            )}

            <div className="cfg-grid" style={{ marginBottom: '1rem' }}>
              <div className="cfg-field cfg-field--full">
                <label htmlFor="lmstudio-model" className="cfg-label">Model</label>
                <select
                  id="lmstudio-model"
                  className="cfg-select"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                >
                  {models.length > 0
                    ? models.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.display_name || m.key}
                        {m.loaded ? ' (loaded)' : ' (not loaded)'}
                        {m.size_bytes ? ` — ${formatBytes(m.size_bytes)}` : ''}
                      </option>
                    ))
                    : <option value={DEFAULT_MODEL}>{DEFAULT_MODEL}</option>
                  }
                </select>
              </div>
            </div>
          </>
        )}

        {/* Download progress */}
        {downloadStatus && downloading && (
          <div className="cfg-progress-box">
            <p>Downloading {selectedModel}…</p>
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

        <hr className="cfg-divider" style={{ marginTop: '1.25rem' }} />

        <div className="cfg-actions">
          {serverStatus === 'running' && (selectedDownloaded || models.length === 0) && !selectedLoaded && (
            <button
              type="button"
              className="cfg-btn cfg-btn--green"
              onClick={() => handleLoad(selectedModel)}
              disabled={loading}
            >
              {loading ? 'Loading…' : 'Load Model'}
            </button>
          )}
          <button
            type="button"
            className="cfg-btn cfg-btn--purple"
            onClick={handleDownload}
            disabled={downloading || loading}
          >
            {downloading ? 'Downloading…' : 'Download & Load'}
          </button>
          {serverStatus === 'running' && (
            <button
              type="button"
              className="cfg-btn cfg-btn--secondary"
              onClick={handleSaveModel}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save Model'}
            </button>
          )}
        </div>

        {/* Endpoint info */}
        {serverStatus === 'running' && (
          <div className="cfg-info-panel" style={{ marginTop: '1.25rem' }}>
            <strong>Anthropic API endpoint</strong>
            <code className="cfg-code">{baseUrl}/v1/messages</code>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: '#94a3b8' }}>
              x-api-key: any value accepted — LM Studio does not validate API keys.
              Model field must match the key shown above (e.g.{' '}
              <code>google/gemma-4-e2b</code>).
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
