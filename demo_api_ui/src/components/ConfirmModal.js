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
      <button type="button" className="btn btn-secondary" onClick={onCancel}>
        {cancelLabel}
      </button>
      <button
        type="button"
        className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
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
      defaultWidth={380}
      defaultHeight={210}
      minWidth={380}
      backdropClose
      storageKey={null}
    >
      <div className="dm-scroll confirm-modal-message">
        {message}
      </div>
    </DraggableModal>
  );
}
