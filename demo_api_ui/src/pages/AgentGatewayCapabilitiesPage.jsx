import React from 'react';
import CapabilityShowcasePage from '../components/CapabilityShowcasePage';
import WeatherStateControl from '../components/WeatherStateControl';
import {
  AGENT_GATEWAY_CAPABILITIES,
  AGENT_GATEWAY_GROUPS,
} from '../config/capabilityLedgers/agentGatewayCapabilities';

const INTRO =
  'Agent Gateway is the default live enforcement path in this demo — Node Gateway is ' +
  'the offline/dev fallback. Every capability below cites the exact code ' +
  'in this repo that implements it, on both paths.';

export default function AgentGatewayCapabilitiesPage() {
  return (
    <CapabilityShowcasePage
      title="Agent Gateway"
      intro={INTRO}
      ledger={AGENT_GATEWAY_CAPABILITIES}
      groups={AGENT_GATEWAY_GROUPS}
      renderCardExtra={(cap) => cap.id === 'weather-tx-scope' ? <WeatherStateControl /> : null}
    />
  );
}
