import React from 'react';
import CapabilityShowcasePage from '../components/CapabilityShowcasePage';
import {
  PINGONE_AUTHORIZE_CAPABILITIES,
  PINGONE_AUTHORIZE_GROUPS,
} from '../config/capabilityLedgers/pingOneAuthorizeCapabilities';

const INTRO =
  'Contextual Runtime Authorization: PingOne Authorize grants dynamic, ' +
  'least-privilege permissions in real time. This page is a capability audit, ' +
  'not marketing copy — every card below names one real, running behavior of ' +
  'the PingOne Authorize integration in this repo: a plain-English description ' +
  'plus the exact file and function that implements it, so each claim is ' +
  'checkable against the source. The three groups below show how those ' +
  'capabilities compose: Real-time, contextual decisions is how a permit/deny ' +
  'gets decided per call; Fine-grained, attribute-driven policy is what that ' +
  'decision is based on; Operations & audit is how a decision gets inspected ' +
  'and verified afterward.';

export default function PingOneAuthorizeCapabilitiesPage() {
  return (
    <CapabilityShowcasePage
      title="PingOne Authorize"
      intro={INTRO}
      ledger={PINGONE_AUTHORIZE_CAPABILITIES}
      groups={PINGONE_AUTHORIZE_GROUPS}
    />
  );
}
