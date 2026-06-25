import { useState } from 'react';
import DraggableModal from './DraggableModal';
import './ErrorModal.css';

export default function ErrorModal({ error, isOpen, onClose }) {
  const [showTokenDetails, setShowTokenDetails] = useState(false);

  const details = error?.details || error || {};
  const icon = error?.severity === 'critical' ? '❌' : '⚠️';
  const title = `${icon} ${error?.error_code || 'Authorization Failed'}`;

  const footer = (
    <>
      {details.doc_link && (
        <a href={details.doc_link} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
          Learn more
        </a>
      )}
      <a href="mailto:support@bank.com" className="btn btn-secondary">Contact support</a>
      <button type="button" className="dm-close-btn" onClick={onClose}>Close</button>
    </>
  );

  return (
    <DraggableModal
      isOpen={isOpen && !!error}
      onClose={onClose}
      title={title}
      footer={footer}
      defaultWidth={560}
      defaultHeight={480}
      storageKey="error-modal"
    >
      <div className="dm-scroll">
        <section className="error-section">
          <h3>What happened</h3>
          <p>{details.what_failed || details.message || 'An error occurred'}</p>
        </section>

        {details.why && (
          <section className="error-section">
            <h3>Why this matters</h3>
            <p>{details.why}</p>
          </section>
        )}

        {details.teaching && (
          <section className="error-section">
            <h3>Teaching moment</h3>
            <p>{details.teaching}</p>
          </section>
        )}

        <section className="error-section">
          <h3>How to fix it</h3>
          <p>{details.fix || 'Contact your system administrator for assistance.'}</p>
        </section>

        {details.tokens_involved && Object.keys(details.tokens_involved).length > 0 && (
          <section className="error-section">
            <button
              className="error-modal__toggle"
              onClick={() => setShowTokenDetails(!showTokenDetails)}
              aria-expanded={showTokenDetails}
              type="button"
            >
              {showTokenDetails ? '▼' : '▶'} Token details
            </button>
            {showTokenDetails && (
              <pre className="error-modal__code">
                {JSON.stringify(details.tokens_involved, null, 2)}
              </pre>
            )}
          </section>
        )}
      </div>
    </DraggableModal>
  );
}
