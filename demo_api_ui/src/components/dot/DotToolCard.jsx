import React from 'react';

const PILL = { PERMIT: 'dot-verdict--permit', DENY: 'dot-verdict--deny', CONSENT: 'dot-verdict--consent' };

export default function DotToolCard({ item }) {
  const { name, verdict, reason, request, response } = item;
  const hasDetails = reason || request || response;
  return (
    <div className="dot-tool">
      <div className="dot-tool__row">
        <strong>{name}</strong>
        {PILL[verdict] && <span className={`dot-verdict ${PILL[verdict]}`}>{verdict}</span>}
      </div>
      {hasDetails && (
        <details open={verdict === 'DENY'}>
          <summary>{verdict === 'DENY' ? 'Why it was refused' : 'Request and response'}</summary>
          <pre>{[reason, request && JSON.stringify(request), response && JSON.stringify(response)].filter(Boolean).join('\n')}</pre>
        </details>
      )}
    </div>
  );
}
