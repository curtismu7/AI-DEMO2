// banking_api_ui/src/components/DashboardLayoutToggle.js
import React, { useCallback } from 'react';
import { notifyInfo } from '../utils/appToast';
import { getDashboardLayout, setDashboardLayout } from '../utils/dashboardLayout';
import { useAgentUiMode } from '../context/AgentUiModeContext';
import { persistAgentUi } from '../services/demoScenarioService';
import './DashboardLayoutToggle.css';

/**
 * Customer dashboard: classic vs split. Split implies Agent UI **Middle**; Classic clears middle (float-only or bottom dock).
 */
export default function DashboardLayoutToggle({ className = '' }) {
  const layout = getDashboardLayout();
  const { placement, fab, setAgentUi } = useAgentUiMode();

  const handleClassic = useCallback(() => {
    if (layout === 'classic') return;
    setDashboardLayout('classic');
    if (placement === 'middle') {
      setAgentUi({ placement: 'none', fab: true });
      void persistAgentUi({ placement: 'none', fab: true });
    }
    notifyInfo('Switched to classic dashboard layout.', { autoClose: 1800 });
    window.setTimeout(() => window.location.reload(), 200);
  }, [layout, placement, setAgentUi]);

  const handleSplit = useCallback(() => {
    if (layout === 'split3') return;
    setDashboardLayout('split3');
    setAgentUi({ placement: 'middle', fab });
    void persistAgentUi({ placement: 'middle', fab });
    notifyInfo('Switched to split view: token | assistant | banking.', { autoClose: 1800 });
    window.setTimeout(() => window.location.reload(), 200);
  }, [layout, fab, setAgentUi]);

  const splitActive = placement === 'middle';
  const classicActive = placement !== 'middle';

  return (
    <div
      className={`dashboard-layout-toggle ${className}`.trim()}
      role="group"
      aria-label="Dashboard column layout"
    >
      <span className="dashboard-layout-toggle__label" id="dashboard-layout-legend">
        Dashboard
      </span>
      <div className="dashboard-layout-toggle__segmented" role="toolbar" aria-labelledby="dashboard-layout-legend">
        <button
          type="button"
          className={`dashboard-layout-toggle__btn${splitActive ? ' dashboard-layout-toggle__btn--active' : ''}`}
          onClick={handleSplit}
          aria-pressed={splitActive}
          title="Token chain (left) · AI assistant (center) · accounts & transactions (right). Sets Agent UI to Middle."
        >
          Split view
        </button>
        <button
          type="button"
          className={`dashboard-layout-toggle__btn${classicActive ? ' dashboard-layout-toggle__btn--active' : ''}`}
          onClick={handleClassic}
          aria-pressed={classicActive}
          title="Original layout: token + banking center + floating assistant zone"
        >
          Classic
        </button>
      </div>
    </div>
  );
}
