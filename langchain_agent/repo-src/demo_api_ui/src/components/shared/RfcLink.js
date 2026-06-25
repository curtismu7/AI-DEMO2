import React from 'react';
import { RFC_LINKS } from '../../config/rfcLinks';

export default function RfcLink({ rfc, section, label }) {
  const entry = RFC_LINKS[rfc];
  if (!entry) return null;

  const displayLabel = label || (section ? `${entry.label} ${section}` : entry.label);
  const url = section
    ? `${entry.url}#${section.replace(/^§/, 'section-')}`
    : entry.url;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="edu-rfc-link"
      title={entry.title}
    >
      {displayLabel}
      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M5 2H2v8h8V7M7 1h4v4M11 1 5.5 6.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}
