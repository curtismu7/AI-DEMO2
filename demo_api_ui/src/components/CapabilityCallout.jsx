import React from 'react';
import { AGENT_GATEWAY_CAPABILITIES } from '../config/agentGatewayCapabilities';
import './CapabilityCallout.css';

export default function CapabilityCallout({ capabilityId }) {
  const capability = AGENT_GATEWAY_CAPABILITIES.find((c) => c.id === capabilityId);
  if (!capability) return null;

  return (
    <a
      className="capability-callout"
      href={`/agent-gateway-capabilities#${capability.id}`}
    >
      <span className="capability-callout__label">Agent Gateway capability:</span>{' '}
      <span className="capability-callout__title">{capability.title}</span>
      <span className="capability-callout__arrow"> →</span>
    </a>
  );
}
