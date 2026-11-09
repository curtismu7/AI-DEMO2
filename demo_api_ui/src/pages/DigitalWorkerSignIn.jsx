import React, { useEffect, useRef } from "react";
import { openSignIn } from "../utils/signInService";
import { StatusChip } from "../components/pingUi";

// On a walled deployment (SE) every API call this page makes answers 401 until the
// visitor has signed in. Say so and offer the way in, rather than a red error.
// returnTo is explicit so signing in always lands back on this page. Nothing navigates on its own:
// the visitor presses Sign in. It is the one primary in the view it appears in (the run it guards is not mounted),
// except under the consent card, where the run's own action stays on screen: there it is a secondary (`primary={false}`).
// `focusOnMount` is for a prompt that replaces the control the visitor just pressed (the mock phone answered 401 and its
// card is gone): focus moves to this named group instead of falling to the page body.
export default function DigitalWorkerSignIn({ what, primary = true, focusOnMount = false }) {
  const group = useRef(null);
  useEffect(() => {
    if (focusOnMount) group.current?.focus();
  }, [focusOnMount]);
  return (
    <div ref={group} tabIndex={-1} role="group" aria-label="Sign-in needed" className="dw-signin">
      <div role="status" className="dw-signin__text">
        <p className="pu-status-line"><StatusChip tone="warn">Sign-in needed</StatusChip><span>Sign in to {what}.</span></p>
        <p className="pu-note">The server answered 401: this needs a signed-in session. After you sign in you come back to this page.</p>
      </div>
      <button type="button" className={primary ? "pu-btn pu-btn--primary" : "pu-btn"} onClick={() => openSignIn({ returnTo: "/digital-worker" })}>
        Sign in
      </button>
    </div>
  );
}
