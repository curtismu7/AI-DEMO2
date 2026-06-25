import ComplianceModalContent from "./ComplianceModalContent";
import DraggableModal from "./DraggableModal";
import "./ComplianceModal.css";

/**
 * Draggable, resizable modal for MCP Compliance Checklist.
 * Uses DraggableModal as its shell (drag, 8-dir resize, pop-out).
 */
export default function ComplianceModal({
  open,
  onClose,
  complianceStripState,
  messages,
  onClearSteps,
  CHIP_APPLICABLE_STEPS,
  getStepSkipExplanation,
}) {
  return (
    <DraggableModal
      isOpen={open}
      onClose={onClose}
      title="MCP Compliance Checklist"
      defaultWidth={420}
      defaultHeight={600}
      defaultX={20}
      defaultY={80}
      storageKey="compliance-modal"
      noBackdrop
      minWidth={300}
      minHeight={250}
      footer={null}
    >
      <ComplianceModalContent
        complianceStripState={complianceStripState}
        messages={messages}
        onClearSteps={onClearSteps}
        CHIP_APPLICABLE_STEPS={CHIP_APPLICABLE_STEPS}
        getStepSkipExplanation={getStepSkipExplanation}
      />
    </DraggableModal>
  );
}
