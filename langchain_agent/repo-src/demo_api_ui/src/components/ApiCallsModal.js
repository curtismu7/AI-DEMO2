import ApiCallDisplay from './ApiCallDisplay';
import DraggableModal from './DraggableModal';

export default function ApiCallsModal({ open, onClose }) {
  return (
    <DraggableModal
      isOpen={!!open}
      onClose={onClose}
      title="API Calls"
      defaultWidth={700}
      defaultHeight={500}
      storageKey="api-calls-modal"
    >
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0, padding: '1rem' }}>
        <ApiCallDisplay sessionId="dashboard" />
      </div>
    </DraggableModal>
  );
}
