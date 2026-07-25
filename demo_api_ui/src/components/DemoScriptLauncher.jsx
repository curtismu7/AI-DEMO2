import { useEffect, useState } from "react";
import DraggableModal from "./DraggableModal";
import { DEMO_SCRIPT } from "./demoScript";
import "./DemoScriptLauncher.css";

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
  const s = DEMO_SCRIPT;

  // The sidebar "Demo Script" nav item (AdminSideNav) toggles the modal via a
  // window CustomEvent, since this launcher owns the modal state globally.
  useEffect(() => {
    const toggle = () => setOpen((o) => !o);
    window.addEventListener("demo-script-toggle", toggle);
    return () => window.removeEventListener("demo-script-toggle", toggle);
  }, []);

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
    <div className="dsl-beat" key={key}>
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
        footer={footer}
      >
        <div className="dm-scroll dsl-body" style={{ fontSize: `${fontPx}px` }}>
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
