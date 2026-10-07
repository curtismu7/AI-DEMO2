import React, { useEffect, useState } from 'react';
import { LOADING_TIPS, TIP_ROTATE_MS } from './loadingTips';

// Each spinner that mounts starts on the next tip, so two on screen at once differ.
let nextTip = 0;

const SLOW_MS = 8000;

/** A rotating "Did you know" card, for under a stand-alone loading spinner. */
export default function LoadingTip() {
  const [index, setIndex] = useState(() => nextTip++ % LOADING_TIPS.length);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const rotate = setInterval(() => setIndex((i) => (i + 1) % LOADING_TIPS.length), TIP_ROTATE_MS);
    const late = setTimeout(() => setSlow(true), SLOW_MS);
    return () => { clearInterval(rotate); clearTimeout(late); };
  }, []);
  return (
    // Decorative: the spinner is a live region, and a tip that changes every few
    // seconds would be read out each time.
    <span className="ping-spinner__tip" aria-hidden="true">
      <b>Did you know</b>
      <span>{LOADING_TIPS[index]}</span>
      {slow && <em>Taking longer than usual. The stack may be restarting.</em>}
    </span>
  );
}
