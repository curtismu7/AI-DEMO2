import React from 'react';
import { AGENT_GATEWAY_CAPABILITIES, CAPABILITY_GROUPS } from '../config/agentGatewayCapabilities';
import './AgentGatewayCapabilitiesTour.css';

function EnforcedByPill({ capability }) {
  if (capability.enforcedByDefault === 'node-only') {
    return <span className="agct-pill agct-pill--node-only">Node only</span>;
  }
  return (
    <span className="agct-pill agct-pill--pinggateway">
      Enforced by PingGateway (default)
      <span className="agct-pill__fallback"> · Node (fallback)</span>
    </span>
  );
}

function CapabilityCard({ capability }) {
  const tryHref = capability.relatedUCIds[0] ? `/use-cases#${capability.relatedUCIds[0]}` : null;
  return (
    <article
      id={capability.id}
      className="agct-card"
      data-testid={`capability-card-${capability.id}`}
    >
      <h3 className="agct-card__title">{capability.title}</h3>
      <p className="agct-card__oneliner">{capability.oneLiner}</p>
      <EnforcedByPill capability={capability} />
      <p className="agct-card__fallback-note">{capability.fallbackNote}</p>
      <dl className="agct-card__evidence">
        <dt>Node</dt>
        <dd><code>{capability.evidence.node}</code></dd>
        {capability.evidence.pingGateway ? (
          <>
            <dt>PingGateway</dt>
            <dd><code>{capability.evidence.pingGateway}</code></dd>
          </>
        ) : null}
      </dl>
      {tryHref ? (
        <a className="agct-card__try" href={tryHref}>Try it →</a>
      ) : null}
    </article>
  );
}

export default function AgentGatewayCapabilitiesTour() {
  return (
    <div className="agct-page">
      <h1>Agent Gateway — Capability Tour</h1>
      <p className="agct-intro">
        Every capability below is evidence-cited against the current code, not
        asserted. &quot;Enforced by&quot; reflects the live PingGateway-default
        routing — Node is the offline/dev fallback.
      </p>
      {CAPABILITY_GROUPS.map((group) => (
        <section key={group.id} className="agct-group">
          <h2>{group.label}</h2>
          <div className="agct-group__grid">
            {AGENT_GATEWAY_CAPABILITIES
              .filter((c) => c.group === group.id)
              .map((c) => <CapabilityCard key={c.id} capability={c} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
