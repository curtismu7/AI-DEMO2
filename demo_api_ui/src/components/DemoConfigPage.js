// /demo-config: presenters tailor the sidebar per audience.
//
// Layout follows the Ping UI Standard through the shared primitives (components/pingUi,
// docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards, P5 key-value, P7 chips, P9 buttons.
// Skipped: P6 inspector and P8 diagram (this page has neither). The group list and its drag/drop stay
// page-local (DemoConfigPage.css).
//
// P9, "exactly one primary per view", by state:
//   loading          no buttons.
//   ready / saving   "Save & refresh sidebar" is the only primary: it is the page's one job and the
//                    only control that writes the sidebar. Reset order, Apply, Delete (then Confirm
//                    delete / Cancel in the row), Save as new config, expand, reorder and section
//                    toggles are secondaries.
//   error            same primary; the error card adds only a secondary Dismiss.
// Busy controls use aria-disabled, never the disabled attribute, so focus stays on the control that
// was activated. A group, or a page inside its group, can be reordered by keyboard with its up/down buttons.
// Moving a page to a different group is drag only; there is no keyboard path for that yet.
import React, { useState, useEffect, useCallback, useRef } from "react";
import useDividerDrag from "../hooks/useDividerDrag";
import PageHeader from "./common/PageHeader";
import { PingPage, SimBanner, PageFrame, Section, Card, StatusChip, KvList } from "./pingUi";
import "./DemoConfigPage.css";
import { NAV_STRUCTURE_CATALOG, applyChildOrder } from "../config/navStructureCatalog";
import { NAV_PAGE_PATHS } from "../config/navPagePaths";
import InlineSpinner from './shared/InlineSpinner';

const SECTION_GROUPS = [
  { label: "Core navigation", groups: ["Home", "Security Dashboard", "Skin Studio"] },
  {
    label: "AI and demos",
    groups: [
      "AI-Gateway",
      "AI Agent Gateway",
      "AI Product Pages",
      "Demos",
      "AI Flows",
      "Agent Studio (Preview)",
      "Learn & Present",
    ],
  },
  {
    label: "Security and identity",
    groups: [
      "Inspectors",
      "PingOne MCP",
      "PingOne Sample Apps",
      "PingOne Demo Apps",
      "Delegation & Consent",
      "Ping products",
      "Authorize",
      "OAuth & Identity",
      "Platform Admin",
      "Industry Verticals",
      "Users & Accounts",
      "AI Attack Demos",
    ],
  },
  {
    label: "Operations and observability",
    groups: [
      "Monitoring",
      "Telemetry",
      "Diagrams",
      "Demo arch slides",
      "MCP & Gateways",
      "Developer Tools",
      "System Tools",
      "Integration Tests",
    ],
  },
];

const SECTION_BY_GROUP = Object.fromEntries(
  SECTION_GROUPS.flatMap((section) => section.groups.map((group) => [group, section.label])),
);

const NAV_PAGE_PATH_OVERRIDES = {
  "AI Product Pages::PingOne Authorize": "/ai-products/authorize",
  "Monitoring::PingOne Authorize": "/monitoring/p1az",
  "OAuth & Identity::OAuth Debug": "/oauth-debug-logs",
  "System Tools::OAuth Debug": "/configure?tab=debug",
};

// A few sidebar entries launch an action instead of declaring a React Router
// path. The config table still needs a useful destination for every row.
const NAV_ACTION_PAGE_PATHS = {
  "Demo Script": "/dashboard",
  "PAC Editor": "http://127.0.0.1:9099",
  "Prompt Injection": "/dashboard",
  "HITL Bypass": "/dashboard",
  "Indirect Injection": "/dashboard",
  "Unauthorized Commitments": "/dashboard",
  "Scope Abuse": "/dashboard",
  "Intent Bypass": "/dashboard",
  "Learning Log": "/logs?mode=learn",
  "LibreChat (browser)": "http://localhost:3080",
  "LM Studio (Mac)": "/privilege-mcp-client?client=lm-studio",
  "API Docs (Swagger)": "/api/docs",
  "API Reference (Scalar)": "/api/reference",
};

function getPagePath(groupLabel, itemLabel) {
  return (
    NAV_PAGE_PATH_OVERRIDES[`${groupLabel}::${itemLabel}`] ||
    NAV_PAGE_PATHS[itemLabel] ||
    NAV_ACTION_PAGE_PATHS[itemLabel]
  );
}

function getGroupPath(group) {
  return getPagePath(group.label, group.label) || getPagePath(group.label, group.children?.[0]);
}

function matchesSearch(group, searchQuery) {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return true;
  return (
    group.label.toLowerCase().includes(query) ||
    (group.children || []).some((child) => child.toLowerCase().includes(query))
  );
}

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
  const { size: railWidth, handleProps: railHandleProps } = useDividerDrag({
    min: 240,
    max: 520,
    initial: 300,
    storageKey: "demo-config-rail-width",
    invert: true, // rail sits right of its divider
  });
  const [hiddenLabels, setHiddenLabels] = useState([]);
  const [navOrder, setNavOrder] = useState(null);
  const [groups, setGroups] = useState(() => NAV_STRUCTURE_CATALOG);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [collapsedSections, setCollapsedSections] = useState({});
  const [searchQuery, setSearchQuery] = useState("");
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
  // Screen-reader text for keyboard reorders (focus stays on the button that moved).
  const [announce, setAnnounce] = useState("");
  const messagesRef = useRef(null);
  const configListRef = useRef(null);
  const newNameRef = useRef(null);
  // Two-step delete: the id whose row is asking "Confirm delete / Cancel", and the id whose Delete
  // button should get focus back once the row returns to its normal state.
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const returnFocusIdRef = useRef(null);

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
    if (busy || next < 0 || next >= groups.length) return;
    setAnnounce(`Moved ${groups[index].label} ${dir < 0 ? "up" : "down"}: position ${next + 1} of ${groups.length}`);
    setGroups((prev) => {
      const arr = [...prev];
      [arr[index], arr[next]] = [arr[next], arr[index]];
      return arr;
    });
    setActiveConfigId(null);
  };

  // Keyboard path for a child drag within its own group.
  const moveChild = (groupLabel, child, dir) => {
    if (busy || searchQuery.trim()) return;
    const group = groups.find((g) => g.label === groupLabel);
    const from = group?.children?.indexOf(child) ?? -1;
    const to = from + dir;
    if (from < 0 || to < 0 || to >= group.children.length) return;
    setAnnounce(`Moved ${child} ${dir < 0 ? "up" : "down"} in ${groupLabel}: position ${to + 1} of ${group.children.length}`);
    setGroups((prev) =>
      prev.map((g) => {
        if (g.label !== groupLabel) return g;
        const arr = [...g.children];
        [arr[from], arr[to]] = [arr[to], arr[from]];
        return { ...g, children: arr };
      }),
    );
    setActiveConfigId(null);
  };

  // Safari/WebKit refuses to start an HTML5 drag unless dragstart writes to
  // dataTransfer, so both drag kinds set a payload (the label is decorative —
  // state lives in the refs).
  const onDragStart = (e, index) => {
    dragIndexRef.current = index;
    if (e.dataTransfer) {
      e.dataTransfer.setData("text/plain", groups[index]?.label || "");
      e.dataTransfer.effectAllowed = "move";
    }
  };
  const onGroupRowDragOver = (e, group, index) => {
    e.preventDefault();
    if (childDragRef.current) {
      // A child drag over a group row targets "append to this group".
      const droppable = Array.isArray(group.children);
      if (e.dataTransfer) e.dataTransfer.dropEffect = droppable ? "move" : "none";
      setChildDropTarget(droppable ? { group: group.label, index: -1 } : null);
    } else {
      setDragOverIndex(index);
    }
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
    if (e.dataTransfer) {
      e.dataTransfer.setData("text/plain", label);
      e.dataTransfer.effectAllowed = "move";
    }
  };
  const onChildDragOver = (e, group, index) => {
    if (!childDragRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
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

  const resetOrder = () => {
    if (busy) return;
    setGroups(NAV_STRUCTURE_CATALOG);
    setActiveConfigId(null);
  };

  const saveSelection = async () => {
    if (busy) return;
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
    if (!name || busy) return;
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
      // The Save button goes inert once the name is cleared, so keep focus in the form.
      newNameRef.current?.focus();
    } catch (err) {
      setError(`Failed to save config: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const applyConfig = async (config) => {
    if (busy) return;
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

  const findConfigButton = (attr, id) =>
    Array.from(configListRef.current?.querySelectorAll(`[${attr}]`) || []).find((el) => el.getAttribute(attr) === id);

  // Focus follows the two-step delete: Delete -> Cancel (the safe choice); Cancel/Escape/failure -> Delete again.
  useEffect(() => {
    if (confirmDeleteId) {
      findConfigButton("data-dc-cancel", confirmDeleteId)?.focus();
    } else if (returnFocusIdRef.current) {
      findConfigButton("data-dc-delete", returnFocusIdRef.current)?.focus();
      returnFocusIdRef.current = null;
    }
  }, [confirmDeleteId]);

  const askDelete = (config) => {
    if (busy) return;
    setConfirmDeleteId(config.id);
    setAnnounce(`Delete "${config.name}"? This removes it from the shared library for everyone. Confirm or cancel.`);
  };

  const cancelDelete = () => {
    returnFocusIdRef.current = confirmDeleteId;
    setConfirmDeleteId(null);
    setAnnounce("");
  };

  const deleteConfig = async (config) => {
    if (busy) return;
    setBusy(true);
    setAnnounce("");
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
      // The card that held focus is gone: land on the saved-configs list, not the top of the page.
      configListRef.current?.focus();
    } catch (err) {
      returnFocusIdRef.current = config.id;
      setError(`Failed to delete "${config.name}": ${err.message}`);
    } finally {
      setConfirmDeleteId(null);
      setBusy(false);
    }
  };

  // Groups of the current catalog this config shows. hiddenLabels can name labels that are no longer in
  // the catalog, so count what is shown rather than subtracting (that went negative).
  const shownCount = (config) =>
    NAV_STRUCTURE_CATALOG.filter((g) => !(config.hiddenLabels || []).includes(g.label)).length;

  const visibleCount = groups.filter((g) => !hiddenLabels.includes(g.label)).length;
  const filteredGroups = groups.filter((group) => matchesSearch(group, searchQuery));
  const groupedSections = SECTION_GROUPS.map((section) => ({
    ...section,
    groups: filteredGroups.filter((group) =>
      (SECTION_BY_GROUP[group.label] || "Other") === section.label,
    ),
  }));
  const otherGroups = filteredGroups.filter((group) => !SECTION_BY_GROUP[group.label]);
  if (otherGroups.length > 0) groupedSections.push({ label: "Other", groups: otherGroups });
  const hasSearchResults = groupedSections.some((section) => section.groups.length > 0);

  return (
    <PingPage className="dc-page">
      <SimBanner data-testid="dc-banner">
        <strong>LIVE SETTINGS</strong> — nothing on this page is simulated. Save &amp; refresh sidebar writes your
        sidebar choices to this server, for your account only. Saved configs are shared: saving or deleting a named
        config changes the one library everyone using this server sees. Applying a saved config also sets the
        feature flags stored with it, and feature flags apply to everyone using this server.
      </SimBanner>
      <PageHeader
        eyebrow="Admin · Presenter tools"
        title="Demo Config"
        summary="Tailor the sidebar for your audience. Checked groups are visible. Drag a group by its dotted handle to reorder it, or use its up and down buttons. Expand a group to reorder its pages, or drag a page into another group."
      />
      <PageFrame>
        <div className="dc-messages" ref={messagesRef} tabIndex={-1}>
          <div role="status" aria-live="polite">
            {toast && (
              <Card tone="ok" data-testid="dc-toast">
                <p className="pu-status-line dc-message">
                  <StatusChip tone="ok">Done</StatusChip>
                  <span>{toast}</span>
                </p>
              </Card>
            )}
            <span className="dc-sr-only">{announce}</span>
          </div>
          {error && (
            <Card tone="danger" role="alert" data-testid="dc-error">
              <p className="pu-status-line dc-message">
                <StatusChip tone="danger">Error</StatusChip>
                <span>{error}</span>
                <button
                  type="button"
                  className="pu-btn dc-dismiss"
                  onClick={() => {
                    setError(null);
                    setAnnounce("");
                    messagesRef.current?.focus();
                  }}
                >
                  Dismiss
                </button>
              </p>
            </Card>
          )}
        </div>

        {loading ? (
          <div className="dc-loading"><InlineSpinner label="Loading…" /></div>
        ) : (
          <div className="dc-layout" style={{ "--dc-rail-w": `${railWidth}px` }}>
            <Section
              id="dc-groups-h"
              kicker="1 · Sidebar groups"
              title="What the sidebar shows"
              lede="Choose the groups an audience sees and put them in the order you present them."
            >
              <Card>
                <p className="pu-status-line">
                  <StatusChip tone={flagOn ? "ok" : "neutral"}>{flagOn ? "On" : "Off"}</StatusChip>
                  <span>Sidebar customization</span>
                  <span className="dc-count">
                    {visibleCount} of {groups.length} visible
                  </span>
                </p>
                {!flagOn && (
                  <p className="pu-note">
                    While this flag is off the server returns no hidden groups, so the sidebar shows every
                    group whatever is unchecked here.
                  </p>
                )}

                <div className="dc-search-wrap">
                  <label className="pu-label" htmlFor="demo-config-search">
                    Search groups and pages
                  </label>
                  <div className="dc-search-input-wrap">
                    <span aria-hidden="true">🔍</span>
                    <input
                      id="demo-config-search"
                      type="search"
                      role="searchbox"
                      aria-label="Search groups and pages"
                      placeholder="Search by group or page name"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        className="dc-icon-btn"
                        onClick={() => setSearchQuery("")}
                        aria-label="Clear search"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                <div className="dc-group-list">
                  {groupedSections.map((section) => {
                    if (section.groups.length === 0) return null;
                    const isSectionOpen = searchQuery.trim() || !collapsedSections[section.label];
                    return (
                      <section className="dc-section" key={section.label}>
                        <button
                          type="button"
                          className="dc-section__toggle"
                          onClick={() =>
                            setCollapsedSections((prev) => ({
                              ...prev,
                              [section.label]: !prev[section.label],
                            }))
                          }
                          aria-expanded={!!isSectionOpen}
                        >
                          <span>{section.label}</span>
                          <span className="dc-section__meta">
                            {section.groups.length} groups {isSectionOpen ? "▲" : "▼"}
                          </span>
                        </button>
                        {isSectionOpen && (
                          <div className="dc-section__body">
                            <div className="dc-page-table-header" role="row">
                              <span aria-hidden="true" />
                              <span role="columnheader">Navigation item</span>
                              <span role="columnheader">Page</span>
                              <span aria-hidden="true" />
                              <span aria-hidden="true" />
                            </div>
                            {section.groups.map((group) => {
                              const groupIndex = groups.indexOf(group);
                              const isHidden = hiddenLabels.includes(group.label);
                              const isExpanded = !!expandedGroups[group.label] || !!searchQuery.trim();
                              const query = searchQuery.trim().toLowerCase();
                              const showAllChildren = !query || group.label.toLowerCase().includes(query);
                              const visibleChildren = (group.children || [])
                                .map((child, childIndex) => ({ child, childIndex }))
                                .filter(({ child }) =>
                                  showAllChildren || child.toLowerCase().includes(query),
                                );
                              const isDragTarget =
                                dragOverIndex === groupIndex ||
                                (childDropTarget &&
                                  childDropTarget.group === group.label &&
                                  childDropTarget.index === -1);
                              const groupPath = getGroupPath(group);

                              return (
                                <div
                                  key={group.label}
                                  className={`dc-group-row${isHidden ? " dc-group-row--hidden" : ""}${isDragTarget ? " dc-group-row--drag-over" : ""}`}
                                  draggable={!searchQuery}
                                  onDragStart={(e) => onDragStart(e, groupIndex)}
                                  onDragOver={(e) => onGroupRowDragOver(e, group, groupIndex)}
                                  onDrop={(e) => onGroupRowDrop(e, group, groupIndex)}
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
                                    {groupPath && (
                                      <a className="dc-open-link" href={groupPath} aria-label={`Open ${group.label}`}>
                                        Open page
                                      </a>
                                    )}
                                    {!groupPath && <span className="dc-page-link-placeholder">—</span>}
                                    {group.children && group.children.length > 0 && (
                                      <button
                                        type="button"
                                        className="dc-icon-btn dc-expand-btn"
                                        onClick={() => toggleExpand(group.label)}
                                        aria-label={`${isExpanded ? "Collapse" : "Expand"} ${group.label}`}
                                        aria-expanded={isExpanded}
                                      >
                                        {isExpanded ? "▲" : "▼"}
                                        <span className="dc-child-count">{group.children.length}</span>
                                      </button>
                                    )}
                                    <div className="dc-reorder-btns">
                                      <button
                                        type="button"
                                        className="dc-icon-btn"
                                        onClick={() => moveGroup(groupIndex, -1)}
                                        aria-disabled={busy || groupIndex === 0 ? "true" : undefined}
                                        aria-label={`Move ${group.label} up`}
                                        title="Move up"
                                      >↑</button>
                                      <button
                                        type="button"
                                        className="dc-icon-btn"
                                        onClick={() => moveGroup(groupIndex, 1)}
                                        aria-disabled={busy || groupIndex === groups.length - 1 ? "true" : undefined}
                                        aria-label={`Move ${group.label} down`}
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
                                      {visibleChildren.map(({ child, childIndex }) => {
                                        const childPath = getPagePath(group.label, child);
                                        const childLocked = busy || !!searchQuery.trim();
                                        return (
                                          <li
                                            key={child}
                                            className={`dc-child-item dc-child-item--draggable${
                                              childDropTarget &&
                                              childDropTarget.group === group.label &&
                                              childDropTarget.index === childIndex
                                                ? " dc-child-item--drag-over"
                                                : ""
                                            }`}
                                            draggable={!searchQuery}
                                            onDragStart={(e) => onChildDragStart(e, group.label, child)}
                                            onDragOver={(e) => onChildDragOver(e, group.label, childIndex)}
                                            onDrop={(e) => onChildDrop(e, group.label, childIndex)}
                                            onDragEnd={onChildDragEnd}
                                          >
                                            <span className="dc-drag-handle" aria-hidden="true">⠿</span>
                                            <span className="dc-child-label">{child}</span>
                                            {childPath && (
                                              <a className="dc-open-link" href={childPath} aria-label={`Open ${child}`}>
                                                Open page
                                              </a>
                                            )}
                                            {!childPath && <span className="dc-page-link-placeholder">—</span>}
                                            <span className="dc-reorder-btns">
                                              <button
                                                type="button"
                                                className="dc-icon-btn"
                                                onClick={() => moveChild(group.label, child, -1)}
                                                aria-disabled={childLocked || childIndex === 0 ? "true" : undefined}
                                                aria-label={`Move ${child} up in ${group.label}`}
                                                title="Move up"
                                              >↑</button>
                                              <button
                                                type="button"
                                                className="dc-icon-btn"
                                                onClick={() => moveChild(group.label, child, 1)}
                                                aria-disabled={childLocked || childIndex === group.children.length - 1 ? "true" : undefined}
                                                aria-label={`Move ${child} down in ${group.label}`}
                                                title="Move down"
                                              >↓</button>
                                            </span>
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    );
                  })}
                  {!hasSearchResults && (
                    <div className="pu-empty pu-note dc-no-results">No groups or pages match “{searchQuery}”.</div>
                  )}
                </div>

                <div className="pu-actions dc-panel__actions">
                  {!isDefaultOrder && (
                    <button
                      type="button"
                      className="pu-btn"
                      onClick={resetOrder}
                      aria-disabled={busy ? "true" : undefined}
                    >
                      Reset order
                    </button>
                  )}
                  <button
                    type="button"
                    className="pu-btn pu-btn--primary"
                    onClick={saveSelection}
                    aria-disabled={busy ? "true" : undefined}
                  >
                    Save &amp; refresh sidebar
                  </button>
                </div>
              </Card>
            </Section>

            <div className="divider-drag-handle" aria-label="Resize saved-configs rail" {...railHandleProps} />

            <aside className="dc-configs">
              <Section
                id="dc-configs-h"
                kicker="2 · Saved configs"
                title="Saved configs"
                lede="A named config bundles a sidebar selection with flag states. Apply one to switch both at once."
              >
                <div className="dc-config-list" ref={configListRef} tabIndex={-1} role="group" aria-labelledby="dc-configs-h">
                  {configs.map((config) => {
                    const isActive = activeConfigId === config.id;
                    return (
                      <Card key={config.id} tone={isActive ? "ok" : "neutral"} data-testid={`dc-config-${config.id}`}>
                        <div className="dc-config-head">
                          <h3 className="pu-h3">{config.name}</h3>
                          {isActive && <StatusChip tone="ok">Active</StatusChip>}
                        </div>
                        <KvList
                          items={[
                            { label: "Groups shown", value: shownCount(config) },
                            { label: "Flags", value: Object.keys(config.flagSnapshot || {}).length },
                          ]}
                        />
                        <div
                          className="pu-actions"
                          onKeyDown={(e) => {
                            if (e.key === "Escape" && confirmDeleteId === config.id) {
                              e.stopPropagation();
                              cancelDelete();
                            }
                          }}
                        >
                          <button
                            type="button"
                            className="pu-btn"
                            onClick={() => applyConfig(config)}
                            aria-disabled={busy ? "true" : undefined}
                            aria-label={`Apply ${config.name}`}
                          >
                            Apply
                          </button>
                          {!config.isBuiltin && confirmDeleteId !== config.id && (
                            <button
                              type="button"
                              className="pu-btn dc-btn-danger"
                              data-dc-delete={config.id}
                              onClick={() => askDelete(config)}
                              aria-disabled={busy ? "true" : undefined}
                              aria-label={`Delete ${config.name}`}
                            >
                              Delete
                            </button>
                          )}
                          {!config.isBuiltin && confirmDeleteId === config.id && (
                            <>
                              <button
                                type="button"
                                className="pu-btn dc-btn-danger"
                                onClick={() => deleteConfig(config)}
                                aria-disabled={busy ? "true" : undefined}
                                aria-label={`Confirm delete ${config.name}`}
                              >
                                Confirm delete
                              </button>
                              <button
                                type="button"
                                className="pu-btn"
                                data-dc-cancel={config.id}
                                onClick={cancelDelete}
                                aria-label={`Cancel delete ${config.name}`}
                              >
                                Cancel
                              </button>
                            </>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
                <Card tone="neutral" title="Save the current selection">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveAsNewConfig();
                    }}
                  >
                    <label className="pu-label" htmlFor="dc-new-config-name">Config name</label>
                    <input
                      id="dc-new-config-name"
                      ref={newNameRef}
                      type="text"
                      className="dc-input"
                      placeholder="Name this selection…"
                      value={newConfigName}
                      onChange={(e) => setNewConfigName(e.target.value)}
                    />
                    <div className="pu-actions">
                      <button
                        type="submit"
                        className="pu-btn"
                        aria-disabled={busy || !newConfigName.trim() ? "true" : undefined}
                      >
                        Save as new config
                      </button>
                    </div>
                  </form>
                </Card>
              </Section>
            </aside>
          </div>
        )}
      </PageFrame>
    </PingPage>
  );
}
