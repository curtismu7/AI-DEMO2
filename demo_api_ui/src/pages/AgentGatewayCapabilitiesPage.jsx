import React from 'react';
import CapabilityShowcasePage from '../components/CapabilityShowcasePage';
import {
  AGENT_GATEWAY_CAPABILITIES,
  AGENT_GATEWAY_GROUPS,
} from '../config/capabilityLedgers/agentGatewayCapabilities';

const INTRO =
  'PingGateway is the default live enforcement path in this demo — Node is ' +
  'the offline/dev fallback. Every capability below cites the exact code ' +
  'in this repo that implements it, on both paths.';

export default function AgentGatewayCapabilitiesPage() {
  return (
    <CapabilityShowcasePage
      title="Agent Gateway"
      intro={INTRO}
      ledger={AGENT_GATEWAY_CAPABILITIES}
      groups={AGENT_GATEWAY_GROUPS}
    />
  );
}
