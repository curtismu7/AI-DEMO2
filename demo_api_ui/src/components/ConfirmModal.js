// ConfirmModal.js — generic yes/no confirmation dialog (replaces window.confirm)
import DraggableModal from './DraggableModal';

/**
 * @param {boolean}   isOpen
 * @param {string}    title
 * @param {string}    message
 * @param {string}    [confirmLabel]  default "Confirm"
 * @param {string}    [cancelLabel]   default "Cancel"
 * @param {boolean}   [danger]        destructive action: the confirm button is still the dialog's single primary
 *                                    (fixed Ping Red gradient, never a vertical's colour) and Cancel stays the secondary;
 *                                    `data-danger` marks it. Focus handling is DraggableModal's and is unchanged.
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
        className="btn btn-primary"
        data-danger={danger ? 'true' : undefined}
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
