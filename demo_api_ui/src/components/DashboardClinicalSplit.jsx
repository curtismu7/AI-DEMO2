import React from "react";
import AgentClinicalHost from "./agent-clinical/AgentClinicalHost";
import CollapsibleStepDetail from "./CollapsibleStepDetail";
import ReelDock from "./ReelDock";
import SequenceReelDiagram from "./SequenceReelDiagram";
import ServerTopologyStory from "./ServerTopologyStory";
import TokenTopologyPanel from "./TokenTopologyPanel";
import { DetailPaneResizeHandle } from "./DashboardTracePanels";

/**
 * The clinical-split layout (ff_agent_clinical_split): it owns the whole dashboard area when on. Moved out of
 * UserDashboardPing2026.js unchanged. `globalModals` is the same overlay element the main layout renders, so the
 * modals stay reachable from this branch.
 */
export default function DashboardClinicalSplit({
  detailPaneHeight,
  followFlow,
  globalModals,
  onDetailPaneResizeKeyDown,
  onDetailPaneResizeMouseDown,
  selectedSeqStep,
  setSelectedSeqStep,
  setSlowMode,
  showFilmstrip,
  showSequenceDiagram,
  showServerTopology,
  showTokenTopology,
  simpleStepperInline,
  slowMode,
}) {
  return (
      <>
        <div className="customer-skin-p1 user-dashboard user-dashboard--clinical-split agent-clinical-host">
          <AgentClinicalHost />
          {/* Movie reel — same ReelDock the float layout uses, so the sticky
              bottom-pin and the collapse toggle come for free. This branch is an
              EARLY RETURN, so it never reaches the two reel renders further down;
              until now the clinical layout was the one customer surface with no
              reel at all. .agent-clinical-host is display:block over a 100vh
              shell, the same shape as float mode, so .tcfs-float-host's
              position:sticky/bottom:0 pins it without any clinical-specific CSS. */}
          {showFilmstrip && !showSequenceDiagram && !showServerTopology && <ReelDock />}
          {showTokenTopology && !showSequenceDiagram && !showServerTopology && <TokenTopologyPanel inline />}
          {simpleStepperInline}
          {showServerTopology && <ServerTopologyStory />}
          {showSequenceDiagram && !showServerTopology && (
            <SequenceReelDiagram
              onSelectStep={setSelectedSeqStep}
              onReset={() => setSelectedSeqStep(null)}
              selectedStepId={selectedSeqStep?.id}
              slowMode={slowMode}
              followFlow={followFlow}
              onToggleSlowMode={() => setSlowMode(!slowMode)}
            />
          )}
          {showSequenceDiagram && selectedSeqStep && (
            <>
              <DetailPaneResizeHandle
                height={detailPaneHeight}
                onMouseDown={onDetailPaneResizeMouseDown}
                onKeyDown={onDetailPaneResizeKeyDown}
              />
              <div className="ud-sequence-detail-row" style={{ height: detailPaneHeight }}>
              <CollapsibleStepDetail step={selectedSeqStep} />
              </div>
            </>
          )}
        </div>
        {globalModals}
      </>
  );
}
