import React from 'react';
import DraggableModal from './DraggableModal';
import { TokenExchangeInspector } from './TokenExchangeInspector';

export default function TokenExchangeModal({ isOpen, onClose }) {
  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="Token Exchange Live Report"
      defaultWidth={700}
      defaultHeight={500}
      storageKey="token-exchange-modal-pos"
      footer={null}
    >
      <TokenExchangeInspector maxHistory={50} />
    </DraggableModal>
  );
}
