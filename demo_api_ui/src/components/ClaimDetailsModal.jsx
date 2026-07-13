import React from 'react';
import DraggableModal from './DraggableModal';
import { TOKEN_CLAIMS } from '../constants/tokenClaims';
import '../styles/TokenChainRedesign.css';

function ClaimDetailsModal({ isOpen, tokenType, onClose }) {
  const claims = TOKEN_CLAIMS[tokenType] || [];
  const titleMap = {
    user: 'User Token Claims',
    agent: 'Agent Token Claims',
    mcp: 'MCP Token Claims',
  };
  const title = titleMap[tokenType] || 'Token Claims';

  const claimsContent = (
    <div className="utfi-claims-list">
      {claims.map((claim, index) => (
        <div key={index} className="utfi-claim-item">
          <div className="utfi-claim-key">{claim.key}</div>
          <div className="utfi-claim-value">{claim.value}</div>
          <div className="utfi-claim-description">{claim.description}</div>
        </div>
      ))}
    </div>
  );

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      defaultWidth={520}
      defaultHeight={600}
      storageKey={`claim-modal-${tokenType}`}
    >
      {claimsContent}
    </DraggableModal>
  );
}

export default ClaimDetailsModal;
