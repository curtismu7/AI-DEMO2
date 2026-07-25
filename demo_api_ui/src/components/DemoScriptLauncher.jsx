import { useState } from "react";
import DraggableModal from "./DraggableModal";
import { DEMO_SCRIPT } from "./demoScript";
import "./DemoScriptLauncher.css";

// Floating presenter teleprompter for the 15-min security demo. Mounted
// unguarded in App.js's global overlay block so it renders for ANY user,
// including unauthenticated (sign-in screen and every route). Static content
// only - no auth/session/provider dependency. The DraggableModal built-in
// pop-out opens the script in a separate window for a second monitor; the
// beats are a passive scroll (no stepper state to lose mid-demo).
export default function DemoScriptLauncher() {
  const [open, setOpen] = useState(false);
  const s = DEMO_SCRIPT;

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

  return (
    <>
      <button
        type="button"
        className="demo-script-launch"
        onClick={() => setOpen(true)}
        title="Open the live demo script (teleprompter) - pop out to a second screen"
      >
        Demo Script
      </button>

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
      >
        <div className="dm-scroll dsl-body">
          <p className="dsl-lead">
            {s.audience} · {s.surface}
          </p>

          <h4>Preflight</h4>
          <ul className="dsl-list">
            {s.preflight.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>

          <h4>Intro</h4>
          <p className="dsl-say">{s.intro}</p>

          {s.acts.map((act, ai) => (
            <div key={ai}>
              <h4>
                {act.title} <span className="dsl-meta">{act.meta}</span>
              </h4>
              {act.beats.map((b, bi) => beat(b, bi))}
            </div>
          ))}

          <h4>{s.closer.title}</h4>
          <p className="dsl-warn">{s.closer.warn}</p>
          <ol className="dsl-list">
            {s.closer.steps.map((st, i) => (
              <li key={i}>{st}</li>
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
            {s.fallback.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ol>
        </div>
      </DraggableModal>
    </>
  );
}
