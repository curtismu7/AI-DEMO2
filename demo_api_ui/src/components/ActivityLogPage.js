// demo_api_ui/src/components/ActivityLogPage.js
import { useMemo } from 'react';
import ActivityLogPanel from './ActivityLogPanel';
import DraggableModal from './DraggableModal';
import './ActivityLogPage.css';

/**
 * Full-viewport Activity Log for /monitoring/activity-log.
 * Uses DraggableModal so the panel fills the page by default and stays
 * draggable, resizable, and pop-out capable like TokenChainModal.
 */
export default function ActivityLogPage() {
  const { defaultWidth, defaultHeight, defaultX, defaultY } = useMemo(() => {
    const margin = 16;
    const topBar = 56;
    // The modal is position:fixed (viewport-relative), so it doesn't inherit
    // .main-content's sidebar margin-left the way in-flow content does — read
    // the live rendered offset instead of hardcoding a sidebar width, so it
    // stays correct whether AdminSideNav is expanded, collapsed, or resized.
    const sidebarOffset = typeof document !== 'undefined'
      ? parseFloat(getComputedStyle(document.querySelector('.main-content') || document.body).marginLeft) || 0
      : 0;
    const w = typeof window !== 'undefined'
      ? Math.max(640, window.innerWidth - sidebarOffset - margin * 2)
      : 1200;
    const h = typeof window !== 'undefined'
      ? Math.max(480, window.innerHeight - topBar - margin)
      : 800;
    return {
      defaultWidth: w,
      defaultHeight: h,
      defaultX: sidebarOffset + margin,
      defaultY: topBar,
    };
  }, []);

  return (
    <div className="alp-page-shell" aria-hidden="true">
      <DraggableModal
        isOpen
        onClose={() => window.history.back()}
        title="Application Activity & PingOne Events"
        defaultWidth={defaultWidth}
        defaultHeight={defaultHeight}
        defaultX={defaultX}
        defaultY={defaultY}
        storageKey="ba-activity-log-page"
        minWidth={420}
        minHeight={320}
        footer={null}
        noBackdrop
        zIndex={9000}
      >
        <ActivityLogPanel enabled />
      </DraggableModal>
    </div>
  );
}
