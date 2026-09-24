import React from 'react';
import { RUN_PROVENANCE } from '../config/agentTerminology';
import './TraceProvenanceBadge.css';

const DETAILS = {
  mock: 'Simulated evidence — no tenant action was executed.',
  recorded: 'Captured evidence replayed from a completed run.',
  live: 'Evidence from the current tenant execution.',
};

export default function TraceProvenanceBadge({ provenance = 'live' }) {
  const value = Object.prototype.hasOwnProperty.call(RUN_PROVENANCE, provenance)
    ? provenance
    : 'live';
  return (
    <span
      className={`trace-provenance trace-provenance--${value}`}
      title={DETAILS[value]}
      data-provenance={value}
    >
      {RUN_PROVENANCE[value]}
    </span>
  );
}
