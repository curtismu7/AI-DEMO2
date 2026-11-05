import React, { useCallback, useRef, useState } from "react";
import ConsentMockPhoneFlow from "../components/ConsentMockPhoneFlow";
import DigitalWorkerSignIn from "./DigitalWorkerSignIn";

// One mock CIBA consent phone for the whole page. The attended run and the unattended panel both
// need a human to approve something, and the server keeps a single pending request per session, so
// they share this one instead of each mounting their own.
//
//   ask(snapshot, label) -> Promise<"approved" | "denied" | "expired" | "cancelled" | "signin" | "error" | "busy">
//   host                 -> the element to render (null when idle); the phone itself is a floating modal
//
// snapshot is what the server's mock accepts: { amount, type: "transfer" | "withdrawal", description }.
export default function useConsentPhone() {
  const [request, setRequest] = useState(null); // { id, scenario } while a phone is up or its outcome is on screen
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const settle = useRef(null); // resolves the ask() still waiting for an answer
  const seq = useRef(0);

  const finish = useCallback((result) => {
    settle.current?.(result);
    settle.current = null;
  }, []);

  const ask = useCallback((snapshot, label) => {
    if (settle.current) return Promise.resolve("busy");
    setNeedsSignIn(false);
    return new Promise((resolve) => {
      settle.current = resolve;
      seq.current += 1;
      setRequest({ id: seq.current, scenario: { label, snapshot } });
    });
  }, []);

  const onError = useCallback((err) => {
    // The mock is session-scoped: a signed-out visitor gets 401 "Sign in first". That is an invitation,
    // not a failure. Anything else stays on screen (the flow prints its own message) until closed.
    if (err?.response?.status === 401) {
      setNeedsSignIn(true);
      setRequest(null);
      finish("signin");
    } else {
      finish("error");
    }
  }, [finish]);

  const close = useCallback(() => {
    finish("cancelled"); // a no-op when it was already answered
    setRequest(null);
  }, [finish]);

  const host = request || needsSignIn ? (
    <div className="dw-consent">
      {needsSignIn ? <DigitalWorkerSignIn what="approve on the mock phone" /> : null}
      {request ? (
        <ConsentMockPhoneFlow
          key={request.id}
          embedded
          scenario={request.scenario}
          onDecision={finish}
          onError={onError}
          onDone={close}
        />
      ) : null}
    </div>
  ) : null;

  return { ask, host };
}
