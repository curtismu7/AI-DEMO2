import React, { useState, useEffect, useCallback } from "react";
import "../styles/appShellPages.css";
import "./DemoConfigPage.css";
import { NAV_ITEM_CATALOG } from "../config/navItemsCatalog";

export default function DemoConfigPage() {
  const [hiddenLabels, setHiddenLabels] = useState([]);
  const [activeConfigId, setActiveConfigId] = useState(null);
  const [configs, setConfigs] = useState([]);
  const [flagOn, setFlagOn] = useState(false);
  const [newConfigName, setNewConfigName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [prefsRes, configsRes] = await Promise.all([
        fetch("/api/user/nav-config", { credentials: "include" }),
        fetch("/api/nav-configs", { credentials: "include" }),
      ]);
      const prefs = await prefsRes.json();
      const configsData = await configsRes.json();
      if (!prefsRes.ok) throw new Error(prefs.error || `HTTP ${prefsRes.status}`);
      if (!configsRes.ok) throw new Error(configsData.error || `HTTP ${configsRes.status}`);
      setHiddenLabels(prefs.hiddenLabels || []);
      setActiveConfigId(prefs.activeConfigId || null);
      setFlagOn(!!prefs.flagOn);
      setConfigs(configsData.configs || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const toggleLabel = (label) => {
    setHiddenLabels((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label],
    );
    setActiveConfigId(null);
  };

  const saveSelection = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/user/nav-config", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hiddenLabels, activeConfigId: null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setToast("Selection saved");
    } catch (err) {
      setError(`Failed to save: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const saveAsNewConfig = async () => {
    const name = newConfigName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const flagsRes = await fetch("/api/admin/feature-flags", { credentials: "include" });
      const flagsData = await flagsRes.json();
      if (!flagsRes.ok) throw new Error(flagsData.error || `HTTP ${flagsRes.status}`);
      const flagSnapshot = Object.fromEntries((flagsData.flags || []).map((f) => [f.id, f.value]));
      const res = await fetch("/api/nav-configs", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, hiddenLabels, flagSnapshot }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setConfigs((prev) => [...prev, data.config]);
      setNewConfigName("");
      setToast(`"${name}" saved`);
    } catch (err) {
      setError(`Failed to save config: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const applyConfig = async (config) => {
    setBusy(true);
    setError(null);
    try {
      const flagSnapshot = config.flagSnapshot || {};
      if (Object.keys(flagSnapshot).length > 0) {
        const patchRes = await fetch("/api/admin/feature-flags", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates: flagSnapshot }),
        });
        const patchData = await patchRes.json();
        if (!patchRes.ok) throw new Error(patchData.error || `HTTP ${patchRes.status}`);
      }

      const putRes = await fetch("/api/user/nav-config", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hiddenLabels: config.hiddenLabels, activeConfigId: config.id }),
      });
      const putData = await putRes.json();
      if (!putRes.ok) throw new Error(putData.error || `HTTP ${putRes.status}`);

      setHiddenLabels(config.hiddenLabels || []);
      setActiveConfigId(config.id);
      setToast(`Applied "${config.name}"`);
    } catch (err) {
      setError(`Failed to apply "${config.name}": ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const deleteConfig = async (config) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/nav-configs/${config.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setConfigs((prev) => prev.filter((c) => c.id !== config.id));
      if (activeConfigId === config.id) setActiveConfigId(null);
      setToast(`"${config.name}" deleted`);
    } catch (err) {
      setError(`Failed to delete "${config.name}": ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const visibleCount = NAV_ITEM_CATALOG.length - hiddenLabels.length;

  return (
    <div className="app-page">
      <div className="app-page-header">
        <div className="app-page-header__left">
          <h1 className="app-page-title">Demo Config</h1>
          <p className="app-page-subtitle">
            Choose which sidebar items show for you, then save the selection as a reusable config.
          </p>
        </div>
        <span className={`dc-flag-pill${flagOn ? " dc-flag-pill--on" : ""}`}>
          Sidebar Customization: {flagOn ? "ON" : "OFF"}
        </span>
      </div>

      {error && (
        <div className="dc-error" role="alert">
          <strong>Error:</strong> {error}
          <button type="button" className="dc-error__dismiss" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}
      {toast && <div className="dc-toast">✅ {toast}</div>}

      {loading ? (
        <div className="dc-loading">Loading…</div>
      ) : (
        <div className="dc-layout">
          <section className="dc-panel">
            <div className="dc-panel__head">
              <h2>Sidebar items</h2>
              <span className="dc-count">
                {visibleCount} of {NAV_ITEM_CATALOG.length} visible
              </span>
            </div>
            <div className="dc-item-grid">
              {NAV_ITEM_CATALOG.map((label) => (
                <label key={label} className="dc-nav-check">
                  <input
                    type="checkbox"
                    checked={!hiddenLabels.includes(label)}
                    onChange={() => toggleLabel(label)}
                    disabled={busy}
                    aria-label={label}
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="dc-panel__actions">
              <button type="button" className="dc-btn-primary" onClick={saveSelection} disabled={busy}>
                Save current selection
              </button>
            </div>
          </section>

          <aside className="dc-configs">
            <h2>Saved configs</h2>
            <p className="dc-hint">
              Named configs bundle a sidebar selection + flag states. Apply one to switch both at once.
            </p>
            {configs.map((config) => (
              <div
                key={config.id}
                className={`dc-config-card${activeConfigId === config.id ? " dc-config-card--active" : ""}`}
              >
                <div className="dc-config-card__row1">
                  <span className="dc-config-card__name">{config.name}</span>
                  {activeConfigId === config.id && <span className="dc-badge">Active</span>}
                </div>
                <p className="dc-config-card__meta">
                  {NAV_ITEM_CATALOG.length - (config.hiddenLabels || []).length} items &middot;{" "}
                  {Object.keys(config.flagSnapshot || {}).length} flags
                </p>
                <div className="dc-config-card__actions">
                  <button type="button" onClick={() => applyConfig(config)} disabled={busy}>
                    Apply
                  </button>
                  {!config.isBuiltin && (
                    <button
                      type="button"
                      className="dc-btn-danger"
                      onClick={() => deleteConfig(config)}
                      disabled={busy}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
            <div className="dc-new-config">
              <input
                type="text"
                placeholder="Name this selection…"
                value={newConfigName}
                onChange={(e) => setNewConfigName(e.target.value)}
                disabled={busy}
              />
              <button type="button" onClick={saveAsNewConfig} disabled={busy || !newConfigName.trim()}>
                Save as new config
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
