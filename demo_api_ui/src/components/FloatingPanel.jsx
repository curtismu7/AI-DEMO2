import React, { useState, useRef, useCallback, useEffect } from 'react';
import ReactDOM, { createPortal } from 'react-dom';
import './FloatingPanel.css';

/**
 * Renders children into a pop-out window using a real React root so that
 * all state, event listeners, and live data work correctly.
 */
function PopOutPortal({ win, children }) {
  const [container] = useState(() => {
    const el = win.document.getElementById('fp-popout-root');
    return el;
  });

  if (!container) return null;
  return createPortal(children, container);
}

/**
 * A draggable, 8-direction resizable panel that can be popped out to a new browser window.
 */
export default function FloatingPanel({
  title = 'Panel',
  defaultWidth = 480,
  defaultHeight = 500,
  defaultX = 0,
  defaultY = 0,
  defaultCollapsed = false,
  bottomDock = false,
  children,
  className = '',
  minWidth = 280,
  minHeight = 200,
  onClose = null,
}) {
  const [pos, setPos] = useState({ x: defaultX, y: defaultY });
  const [size, setSize] = useState({ w: defaultWidth, h: defaultHeight });
  const [isDragging, setIsDragging] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [popoutWin, setPopoutWin] = useState(null);
  const panelRef = useRef(null);
  const dragStartRef = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const resizeRef = useRef(null);

  const isPoppedOut = !!popoutWin;

  // --- Drag logic (pointer capture allows dragging onto a second monitor) ---
  const onDragStart = useCallback((e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.fp-btn') || e.target.closest('.fp-handle')) return;
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
    const target = e.currentTarget;
    // setPointerCapture keeps pointermove firing even when cursor leaves the browser
    if (target.setPointerCapture && e.pointerId != null) {
      try { target.setPointerCapture(e.pointerId); } catch (_) {}
    }
    const onMove = (ev) => {
      const { mx, my, px, py } = dragStartRef.current;
      setPos({ x: px + (ev.clientX - mx), y: py + (ev.clientY - my) });
    };
    const onUp = () => {
      setIsDragging(false);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  }, [pos]);

  // (pointer capture approach above; no separate isDragging effect needed)
  useEffect(() => {
    // Keep isDragging in sync but don't add global listeners — pointer capture handles it
  }, [isDragging]);

  // --- 8-direction resize logic ---
  const onResizeStart = useCallback((e, dir) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { dir, mx: e.clientX, my: e.clientY, w: size.w, h: size.h, px: pos.x, py: pos.y };
    document.body.style.userSelect = 'none';
    const cursors = { n:'n-resize', ne:'ne-resize', e:'e-resize', se:'nwse-resize',
                      s:'s-resize', sw:'sw-resize', w:'w-resize', nw:'nw-resize' };
    document.body.style.cursor = cursors[dir] || 'nwse-resize';

    const onMove = (ev) => {
      const { dir: d, mx, my, w, h, px, py } = resizeRef.current;
      const dx = ev.clientX - mx;
      const dy = ev.clientY - my;
      let newW = w, newH = h, newX = px, newY = py;
      if (d.includes('e')) newW = Math.max(minWidth, w + dx);
      if (d.includes('s')) newH = Math.max(minHeight, h + dy);
      if (d.includes('w')) { const c = Math.min(w - minWidth, -dx); newW = w + c; newX = px - c; }
      if (d.includes('n')) { const c = Math.min(h - minHeight, -dy); newH = h + c; newY = py - c; }
      setSize({ w: newW, h: newH });
      if (d.includes('n') || d.includes('w')) setPos({ x: newX, y: newY });
    };
    const onUp = () => {
      resizeRef.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [size, pos, minWidth, minHeight]);

  // --- Pop-out: open new window and inject styles; children render via portal ---
  const handlePopOut = useCallback(() => {
    if (popoutWin) {
      if (!popoutWin.closed) popoutWin.close();
      setPopoutWin(null);
      return;
    }

    const w = size.w + 40;
    const h = size.h + 80;
    const left = window.screenX + pos.x;
    const top = window.screenY + pos.y;
    const win = window.open('', `panel_${title}`, `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`);
    if (!win) return;

    // Write minimal shell with styles copied from the parent document
    const styleLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .map((el) => `<link rel="stylesheet" href="${el.href}">`)
      .join('\n');
    const inlineStyles = Array.from(document.querySelectorAll('style'))
      .map((el) => `<style>${el.textContent}</style>`)
      .join('\n');

    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
  ${styleLinks}
  ${inlineStyles}
  <style>
    html, body { margin: 0; padding: 0; height: 100%; background: #fff; }
    #fp-popout-root { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  </style>
</head>
<body><div id="fp-popout-root"></div></body>
</html>`);
    win.document.close();

    // Show a proper URL in the popup address bar instead of about:blank
    try { win.history.pushState({}, '', '/dev-tools-popout'); } catch (_) {}

    win.addEventListener('beforeunload', () => {
      setPopoutWin(null);
    });

    setPopoutWin(win);
  }, [popoutWin, size, pos, title]);

  // Close pop-out on unmount
  useEffect(() => {
    return () => {
      if (popoutWin && !popoutWin.closed) popoutWin.close();
    };
  }, [popoutWin]);

  // --- Render pop-out placeholder in original window while children live in the new window ---
  if (isPoppedOut && popoutWin && !popoutWin.closed) {
    return (
      <>
        {/* Portal: render the actual React children into the pop-out window's DOM */}
        <PopOutPortal win={popoutWin}>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#fff' }}>
            {/* Mini title bar inside pop-out */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'6px 12px', background:'linear-gradient(135deg,#1a1a2e 0%,#16213e 100%)', color:'#fff', flexShrink:0 }}>
              <span style={{ fontSize:13, fontWeight:600 }}>{title}</span>
              <button
                onClick={handlePopOut}
                title="Bring back"
                style={{ background:'rgba(255,255,255,0.15)', border:'none', color:'#fff', width:24, height:24, borderRadius:4, cursor:'pointer', fontSize:12 }}
              >⤶</button>
            </div>
            <div style={{ flex:1, minHeight:0, overflow:'hidden' }}>
              {children}
            </div>
          </div>
        </PopOutPortal>
        {/* Placeholder in original window */}
        <div className={`fp-placeholder ${className}`}>
          <div className="fp-placeholder-inner">
            <span>↗ {title}</span>
            <button className="fp-btn fp-btn-popin" onClick={handlePopOut} title="Bring back">⤶</button>
          </div>
        </div>
      </>
    );
  }

  const panel = (
    <div
      ref={panelRef}
      className={`fp-panel ${className} ${isDragging ? 'fp-dragging' : ''} ${isCollapsed ? 'fp-collapsed' : ''}`}
      style={{
        position: 'fixed',
        ...(bottomDock && isCollapsed
          ? { bottom: 0, left: 0, right: 0, width: '100%' }
          : bottomDock
          ? { bottom: 0, left: pos.x, width: size.w }
          : { top: pos.y, left: pos.x, width: size.w }),
        height: isCollapsed ? 'auto' : size.h,
        zIndex: 9000,
      }}
    >
      {/* 8 resize handles */}
      {!isCollapsed && (
        <>
          <div className="fp-handle fp-handle-n"  onMouseDown={(e) => onResizeStart(e, 'n')}  aria-hidden />
          <div className="fp-handle fp-handle-ne" onMouseDown={(e) => onResizeStart(e, 'ne')} aria-hidden />
          <div className="fp-handle fp-handle-e"  onMouseDown={(e) => onResizeStart(e, 'e')}  aria-hidden />
          <div className="fp-handle fp-handle-se" onMouseDown={(e) => onResizeStart(e, 'se')} aria-hidden />
          <div className="fp-handle fp-handle-s"  onMouseDown={(e) => onResizeStart(e, 's')}  aria-hidden />
          <div className="fp-handle fp-handle-sw" onMouseDown={(e) => onResizeStart(e, 'sw')} aria-hidden />
          <div className="fp-handle fp-handle-w"  onMouseDown={(e) => onResizeStart(e, 'w')}  aria-hidden />
          <div className="fp-handle fp-handle-nw" onMouseDown={(e) => onResizeStart(e, 'nw')} aria-hidden />
        </>
      )}

      {/* Title bar */}
      <div className="fp-titlebar" onPointerDown={onDragStart}>
        <span className="fp-title">{title}</span>
        <div className="fp-controls">
          <button className="fp-btn" onClick={() => setIsCollapsed((c) => !c)} title={isCollapsed ? 'Expand' : 'Collapse'}>
            {isCollapsed ? '▼' : '▲'}
          </button>
          <button className="fp-btn" onClick={handlePopOut} title="Pop out to new window">↗</button>
          {onClose && (
            <button type="button" className="fp-btn" onClick={onClose} title="Close">✕</button>
          )}
        </div>
      </div>

      {/* Content */}
      {!isCollapsed && (
        <div className="fp-content">
          {children}
        </div>
      )}
    </div>
  );

  return ReactDOM.createPortal(panel, document.body);
}
