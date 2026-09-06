import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import DraggableModal from "./DraggableModal";
import { DEMO_SCRIPT } from "./demoScript";
import "./DemoScriptLauncher.css";

// Cross-window channel so a Run/Go click from the popped-out teleprompter (2nd
// monitor) reaches the workbench/router on the main window. Same-window clicks
// use a window event / direct navigate; BroadcastChannel never echoes to the
// posting window, so neither path double-fires.
const runChannel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("demo-script")
    : null;

const FONT_KEY = "demo-script-font-px";
const FONT_MIN = 12;
const FONT_MAX = 26;
const FONT_STEP = 2;
const FONT_DEFAULT = 15;

function readSavedFontPx() {
  try {
    const v = parseInt(window.localStorage.getItem(FONT_KEY), 10);
    if (Number.isFinite(v)) return Math.min(FONT_MAX, Math.max(FONT_MIN, v));
  } catch {
    /* ignore storage errors */
  }
  return FONT_DEFAULT;
}

// Floating presenter teleprompter for the 15-min security demo. Mounted
// unguarded in App.js's global overlay block so it renders for ANY user,
// including unauthenticated (sign-in screen and every route). Static content
// only - no auth/session/provider dependency. The DraggableModal built-in
// pop-out opens the script in a separate window for a second monitor; the
// beats are a passive scroll. Text size is presenter-adjustable (A-/A+),
// persisted, and applied via the body font-size so it scales in the pop-out.
export default function DemoScriptLauncher({ user }) {
  const [open, setOpen] = useState(false);
  const [fontPx, setFontPx] = useState(readSavedFontPx);
  const [activeUcId, setActiveUcId] = useState(null);
  const navigate = useNavigate();
  const s = DEMO_SCRIPT;
  const bodyRef = useRef(null);
  const lastScrolledUcIdRef = useRef(null);

  // The sidebar "Demo Script" nav item (AdminSideNav) toggles the modal via a
  // window CustomEvent, since this launcher owns the modal state globally.
  useEffect(() => {
    const toggle = () => setOpen((o) => !o);
    window.addEventListener("demo-script-toggle", toggle);
    return () => window.removeEventListener("demo-script-toggle", toggle);
  }, []);

  // This button is fixed at bottom-left on every page (guest sessions only —
  // see the `!user` guard below), with no page-specific layout awareness. On
  // a public/guest use case the AI agent renders as a full-width bottom dock
  // (AIAgent.js `isBottomDock` -> `.ba-embedded-bottom-dock`), which on a
  // short mobile viewport reaches the same bottom-left corner and gets
  // covered by this button — reported live on a phone. Same fix pattern as
  // LandingPage.js's `landing-hero-ctas-in-view` (REGRESSION_PLAN.md
  // 2026-09-05), generalized: toggle a body class while the dock is
  // on-screen so CSS can hide this button under `<=768px` instead of guessing
  // a fixed pixel offset the dock's variable height would break anyway. A
  // MutationObserver (not a one-time querySelector) is needed here, unlike
  // the landing page's static hero, because the dock mounts/unmounts as the
  // agent panel opens and closes.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || typeof MutationObserver === "undefined") {
      return undefined;
    }
    let intersectionObserver = null;
    let observedEl = null;

    const setInView = (inView) => {
      document.body.classList.toggle("agent-bottom-dock-in-view", inView);
    };

    const attachTo = (el) => {
      if (el === observedEl) return;
      intersectionObserver?.disconnect();
      observedEl = el;
      if (!el) {
        setInView(false);
        return;
      }
      const rect = el.getBoundingClientRect();
      setInView(rect.top < window.innerHeight && rect.bottom > 0);
      intersectionObserver = new IntersectionObserver(
        ([entry]) => setInView(entry.isIntersecting),
        { threshold: 0.1 },
      );
      intersectionObserver.observe(el);
    };

    attachTo(document.querySelector(".ba-embedded-bottom-dock"));
    const mutationObserver = new MutationObserver(() => {
      attachTo(document.querySelector(".ba-embedded-bottom-dock"));
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      mutationObserver.disconnect();
      intersectionObserver?.disconnect();
      setInView(false);
    };
  }, []);

  // Follow the workbench's selection so the teleprompter highlights and
  // scrolls to the matching beat. Listens only - never posts a `select`
  // message itself, or a run-channel echo could be misread as a selection.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return undefined;
    const channel = new BroadcastChannel("demo-script");
    const onMsg = (e) => {
      if (e.data?.type !== "select" || !e.data.ucId) return;
      setActiveUcId(e.data.ucId);
    };
    channel.addEventListener("message", onMsg);
    return () => {
      channel.removeEventListener("message", onMsg);
      channel.close();
    };
  }, []);

  // Scroll the active beat into view only on an actual selection change - not
  // on every re-render (an unrelated A-/A+ font-size click re-renders this
  // component too, and re-running scrollIntoView unconditionally would yank a
  // presenter's manual scroll back to the active beat mid-preview). `open` is
  // in the dependency list too: DraggableModal unmounts the beats while the
  // panel is closed, so a selection that arrives while closed must still
  // scroll once the panel reopens, even though activeUcId itself didn't
  // change again. Query within this component's own body rather than the
  // global document so it still resolves correctly when DraggableModal has
  // portaled these beats into a popped-out second-screen window's own
  // document.
  useEffect(() => {
    if (!open || !activeUcId || activeUcId === lastScrolledUcIdRef.current) return;
    bodyRef.current
      ?.querySelector(".dsl-beat--active")
      ?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    lastScrolledUcIdRef.current = activeUcId;
  }, [activeUcId, open]);

  // Trigger a use case on the workbench from the script. Uses the shared
  // BroadcastChannel: the launcher's channel reaches the workbench's channel
  // whether the click came from the in-page modal or the popped-out 2nd-screen
  // window, exactly once (a channel never delivers to the object that posted, so
  // there is no echo/double-run). Requires BroadcastChannel (all modern
  // browsers); if absent, Run is a no-op.
  const runUseCase = (ucId) => {
    runChannel?.postMessage({ type: "run", ucId });
  };

  // Navigate the main window (kill-switch closer -> /ai-control-plane). navigate
  // is bound to the main-window router, so it works even when the click fires in
  // the popped-out window. Does NOT execute the revocation — the presenter does
  // the deliberate STOP there.
  const goTo = (path) => {
    navigate(path);
  };

  const changeFont = (delta) => {
    setFontPx((px) => {
      const next = Math.min(FONT_MAX, Math.max(FONT_MIN, px + delta));
      try {
        window.localStorage.setItem(FONT_KEY, String(next));
      } catch {
        /* ignore storage errors */
      }
      return next;
    });
  };

  const beat = (b, key) => (
    <div
      className={`dsl-beat${b.ucId && b.ucId === activeUcId ? " dsl-beat--active" : ""}`}
      key={key}
    >
      {b.ucId && (
        <button
          type="button"
          className="dsl-run"
          onClick={() => runUseCase(b.ucId)}
          title={`Run ${b.ucId} on the workbench`}
        >
          Run
        </button>
      )}
      <div className="dsl-do">
        <span className="dsl-tag">Do</span> {b.action}
      </div>
      <div className="dsl-see">
        <span className="dsl-tag">See</span> {b.expected}
      </div>
      <div className="dsl-say-row">
        <span className="dsl-tag">Say</span>
        <span className="dsl-say">{b.say}</span>
      </div>
    </div>
  );

  const footer = (
    <div className="dsl-footer">
      <div className="dsl-size">
        <span className="dsl-size-label">Text size</span>
        <button
          type="button"
          className="dsl-size-btn"
          onClick={() => changeFont(-FONT_STEP)}
          disabled={fontPx <= FONT_MIN}
          aria-label="Smaller text"
        >
          A-
        </button>
        <span className="dsl-size-val">{fontPx}px</span>
        <button
          type="button"
          className="dsl-size-btn"
          onClick={() => changeFont(FONT_STEP)}
          disabled={fontPx >= FONT_MAX}
          aria-label="Larger text"
        >
          A+
        </button>
      </div>
      <button
        type="button"
        className="dsl-close-btn"
        onClick={() => setOpen(false)}
      >
        Close
      </button>
    </div>
  );

  return (
    <>
      {/* Floating launcher only on the unauthenticated landing; logged-in
          users open it from the "Demo Script" sidebar item instead. */}
      {!user && (
        <button
          type="button"
          className="demo-script-launch"
          onClick={() => setOpen((o) => !o)}
          title="Toggle the live demo script (teleprompter) - pop out to a second screen"
        >
          Demo Script
        </button>
      )}

      <DraggableModal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="15-Min Security Demo Script"
        defaultWidth={560}
        defaultHeight={640}
        storageKey="demo-script-teleprompter"
        minWidth={360}
        minHeight={320}
        closeOnPopout
        noBackdrop
        footer={footer}
      >
        <div
          className="dm-scroll dsl-body"
          style={{ fontSize: `${fontPx}px` }}
          ref={bodyRef}
        >
          <p className="dsl-lead">
            {s.audience} · {s.surface}
          </p>

          <h4>Preflight</h4>
          <ul className="dsl-list">
            {s.preflight.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>

          <h4>Intro</h4>
          <p className="dsl-say">{s.intro}</p>

          {s.acts.map((act) => (
            <div key={act.title}>
              <h4>
                {act.title} <span className="dsl-meta">{act.meta}</span>
              </h4>
              {act.beats.map((b) => beat(b, b.action))}
            </div>
          ))}

          <h4>{s.closer.title}</h4>
          <p className="dsl-warn">{s.closer.warn}</p>
          <ol className="dsl-list">
            {s.closer.steps.map((st) => (
              <li key={st}>{st}</li>
            ))}
          </ol>
          <div className="dsl-beat">
            <div className="dsl-see">
              <span className="dsl-tag">See</span> {s.closer.expected}
            </div>
            <div className="dsl-say-row">
              <span className="dsl-tag">Say</span>
              <span className="dsl-say">{s.closer.say}</span>
            </div>
          </div>
          {s.closer.navPath && (
            <button
              type="button"
              className="dsl-nav-btn"
              onClick={() => goTo(s.closer.navPath)}
            >
              {s.closer.navLabel || "Go"} →
            </button>
          )}

          <h4>Fallback ladder</h4>
          <ol className="dsl-list">
            {s.fallback.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ol>
        </div>
      </DraggableModal>
    </>
  );
}
