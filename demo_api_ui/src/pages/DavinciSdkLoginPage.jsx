// /davinci-orchestration-sdk runs a DaVinci flow with the Ping Orchestration SDK,
// renders the flow's collectors as our own UI, and teaches how that works.
//
// Deliberately does NOT touch /davinci-login (the hosted-widget page) or any
// file in REGRESSION_PLAN §1. Parallel route, parallel BFF endpoints.
//
// It is a lesson page on the shared components/lesson shell, laid out like the
// DaVinci widget guide so the two lessons read as one course. "Try It Live"
// holds the working sign-in beside the Step Inspector: every SDK call adds a
// card showing the code that ran, the request, DaVinci's answer and the
// collectors, all from this browser's own run. The sections below it
// (SdkLessonSections) teach the rest.
//
// Scope today: interactive text, password, submit, action and flow collectors,
// plus PingOne Forms' display-only rich text, error placeholder, automatic
// Protect signal and passkey authentication. CollectorField renders a visible fallback for anything else
// rather than omitting a field silently.
//
// A successful sign-in does NOT leave this page. A "What just happened" modal
// summarises the run and links into the lesson; closing it leaves you here,
// signed in, with a way to reopen it or sign out to switch users.
import { useCallback, useEffect, useRef, useState } from "react";
import { fido } from "@forgerock/davinci-client";
import CollectorField from "../components/davinci/CollectorField";
import SdkExecutionReel from "../components/davinci/SdkExecutionReel";
import SdkLessonSections, { SDK_LESSON_SECTIONS } from "../components/davinci/SdkLessonSections";
import SdkWalkthrough from "../components/davinci/SdkWalkthrough";
import StepInspector, { summarizeResponse } from "../components/davinci/StepInspector";
import { createOperationEvent, normalizeTraceEntry } from "../components/davinci/sdkExecutionEvents";
import DraggableModal from "../components/DraggableModal";
import { LessonLayout, Section } from "../components/lesson";
import {
  fetchSdkConfig,
  initClient,
  postCallback,
  signOutOfPingOne,
  takePkceVerifier,
} from "../lib/davinciSdkClient";
import "./DavinciSdkLoginPage.css";

// What the Step Inspector records about the collector a user clicked.
const triggerOf = (c) =>
  c ? { type: c.type, key: c.output?.key ?? c.name, label: c.output?.label ?? null } : null;

export default function DavinciSdkLoginPage() {
  // loading | collecting | completing | signedIn | notConfigured | failed
  const [phase, setPhase] = useState("loading");
  // Who ended up signed in and HOW: "session" (an existing PingOne session
  // completed the flow with no screens) or "form" (the user submitted the
  // collectors). The summary tells the story of whichever actually happened.
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
  // One Step Inspector card per SDK call on this run.
  const [steps, setSteps] = useState([]);
  // The execution reel is separate from Step Inspector cards: it only records
  // display-safe events as the existing SDK paths actually occur.
  const [executionEvents, setExecutionEvents] = useState([]);
  const [workbenchPanel, setWorkbenchPanel] = useState("execution");
  const [mobileSurface, setMobileSurface] = useState("form");

  const clientRef = useRef(null);
  const cfgRef = useRef(null);
  const traceRef = useRef([]);
  const executionSequenceRef = useRef(0);
  // StrictMode double-invokes effects; starting the flow twice would burn two
  // nonces and leave the first flow orphaned.
  const startedRef = useRef(false);

  useEffect(() => {
    let closedBeforePrint = [];
    let hiddenLessonsPanel = null;
    const expandLessons = () => {
      const lessonsPanel = document.querySelector(".dvsdk-lesson-page .dvsdk-workbench-lessons");
      if (lessonsPanel?.hidden) {
        hiddenLessonsPanel = lessonsPanel;
        lessonsPanel.hidden = false;
      }
      closedBeforePrint = [...document.querySelectorAll(
        ".dvsdk-lesson-page .lesson-section-disclosure:not([open]), .dvsdk-lesson-page .sdk-lesson-code:not([open])",
      )];
      closedBeforePrint.forEach((section) => { section.open = true; });
    };
    const restoreLessons = () => {
      closedBeforePrint.forEach((section) => { section.open = false; });
      closedBeforePrint = [];
      if (hiddenLessonsPanel) hiddenLessonsPanel.hidden = true;
      hiddenLessonsPanel = null;
    };
    window.addEventListener("beforeprint", expandLessons);
    window.addEventListener("afterprint", restoreLessons);
    return () => {
      window.removeEventListener("beforeprint", expandLessons);
      window.removeEventListener("afterprint", restoreLessons);
      restoreLessons();
    };
  }, []);

  const appendExecutionEvent = useCallback((event) => {
    if (!event) return;
    const sequence = executionSequenceRef.current + 1;
    executionSequenceRef.current = sequence;
    setExecutionEvents((previous) => [...previous, { ...event, id: `execution-${sequence}`, sequence }]);
  }, []);

  const onTrace = useCallback((entry) => {
    traceRef.current.push(entry);
    appendExecutionEvent(normalizeTraceEntry(entry));
  }, [appendExecutionEvent]);

  // Records what really happened on one SDK call: the request the middleware
  // saw (masked before it was stored), the SDK's own cached copy of DaVinci's
  // JSON, and the collectors it built. `from` is the trace length before the
  // call, so the card gets THIS call's request, not an earlier one.
  const recordStep = useCallback((client, kind, node, from, trigger = null) => {
    const request = traceRef.current.slice(from).filter((e) => e.source === "http").at(-1) || null;
    const cached = client.cache?.getLatestResponse?.();
    const status = node?.status ?? null;
    setSteps((prev) => [
      ...prev,
      {
        kind,
        trigger,
        request,
        response: summarizeResponse(cached?.data),
        nodeStatus: status,
        collectors:
          status === "continue" || status === "error"
            ? (client.getCollectors?.() || []).map((c) => ({
                type: c.type,
                category: c.category,
                key: c.output?.key ?? c.name,
                label: c.output?.label ?? null,
              }))
            : [],
        errorMessage: status === "error" || status === "failure" ? client.getError?.()?.message || null : null,
      },
    ]);
    appendExecutionEvent(
      createOperationEvent({
        lane: "davinci",
        kind: "response",
        label: `DaVinci returned ${status || "a response"}`,
        codeKey: kind === "next" ? "update-next" : kind,
        detail: {
          ...(request
            ? {
                method: request.method,
                host: (() => {
                  try { return new URL(request.url).host; } catch { return undefined; }
                })(),
                path: (() => {
                  try { return new URL(request.url).pathname; } catch { return undefined; }
                })(),
                paramNames: (() => {
                  try { return [...new URL(request.url).searchParams.keys()]; } catch { return []; }
                })(),
                responseMode: (() => {
                  try { return new URL(request.url).searchParams.get("response_mode") || undefined; } catch { return undefined; }
                })(),
                body: request.body,
              }
            : {}),
          status,
          eventType: cached?.data?.eventName ?? cached?.data?.eventType,
          response: summarizeResponse(cached?.data),
        },
      }),
    );
  }, [appendExecutionEvent]);

  // Reads collectors off the client rather than off the node, because
  // getCollectors() is the supported accessor and an error node still carries
  // its collectors, which is what lets the form re-render with complaints.
  const syncFromClient = useCallback((client, node) => {
    const currentCollectors = client.getCollectors?.() || [];
    setCollectors(currentCollectors);
    setStep((n) => n + 1);
    const errs = {};
    if (node?.status === "error") {
      for (const ec of client.getErrorCollectors?.() || []) {
        if (ec?.target) errs[ec.target] = ec.message;
      }
    }
    setFieldErrors(errs);
    setMessage(node?.status === "error" ? client.getError?.()?.message || null : null);
    appendExecutionEvent(
      createOperationEvent({
        lane: "collector",
        kind: "collectors",
        label: "SDK collector snapshot",
        codeKey: null,
        detail: {
          status: node?.status,
          collectors: currentCollectors,
        },
      }),
    );
  }, [appendExecutionEvent]);

  // Stay on this page, signed in, and explain what just happened. `profile` is
  // what the BFF returned about the user: username, PingOne user id and email.
  const showSignedIn = useCallback((profile, via) => {
    setSignedIn({ ...profile, via });
    setPhase("signedIn");
    setShowWhatHappened(true);
  }, []);

  // Declared before start() because start() depends on it: a const in a
  // useCallback dependency array is read at render time, so referencing it
  // above its declaration throws.
  const finish = useCallback(async (client, { reused = false, originCodeKey = null } = {}) => {
    const code = client.getClient?.()?.authorization?.code;
    if (!code) throw new Error("The flow succeeded but returned no authorization code.");
    // The SDK owns the PKCE verifier; the BFF does the exchange and holds the
    // tokens, so the verifier has to travel with the code.
    const codeVerifier = takePkceVerifier(cfgRef.current.clientId);
    // Do not render a local "Continue" action while this request is in flight.
    // The authorization code is not a session until the BFF accepts it; the
    // page must visibly wait for that callback before showing the run summary.
    setPhase("completing");
    let result;
    try {
      result = await postCallback({ code, codeVerifier });
    } catch (err) {
      appendExecutionEvent(
        createOperationEvent({
          lane: "sdk",
          kind: "terminal",
          label: "SDK callback failed",
          codeKey: originCodeKey,
          detail: { status: "failure" },
        }),
      );
      throw err;
    }
    appendExecutionEvent(
      createOperationEvent({
        lane: "sdk",
        kind: "terminal",
        label: "SDK completes the callback",
        codeKey: originCodeKey,
        detail: { status: "success" },
      }),
    );
    // The BFF session exists now, but the app shell (TopNav, route guards)
    // re-checks it only on this event, so without it the page stayed signed-out
    // until a reload. It used to be a full page load that refreshed the shell.
    // One-shot, success path only, like PrivilegeMcpClientPage; never dispatch
    // it from a listener (AIAgent.js documents the re-check loop that causes).
    window.dispatchEvent(new CustomEvent("userAuthenticated"));
    const profile = {
      username: result?.username || null,
      userId: result?.userId || null,
      email: result?.email || null,
    };
    showSignedIn(profile, reused ? "session" : "form");
  }, [appendExecutionEvent, showSignedIn]);

  // Ends the PingOne session (not this app's session) and returns here with a
  // clean form, which is the way to sign in as a different user. See
  // signOutOfPingOne.
  const signOut = useCallback(() => {
    appendExecutionEvent(
      createOperationEvent({
        lane: "sdk",
        kind: "logout.begin",
        label: "PingOne sign-out begins",
        codeKey: "logout",
        detail: { status: "pending" },
      }),
    );
    signOutOfPingOne(cfgRef.current).catch((err) => {
      setMessage(err.message);
      setPhase("failed");
    });
  }, [appendExecutionEvent]);

  const start = useCallback(async () => {
    setPhase("loading");
    setMessage(null);
    setMissing(null);
    setSteps([]);
    setExecutionEvents([]);
    traceRef.current = [];
    executionSequenceRef.current = 0;
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
      const from = traceRef.current.length;
      const query = {
        nonce: cfg.nonce,
        ...(cfg.flowPolicyId ? { acr_values: cfg.flowPolicyId } : {}),
      };
      appendExecutionEvent(
        createOperationEvent({
          lane: "sdk",
          kind: "operation.begin",
          label: "SDK starts the flow",
          codeKey: "start",
          detail: { eventType: "start" },
        }),
      );
      const node = await client.start({ query });
      recordStep(client, "start", node, from);
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
        await finish(client, { reused: true, originCodeKey: "start" });
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
  }, [appendExecutionEvent, onTrace, recordStep, syncFromClient, finish]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    start();
  }, [start]);

  // A FlowCollector branches the flow instead of submitting this screen, so it
  // must NOT go through submit(): no values are written and next() is not
  // called. client.flow({action}) returns the initiator to invoke.
  const takeFlow = useCallback(async (collector) => {
    const client = clientRef.current;
    if (!client) return;
    setBusy(true);
    setMessage(null);
    try {
      const from = traceRef.current.length;
      const action = collector.output?.key ?? collector.name;
      appendExecutionEvent(
        createOperationEvent({
          lane: "sdk",
          kind: "operation.begin",
          label: "SDK follows FlowCollector",
          codeKey: "flow",
          detail: { type: collector.type, category: collector.category, actionKey: action },
        }),
      );
      const node = await client.flow({ action })();
      recordStep(client, "flow", node, from, triggerOf(collector));
      // A flow button can END the flow, not just branch it: a success screen's
      // "Continue" is a next-event button, which the SDK hands over as a
      // FlowCollector. Without this the COMPLETED node fell through to an empty
      // form and the code never reached the BFF.
      if (node?.status === "success") {
        await finish(client, { originCodeKey: "flow" });
        return;
      }
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
  }, [appendExecutionEvent, finish, recordStep, syncFromClient]);

  // `collector` is the SubmitCollector that was clicked (or, for Enter in a
  // field, the form's first one). It changes nothing about the request; it
  // only lets the Step Inspector name what the user did.
  const submit = useCallback(async (collector) => {
    const client = clientRef.current;
    if (!client) return;
    setBusy(true);
    setMessage(null);
    try {
      // Values are already in the SDK: each field wrote through its updater on
      // change (Ping's own sample does the same), so there is nothing to
      // collect here and no submit-time loop that could miss a collector.
      const from = traceRef.current.length;
      appendExecutionEvent(
        createOperationEvent({
          lane: "sdk",
          kind: "operation.begin",
          label: "SDK updates and advances form",
          codeKey: "update-next",
          detail: { type: collector?.type, category: collector?.category },
        }),
      );
      const node = await client.next();
      recordStep(client, "next", node, from, triggerOf(collector));
      if (node?.status === "success") {
        await finish(client, { originCodeKey: "update-next" });
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
  }, [appendExecutionEvent, finish, recordStep, syncFromClient]);

  const collectorUpdater = useCallback((collector) => (value) => {
    const result = clientRef.current.update(collector)(value);
    const key = collector.output?.key ?? collector.name;
    appendExecutionEvent(
      createOperationEvent({
        lane: "collector",
        kind: "collector.update",
        label: "SDK updates collector",
        codeKey: "update-next",
        detail: {
          type: collector.type,
          category: collector.category,
          formData: key ? { [key]: value } : {},
        },
      }),
    );
    return result;
  }, [appendExecutionEvent]);

  const authenticatePasskey = useCallback(async (collector) => {
    setBusy(true);
    setMessage(null);
    try {
      const assertion = await fido().authenticate(collector.output?.config?.publicKeyCredentialRequestOptions);
      if (assertion?.error || !assertion?.assertionValue) {
        throw new Error(assertion?.message || "Passkey authentication did not return an assertion.");
      }
      const updateError = collectorUpdater(collector)(assertion);
      if (updateError?.error) {
        throw new Error(updateError.error.message || "The SDK could not accept the passkey assertion.");
      }
      await submit(collector);
    } catch (err) {
      setMessage(err.message || "Passkey authentication failed.");
    } finally {
      setBusy(false);
    }
  }, [collectorUpdater, submit]);

  // From the modal's links: close it and bring that lesson section into view.
  const goToSection = useCallback((id) => {
    setShowWhatHappened(false);
    if (id !== "try-it-live") {
      setWorkbenchPanel("lessons");
      setMobileSurface("inspector");
      const disclosure = document.getElementById(id)?.querySelector(".lesson-section-disclosure");
      if (disclosure) disclosure.open = true;
    }
    window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth" }));
  }, []);

  return (
    <LessonLayout
      // Matches the side-nav label (sdkLoginHeadingMatchesNav.test.js). The nav
      // was once renamed while this heading was not, and the page stopped
      // looking like the orchestration app it is.
      title="DaVinci Orchestration SDK"
      subtitle={
        <>
          See the sign-in flow as it happens: the form, SDK calls, DaVinci responses, and collectors
          share one workspace.
        </>
      }
      sections={SDK_LESSON_SECTIONS}
      storageKey="dvsdk-lesson-nav-width"
      printExclude={["in-this-repo"]}
      pageClassName="dvsdk-lesson-page"
      showSectionNav={false}
    >
      <Section id="try-it-live" title="Try It Live">
        <p>
          The SDK draws each DaVinci step from collectors. Select a reel frame for its code and
          response. Choose <strong>Having trouble signing on?</strong> to see another form.
        </p>

        <div className="dvsdk-workbench" data-mobile-surface={mobileSurface}>
          <div className="dvsdk-workbench-mobile-tabs" role="group" aria-label="Mobile workspace">
            <button
              type="button"
              aria-pressed={mobileSurface === "form"}
              onClick={() => setMobileSurface("form")}
            >
              Live form
            </button>
            <button
              type="button"
              aria-pressed={mobileSurface === "inspector"}
              onClick={() => setMobileSurface("inspector")}
            >
              Execution &amp; lessons
            </button>
          </div>
          <div className="dvsdk-live-app lesson-no-print">
            <header className="dvsdk-login-header">
              <p className="dvsdk-eyebrow">PingOne DaVinci</p>
              <h2>Orchestration SDK Login</h2>
              <p className="dvsdk-subtitle">
                Sign in with the embedded orchestration form. Each screen comes from the live DaVinci flow.
              </p>
            </header>
            <div className="dvsdk-page">
              {phase === "loading" && <p className="dvsdk-status">Starting the flow...</p>}

              {phase === "completing" && (
                <div className="dvsdk-notice">
                  <p className="dvsdk-notice-title">Waiting for the authorization callback</p>
                  <p>PingOne completed the flow. The app is waiting for the BFF to establish the session.</p>
                </div>
              )}

              {/* Signed in and deliberately STILL HERE, with no trip out to the app. */}
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
                  {/* Read by the BFF from PingOne's userinfo after the code
                      exchange. The SDK flow cannot carry these: pi.flow hands
                      the page a screen's form fields, not the flow's HTML. */}
                  <dl className="dvsdk-profile">
                    <dt>Username</dt>
                    <dd>{signedIn?.username || "Not available"}</dd>
                    <dt>User ID</dt>
                    <dd>{signedIn?.userId ? <code>{signedIn.userId}</code> : "Not available"}</dd>
                    <dt>Email</dt>
                    <dd>{signedIn?.email || "Not set"}</dd>
                  </dl>
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
                    submit(collectors.find((c) => c.type === "SubmitCollector"));
                  }}
                >
                  {message && <p className="dvsdk-form-error">{message}</p>}
                  {collectors.map((c) => {
                    const key = c.output?.key ?? c.name ?? c.id;
                    return (
                      <CollectorField
                        key={`${step}:${c.id ?? key}`}
                        collector={c}
                        updater={c.category === "ActionCollector" ? undefined : collectorUpdater(c)}
                        serverError={fieldErrors[key]}
                        busy={busy}
                        onSubmit={() => submit(c)}
                        onFlow={() => takeFlow(c)}
                        onFido={() => authenticatePasskey(c)}
                      />
                    );
                  })}
                </form>
              )}
            </div>
          </div>

          <aside className="dvsdk-workbench-rail">
            <div className="dvsdk-workbench-tabs" role="tablist" aria-label="Evidence and lessons">
              <button
                type="button"
                role="tab"
                aria-selected={workbenchPanel === "execution"}
                onClick={() => { setWorkbenchPanel("execution"); setMobileSurface("inspector"); }}
              >
                Execution reel
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={workbenchPanel === "lessons"}
                onClick={() => { setWorkbenchPanel("lessons"); setMobileSurface("inspector"); }}
              >
                Lessons
              </button>
            </div>

            <div
              className="dvsdk-workbench-panel lesson-no-print"
              role="tabpanel"
              aria-label="Execution evidence"
              hidden={workbenchPanel !== "execution"}
            >
              <div className="dvsdk-live-reel">
                <SdkExecutionReel events={executionEvents} compact />
              </div>
              <details className="dvsdk-call-log">
                <summary>Full SDK call log</summary>
                <StepInspector steps={steps} />
              </details>
            </div>

            <div
              className="dvsdk-workbench-panel dvsdk-workbench-lessons"
              role="tabpanel"
              aria-label="Lessons"
              hidden={workbenchPanel !== "lessons"}
            >
              <SdkLessonSections config={cfgRef.current || {}} steps={steps} />
            </div>
          </aside>
        </div>
      </Section>

      {/* The run summary: what happened on this run, linking into the sections
          above. New storageKey so a size saved for the old, larger walkthrough
          modal does not carry over. */}
      <DraggableModal
        isOpen={showWhatHappened}
        onClose={() => setShowWhatHappened(false)}
        title="What just happened"
        storageKey="davinci-sdk-run-summary"
        defaultWidth={720}
        defaultHeight={620}
      >
        <div className="dm-scroll">
          <SdkWalkthrough
            via={signedIn?.via}
            username={signedIn?.username}
            trace={traceRef.current}
            steps={steps}
            onNavigate={goToSection}
          />
        </div>
      </DraggableModal>
    </LessonLayout>
  );
}
