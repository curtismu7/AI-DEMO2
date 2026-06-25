import React from 'react';
import { useIndustryBranding } from '../context/IndustryBrandingContext';

export default function AgentIdentityCard() {
  const { brandShortName } = useIndustryBranding();

  return (
    <div className="rd2-agent-card">
      <div className="rd2-agent-card__head">
        <h2 className="rd2-agent-card__title">{brandShortName} Agent</h2>
        <span className="rd2-agent-card__status">
          <span className="rd2-agent-card__dot" aria-hidden="true" />
          Active
        </span>
      </div>
      <p className="rd2-agent-card__desc">Secured via PingOne · RFC&nbsp;8693</p>
      <dl className="rd2-agent-card__meta">
        <div className="rd2-agent-card__meta-row">
          <dt className="rd2-agent-card__meta-key">Auth</dt>
          <dd className="rd2-agent-card__meta-val">RFC 8693</dd>
        </div>
        <div className="rd2-agent-card__meta-row">
          <dt className="rd2-agent-card__meta-key">Scopes</dt>
          <dd className="rd2-agent-card__meta-val">read · write · admin</dd>
        </div>
      </dl>
    </div>
  );
}
