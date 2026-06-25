import React, { useState, useCallback, useEffect } from "react";
import apiClient from "../services/apiClient";
import { notifySuccess, notifyError } from "../utils/appToast";
import './LlmConfig.css';

export default function HelixPanel() {
  // Initial blanks — server-side configStore (FIELD_DEFS in configStore.js)
  // returns the public demo defaults from /api/langchain/config/status on
  // first render, so fresh clones see the LLM2 demo agent pre-filled.
  const [helixConfig, setHelixConfig] = useState({
    base_url: "",
    api_key: "",
    environment_id: "",
    agent_id: "",
    prompt_field_id: "",
  });
  const [helixStatus, setHelixStatus] = useState(null);
  const [helixSaving, setHelixSaving] = useState(false);
  const [helixChecking, setHelixChecking] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const fetchHelixStatus = useCallback(async () => {
    setHelixChecking(true);
    try {
      const statusRes = await apiClient.get(
        "/api/langchain/provider/helix/status",
      );
      setHelixStatus(statusRes.data?.status);

      const configRes = await apiClient.get("/api/langchain/config/status");
      const cfg = configRes.data;

      setHelixConfig({
        base_url: cfg?.helix_base_url || "",
        api_key: "",
        environment_id: cfg?.helix_environment_id || "",
        agent_id: cfg?.helix_agent_id || "",
        prompt_field_id: cfg?.helix_prompt_field_id || "",
      });
      notifySuccess("Helix configuration loaded");
    } catch (err) {
      console.error("[HelixPanel] Status check failed:", err);
      notifyError(`Failed to load Helix configuration: ${err.message}`);
    } finally {
      setHelixChecking(false);
    }
  }, []);

  const handleImportJson = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.keyValue) {
          notifyError("JSON file has no keyValue field");
          return;
        }
        setHelixConfig((prev) => ({
          ...prev,
          api_key: data.keyValue,
          ...(data.keyName ? { agent_id: data.keyName } : {}),
        }));
        notifySuccess(`API key imported from ${file.name}`);
      } catch {
        notifyError("Failed to parse JSON file");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleHelixSave = async () => {
    if (
      !helixConfig.base_url ||
      !helixConfig.api_key ||
      !helixConfig.environment_id ||
      !helixConfig.agent_id ||
      !helixConfig.prompt_field_id
    ) {
      notifyError("All Helix fields are required");
      return;
    }

    setHelixSaving(true);
    try {
      await apiClient.post("/api/langchain/config", {
        provider: "helix",
        key_type: "helix",
        helix_api_key: helixConfig.api_key,
        helix_base_url: helixConfig.base_url,
        helix_environment_id: helixConfig.environment_id,
        helix_agent_id: helixConfig.agent_id,
        helix_prompt_field_id: helixConfig.prompt_field_id,
      });
      sessionStorage.setItem("helix_config", JSON.stringify(helixConfig));
      notifySuccess("Helix LLM configuration saved");
      await fetchHelixStatus();
    } catch {
      notifyError("Failed to save Helix configuration");
    } finally {
      setHelixSaving(false);
    }
  };

  const handleHelixClear = async () => {
    setShowClearConfirm(true);
  };

  const confirmHelixClear = async () => {
    setShowClearConfirm(false);
    setHelixSaving(true);
    try {
      await apiClient.delete("/api/langchain/config/key/helix");
      setHelixConfig({
        base_url: "",
        api_key: "",
        environment_id: "",
        agent_id: "",
        prompt_field_id: "",
      });
      setHelixStatus("unconfigured");
      sessionStorage.removeItem("helix_config");
      notifySuccess("Helix configuration cleared");
    } catch {
      notifyError("Failed to clear Helix config");
    } finally {
      setHelixSaving(false);
    }
  };

  useEffect(() => {
    // Restore from sessionStorage on mount (persist across tab switches)
    const savedHelix = sessionStorage.getItem("helix_config");
    if (savedHelix) {
      try {
        setHelixConfig(JSON.parse(savedHelix));
      } catch {
        // Ignore parse errors silently
      }
    }

    // Load status on mount
    const loadStatus = async () => {
      try {
        const statusRes = await apiClient.get(
          "/api/langchain/provider/helix/status",
        );
        setHelixStatus(statusRes.data?.status);
      } catch {
        // Silently handle initial status load failure
      }
    };
    loadStatus();
  }, []);

  // Persist form changes to sessionStorage in real-time
  useEffect(() => {
    sessionStorage.setItem("helix_config", JSON.stringify(helixConfig));
  }, [helixConfig]);

  return (
    <div className="cfg-card">
      {/* Card header */}
      <div className="cfg-card-header">
        <div>
          <p className="cfg-card-title">Helix Configuration</p>
          <p className="cfg-card-sub">
            PingOne AI agent LLM ·{' '}
            <a href="https://openam-helix.forgeblocks.com" target="_blank" rel="noopener noreferrer">
              Open Helix Console ↗
            </a>
          </p>
        </div>
        <span className={`cfg-badge${
          helixStatus === 'available'    ? ' cfg-badge--active' :
          helixStatus === 'unconfigured' ? ' cfg-badge--unconfigured' :
          helixStatus === 'unreachable'  ? ' cfg-badge--unreachable' :
          ' cfg-badge--loading'
        }`}>
          {helixStatus === 'available'    && 'Active'}
          {helixStatus === 'unconfigured' && 'Unconfigured'}
          {helixStatus === 'unreachable'  && 'Unreachable'}
          {helixStatus === null           && '…'}
        </span>
      </div>

      {/* Card body */}
      <div className="cfg-card-body">
        <div className="cfg-grid">
          <div className="cfg-field">
            <label htmlFor="helix-base-url" className="cfg-label">Base URL</label>
            <input
              id="helix-base-url"
              type="text"
              className="cfg-input"
              placeholder="https://openam-helix.forgeblocks.com"
              value={helixConfig.base_url}
              onChange={(e) => setHelixConfig({ ...helixConfig, base_url: e.target.value })}
            />
            <p className="cfg-hint">Your Helix tenant origin</p>
          </div>
          <div className="cfg-field">
            <label htmlFor="helix-api-key" className="cfg-label">API Key</label>
            <input
              id="helix-api-key"
              type="password"
              className="cfg-input"
              placeholder="Helix API Key"
              value={helixConfig.api_key}
              onChange={(e) => setHelixConfig({ ...helixConfig, api_key: e.target.value })}
            />
          </div>
          <div className="cfg-field">
            <label htmlFor="helix-env-id" className="cfg-label">Environment ID</label>
            <input
              id="helix-env-id"
              type="text"
              className="cfg-input"
              placeholder="Environment / Tenant ID"
              value={helixConfig.environment_id}
              onChange={(e) => setHelixConfig({ ...helixConfig, environment_id: e.target.value })}
            />
          </div>
          <div className="cfg-field">
            <label htmlFor="helix-agent-id" className="cfg-label">Agent Name</label>
            <input
              id="helix-agent-id"
              type="text"
              className="cfg-input"
              placeholder="my-banking-agent"
              value={helixConfig.agent_id}
              onChange={(e) => setHelixConfig({ ...helixConfig, agent_id: e.target.value })}
            />
          </div>
          <div className="cfg-field cfg-field--full">
            <label htmlFor="helix-prompt-field-id" className="cfg-label">Prompt Field ID</label>
            <input
              id="helix-prompt-field-id"
              type="text"
              className="cfg-input"
              placeholder="e.g. textInputa7c39a0e8292"
              value={helixConfig.prompt_field_id}
              onChange={(e) => setHelixConfig({ ...helixConfig, prompt_field_id: e.target.value })}
            />
          </div>
        </div>

        <hr className="cfg-divider" />

        <div className="cfg-actions">
          <button
            type="button"
            className="cfg-btn cfg-btn--primary"
            onClick={handleHelixSave}
            disabled={
              helixSaving ||
              !helixConfig.base_url ||
              !helixConfig.api_key ||
              !helixConfig.environment_id ||
              !helixConfig.agent_id ||
              !helixConfig.prompt_field_id
            }
          >
            {helixSaving ? 'Saving…' : 'Save & Activate'}
          </button>
          <button
            type="button"
            className="cfg-btn cfg-btn--secondary"
            onClick={fetchHelixStatus}
            disabled={helixChecking}
          >
            {helixChecking ? 'Loading…' : 'Load from Database'}
          </button>
          <label className="cfg-btn cfg-btn--secondary">
            Import JSON
            <input type="file" accept=".json" onChange={handleImportJson} style={{ display: 'none' }} />
          </label>
          <button
            type="button"
            className="cfg-btn cfg-btn--danger"
            onClick={handleHelixClear}
            disabled={helixSaving}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Clear confirmation modal — unchanged */}
      {showClearConfirm && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div style={{ backgroundColor: '#fff', borderRadius: 8, padding: '2rem', maxWidth: '400px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
            <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>Clear Helix Configuration?</h3>
            <p style={{ color: '#666', marginBottom: '1.5rem' }}>This will delete your Helix configuration and cannot be undone.</p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="cfg-btn cfg-btn--secondary"
                onClick={() => setShowClearConfirm(false)}
                disabled={helixSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="cfg-btn cfg-btn--primary"
                style={{ background: '#dc2626' }}
                onClick={confirmHelixClear}
                disabled={helixSaving}
              >
                {helixSaving ? 'Clearing…' : 'Clear'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
