// banking_api_ui/src/hooks/useDraggablePanel.js
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Clamp a position so a panel of the given size stays fully inside the current
 * viewport (with a small margin). Used only when restoring a saved position —
 * live dragging is intentionally left unclamped. If the panel is wider/taller
 * than the viewport, it is pinned to the top-left margin rather than hidden.
 */
function clampPosToViewport(p, size) {
  if (typeof window === 'undefined' || !window.innerWidth || !window.innerHeight) return p;
  const margin = 8;
  const w = size?.w || 0;
  const h = size?.h || 0;
  const maxX = Math.max(margin, window.innerWidth - w - margin);
  const maxY = Math.max(margin, window.innerHeight - h - margin);
  return {
    x: Math.min(Math.max(p.x, margin), maxX),
    y: Math.min(Math.max(p.y, margin), maxY),
  };
}

/**
 * Shared hook for draggable + resizable fixed-position panels.
 * Live dragging is unclamped — a panel can be dragged anywhere, including
 * off-screen (e.g. onto a second monitor). A position RESTORED from storage is
 * clamped back into the current viewport on mount, so a panel positioned when
 * the window was larger (or a second monitor was attached) can never come back
 * permanently off-screen and invisible.
 *
 * @param {() => { x: number, y: number } | { x: number, y: number }} initialPos  Lazy initialiser or plain object.
 * @param {{ w: number, h: number }}       initialSize
 * @param {{ storageKey?: string, minW?: number, minH?: number }} [options]
 * @returns {{ pos, size, handleDragStart, handleResizeStart }}
 */
export function useDraggablePanel(initialPos, initialSize, options = {}) {
  const { storageKey, minW: minWOpt, minH: minHOpt } = options;
  const resolvedMinW = minWOpt != null ? minWOpt : 280;
  const resolvedMinH = minHOpt != null ? minHOpt : 180;

  const [pos, setPos] = useState(() => {
    if (storageKey) {
      try {
        const stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (stored?.pos?.x != null && stored?.pos?.y != null) {
          return clampPosToViewport(stored.pos, stored.size || initialSize);
        }
      } catch {}
    }
    return typeof initialPos === 'function' ? initialPos() : initialPos;
  });

  const [size, setSize] = useState(() => {
    if (storageKey) {
      try {
        const stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (stored?.size?.w != null) return stored.size;
      } catch {}
    }
    return initialSize;
  });

  // Refs allow event handlers to always read the latest pos/size without
  // being recreated on every state change (fixes stale-closure drag bug).
  const posRef  = useRef(pos);
  const sizeRef = useRef(size);
  posRef.current  = pos;
  sizeRef.current = size;

  // Tracks active resize listeners so they can be torn down on unmount even
  // if mouseup was never fired (e.g. window blur, component unmount mid-resize).
  const activeResizeHandlersRef = useRef(null);

  useEffect(() => {
    return () => {
      const active = activeResizeHandlersRef.current;
      if (active) {
        document.removeEventListener('mousemove', active.onMove);
        document.removeEventListener('mouseup',   active.onUp);
        document.body.style.cursor     = '';
        document.body.style.userSelect = '';
        activeResizeHandlersRef.current = null;
      }
    };
  }, []);

  /** Drag from any element that calls this on pointerdown.
   *  Uses setPointerCapture so pointermove events continue even when the
   *  cursor exits the browser viewport, removing the hard viewport wall. */
  const handleDragStart = useCallback((e) => {
    if (e.button !== 0) return;
    // Don't steal pointer from interactive children (buttons, inputs, links, …)
    if (e.target.closest('button, input, textarea, select, a')) return;
    e.preventDefault();
    const offX = e.clientX - posRef.current.x;
    const offY = e.clientY - posRef.current.y;
    const target = e.currentTarget;
    // Capture pointer so drag continues when cursor exits the viewport
    if (target.setPointerCapture && e.pointerId != null) {
      target.setPointerCapture(e.pointerId);
    }
    const onMove = (ev) => {
      // No clamping — allow drag off-screen to second monitor
      setPos({ x: ev.clientX - offX, y: ev.clientY - offY });
    };
    const onUp   = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup',   onUp);
      target.removeEventListener('pointercancel', onUp);
      document.body.style.userSelect = '';
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify({ pos: posRef.current, size: sizeRef.current }));
        } catch {}
      }
    };
    document.body.style.userSelect = 'none';
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup',   onUp);
    target.addEventListener('pointercancel', onUp);
  }, [storageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 8-direction resize - supports resizing from any edge or corner. */
  const handleResizeStart = useCallback((e, direction = 'se') => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const startW = sizeRef.current.w, startH = sizeRef.current.h;
    const startL = posRef.current.x, startT = posRef.current.y;
    
    const onMove = (ev) => {
      const deltaX = ev.clientX - startX;
      const deltaY = ev.clientY - startY;
      
      let newW = startW, newH = startH, newL = startL, newT = startT;
      
      // Handle each resize direction
      if (direction.includes('e')) {
        newW = Math.max(resolvedMinW, startW + deltaX);
      }
      if (direction.includes('w')) {
        newW = Math.max(resolvedMinW, startW - deltaX);
        newL = startL + (startW - newW);
      }
      if (direction.includes('s')) {
        newH = Math.max(resolvedMinH, startH + deltaY);
      }
      if (direction.includes('n')) {
        newH = Math.max(resolvedMinH, startH - deltaY);
        newT = startT + (startH - newH);
      }
      
      setSize({ w: newW, h: newH });
      setPos({ x: newL, y: newT });
    };
    
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      document.body.style.cursor     = '';
      document.body.style.userSelect = '';
      activeResizeHandlersRef.current = null; // clear ref on normal mouseup
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify({ pos: posRef.current, size: sizeRef.current }));
        } catch {}
      }
    };

    // Set cursor based on direction
    const cursorMap = {
      'n': 'n-resize', 's': 's-resize', 'e': 'e-resize', 'w': 'w-resize',
      'ne': 'ne-resize', 'nw': 'nw-resize', 'se': 'se-resize', 'sw': 'sw-resize'
    };
    document.body.style.cursor = cursorMap[direction] || 'se-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
    activeResizeHandlersRef.current = { onMove, onUp }; // store for unmount cleanup
  }, [resolvedMinW, resolvedMinH, storageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Create resize handlers for each direction */
  const createResizeHandler = useCallback((direction) => (e) => handleResizeStart(e, direction), [handleResizeStart]);

  return { pos, size, handleDragStart, handleResizeStart, createResizeHandler };
}
