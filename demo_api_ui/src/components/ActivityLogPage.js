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
    const w = typeof window !== 'undefined'
      ? Math.max(640, window.innerWidth - margin * 2)
      : 1200;
    const h = typeof window !== 'undefined'
      ? Math.max(480, window.innerHeight - topBar - margin)
      : 800;
    return {
      defaultWidth: w,
      defaultHeight: h,
      defaultX: margin,
      defaultY: topBar,
    };
  }, []);

  return (
    <div className="alp-page-shell" aria-hidden="true">
      <DraggableModal
        isOpen
        onClose={() => window.history.back()}
        title="Activity Log"
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
