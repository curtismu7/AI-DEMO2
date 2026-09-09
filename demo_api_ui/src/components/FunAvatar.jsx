import React from 'react';
import { pickFunAvatar } from '../utils/funAvatar';

export default function FunAvatar({ seed, size = 40, className = '' }) {
  const { bg, mouth } = pickFunAvatar(seed);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-label="User avatar"
    >
      <title>User avatar</title>
      <circle cx="12" cy="12" r="12" fill={bg} />
      <circle cx="8.5" cy="10" r="1.6" fill="#111827" />
      <circle cx="15.5" cy="10" r="1.6" fill="#111827" />
      {mouth === 'smile' && (
        <path d="M 8 15 Q 12 18.5 16 15" stroke="#111827" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      )}
      {mouth === 'open' && <circle cx="12" cy="15.5" r="2" fill="#111827" />}
      {mouth === 'zigzag' && (
        <path d="M 8 15 L 10.5 17 L 13 14.5 L 15.5 16.5" stroke="#111827" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {mouth === 'smirk' && (
        <path d="M 8.5 15.5 Q 13 18 16 13.5" stroke="#111827" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      )}
      {mouth === 'flat' && (
        <path d="M 8.5 15.5 L 15.5 15.5" stroke="#111827" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      )}
    </svg>
  );
}
