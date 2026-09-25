import React from 'react';
import { RUN_PROVENANCE } from '../config/agentTerminology';
import './TraceProvenanceBadge.css';

const DETAILS = {
  mock: 'Simulated evidence — no tenant action was executed.',
  'mock-id-jag': 'Mock replay — no login, tenant action, or live tokens.',
  recorded: 'Captured evidence replayed from a completed run.',
  live: 'Evidence from the current tenant execution.',
  'live-id-jag': 'Live PingFederate ID-JAG evidence from this run.',
};

const ID_JAG_LABELS = {
  'mock-id-jag': 'Mock replay',
  'live-id-jag': 'PingFederate ID-JAG',
};

export default function TraceProvenanceBadge({ provenance = 'live' }) {
  const value = Object.prototype.hasOwnProperty.call(RUN_PROVENANCE, provenance)
    || Object.prototype.hasOwnProperty.call(ID_JAG_LABELS, provenance)
    ? provenance
    : 'live';
  const colorKind = value === 'mock-id-jag' ? 'mock' : value === 'live-id-jag' ? 'live' : value;
  return (
    <span
      className={`trace-provenance trace-provenance--${colorKind}`}
      title={DETAILS[value]}
      data-provenance={value}
    >
      {ID_JAG_LABELS[value] || RUN_PROVENANCE[value]}
    </span>
  );
}
