// banking_api_ui/src/components/shared/EducationDrawer.js
import React, { useState, useEffect, useRef } from "react";
import "./EducationDrawer.css";

/**
 * Slide-in drawer shell with pill tabs (same family as CIBA panel).
 */
export default function EducationDrawer({
  isOpen,
  onClose,
  title,
  tabs,
  initialTabId,
  width = "clamp(320px, 50vw, 100vw)",
}) {
  const [activeId, setActiveId] = useState(tabs[0]?.id);
  /** Only apply initialTabId when the drawer opens — not on every render (tabs[] is often a new array reference per parent render). */
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }
    const justOpened = !wasOpenRef.current;
    wasOpenRef.current = true;
    if (!justOpened) return;

    if (initialTabId && tabs.some((t) => t.id === initialTabId)) {
      setActiveId(initialTabId);
    } else {
      setActiveId((prev) =>
        tabs.find((t) => t.id === prev) ? prev : tabs[0]?.id,
      );
    }
  }, [isOpen, initialTabId, tabs]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const active = tabs.find((t) => t.id === activeId) || tabs[0];

  return (
    <>
      <div
        className="edu-drawer-overlay"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="edu-drawer"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edu-drawer-title"
      >
        {/* Top row: tab pills upper-left, close upper-right (cleaner for screen shares / demos) */}
        <div className="edu-drawer-topbar">
          <div className="edu-drawer-tabs" role="tablist" aria-label="Section">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeId === t.id}
                className={`edu-drawer-tab${activeId === t.id ? " edu-drawer-tab--active" : ""}`}
                onClick={() => setActiveId(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="edu-drawer-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="edu-drawer-title-row">
          <h2 id="edu-drawer-title" className="edu-drawer-title">
            {title}
          </h2>
        </div>
        <div className="edu-drawer-body scroll-area">
          {typeof active?.content === "function"
            ? active.content(setActiveId)
            : active?.content}
        </div>
      </div>
    </>
  );
}
