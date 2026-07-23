// demo_api_ui/src/components/DashboardTokenRail.jsx
/**
 * Dashboard Token Chain rail — side-nav-style collapse + drag-to-resize width.
 * Keeps children mounted when collapsed so TraceRail state is preserved.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  TOKEN_RAIL_COLLAPSED_WIDTH,
  TOKEN_RAIL_MAX_WIDTH,
  TOKEN_RAIL_MIN_WIDTH,
  persistTokenRailCollapsed,
  persistTokenRailWidth,
  readStoredTokenRailCollapsed,
  readStoredTokenRailWidth,
} from "../utils/tokenRailLayout";
import "./DashboardTokenRail.css";

/** Set --ud-token-rail-width on :root synchronously so the grid can read it
 *  on the first paint (useEffect fires too late for grid-template-columns). */
if (typeof window !== "undefined") {
  const _w = readStoredTokenRailWidth();
  const _collapsed = readStoredTokenRailCollapsed();
  document.documentElement.style.setProperty(
    "--ud-token-rail-width",
    `${_collapsed ? TOKEN_RAIL_COLLAPSED_WIDTH : _w}px`,
  );
}

/**
 * @param {{ children: React.ReactNode }} props
 */
export default function DashboardTokenRail({ children }) {
  const [collapsed, setCollapsed] = useState(() =>
    typeof window !== "undefined" ? readStoredTokenRailCollapsed() : false,
  );
  const [width, setWidth] = useState(() =>
    typeof window !== "undefined"
      ? readStoredTokenRailWidth()
      : TOKEN_RAIL_MIN_WIDTH,
  );
  const isResizing = useRef(false);

  useEffect(() => {
    persistTokenRailWidth(width);
    const w = collapsed ? TOKEN_RAIL_COLLAPSED_WIDTH : width;
    document.documentElement.style.setProperty("--ud-token-rail-width", `${w}px`);
  }, [width, collapsed]);

  useEffect(() => {
    persistTokenRailCollapsed(collapsed);
  }, [collapsed]);

  /** Drag left edge: move left = wider (rail sits on the right). */
  const startResize = useCallback(
    (e) => {
      if (collapsed || e.button !== 0) return;
      e.preventDefault();
      isResizing.current = true;
      const startX = e.clientX;
      const startW = width;
      const onMove = (me) => {
        if (!isResizing.current) return;
        const next = Math.min(
          TOKEN_RAIL_MAX_WIDTH,
          Math.max(TOKEN_RAIL_MIN_WIDTH, startW + (startX - me.clientX)),
        );
        setWidth(next);
      };
      const onUp = () => {
        isResizing.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [collapsed, width],
  );

  const handleToggle = useCallback(() => {
    setCollapsed((c) => !c);
  }, []);

  const effectiveWidth = collapsed ? TOKEN_RAIL_COLLAPSED_WIDTH : width;

  return (
    <aside
      className={`ud-token-rail${collapsed ? " ud-token-rail--collapsed" : ""}`}
      aria-label="Token chain"
      data-testid="dashboard-token-rail"
      data-collapsed={collapsed ? "true" : "false"}
    >
      {!collapsed && (
        // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only drag; keyboard users use collapse toggle.
        <div
          className="ud-token-rail__resize-handle"
          onMouseDown={startResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Drag to resize token chain width"
          data-testid="dashboard-token-rail-resize"
        />
      )}
      <button
        type="button"
        className="ud-token-rail__toggle"
        onClick={handleToggle}
        aria-label={collapsed ? "Expand token chain" : "Collapse token chain"}
        aria-expanded={!collapsed}
        title={collapsed ? "Expand" : "Collapse"}
        data-testid="dashboard-token-rail-toggle"
      >
        {collapsed ? "←" : "→"}
      </button>
      {collapsed && (
        <span className="ud-token-rail__collapsed-label" aria-hidden="true">
          Token
        </span>
      )}
      <div
        className="section ud-token-rail__inner"
        hidden={collapsed}
        aria-hidden={collapsed}
      >
        {children}
      </div>
    </aside>
  );
}
