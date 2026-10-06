import React, { useEffect, useState } from 'react';
import { LOADING_TIPS, TIP_ROTATE_MS } from './loadingTips';

// Each spinner that mounts starts on the next tip, so two on screen at once differ.
let nextTip = 0;

/** A rotating "Did you know" line, for under a stand-alone loading spinner. */
export default function LoadingTip() {
  const [index, setIndex] = useState(() => nextTip++ % LOADING_TIPS.length);
  useEffect(() => {
    const rotate = setInterval(() => setIndex((i) => (i + 1) % LOADING_TIPS.length), TIP_ROTATE_MS);
    return () => clearInterval(rotate);
  }, []);
  return (
    // Decorative: the spinner is a live region, and a tip that changes every few
    // seconds would be read out each time.
    <span className="ping-spinner__tip" aria-hidden="true">
      <b>Did you know</b> {LOADING_TIPS[index]}
    </span>
  );
}
