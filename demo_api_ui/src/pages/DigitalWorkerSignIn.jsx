import React from "react";
import { openSignIn } from "../utils/signInService";

// On a walled deployment (SE) every API call this page makes answers 401 until the
// visitor has signed in. Say so and offer the way in, rather than a red error.
// returnTo is explicit so signing in always lands back on this page.
export default function DigitalWorkerSignIn({ what }) {
  return (
    <div role="status" className="dw-signin">
      <p>Sign in to {what}.</p>
      <button type="button" className="btn btn-primary" onClick={() => openSignIn({ returnTo: "/digital-worker" })}>
        Sign in
      </button>
    </div>
  );
}
