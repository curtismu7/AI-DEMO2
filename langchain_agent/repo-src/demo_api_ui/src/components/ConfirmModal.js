// ConfirmModal.js — generic yes/no confirmation dialog (replaces window.confirm)
import DraggableModal from './DraggableModal';

/**
 * @param {boolean}   isOpen
 * @param {string}    title
 * @param {string}    message
 * @param {string}    [confirmLabel]  default "Confirm"
 * @param {string}    [cancelLabel]   default "Cancel"
 * @param {boolean}   [danger]        if true, confirm button is red
 * @param {Function}  onConfirm
 * @param {Function}  onCancel
 */
export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}) {
  const footer = (
    <>
      <button type="button" className="dm-close-btn" onClick={onCancel}>
        {cancelLabel}
      </button>
      <button
        type="button"
        className="dm-close-btn"
        style={{
          background: danger ? '#dc2626' : '#2563eb',
          borderColor: danger ? '#b91c1c' : '#1d4ed8',
          color: '#fff',
        }}
        onClick={onConfirm}
      >
        {confirmLabel}
      </button>
    </>
  );

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      footer={footer}
      defaultWidth={440}
      defaultHeight={210}
      backdropClose
      storageKey={null}
    >
      <div className="dm-scroll" style={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.6 }}>
        {message}
      </div>
    </DraggableModal>
  );
}
