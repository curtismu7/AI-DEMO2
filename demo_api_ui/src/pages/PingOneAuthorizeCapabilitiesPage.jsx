import React from 'react';
import CapabilityShowcasePage from '../components/CapabilityShowcasePage';
import {
  PINGONE_AUTHORIZE_CAPABILITIES,
  PINGONE_AUTHORIZE_GROUPS,
} from '../config/capabilityLedgers/pingOneAuthorizeCapabilities';

const INTRO =
  'Contextual Runtime Authorization: PingOne Authorize grants dynamic, ' +
  'least-privilege permissions in real time. Every capability below cites ' +
  'the exact code in this repo that implements it.';

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
