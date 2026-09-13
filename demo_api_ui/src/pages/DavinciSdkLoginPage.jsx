// /davinci-sdk-login — runs a DaVinci flow with the Ping Orchestration SDK and
// renders the flow's collectors as our own UI.
//
// Deliberately does NOT touch /davinci-login (the hosted-widget page) or any
// file in REGRESSION_PLAN §1. Parallel route, parallel BFF endpoints.
//
// Scope today: TextCollector, PasswordCollector, SubmitCollector — enough to
// drive the flow's Password Sign On Page. CollectorField renders a visible
// fallback for anything else rather than omitting a field silently.
//
// Debugging goes through the SDK's own logger (see davinciSdkClient.js), which
// narrates what the SDK decided. `trace` below collects those entries, and the
// "What just happened" walkthrough renders the parts a developer needs from it.
//
// A successful sign-in does NOT leave this page. It used to navigate to
// /davinci-login/confirmed, whose "Continue to the app" went home — out of the
// lesson. Now a "What just happened" modal walks through the steps that actually
// ran, and closing it leaves you here, signed in, with a way to reopen it or
// sign out to switch users.
import { useCallback, useEffect, useRef, useState } from "react";
import CollectorField from "../components/davinci/CollectorField";
import SdkWalkthrough from "../components/davinci/SdkWalkthrough";
import DraggableModal from "../components/DraggableModal";
import {
  fetchSdkConfig,
  initClient,
  postCallback,
  signOutOfPingOne,
  takePkceVerifier,
} from "../lib/davinciSdkClient";
import "./DavinciSdkLoginPage.css";

export default function DavinciSdkLoginPage() {
  // loading | collecting | reused | signedIn | notConfigured | failed
  const [phase, setPhase] = useState("loading");
  // Username an existing PingOne session signed in as, shown on the "reused"
  // panel so the user can Continue as them or sign out to switch.
  const [reusedAs, setReusedAs] = useState(null);
  // Who ended up signed in and HOW — "session" (an existing PingOne session
  // completed the flow with no screens) or "form" (the user submitted the
  // collectors). The walkthrough tells the story of whichever actually happened.
  const [signedIn, setSignedIn] = useState(null);
  const [showWhatHappened, setShowWhatHappened] = useState(false);
  const [message, setMessage] = useState(null);
  const [missing, setMissing] = useState(null);
  const [collectors, setCollectors] = useState([]);
  // Bumped on every node transition and folded into each field's React key, so
  // the inputs REMOUNT per screen. Without it, two consecutive screens that
  // reuse a collector id (the flow's sign-on and "enter username" screens both
  // send `username-0`) keep the previous screen's local state, showing a value
  // the SDK does not hold. Caught driving the live flow, not by any unit test.
  const [step, setStep] = useState(0);
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const clientRef = useRef(null);
  const cfgRef = useRef(null);
  const traceRef = useRef([]);
  // StrictMode double-invokes effects; starting the flow twice would burn two
  // nonces and leave the first flow orphaned.
  const startedRef = useRef(false);

  const onTrace = useCallback((entry) => {
    traceRef.current.push(entry);
  }, []);

  // Reads collectors off the client rather than off the node, because
  // getCollectors() is the supported accessor and an error node still carries
  // its collectors — which is what lets the form re-render with complaints.
  const syncFromClient = useCallback((client, node) => {
    setCollectors(client.getCollectors?.() || []);
    setStep((n) => n + 1);
    const errs = {};
    if (node?.status === "error") {
      for (const ec of client.getErrorCollectors?.() || []) {
        if (ec?.target) errs[ec.target] = ec.message;
      }
    }
    setFieldErrors(errs);
    setMessage(node?.status === "error" ? client.getError?.()?.message || null : null);
  }, []);

  // Stay on this page, signed in, and explain what just happened.
  const showSignedIn = useCallback((username, via) => {
    setSignedIn({ username, via });
    setPhase("signedIn");
    setShowWhatHappened(true);
  }, []);

  // Declared before start() because start() depends on it: a const in a
  // useCallback dependency array is read at render time, so referencing it
  // above its declaration throws.
  const finish = useCallback(async (client, { reused = false } = {}) => {
    const code = client.getClient?.()?.authorization?.code;
    if (!code) throw new Error("The flow succeeded but returned no authorization code.");
    // The SDK owns the PKCE verifier; the BFF does the exchange and holds the
    // tokens, so the verifier has to travel with the code.
    const codeVerifier = takePkceVerifier(cfgRef.current.clientId);
    const result = await postCallback({ code, codeVerifier });
    const username = result?.username || null;
    // A reused PingOne session completed the flow without anyone typing a name,
    // so say WHO it signed in as and offer to switch before going further.
    if (reused) {
      setReusedAs(username);
      setPhase("reused");
      return;
    }
    showSignedIn(username, "form");
  }, [showSignedIn]);

  // Ends the PingOne session (not this app's session) and returns here with a
  // clean form — the way to sign in as a different user. See signOutOfPingOne.
  const signOut = useCallback(() => {
    signOutOfPingOne(cfgRef.current).catch((err) => {
      setMessage(err.message);
      setPhase("failed");
    });
  }, []);

  const start = useCallback(async () => {
    setPhase("loading");
    setMessage(null);
    setMissing(null);
    try {
      const cfg = await fetchSdkConfig();
      cfgRef.current = cfg;
      const client = await initClient(cfg, { onTrace });
      clientRef.current = client;

      // No prompt=login. It was added so a signed-in presenter would still see
      // the collectors, but it made PingOne REFUSE a sign-in as a different
      // user: signed in to PingOne as demoAdmin, the form then authenticated
      // someone else and the flow failed with "userSessionMismatch". Instead an
      // existing PingOne session is reused (the flow completes with no
      // screens), and the page offers to sign out of PingOne to switch users.
      const node = await client.start({ query: { nonce: cfg.nonce } });
      if (node?.status === "failure") {
        // A 5XX or an unparseable payload lands here, not on 'error'. The SDK
        // logs "Response of 5XX indicates unrecoverable failure"; its own error
        // message is often empty, so say something useful instead of blank.
        setMessage(
          client.getError?.()?.message ||
            "The flow could not be started. It may not be deployed, or not enabled for PingOne.",
        );
        setPhase("failed");
        return;
      }
      // The browser already holds a PingOne session, so /as/authorize completed
      // the flow outright (flow.status COMPLETED, authorization code attached)
      // and there are no screens and no collectors. This used to fall through
      // to "collecting" with zero collectors and render an EMPTY FORM: heading,
      // subtitle, nothing else. Reported from a screenshot while signed in as
      // Demo Admin; reproduced by signing in once and reloading the page.
      if (node?.status === "success") {
        // reused: nobody typed anything, so finish() shows who this signed in
        // as, with Continue / sign out.
        await finish(client, { reused: true });
        return;
      }
      syncFromClient(client, node);
      setPhase("collecting");
    } catch (err) {
      if (err.notConfigured) {
        setMissing(err.missing);
        setMessage(err.message);
        setPhase("notConfigured");
        return;
      }
      setMessage(err.message);
      setPhase("failed");
    }
  }, [onTrace, syncFromClient, finish]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    start();
  }, [start]);

  // A FlowCollector branches the flow instead of submitting this screen, so it
  // must NOT go through submit() — no values are written and next() is not
  // called. client.flow({action}) returns the initiator to invoke.
  const takeFlow = useCallback(async (collector) => {
    const client = clientRef.current;
    if (!client) return;
    setBusy(true);
    setMessage(null);
    try {
      const node = await client.flow({ action: collector.output?.key ?? collector.name })();
      if (node?.status === "failure") {
        setMessage(client.getError?.()?.message || "That path could not be started.");
        setPhase("failed");
        return;
      }
      syncFromClient(client, node);
      setPhase("collecting");
    } catch (err) {
      setMessage(err.message);
      setPhase("failed");
    } finally {
      setBusy(false);
    }
  }, [syncFromClient]);

  const submit = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    setBusy(true);
    setMessage(null);
    try {
      // Values are already in the SDK: each field wrote through its updater on
      // change (Ping's own sample does the same), so there is nothing to
      // collect here and no submit-time loop that could miss a collector.
      const node = await client.next();
      if (node?.status === "success") {
        await finish(client);
        return;
      }
      if (node?.status === "failure") {
        setMessage(client.getError?.()?.message || "The flow ended without signing in.");
        setPhase("failed");
        return;
      }
      // 'continue' and 'error' both re-render; 'error' carries field messages.
      syncFromClient(client, node);
      setPhase("collecting");
    } catch (err) {
      setMessage(err.message);
      setPhase("failed");
    } finally {
      setBusy(false);
    }
  }, [finish, syncFromClient]);

  return (
    <div className="dvsdk-page">
      {/* Matches the side-nav label. The nav was renamed to "Orchestration SDK
          Login" while this heading still said "DaVinci SDK Login", so clicking
          the orchestration entry landed on a page that did not look like the
          orchestration app — reported as "I do not see a way to start the
          orchestration app, I only see widget". */}
      <h1 className="dvsdk-title">Orchestration SDK Login</h1>
      <p className="dvsdk-sub">
        The Ping Orchestration SDK runs a PingOne DaVinci flow and this page renders
        the flow&rsquo;s collectors itself &mdash; no DaVinci-hosted screens, no widget.
      </p>

      {phase === "loading" && <p className="dvsdk-status">Starting the flow...</p>}

      {/* An existing PingOne session completed the flow with no screens. Say
          who it signed in as and let the user choose, rather than dropping
          them into the app as someone they may not have expected. */}
      {phase === "reused" && (
        <div className="dvsdk-notice">
          <p className="dvsdk-notice-title">Signed in with your existing PingOne session</p>
          <p>
            {reusedAs ? (
              <>
                You are signed in as <strong>{reusedAs}</strong>.
              </>
            ) : (
              "This browser was already signed in to PingOne, so no form was needed."
            )}
          </p>
          <div className="dvsdk-actions">
            <button
              type="button"
              className="dvsdk-retry"
              onClick={() => showSignedIn(reusedAs, "session")}
            >
              Continue
            </button>
            <button type="button" className="dvsdk-retry" onClick={signOut}>
              Sign out of PingOne and use a different account
            </button>
          </div>
        </div>
      )}

      {/* Signed in and deliberately STILL HERE — no trip out to the app. */}
      {phase === "signedIn" && (
        <div className="dvsdk-notice">
          <p className="dvsdk-notice-title">You&rsquo;re signed in</p>
          <p>
            {signedIn?.username ? (
              <>
                Signed in as <strong>{signedIn.username}</strong>.
              </>
            ) : (
              "Signed in."
            )}
          </p>
          <div className="dvsdk-actions">
            <button type="button" className="dvsdk-retry" onClick={() => setShowWhatHappened(true)}>
              What just happened?
            </button>
            <button type="button" className="dvsdk-retry" onClick={signOut}>
              Sign out of PingOne and use a different account
            </button>
          </div>
        </div>
      )}

      {phase === "notConfigured" && (
        <div className="dvsdk-notice">
          <p className="dvsdk-notice-title">Not configured</p>
          <p>{message}</p>
          {missing?.length > 0 && (
            <ul className="dvsdk-missing">
              {missing.map((m) => (
                <li key={m}>
                  <code>{m}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {phase === "failed" && (
        <div className="dvsdk-error">
          {/* userSessionMismatch: PingOne already has a session for a DIFFERENT
              user and will not sign someone else in on top of it. Reported
              while signed in as demoAdmin. Retrying cannot fix that; signing
              out of PingOne can, so offer it instead of the bare code. */}
          {/userSessionMismatch/i.test(message || "") ? (
            <p>
              This browser is signed in to PingOne as a different user, so PingOne will not
              sign you in as someone else on top of that session.
            </p>
          ) : (
            <p>{message}</p>
          )}
          <div className="dvsdk-actions">
            <button type="button" className="dvsdk-retry" onClick={start}>
              Try again
            </button>
            {/userSessionMismatch/i.test(message || "") && (
              <button type="button" className="dvsdk-retry" onClick={signOut}>
                Sign out of PingOne and use a different account
              </button>
            )}
          </div>
        </div>
      )}

      {phase === "collecting" && (
        <form
          className="dvsdk-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {message && <p className="dvsdk-form-error">{message}</p>}
          {collectors.map((c) => {
            const key = c.output?.key ?? c.name ?? c.id;
            return (
              <CollectorField
                key={`${step}:${c.id ?? key}`}
                collector={c}
                updater={c.category === "ActionCollector" ? undefined : clientRef.current?.update(c)}
                serverError={fieldErrors[key]}
                busy={busy}
                onSubmit={submit}
                onFlow={() => takeFlow(c)}
              />
            );
          })}
        </form>
      )}

      {/* The developer walkthrough: how the app is wired to PingOne, pi.flow,
          collectors, how each DaVinci step comes back, and the BFF exchange —
          plus what actually happened on this run, from the page's own SDK
          trace. New storageKey so a size saved for the old, smaller modal does
          not shrink this one. */}
      <DraggableModal
        isOpen={showWhatHappened}
        onClose={() => setShowWhatHappened(false)}
        title="What just happened"
        storageKey="davinci-sdk-walkthrough"
        defaultWidth={900}
        defaultHeight={760}
      >
        <div className="dm-scroll">
          <SdkWalkthrough
            via={signedIn?.via}
            username={signedIn?.username}
            trace={traceRef.current}
            config={cfgRef.current || {}}
          />
        </div>
      </DraggableModal>
    </div>
  );
}
