// Interactive explainer for the Privilege AI Gateway's "Block Agreement" setting,
// recreating the console modal (off / unit / inspection) and letting the viewer
// see how the mode merges an ML-sidecar finding with the deterministic detector
// layer. Educational only — it does not read the live gateway config.
import { useState } from 'react';
import DraggableModal from './DraggableModal';
import './BlockAgreementModal.css';

// The three modes, copy verbatim from the console's Block Agreement tooltip.
export const BLOCK_AGREEMENT_MODES = [
  { id: 'off', label: 'Off — ML Blocks Alone', desc: 'ML blocks alone — no deterministic agreement needed.' },
  { id: 'unit', label: 'Unit — Agree on Same Content Unit', desc: 'ML block honored only if a deterministic detector fired on the same content unit.' },
  { id: 'inspection', label: 'Inspection — Agree Anywhere in Request', desc: 'ML block honored if a deterministic detector fired anywhere in the request.' },
];

// Pure merge policy. Deterministic detectors always run independently, so a
// deterministic hit blocks on its own; this only decides whether the ML finding
// is HONORED as a block or downgraded to an alert.
//   mode:          'off' | 'unit' | 'inspection'
//   deterministic: 'same_unit' | 'elsewhere' | 'none'
//   ml:            boolean (did the ML sidecar flag the request)
export function blockAgreementOutcome(mode, deterministic, ml) {
  const detFired = deterministic !== 'none';
  let mlHonored = false;
  if (ml) {
    if (mode === 'off') mlHonored = true;
    else if (mode === 'unit') mlHonored = deterministic === 'same_unit';
    else if (mode === 'inspection') mlHonored = detFired;
  }
  const blocked = mlHonored || detFired;

  let tone;
  let headline;
  let detail;
  if (blocked) {
    tone = 'blocked';
    headline = 'Request blocked';
    if (mlHonored && detFired) {
      detail = 'Both layers flagged it, so it blocks under any mode.';
    } else if (mlHonored) {
      detail = 'The ML sidecar finding is honored as a block under this mode.';
    } else {
      detail = 'A deterministic detector fired — that blocks on its own, regardless of the ML finding or this setting.';
    }
  } else if (ml) {
    tone = 'alert';
    headline = 'Allowed — ML finding logged as an alert';
    detail = mode === 'unit'
      ? 'The ML sidecar flagged it, but no deterministic detector fired on the same content unit, so the finding is not honored as a block.'
      : 'The ML sidecar flagged it, but no deterministic detector fired anywhere in the request, so the finding is not honored as a block.';
  } else {
    tone = 'allow';
    headline = 'Allowed';
    detail = 'Neither the deterministic layer nor the ML sidecar flagged this request.';
  }
  return { mlHonored, blocked, tone, headline, detail };
}

const DET_OPTIONS = [
  { id: 'same_unit', label: 'Same content unit' },
  { id: 'elsewhere', label: 'Elsewhere in request' },
  { id: 'none', label: 'No' },
];

export default function BlockAgreementModal({ isOpen, onClose }) {
  const [mode, setMode] = useState('unit');
  const [deterministic, setDeterministic] = useState('none');
  const [ml, setMl] = useState(true);
  const outcome = blockAgreementOutcome(mode, deterministic, ml);

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="🛡 Block Agreement"
      storageKey="lgw-block-agreement"
      defaultWidth={560}
      defaultHeight={560}
    >
      {/* dm-scroll: dm-body is bare by contract — no padding, no scroll. */}
      <div className="dm-scroll">
        <div className="ba-modal">
        <p className="ba-intro">
          Controls how the ML sidecar verdict is merged with the deterministic detector
          layer. Deterministic detectors always run independently — this setting only
          affects whether the sidecar can block a request on its own.
        </p>

        <fieldset className="ba-modes">
          <legend>Mode</legend>
          {BLOCK_AGREEMENT_MODES.map((m) => (
            <label key={m.id} className={`ba-mode${mode === m.id ? ' is-active' : ''}`}>
              <input
                type="radio"
                name="ba-mode"
                value={m.id}
                checked={mode === m.id}
                onChange={() => setMode(m.id)}
              />
              <span className="ba-mode__label">{m.label}</span>
              <span className="ba-mode__desc">{m.desc}</span>
            </label>
          ))}
        </fieldset>

        <div className="ba-controls">
          <div className="ba-control">
            <span className="ba-control__q">Deterministic detector fired?</span>
            <div className="ba-seg" role="group" aria-label="Deterministic detector fired?">
              {DET_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={deterministic === o.id ? 'is-on' : ''}
                  onClick={() => setDeterministic(o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="ba-control">
            <span className="ba-control__q">ML sidecar flagged?</span>
            <div className="ba-seg" role="group" aria-label="ML sidecar flagged?">
              <button type="button" className={ml ? 'is-on' : ''} onClick={() => setMl(true)}>Yes</button>
              <button type="button" className={!ml ? 'is-on' : ''} onClick={() => setMl(false)}>No</button>
            </div>
          </div>
        </div>

        <div className={`ba-outcome is-${outcome.tone}`}>
          <strong>{outcome.headline}</strong>
          <span>{outcome.detail}</span>
        </div>

        <p className="ba-note">
          In the live test the mode was <code>unit</code>, the ML sidecar flagged a benign
          prompt, and no deterministic detector fired — so the finding was honored only as
          an alert, not a block. Switch the mode to <code>off</code> above to see it block.
        </p>
        </div>
      </div>
    </DraggableModal>
  );
}
