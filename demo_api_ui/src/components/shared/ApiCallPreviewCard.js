import React, { useState } from 'react';
import './ApiCallPreviewCard.css';

export default function ApiCallPreviewCard({ method = 'POST', endpoint, requestBody, docUrl, docLabel, description }) {
  const [copied, setCopied] = useState(false);
  const json = requestBody ? JSON.stringify(requestBody, null, 2) : null;

  const copy = () => {
    if (!json) return;
    navigator.clipboard && navigator.clipboard.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="acpc-root">
      <div className="acpc-header">
        <span className={`acpc-method acpc-method--${method.toLowerCase()}`}>{method}</span>
        <span className="acpc-endpoint">{endpoint}</span>
        {docUrl && (
          <a href={docUrl} target="_blank" rel="noopener noreferrer" className="acpc-doc-link">
            {docLabel || 'PingOne Docs'} ↗
          </a>
        )}
      </div>
      {description && <div className="acpc-desc">{description}</div>}
      {json && (
        <div className="acpc-body">
          <div className="acpc-body-header">
            <span className="acpc-body-label">Request body</span>
            <button type="button" onClick={copy} className="acpc-copy">
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <pre className="acpc-json">{json}</pre>
        </div>
      )}
    </div>
  );
}
