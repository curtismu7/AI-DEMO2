// Guided Demo Track — standalone presenter page (spec surface 1).
// Live view polls /api/demo-track; the run picker swaps in an archived
// run from /api/demo-track/runs as a static snapshot (no polling, no mutation).
//
// Layout follows the standalone Ping UI Standard through the shared primitives
// (components/pingUi, docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards,
// P5 key-value, P7 chips with a word, P9 buttons. Nothing on this page is mocked, so the banner
// says what is live (the recorded decisions, the agent call, the gauntlet attacks) and what is an
// archived snapshot.
//
// P9 "one primary per view" is read as one primary ACTION AT A TIME, decided in one place
// (primaryKey below): the next Run in the step that is open; when that step has nothing left to
// run (or none is open) "Start new run"; on an archived snapshot "Back to the live run". The
// run-controls button is one element that swaps its label, so keyboard focus stays on it.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import apiClient from "../services/apiClient";
import { requiredFlagsForUseCase } from "../utils/requiredDemoFlags";
import { useThemeOptional } from "../context/ThemeContext";
import "./DemoTrackPage.css";
import InlineSpinner from '../components/shared/InlineSpinner';
import PageAgentModeToggle, { usePageAgentMode } from '../components/shared/PageAgentModeToggle';
import PageHeader from '../components/common/PageHeader';
import { PingPage, SimBanner, PageFrame, Section, Card, StatusChip, KvList } from '../components/pingUi';

const POLL_MS = 5000;
const ACT_META = {
  1: { kicker: "Act 1 of 2", title: "The customer agent", tagline: "One user, one agent, real money — prove every action is governed." },
  2: { kicker: "Act 2 of 2", title: "Same rails govern the admins", tagline: "The AI that manages your identity platform is itself governed by it." },
};

function fmtTime(iso) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
}

function stepComplete(step, run, gauntletSims) {
  if (step.stepId === "attack-gauntlet") {
    return gauntletSims.length > 0 && gauntletSims.every((g) => run.gauntlet?.[g.sim]?.blocked);
  }
  const green = !step.slots.green || run.slots[`${step.stepId}:green`];
  const red = !step.slots.red || run.slots[`${step.stepId}:red`];
  return Boolean(green && red);
}

// Light markdown flattening for the agent reply — the heuristic/LLM replies use
// **bold** and • bullets; strip the markers and keep line breaks (repo bans raw
// markdown markers in UI text). No HTML injection — plain text, pre-wrapped.
function plainText(s) {
  return String(s || "").replace(/\*\*/g, "").replace(/`/g, "").trim();
}

// A step has started once any of its slots is stamped (or any gauntlet attack was blocked).
function stepStarted(step, run, gauntletSims) {
  if (step.stepId === "attack-gauntlet") return gauntletSims.some((g) => run.gauntlet?.[g.sim]);
  return Boolean(run.slots[`${step.stepId}:green`] || run.slots[`${step.stepId}:red`]);
}

function SlotResponse({ resp }) {
  if (!resp) return null;
  if (resp.sims) {
    return (
      <div className="dtp-response" role="status">
        <div className="dtp-response-head">What happened</div>
        {resp.sims.map((s) => (
          <div key={s.sim} className="dtp-response-sim">
            <span className="dtp-response-sim-name">{s.sim}</span>
            <span className="dtp-response-sim-out">HTTP {s.status}{s.errorCode ? ` · ${s.errorCode}` : ""}</span>
          </div>
        ))}
      </div>
    );
  }
  if (!resp.reply) return null;
  return (
    <div className="dtp-response" role="status">
      <div className="dtp-response-head">
        Agent response{resp.tools?.length ? <span className="dtp-response-tool"> · {resp.tools.join(", ")}</span> : null}
      </div>
      <div className="dtp-response-body">{plainText(resp.reply)}</div>
    </div>
  );
}

const VERDICT_TONE = { PERMIT: "ok", STEP_UP: "warn" };

function SlotRow({ tag, slot, stamp, prompt, onRun, runStatus, canRun, lead }) {
  const verdictTone = stamp ? (VERDICT_TONE[stamp.verdict] || "danger") : "neutral";
  return (
    <div className="dtp-run-row">
      <StatusChip tone={tag === "GREEN" ? "ok" : "danger"}>{tag}</StatusChip>
      <span className="dtp-prompt">{prompt || slot.chipText || slot.label}</span>
      {stamp ? (
        <span className="dtp-stamp" title={stamp.reason || ""}>
          <StatusChip tone={verdictTone}>{stamp.verdict} {stamp.verdict === "PERMIT" ? "✓" : "✕"}</StatusChip>
          <span className="dtp-stamp-meta pu-mono">
            {fmtTime(stamp.at)}
            {stamp.decisionId ? ` · ${stamp.decisionId}` : ""}
          </span>
        </span>
      ) : runStatus === "error" ? (
        <span className="dtp-run-note dtp-run-note--error" role="status">✕ run failed — check the agent</span>
      ) : runStatus === "running" ? (
        <span className="dtp-run-note dtp-run-note--running" role="status">running through the agent…</span>
      ) : runStatus === "done" ? (
        <span className="dtp-run-note dtp-run-note--done" role="status">✓ ran — recording verdict…</span>
      ) : (
        <span className="dtp-run-note">waiting for a matching run</span>
      )}
      {canRun && (
        <PuButton
          lead={lead}
          className="dtp-run-btn"
          onClick={onRun}
          busy={runStatus === "running"}
        >
          {runStatus === "running" ? "Running…" : runStatus === "done" ? "✓ ran" : stamp ? "Run again" : "Run"}
          <span className="dtp-sr"> ({tag === "GREEN" ? "permit" : "deny"} case)</span>
        </PuButton>
      )}
    </div>
  );
}

export default function DemoTrackPage() {
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const [state, setState] = useState(null); // { track, run } (live)
  const [agentMode, setAgentMode] = usePageAgentMode('demo-track', 'heuristics');
  const [history, setHistory] = useState([]);
  const [viewRunId, setViewRunId] = useState("live");
  const [expanded, setExpanded] = useState(null); // stepId | null — manual expand overlay
  const [error, setError] = useState(null);

  // The support console deep-links here with ?track=support; the main page is
  // the default. Read once on mount, same style as the ?step deep link below.
  const trackId = useMemo(
    () => (new URLSearchParams(window.location.search).get("track") === "support" ? "support" : "main"),
    [],
  );
  const trackQuery = trackId === "main" ? "" : `?track=${trackId}`;

  // load() is invoked from four independent, overlapping call sites (the 5s
  // poll, startRun, onStepClick, runSlot) — a slower, older request can
  // resolve after a newer one and clobber fresher state. Guard with a
  // monotonic request id: only the most recently-issued call may setState.
  const loadReqIdRef = useRef(0);
  const load = useCallback(async () => {
    const myReqId = ++loadReqIdRef.current;
    try {
      const [stateRes, runsRes] = await Promise.all([
        apiClient.get(`/api/demo-track${trackQuery}`),
        apiClient.get("/api/demo-track/runs"),
      ]);
      if (myReqId !== loadReqIdRef.current) return; // a newer load() has since started
      setState(stateRes.data);
      setHistory(runsRes.data.runs || []);
      setError(null);
    } catch (e) {
      if (myReqId !== loadReqIdRef.current) return;
      setError(e.message);
    }
  }, [trackQuery]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('step') === 'attack-gauntlet') {
      setExpanded('attack-gauntlet');
    }
  }, []);

  const isLive = viewRunId === "live";
  const run = useMemo(() => {
    if (!state) return null;
    if (isLive) return state.run;
    return history.find((r) => r.runId === viewRunId) || state.run;
  }, [state, history, viewRunId, isLive]);

  // "idle" | "busy" | "done" | "failed" — visible feedback for Start new run
  // (a fresh empty run renders identically, so the click needs its own signal).
  const [runState, setRunState] = useState("idle");
  const runFlashRef = useRef(null);
  useEffect(() => () => { if (runFlashRef.current) clearTimeout(runFlashRef.current); }, []);

  const startRun = useCallback(async () => {
    setRunState("busy");
    try {
      await (trackId === "main"
        ? apiClient.post("/api/demo-track/runs")
        : apiClient.post("/api/demo-track/runs", { track: trackId }));
      await load();
      setRunState("done");
    } catch {
      setRunState("failed");
    }
    if (runFlashRef.current) clearTimeout(runFlashRef.current);
    runFlashRef.current = setTimeout(() => setRunState("idle"), 1800);
  }, [load, trackId]);

  const onStepClick = useCallback(async (stepId) => {
    setExpanded((cur) => (cur === stepId ? null : stepId));
    if (!isLive) return;
    try {
      await (trackId === "main"
        ? apiClient.post("/api/demo-track/active-step", { stepId })
        : apiClient.post("/api/demo-track/active-step", { stepId, track: trackId }));
      load();
    } catch { /* next poll recovers */ }
  }, [isLive, load, trackId]);

  // ── In-page runner: dispatch chips through the REAL agent, honoring the
  // active vertical. Chip text resolves from the per-vertical use-case catalog
  // (e.g. UC2 is "hand off to a specialist" in banking but "show my sensitive
  // patient records" in healthcare); sim-sourced red slots run attack sims.
  const [vertical, setVertical] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [slotRuns, setSlotRuns] = useState({}); // `${stepId}:${color}` -> "running" | "done" | "error"
  const [slotResponses, setSlotResponses] = useState({}); // key -> { reply, tools, sims }
  const slotFlashRef = useRef(null);
  useEffect(() => () => { if (slotFlashRef.current) clearTimeout(slotFlashRef.current); }, []);

  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    const onAuth = () => setAuthed(true);
    window.addEventListener('userAuthenticated', onAuth);
    return () => window.removeEventListener('userAuthenticated', onAuth);
  }, []);

  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await apiClient.get("/api/verticals/me");
        const activeId = me.data?.activeId || "banking";
        if (cancelled) return;
        setVertical(activeId);
        const cat = await apiClient.get(`/api/use-cases?vertical=${encodeURIComponent(activeId)}`);
        if (!cancelled) setCatalog(cat.data?.useCases || []);
      } catch { /* runner degrades to config chip text */ }
    })();
    return () => { cancelled = true; };
  }, [authed]);

  // Vertical-resolved prompt for a step's green chip: the catalog trigger of the
  // step's primary backing UC wins; config chipText is the fallback.
  const promptFor = useCallback((step, color, slot) => {
    if (color === "green") {
      const primary = step.ucIds?.[0];
      const uc = catalog.find((u) => u && (u.id === primary || u.useCaseId === step.stepId));
      if (uc?.trigger?.type === "chip" && uc.trigger.text) return uc.trigger.text;
    }
    return slot.chipText || null;
  }, [catalog]);

  const setSlotRun = useCallback((key, value) =>
    setSlotRuns((cur) => {
      const next = { ...cur };
      if (value) next[key] = value; else delete next[key];
      return next;
    }), []);

  const runSlot = useCallback(async (step, color, slot) => {
    const key = `${step.stepId}:${color}`;
    setSlotRun(key, "running");
    try {
      // Arm THIS slot first: the matcher's wildcard (which lets any vertical's
      // tool stamp the step) fires only for the armed slot, and only until the
      // run it was armed for fills it.
      await apiClient.post("/api/demo-track/arm", { stepId: step.stepId, color }).catch(() => {});
      if (slot.source === "sim") {
        const results = [];
        for (const sim of slot.match?.sims || []) {
          // Sequential on purpose: rapid-fire but ordered, like the launcher.
          // eslint-disable-next-line no-await-in-loop
          const r = await apiClient.post("/api/demo/attack-sim/run", { sim });
          results.push({ sim, status: r.data?.status, errorCode: r.data?.errorCode });
        }
        setSlotResponses((cur) => ({ ...cur, [key]: { sims: results } }));
      } else {
        // Arm the flags this step needs (same contract as the launcher/dropdown).
        const flags = requiredFlagsForUseCase({ useCaseId: step.stepId, primaryTool: slot.match?.tools?.[0] || null });
        if (flags.length) {
          const updates = Object.fromEntries(flags.map((f) => [f, true]));
          // _noAuthBanner: arming is best effort on an admin-gated route, so its
          // 401 says nothing about the session — without this it raises the global
          // re-auth banner over a step that may have answered correctly.
          await apiClient
            .patch("/api/admin/feature-flags", { updates }, { _noAuthBanner: true })
            .catch(() => {});
        }
        const prompt = promptFor(step, color, slot);
        if (!prompt) throw new Error("no dispatchable chip for this slot");
        const res = await apiClient.post("/api/agent/invoke", {
          prompt,
          agentMode,
          // Scripted slots resolve their chip deterministically; llama.cpp mode lets the model route instead.
          ...(agentMode === "heuristics" ? { forceHeuristic: true } : {}),
          vertical: vertical || "banking",
        });
        // Keep what the agent actually said + which tool ran, so the presenter
        // sees WHAT happened, not just that a slot stamped.
        setSlotResponses((cur) => ({ ...cur, [key]: { reply: res.data?.reply || "", tools: res.data?.toolsCalled || [] } }));
      }
      // Success: reload (the stamp usually lands here) and flash a "✓ ran"
      // acknowledgement, so a permit doesn't look dead before/instead of the
      // stamp landing. The stamp itself takes over once present.
      await load();
      setSlotRun(key, "done");
      if (slotFlashRef.current) clearTimeout(slotFlashRef.current);
      slotFlashRef.current = setTimeout(() => setSlotRun(key, null), 2500);
    } catch {
      setSlotRun(key, "error");
    }
  }, [promptFor, vertical, load, setSlotRun, agentMode]);

  // Every state renders inside the page frame with the banner first, so what is live and what is
  // not is stated even while loading or when the server did not answer.
  // A failed poll must not unmount the page (and the focused control in it): once a run has been
  // received, `ready` stays true and the error shows as an alert card above the last data.
  const ready = Boolean(state && run);
  const track = ready ? state.track : null;
  const steps = ready ? track.steps : [];
  // The support track (config/supportDemoTrack.js) has no gauntlet — the field
  // is absent, not empty, so a bare .filter would throw.
  const gauntletSims = ready && Array.isArray(track.gauntletSims) ? track.gauntletSims : [];
  const hasGauntlet = ready && steps.some((s) => s.stepId === "attack-gauntlet");
  const gauntletBlocked = ready ? gauntletSims.filter((g) => run.gauntlet?.[g.sim]?.blocked).length : 0;
  const allDone = ready && steps.every((s) => stepComplete(s, run, gauntletSims));
  const doneCount = ready ? steps.filter((s) => stepComplete(s, run, gauntletSims)).length : 0;

  const isStepOpen = (step) => (expanded ? expanded === step.stepId : isLive && run.activeStepId === step.stepId);

  // Can this slot's Run button be shown? Same rule the rows used before, in one place so the primary
  // decision below agrees with what is on screen.
  const canRunSlot = (step, color) => {
    const slot = step.slots[color];
    if (!isLive || !slot) return false;
    if (step.stepId === "attack-gauntlet") return color === "red";
    if (color === "green") return Boolean(promptFor(step, "green", slot));
    return slot.source === "sim" || Boolean(slot.chipText);
  };

  // P9: exactly one primary at a time. Archived snapshot: back to live. Live: the next unstamped Run
  // in the open step (green before red; the gauntlet's single button until all attacks are blocked);
  // when the open step has none, or no step is open, Start new run.
  let primaryKey = "controls";
  if (ready && isLive) {
    const open = steps.find(isStepOpen);
    if (open) {
      if (open.stepId === "attack-gauntlet") {
        if (canRunSlot(open, "red") && gauntletBlocked < gauntletSims.length) primaryKey = `${open.stepId}:red`;
      } else if (canRunSlot(open, "green") && !run.slots[`${open.stepId}:green`]) primaryKey = `${open.stepId}:green`;
      else if (canRunSlot(open, "red") && !run.slots[`${open.stepId}:red`]) primaryKey = `${open.stepId}:red`;
    }
  }

  // Built before the steps so the banner is the first thing the page defines, as it is the first thing it shows.
  const runStamp = ready ? fmtTime(run.startedAt) : "";
  const banner = (
  <SimBanner data-testid="dtp-banner">
    {!ready ? (
      <>
        <strong>NOT CONNECTED</strong> — this page has not received a run from the server yet, so nothing below is
        current. It shows no sample data in its place.
      </>
    ) : isLive && error ? (
      <>
        <strong>LAST RUN RECEIVED</strong> — the server did not answer the latest refresh, so this may be out of
        date. The page keeps retrying every 5 seconds. It shows no sample data in its place.
      </>
    ) : isLive ? (
      <>
        <strong>LIVE RUN</strong> — this page follows the run the server is recording now and refreshes every 5
        seconds. Each verdict stamp is a decision the server logged when the agent or the gateway handled a call;
        none of it is sample data. Run sends a step&apos;s prompt through this app&apos;s agent (Heuristics routes
        it with fixed rules, llama.cpp lets the local model choose the tool){hasGauntlet
          ? `, and the gauntlet sends ${gauntletSims.length} deliberately flawed tokens to the real gateway`
          : ""}.
      </>
    ) : (
      <>
        <strong>ARCHIVED RUN</strong> — a saved snapshot of an earlier run (started {runStamp}). It does not refresh,
        nothing here runs, and nothing you click changes it. Go back to the live run to keep presenting.
      </>
    )}
  </SimBanner>
  );

  const renderStep = (step, idx) => {
    const complete = stepComplete(step, run, gauntletSims);
    const isActive = isLive && run.activeStepId === step.stepId;
    const isOpen = isStepOpen(step);
    const green = run.slots[`${step.stepId}:green`];
    const red = run.slots[`${step.stepId}:red`];
    const isGauntlet = step.stepId === "attack-gauntlet";
    const stepChip = complete
      ? <StatusChip tone="ok">PROVED</StatusChip>
      : stepStarted(step, run, gauntletSims)
        ? <StatusChip tone="warn">In progress</StatusChip>
        : isActive
          ? <StatusChip tone="info">Active</StatusChip>
          : <StatusChip tone="neutral">Not run</StatusChip>;
    return (
      <Card
        key={step.stepId}
        tone={complete ? "ok" : isActive ? undefined : "neutral"}
        className={`dtp-step${complete ? " dtp-step--done" : ""}${isActive ? " dtp-step--active" : ""}`}
        data-testid={`dtp-step-${step.stepId}`}
      >
        <h3 className="dtp-step-h">
          <button
            type="button"
            className="dtp-step-head"
            aria-expanded={isOpen}
            aria-controls={`dtp-body-${step.stepId}`}
            onClick={() => onStepClick(step.stepId)}
          >
            <span className="dtp-step-num" aria-hidden="true">{complete ? "✓" : idx + 1}</span>
            <span className="dtp-step-title">{step.title}</span>
            <span className="dtp-step-cap">{step.capability}</span>
            <span className="dtp-step-ucs pu-mono">{Array.isArray(step.ucIds) ? step.ucIds.join(" · ") : ""}</span>
            {stepChip}
            <span className="dtp-chev" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
          </button>
        </h3>
        {!isOpen && (
          <div className="dtp-collapsed-note">
            {step.slots.green && <span>✓ {green ? step.proved.green : step.slots.green.chipText}</span>}
            {step.slots.green && step.slots.red && <span> · </span>}
            {step.slots.red && <span>✕ {red ? step.proved.red : step.slots.red.chipText || step.slots.red.label}</span>}
          </div>
        )}
        {isOpen && (
          <div className="dtp-step-body" id={`dtp-body-${step.stepId}`}>
            <p className="dtp-buyer-story">{step.buyerStory}</p>
            {isGauntlet ? (
              <>
                <div className="dtp-gauntlet-bar">
                  {isLive && step.slots.red && (
                    <PuButton
                      lead={primaryKey === `${step.stepId}:red`}
                      className="dtp-run-btn"
                      onClick={() => runSlot(step, "red", step.slots.red)}
                      busy={slotRuns[`${step.stepId}:red`] === "running"}
                    >
                      {slotRuns[`${step.stepId}:red`] === "running" ? "Running attacks…" : "Run all 6 attacks"}
                    </PuButton>
                  )}
                  <StatusChip tone={gauntletSims.length > 0 && gauntletBlocked === gauntletSims.length ? "ok" : "neutral"}>
                    {gauntletBlocked} / {gauntletSims.length} blocked
                  </StatusChip>
                  {slotRuns[`${step.stepId}:red`] === "error" && (
                    <span className="dtp-run-note dtp-run-note--error" role="status">✕ a sim call failed</span>
                  )}
                </div>
                <div className="dtp-gauntlet">
                  {gauntletSims.map((g) => {
                    const tile = run.gauntlet?.[g.sim];
                    return (
                      <div key={g.sim} className="dtp-g-tile">
                        <div className="dtp-g-name">{g.label}</div>
                        <div className="dtp-g-uc pu-mono">{g.ucId}</div>
                        <StatusChip tone={tile?.blocked ? "ok" : "neutral"}>
                          {tile?.blocked ? "BLOCKED ✓" : "pending"}
                        </StatusChip>
                        {tile?.errorCode ? <span className="dtp-g-code pu-mono">{tile.errorCode}</span> : null}
                        {tile?.reason && <div className="dtp-g-reason">{tile.reason}</div>}
                      </div>
                    );
                  })}
                </div>
                <SlotResponse resp={slotResponses[`${step.stepId}:red`]} />
              </>
            ) : (
              <>
                {step.slots.green && (
                  <>
                    <SlotRow
                      tag="GREEN" slot={step.slots.green} stamp={green}
                      prompt={promptFor(step, "green", step.slots.green)}
                      canRun={canRunSlot(step, "green")}
                      lead={primaryKey === `${step.stepId}:green`}
                      runStatus={slotRuns[`${step.stepId}:green`]}
                      onRun={() => runSlot(step, "green", step.slots.green)}
                    />
                    {green?.reason && <div className="dtp-reason dtp-reason--g">{green.reason}</div>}
                    <SlotResponse resp={slotResponses[`${step.stepId}:green`]} />
                  </>
                )}
                {step.slots.red && (
                  <>
                    <SlotRow
                      tag="RED" slot={step.slots.red} stamp={red}
                      prompt={step.slots.red.source === "sim" ? null : promptFor(step, "red", step.slots.red)}
                      canRun={canRunSlot(step, "red")}
                      lead={primaryKey === `${step.stepId}:red`}
                      runStatus={slotRuns[`${step.stepId}:red`]}
                      onRun={() => runSlot(step, "red", step.slots.red)}
                    />
                    {red?.reason && (
                      <div className="dtp-reason dtp-reason--r">
                        {red.errorCode ? <span className="dtp-reason-code pu-mono">{red.errorCode}</span> : null}
                        {red.reason}
                      </div>
                    )}
                    <SlotResponse resp={slotResponses[`${step.stepId}:red`]} />
                  </>
                )}
              </>
            )}
            {complete && (
              <div className="dtp-takeaway">
                <h4>WHAT THIS PROVED</h4>
                {step.proved.green && (
                  <div className="dtp-takeaway-line">
                    <span className="dtp-mark dtp-mark--g"><span aria-hidden="true">✓</span><span className="dtp-sr">Permitted: </span></span>
                    <span>{step.proved.green}</span>
                  </div>
                )}
                {step.proved.red && (
                  <div className="dtp-takeaway-line">
                    <span className="dtp-mark dtp-mark--r"><span aria-hidden="true">✕</span><span className="dtp-sr">Denied: </span></span>
                    <span>{step.proved.red}</span>
                  </div>
                )}
                <div className="dtp-talk-track"><b>SAY THIS:</b> {step.proved.sayThis}</div>
              </div>
            )}
          </div>
        )}
      </Card>
    );
  };

  const controlsBusy = isLive && runState === "busy";

  return (
    <PingPage className="dtp-root">
      {banner}
      <PageHeader
        eyebrow="AI Experiences · Presenter track"
        title="Guided Demo Track"
        summary={ready
          ? `Two acts · ${steps.length} steps · every step ends with a permit AND a deny`
          : "Two acts, and every step ends with a permit AND a deny."}
      />
      <PageFrame>
        {error && (
          <Section id="dtp-error-h" kicker="Status" title="Demo Track unavailable">
            <Card tone="danger">
              <p className="pu-status-line" role="alert">
                <StatusChip tone="danger">Error</StatusChip>
                <span className="dtp-error">Demo Track unavailable — {error}</span>
              </p>
              <p className="pu-note">
                {ready
                  ? "The last run received is still shown below, but it is no longer current. The page keeps trying every 5 seconds."
                  : "The page keeps trying every 5 seconds and fills in as soon as the server answers."}
              </p>
            </Card>
          </Section>
        )}
        {!ready ? (error ? null : (
          <Section id="dtp-loading-h" kicker="Status" title="Loading the run">
            <div className="dtp-loading"><InlineSpinner label="Loading demo track…" /></div>
          </Section>
        )) : (
          <>
            <Section
              id="dtp-controls-h"
              kicker="1 · Your run"
              title={isLive ? "Live run" : "Archived run"}
              lede="Pick a saved run to read it back, or start a fresh one."
            >
              <Card tone={isLive ? "live" : "neutral"} className="dtp-controls">
                <p className="pu-status-line">
                  {isLive
                    ? <StatusChip tone="ok">Live</StatusChip>
                    : <StatusChip tone="warn">Viewing history — read-only</StatusChip>}
                  {vertical && <StatusChip tone="info">Vertical: {vertical}</StatusChip>}
                  <span>{doneCount} of {steps.length} steps proved</span>
                </p>
                <KvList
                  items={[
                    {
                      label: "Run",
                      value: (
                        <select className="pu-select" aria-label="Run" value={viewRunId} onChange={(e) => setViewRunId(e.target.value)}>
                          <option value="live">Live · started {fmtTime(state.run.startedAt)}</option>
                          {history.map((r) => (
                            <option key={r.runId} value={r.runId}>
                              {new Date(r.startedAt).toLocaleString()} — {Object.keys(r.slots).length} slots
                            </option>
                          ))}
                        </select>
                      ),
                    },
                    { label: "Agent mode", value: <PageAgentModeToggle mode={agentMode} onChange={setAgentMode} /> },
                    {
                      label: "Progress",
                      value: (
                        <span className="dtp-progress" role="img" aria-label={`${doneCount} of ${steps.length} steps proved`}>
                          {steps.map((s, i) => {
                            const complete = stepComplete(s, run, gauntletSims);
                            const active = isLive && run.activeStepId === s.stepId;
                            return (
                              <span key={s.stepId} className={`dtp-dot${complete ? " dtp-dot--done" : ""}${active ? " dtp-dot--active" : ""}`}>
                                {complete ? "✓" : i + 1}
                              </span>
                            );
                          })}
                        </span>
                      ),
                    },
                  ]}
                />
                <div className="pu-actions">
                  {/* One element for both views, so focus stays on it when the view changes. */}
                  <PuButton
                    lead={primaryKey === "controls"}
                    busy={controlsBusy}
                    onClick={isLive ? startRun : () => setViewRunId("live")}
                    className={runState === "failed" && isLive ? "dtp-newrun--failed" : ""}
                  >
                    {!isLive ? "Back to the live run"
                      : runState === "busy" ? "Starting…"
                        : runState === "done" ? "✓ New run started"
                          : runState === "failed" ? "✕ Failed — retry"
                            : "Start new run"}
                  </PuButton>
                  <PuButton
                    onClick={toggleDarkMode}
                    title="Switch this page between light and dark"
                  >
                    {darkMode ? "Light mode" : "Dark mode"}
                  </PuButton>
                </div>
              </Card>
            </Section>

            {[1, 2].map((act) => (
              <Section
                key={act}
                id={`dtp-act-${act}-h`}
                kicker={ACT_META[act].kicker}
                title={ACT_META[act].title}
                lede={ACT_META[act].tagline}
              >
                {steps.filter((s) => s.act === act).map((s) => renderStep(s, steps.indexOf(s)))}
              </Section>
            ))}

            <Section id="dtp-finish-h" kicker="Result" title="Track status">
              <Card tone={allDone ? "ok" : "neutral"} className="dtp-finish">
                <p className="pu-status-line">
                  {allDone ? <StatusChip tone="ok">Complete</StatusChip> : <StatusChip tone="neutral">In progress</StatusChip>}
                </p>
                {allDone ? (
                  <p className="dtp-finish-text">
                    <b>Track complete</b> — {steps.length} capabilities proved: {doneCount} permits and denials with decision evidence. Print this page as the leave-behind.
                  </p>
                ) : (
                  <p className="dtp-finish-text">
                    {doneCount} of {steps.length} steps proved so far — run the remaining steps from the agent or the use-case launcher.
                  </p>
                )}
              </Card>
            </Section>
          </>
        )}
      </PageFrame>
    </PingPage>
  );
}

// Every button on the page goes through here, so the one-primary rule has one place to read. A busy
// button stays focusable (aria-disabled, not disabled) so keyboard focus is not thrown to the page
// when a Run or Start starts; the click is ignored while busy.
function PuButton({ lead = false, busy = false, onClick, className = "", children, ...rest }) {
  return (
    <button
      type="button"
      className={`${lead ? "pu-btn pu-btn--primary" : "pu-btn"} ${className}`.trim()}
      aria-disabled={busy ? "true" : undefined}
      onClick={busy ? undefined : onClick}
      {...rest}
    >
      {children}
    </button>
  );
}
