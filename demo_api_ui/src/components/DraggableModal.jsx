import React, { useState, useCallback, useEffect } from "react";
import ReactDOM, { createPortal } from "react-dom";
import { useDraggablePanel } from "../hooks/useDraggablePanel";
import "./DraggableModal.css";

function getSingletonRegistry() {
  if (typeof window === "undefined") return null;
  if (!window.__dmSingletonRegistry) {
    window.__dmSingletonRegistry = new Map();
  }
  return window.__dmSingletonRegistry;
}

// Separate React root in the popup window so DOM events fire through their own
// event-delegation tree. createPortal alone breaks because events in a foreign
// window never reach the parent window's React root.
function PopOutPortal({ win, children }) {
  const rootRef = React.useRef(null);
  const containerRef = React.useRef(null);

  React.useEffect(() => {
    const container = win.document.getElementById("dm-root");
    if (!container) return;
    containerRef.current = container;
    const root = ReactDOM.createRoot(container);
    rootRef.current = root;
    root.render(children);
    return () => {
      rootRef.current = null;
      containerRef.current = null;
      // Defer unmount so React doesn't unmount during a commit
      setTimeout(() => { try { root.unmount(); } catch (_) {} }, 0);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win]);

  React.useEffect(() => {
    if (rootRef.current) rootRef.current.render(children);
  }, [children]);

  return null;
}

/**
 * DraggableModal — shared base for all modals.
 *
 * Features:
 *   - Drag from title bar
 *   - 8-direction resize from edges/corners
 *   - 🪟 pop-out to new browser window (React portal keeps state intact)
 *   - ✕ close button in title bar
 *   - Close button at bottom (default footer; pass footer={<…>} to customise,
 *     or footer={null} to suppress)
 *   - Body scrolls when content overflows; no scrollbar on initial render
 *
 * Props:
 *   isOpen        boolean
 *   onClose       () => void
 *   title         string
 *   className     string (default '') — appended to the panel's own class
 *   children      React node — body content
 *   footer        React node | null | undefined
 *                   undefined  → renders default "Close" button
 *                   null       → no footer bar at all
 *                   React node → renders that node inside the footer bar
 *   defaultWidth  number (default 520)
 *   defaultHeight number (default 600)
 *   defaultX      number | null  (null = auto-centre)
 *   defaultY      number | null  (null = auto-centre)
 *   storageKey    string | null  (localStorage key for pos/size persistence)
 *   minWidth      number (default 320)
 *   minHeight     number (default 240)
 *   zIndex        number (default 9999)
 *   backdropClose boolean (default false)
 *   closeLabel    string  (default 'Close')
 *   singletonKey  string | null (default null)
 *                   If set, only one open modal instance with this key is allowed.
 *   autoPopOut    boolean (default false)
 */
export default function DraggableModal({
  isOpen,
  onClose,
  title = "Panel",
  className = "",
  children,
  footer,
  defaultWidth = 520,
  defaultHeight = 600,
  defaultX = null,
  defaultY = null,
  storageKey = null,
  minWidth = 320,
  minHeight = 240,
  zIndex = 9999,
  backdropClose = false,
  noBackdrop = false,
  closeLabel = "Close",
  closeOnPopout = false,
  singletonKey = null,
  autoPopOut = false,
}) {
  const [popoutWin, setPopoutWin] = useState(null);
  const [instanceId] = useState(() => `dm_${Math.random().toString(36).slice(2)}`);

  const initialPos = useCallback(
    () => ({
      x:
        defaultX != null
          ? defaultX
          : Math.max(0, Math.round((window.innerWidth - defaultWidth) / 2)),
      y:
        defaultY != null
          ? defaultY
          : Math.max(
              0,
              Math.round((window.innerHeight - defaultHeight) / 2) - 30,
            ),
    }),
    [defaultX, defaultY, defaultWidth, defaultHeight],
  );

  const { pos, size, handleDragStart, createResizeHandler } = useDraggablePanel(
    initialPos,
    { w: defaultWidth, h: defaultHeight },
    { storageKey, minW: minWidth, minH: minHeight },
  );

  const isPoppedOut = Boolean(popoutWin && !popoutWin.closed);

  const handlePopOut = useCallback(() => {
    if (isPoppedOut) {
      popoutWin.focus();
      return;
    }
    const w = size.w + 40;
    const h = size.h + 60;
    const left = window.screenX + pos.x;
    const top = window.screenY + pos.y;
    const win = window.open(
      "",
      `dm_${Date.now()}`,
      `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`,
    );
    if (!win) return;

    const styleLinks = Array.from(
      document.querySelectorAll('link[rel="stylesheet"]'),
    )
      .map((el) => `<link rel="stylesheet" href="${el.href}">`)
      .join("\n");
    const inlineStyles = Array.from(document.querySelectorAll("style"))
      .map((el) => `<style>${el.textContent}</style>`)
      .join("\n");

    win.document.write(`<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
${styleLinks}
${inlineStyles}
<style>
html,body{margin:0;padding:0;height:100%;background:#fff}
#dm-root{display:flex;flex-direction:column;height:100%;overflow:hidden}
</style>
</head><body><div id="dm-root"></div></body></html>`);
    win.document.close();
    win.addEventListener("beforeunload", () => setPopoutWin(null));
    setPopoutWin(win);
    if (closeOnPopout && onClose) onClose();
  }, [isPoppedOut, popoutWin, size, pos, title, closeOnPopout, onClose]);

  // Close popup window on unmount
  useEffect(
    () => () => {
      if (popoutWin && !popoutWin.closed) popoutWin.close();
    },
    [popoutWin],
  );

  // Escape key
  useEffect(() => {
    if (!isOpen || !onClose) return;
    const h = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [isOpen, onClose]);

  // Enforce single open modal per key (prevents stacked duplicate windows).
  useEffect(() => {
    if (!singletonKey || !isOpen || !onClose) return;
    const registry = getSingletonRegistry();
    if (!registry) return;

    const owner = registry.get(singletonKey);
    if (owner && owner !== instanceId) {
      onClose();
      return;
    }

    registry.set(singletonKey, instanceId);
    return () => {
      const current = registry.get(singletonKey);
      if (current === instanceId) registry.delete(singletonKey);
    };
  }, [singletonKey, isOpen, onClose, instanceId]);

  // Optional auto-popout behavior.
  useEffect(() => {
    if (!isOpen || !autoPopOut || isPoppedOut) return;
    handlePopOut();
  }, [isOpen, autoPopOut, isPoppedOut, handlePopOut]);

  if (!isOpen && !isPoppedOut) return null;

  // Footer: undefined → default close button; null → none; node → custom
  const footerBar =
    footer === undefined ? (
      <div className="dm-footer">
        <button type="button" className="dm-close-btn" onClick={onClose}>
          {closeLabel}
        </button>
      </div>
    ) : footer !== null ? (
      <div className="dm-footer">{footer}</div>
    ) : null;

  // --- Pop-out state ---
  if (isPoppedOut) {
    const popoutContent = (
      <div className="dm-popout-layout">
        <div className="dm-titlebar dm-titlebar--static">
          <span className="dm-title">{title}</span>
          <div className="dm-controls">
            {onClose && (
              <button
                type="button"
                className="dm-btn"
                onClick={onClose}
                title="Close"
              >
                ✕
              </button>
            )}
          </div>
        </div>
        <div className="dm-body">{children}</div>
        {footerBar}
      </div>
    );
    return ReactDOM.createPortal(
      <>
        <PopOutPortal win={popoutWin}>{popoutContent}</PopOutPortal>
        <div className="dm-popout-placeholder">
          <span>🪟 {title} — open in separate window</span>
          <button
            type="button"
            className="dm-placeholder-btn"
            onClick={() => popoutWin.focus()}
          >
            Focus
          </button>
          <button
            type="button"
            className="dm-placeholder-btn"
            onClick={() => popoutWin.close()}
          >
            Close
          </button>
        </div>
      </>,
      document.body,
    );
  }

  // --- Normal in-page state ---
  return ReactDOM.createPortal(
    <>
      {/* Backdrop */}
      {!noBackdrop && (
        <div
          className="dm-backdrop"
          aria-hidden="true"
          style={{ zIndex: zIndex - 1 }}
          onClick={backdropClose && onClose ? onClose : undefined}
        />
      )}

      {/* Panel */}
      <div
        className={`dm-panel${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal={noBackdrop ? undefined : "true"}
        style={{
          left: pos.x,
          top: pos.y,
          width: size.w,
          height: size.h,
          zIndex,
        }}
      >
        {/* 8 resize handles */}
        {["n", "ne", "e", "se", "s", "sw", "w", "nw"].map((dir) => (
          <div
            key={dir}
            className={`dm-handle dm-handle-${dir}`}
            onMouseDown={createResizeHandler(dir)}
            aria-hidden="true"
          />
        ))}

        {/* Title bar (drag target) */}
        <div className="dm-titlebar" onPointerDown={handleDragStart}>
          <span className="dm-title">{title}</span>
          <div className="dm-controls">
            <button
              type="button"
              className="dm-btn"
              onClick={handlePopOut}
              title="Pop out to new window"
            >
              🪟
            </button>
            {onClose && (
              <button
                type="button"
                className="dm-btn"
                onClick={onClose}
                title="Close"
                aria-label="Close"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Scrollable body */}
        <div className="dm-body">{children}</div>

        {/* Footer */}
        {footerBar}
      </div>
    </>,
    document.body,
  );
}
