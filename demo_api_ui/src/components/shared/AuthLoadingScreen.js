import React, { useEffect, useState } from 'react';
import PingIdentitySpinner from './PingIdentitySpinner';
import { LOADING_TIPS as TIPS, TIP_ROTATE_MS as TIP_MS } from './loadingTips';

const SLOW_MS = 8000;

/**
 * The screen shown while the sign-in check is in flight (App.js `loading`, and the
 * dashboard's own loading branch).
 *
 * It draws the SAME skeleton the HTML boot screen paints (index.html: `#boot-spinner`),
 * through the shared `.boot-skeleton` rules in that file, so a refresh is one
 * continuous screen: boot skeleton, then this, then the real chrome. It used to be a
 * small white card on a blank full-screen overlay, which hid the chrome and then
 * revealed it again: two large light-coloured swaps on every refresh.
 *
 * The label is the accessible name only. A visible label would put a token ink on
 * the skeleton's literal ground, which the ink-and-ground rule (H1) forbids. The tip
 * card below the spinner is drawn in literal ink/ground pairs for the same reason.
 */
export default function AuthLoadingScreen({ label = 'Loading' }) {
  const [tip, setTip] = useState(0);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const rotate = setInterval(() => setTip((t) => (t + 1) % TIPS.length), TIP_MS);
    const late = setTimeout(() => setSlow(true), SLOW_MS);
    return () => { clearInterval(rotate); clearTimeout(late); };
  }, []);
  return (
    <div className="boot-skeleton">
      <div className="boot-bar" />
      <div className="boot-nav" />
      <div className="boot-main">
        <div className="boot-card" />
        <div className="boot-card boot-card--short" />
      </div>
      <div className="boot-skeleton__spinner">
        <PingIdentitySpinner size={56} aria-label={label} tip={false} />
      </div>
      <div className="boot-skeleton__tip">
        <b>Did you know</b>
        <span>{TIPS[tip]}</span>
        {slow && <em>Taking longer than usual. The stack may be restarting.</em>}
      </div>
    </div>
  );
}
