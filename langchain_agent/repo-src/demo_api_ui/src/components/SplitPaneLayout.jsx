import React, { useState, useRef, useCallback, useEffect } from 'react';
import './SplitPaneLayout.css';

const STORAGE_KEY = 'splitPaneMainWidth';
const DEFAULT_MAIN_PCT = 60;
const MIN_PCT = 25;
const MAX_PCT = 80;

/**
 * SplitPaneLayout — Resizable split-pane wrapper component
 *
 * Provides a flexible layout with agent pane (primary) and architecture panel (secondary).
 * Users can drag the divider to resize columns; width is persisted in localStorage.
 * Responsive: Desktop (flex-row) → Tablet (adjusted widths) → Mobile (flex-column stacked)
 *
 * @param {React.ReactNode} children - Content for the agent pane (BankingAgent, etc.)
 * @param {React.ReactNode} archPanel - Content for the architecture panel (ArchitectureTabsPanel)
 * @param {string} [className] - Optional additional CSS class names
 * @returns {React.ReactElement}
 */
const SplitPaneLayout = ({ children, archPanel, className = '' }) => {
  const [mainPct, setMainPct] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const n = Number(saved);
        if (n >= MIN_PCT && n <= MAX_PCT) return n;
      }
    } catch { /* ignore */ }
    return DEFAULT_MAIN_PCT;
  });

  const containerRef = useRef(null);
  const draggingRef = useRef(false);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      let pct = (x / rect.width) * 100;
      pct = Math.max(MIN_PCT, Math.min(MAX_PCT, pct));
      setMainPct(pct);
    };

    const handleMouseUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Persist to localStorage on change (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, String(Math.round(mainPct))); } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [mainPct]);

  const handleDoubleClick = useCallback(() => {
    setMainPct(DEFAULT_MAIN_PCT);
  }, []);

  return (
    <div className={`split-pane-layout ${className}`.trim()} ref={containerRef}>
      <div className="split-pane-agent-pane" style={{ flexBasis: `${mainPct}%` }}>
        {children}
      </div>
      <div
        className="split-pane-resize-handle"
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        title="Drag to resize (double-click to reset)"
        role="separator"
        aria-orientation="vertical"
      />
      <aside className="split-pane-architecture-pane" style={{ flexBasis: `${100 - mainPct}%` }}>
        {archPanel}
      </aside>
    </div>
  );
};

export default SplitPaneLayout;
