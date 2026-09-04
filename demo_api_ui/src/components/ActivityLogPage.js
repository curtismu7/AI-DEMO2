// demo_api_ui/src/components/ActivityLogPage.js
import { useLayoutEffect, useState } from 'react';
import ActivityLogPanel from './ActivityLogPanel';
import DraggableModal from './DraggableModal';
import './ActivityLogPage.css';

/**
 * Full-viewport Activity Log for /monitoring/activity-log.
 * Uses DraggableModal so the panel fills the page by default and stays
 * draggable, resizable, and pop-out capable like TokenChainModal.
 */
const STORAGE_KEY = 'ba-activity-log-page';

export default function ActivityLogPage() {
  // DraggableModal's position state initializes once, on ITS first render,
  // and never re-reads defaultX/defaultY after that (React's lazy useState
  // initializer semantics) — so it must not mount until the real sidebar
  // offset is known. Measuring in render (useMemo) reads the DOM before
  // React has committed anything on a fresh page load, so `.main-content`
  // doesn't exist yet and every value falls back to 0: the modal was
  // mounting flush against the left edge, covering AdminSideNav, on every
  // first visit. useLayoutEffect runs after commit (and before paint), so
  // this measures the real, laid-out sidebar width instead.
  const [layout, setLayout] = useState(null);

  useLayoutEffect(() => {
    const margin = 16;
    const topBar = 56;
    // The modal is position:fixed (viewport-relative), so it doesn't inherit
    // .main-content's sidebar margin-left the way in-flow content does — read
    // the live rendered offset instead of hardcoding a sidebar width, so it
    // stays correct whether AdminSideNav is expanded, collapsed, or resized.
    const sidebarOffset = parseFloat(
      getComputedStyle(document.querySelector('.main-content') || document.body).marginLeft,
    ) || 0;
    // DraggableModal restores a persisted {pos,size} from localStorage on
    // mount, unconditionally overriding defaultX/defaultY — so a position
    // saved before this offset was measured correctly (or from a drag that
    // clipped the panel to the left edge) would otherwise permanently cover
    // AdminSideNav, with no in-app way to recover. Treat a stored x left of
    // the sidebar as stale and drop it; the panel then falls back to the
    // fresh default below, and any FUTURE drag/resize persists normally.
    try {
      const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
      if (stored?.pos?.x != null && stored.pos.x < sidebarOffset) {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch { /* corrupt entry — leave it for useDraggablePanel's own try/catch */ }

    setLayout({
      defaultWidth: Math.max(640, window.innerWidth - sidebarOffset - margin * 2),
      defaultHeight: Math.max(480, window.innerHeight - topBar - margin),
      defaultX: sidebarOffset + margin,
      defaultY: topBar,
    });
  }, []);

  return (
    <div className="alp-page-shell" aria-hidden="true">
      {layout && (
        <DraggableModal
          isOpen
          onClose={() => window.history.back()}
          title="Application Activity & PingOne Events"
          defaultWidth={layout.defaultWidth}
          defaultHeight={layout.defaultHeight}
          defaultX={layout.defaultX}
          defaultY={layout.defaultY}
          storageKey={STORAGE_KEY}
          minWidth={420}
          minHeight={320}
          footer={null}
          noBackdrop
          zIndex={9000}
        >
          <ActivityLogPanel enabled />
        </DraggableModal>
      )}
    </div>
  );
}
