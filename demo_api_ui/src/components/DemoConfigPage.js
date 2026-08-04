import React, { useState, useEffect, useCallback, useRef } from "react";
import "../styles/appShellPages.css";
import "./DemoConfigPage.css";
import { NAV_STRUCTURE_CATALOG, applyChildOrder } from "../config/navStructureCatalog";

// Apply a saved navOrder (array of labels) to the catalog, appending any new
// labels not yet in the saved order at the end.
function applyOrder(catalog, navOrder) {
  if (!Array.isArray(navOrder) || navOrder.length === 0) return catalog;
  const byLabel = Object.fromEntries(catalog.map((g) => [g.label, g]));
  const ordered = navOrder.filter((l) => byLabel[l]).map((l) => byLabel[l]);
  const rest = catalog.filter((g) => !navOrder.includes(g.label));
  return [...ordered, ...rest];
}

export default function DemoConfigPage() {
  const [hiddenLabels, setHiddenLabels] = useState([]);
  const [navOrder, setNavOrder] = useState(null);
  const [groups, setGroups] = useState(() => NAV_STRUCTURE_CATALOG);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [activeConfigId, setActiveConfigId] = useState(null);
  const [configs, setConfigs] = useState([]);
  const [flagOn, setFlagOn] = useState(false);
  const [newConfigName, setNewConfigName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const dragIndexRef = useRef(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const childDragRef = useRef(null);
  const [childDropTarget, setChildDropTarget] = useState(null);

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
      const savedOrder = prefs.navOrder || null;
      const savedChildOrder = prefs.childOrder || null;
      setHiddenLabels(prefs.hiddenLabels || []);
      setActiveConfigId(prefs.activeConfigId || null);
      setFlagOn(!!prefs.flagOn);
      setConfigs(configsData.configs || []);
      setNavOrder(savedOrder);
      setGroups(applyChildOrder(applyOrder(NAV_STRUCTURE_CATALOG, savedOrder), savedChildOrder));
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

  const toggleExpand = (label) => {
    setExpandedGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const moveGroup = (index, dir) => {
    const next = index + dir;
    if (next < 0 || next >= groups.length) return;
    setGroups((prev) => {
      const arr = [...prev];
      [arr[index], arr[next]] = [arr[next], arr[index]];
      return arr;
    });
    setActiveConfigId(null);
  };

  const onDragStart = (index) => { dragIndexRef.current = index; };
  const onDragOver = (e, index) => {
    e.preventDefault();
    // A child drag over a group row targets "append to this group", not reorder.
    if (!childDragRef.current) setDragOverIndex(index);
  };
  const onDrop = (e, dropIndex) => {
    e.preventDefault();
    const fromIndex = dragIndexRef.current;
    if (fromIndex === null || fromIndex === dropIndex) { setDragOverIndex(null); return; }
    setGroups((prev) => {
      const arr = [...prev];
      const [removed] = arr.splice(fromIndex, 1);
      arr.splice(dropIndex, 0, removed);
      return arr;
    });
    dragIndexRef.current = null;
    setDragOverIndex(null);
    setActiveConfigId(null);
  };
  const onDragEnd = () => { dragIndexRef.current = null; setDragOverIndex(null); };

  // --- child items: drag to reorder within a group or move to another group ---
  const onChildDragStart = (e, fromGroup, label) => {
    e.stopPropagation();
    childDragRef.current = { fromGroup, label };
  };
  const onChildDragOver = (e, group, index) => {
    if (!childDragRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    setChildDropTarget({ group, index });
  };
  // Drop a dragged child: before childOrder[toIndex] of toGroup, or appended
  // when toIndex is null (drop on the group row / list tail).
  const onChildDrop = (e, toGroup, toIndex) => {
    const drag = childDragRef.current;
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();
    setGroups((prev) =>
      prev.map((g) => {
        if (!Array.isArray(g.children)) return g;
        let children = g.children;
        if (g.label === drag.fromGroup) children = children.filter((c) => c !== drag.label);
        if (g.label === toGroup) {
          const arr = [...children];
          const at = toIndex === null ? arr.length : Math.min(toIndex, arr.length);
          arr.splice(at, 0, drag.label);
          children = arr;
        }
        return children === g.children ? g : { ...g, children };
      }),
    );
    childDragRef.current = null;
    setChildDropTarget(null);
    setActiveConfigId(null);
  };
  const onChildDragEnd = () => { childDragRef.current = null; setChildDropTarget(null); };

  // Group-row drop doubles as "append here" for a dragged child (works on
  // collapsed groups too); group reorder keeps its own path.
  const onGroupRowDrop = (e, group, dropIndex) => {
    if (childDragRef.current) {
      if (Array.isArray(group.children)) onChildDrop(e, group.label, null);
      else onChildDragEnd();
      return;
    }
    onDrop(e, dropIndex);
  };

  const currentOrder = groups.map((g) => g.label);
  const defaultChildrenByLabel = Object.fromEntries(
    NAV_STRUCTURE_CATALOG.map((g) => [g.label, g.children || null]),
  );
  // Sparse override: only groups whose child list differs from the catalog.
  const childOrderEntries = groups
    .filter((g) => Array.isArray(g.children))
    .filter(
      (g) => JSON.stringify(g.children) !== JSON.stringify(defaultChildrenByLabel[g.label] || []),
    )
    .map((g) => [g.label, g.children]);
  const currentChildOrder = childOrderEntries.length
    ? Object.fromEntries(childOrderEntries)
    : null;
  const isDefaultOrder =
    currentChildOrder === null &&
    JSON.stringify(currentOrder) ===
      JSON.stringify(NAV_STRUCTURE_CATALOG.map((g) => g.label));

  const resetOrder = () => { setGroups(NAV_STRUCTURE_CATALOG); setActiveConfigId(null); };

  const saveSelection = async () => {
    setBusy(true);
    setError(null);
    try {
      const orderToSave = isDefaultOrder ? null : currentOrder;
      const res = await fetch("/api/user/nav-config", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hiddenLabels,
          activeConfigId: null,
          navOrder: orderToSave,
          childOrder: currentChildOrder,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setNavOrder(orderToSave);
      setToast("Saved — sidebar updated");
      window.dispatchEvent(new CustomEvent("nav-config-changed"));
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
        body: JSON.stringify({ hiddenLabels: config.hiddenLabels, activeConfigId: config.id, navOrder }),
      });
      const putData = await putRes.json();
      if (!putRes.ok) throw new Error(putData.error || `HTTP ${putRes.status}`);

      setHiddenLabels(config.hiddenLabels || []);
      setActiveConfigId(config.id);
      setToast(`Applied "${config.name}"`);
      window.dispatchEvent(new CustomEvent("nav-config-changed"));
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

  const visibleCount = groups.filter((g) => !hiddenLabels.includes(g.label)).length;

  return (
    <div className="app-page dc-page">
      <div className="app-page-header">
        <div className="app-page-header__left">
          <h1 className="app-page-title">Demo Config</h1>
          <p className="app-page-subtitle">
            Toggle groups on/off, drag groups to reorder, drag the items under a group to
            reorder or move them to another group, then save to update the sidebar.
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
              <h2>Sidebar groups</h2>
              <span className="dc-count">
                {visibleCount} of {groups.length} visible
              </span>
            </div>

            <div className="dc-group-list">
              {groups.map((group, index) => {
                const isHidden = hiddenLabels.includes(group.label);
                const isExpanded = !!expandedGroups[group.label];
                const isDragTarget = dragOverIndex === index;

                return (
                  <div
                    key={group.label}
                    className={`dc-group-row${isHidden ? " dc-group-row--hidden" : ""}${isDragTarget ? " dc-group-row--drag-over" : ""}`}
                    draggable
                    onDragStart={() => onDragStart(index)}
                    onDragOver={(e) => onDragOver(e, index)}
                    onDrop={(e) => onGroupRowDrop(e, group, index)}
                    onDragEnd={onDragEnd}
                  >
                    <div className="dc-group-row__main">
                      <span className="dc-drag-handle" aria-hidden="true">⠿</span>
                      <label className="dc-group-toggle">
                        <input
                          type="checkbox"
                          checked={!isHidden}
                          onChange={() => toggleLabel(group.label)}
                          disabled={busy}
                          aria-label={`Show ${group.label}`}
                        />
                        <span className="dc-group-label">{group.label}</span>
                      </label>
                      {group.children && group.children.length > 0 && (
                        <button
                          type="button"
                          className="dc-expand-btn"
                          onClick={() => toggleExpand(group.label)}
                          aria-label={isExpanded ? "Collapse" : "Expand"}
                        >
                          {isExpanded ? "▲" : "▼"}
                          <span className="dc-child-count">{group.children.length}</span>
                        </button>
                      )}
                      <div className="dc-reorder-btns">
                        <button
                          type="button"
                          className="dc-reorder-btn"
                          onClick={() => moveGroup(index, -1)}
                          disabled={busy || index === 0}
                          aria-label="Move up"
                          title="Move up"
                        >↑</button>
                        <button
                          type="button"
                          className="dc-reorder-btn"
                          onClick={() => moveGroup(index, 1)}
                          disabled={busy || index === groups.length - 1}
                          aria-label="Move down"
                          title="Move down"
                        >↓</button>
                      </div>
                    </div>
                    {isExpanded && group.children && (
                      <ul
                        className="dc-child-list"
                        onDragOver={(e) => onChildDragOver(e, group.label, group.children.length)}
                        onDrop={(e) => onChildDrop(e, group.label, null)}
                      >
                        {group.children.map((child, childIndex) => (
                          <li
                            key={child}
                            className={`dc-child-item dc-child-item--draggable${
                              childDropTarget &&
                              childDropTarget.group === group.label &&
                              childDropTarget.index === childIndex
                                ? " dc-child-item--drag-over"
                                : ""
                            }`}
                            draggable
                            onDragStart={(e) => onChildDragStart(e, group.label, child)}
                            onDragOver={(e) => onChildDragOver(e, group.label, childIndex)}
                            onDrop={(e) => onChildDrop(e, group.label, childIndex)}
                            onDragEnd={onChildDragEnd}
                          >
                            <span className="dc-drag-handle" aria-hidden="true">⠿</span>
                            {child}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="dc-panel__actions">
              {!isDefaultOrder && (
                <button
                  type="button"
                  className="dc-btn-secondary"
                  onClick={resetOrder}
                  disabled={busy}
                >
                  Reset order
                </button>
              )}
              <button
                type="button"
                className="dc-btn-primary"
                onClick={saveSelection}
                disabled={busy}
              >
                Save &amp; refresh sidebar
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
                  {NAV_STRUCTURE_CATALOG.length - (config.hiddenLabels || []).length} items &middot;{" "}
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
              <button
                type="button"
                onClick={saveAsNewConfig}
                disabled={busy || !newConfigName.trim()}
              >
                Save as new config
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
