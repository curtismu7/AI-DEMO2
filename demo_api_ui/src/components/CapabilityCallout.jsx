import React from 'react';

const DEFAULT_TOUR_PATH = '/pingone-authorize-capabilities';

/**
 * Small link-out chip pointing at a capability's entry on a
 * CapabilityShowcasePage tour. Takes the capability object directly (no
 * ledger-id registry lookup) — the caller already has it from its own ledger
 * import. Not wired into any existing panel yet; standalone and tested.
 *
 * @param {object} props
 * @param {{id:string,title:string,oneLiner:string}|null|undefined} props.capability
 * @param {string} [props.to] - defaults to the PingOne Authorize tour page
 */
export default function CapabilityCallout({ capability, to = DEFAULT_TOUR_PATH }) {
  if (!capability) return null;
  return (
    <a className="cap-callout" href={to} title={capability.oneLiner}>
      {capability.title} →
    </a>
  );
}
