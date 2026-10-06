import React, { useEffect, useState } from 'react';

// index.html paints the first of these on the boot screen; keep TIPS[0] in sync
// (indexHtmlBoot.test.js checks it).
export const TIPS = [
  'Every agent call swaps the user token for a scoped one (RFC 8693) before it reaches a tool.',
  'The browser never holds a PingOne token. The BFF keeps it server-side and the page only sees a session cookie.',
  'High-value transfers pause for human approval before they run.',
  'Each tool call is checked against policy at the gateway, not just at sign-in.',
];
export const TIP_MS = 4000;
export const SLOW_MS = 8000;

/**
 * "Did you know" card under a large loading spinner. Rotates a tip, and says so
 * when the wait runs long. Decorative: aria-hidden, so the polite live region on
 * the spinner is not re-announced every few seconds.
 */
export default function SpinnerTip({ className = '' }) {
  const [tip, setTip] = useState(0);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const rotate = setInterval(() => setTip((t) => (t + 1) % TIPS.length), TIP_MS);
    const late = setTimeout(() => setSlow(true), SLOW_MS);
    return () => { clearInterval(rotate); clearTimeout(late); };
  }, []);
  return (
    <span className={`spinner-tip ${className}`.trim()} aria-hidden="true">
      <b>Did you know</b>
      <span>{TIPS[tip]}</span>
      {slow && <em>Taking longer than usual. The stack may be restarting.</em>}
    </span>
  );
}
