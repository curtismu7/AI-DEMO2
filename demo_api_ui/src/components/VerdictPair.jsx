import './VerdictPair.css';

/** Chip tone per outcome label. Unknown labels render neutral. */
function toneOf(label) {
  const t = String(label || '').toUpperCase();
  if (t === 'PERMIT') return 'permit';
  if (t === 'DENY') return 'deny';
  if (t === 'HITL' || t === 'HITL_REQUIRED' || t === 'MFA' || t === 'STEP_UP') return 'hitl';
  if (t === 'UNPROVEN') return 'unproven';
  return 'none';
}

/**
 * Expected vs observed outcome for the selected use case.
 *
 * `actual` is the decision observed on the token chain; `state` is the verdict
 * computed by ProofOfEnforcementContext. The match judgement comes from `state`
 * alone — this component never compares `expected` to `actual` itself, because
 * the real comparison rules (deny-like families, block kinds) live in
 * computeVerdict and are tested there.
 *
 * @param {{
 *   expected: string,
 *   actual: string|null,
 *   state: 'verified'|'denied-as-expected'|'mismatch'|'incomplete'|null,
 *   running: boolean,
 * }} props
 */
export default function VerdictPair({ expected, actual, state, running }) {
  const incomplete = state === 'incomplete';
  const actualLabel = running ? 'Running…' : incomplete ? 'Unproven' : actual || '—';
  const matched = state === 'verified' || state === 'denied-as-expected';
  const showMatch = !running && Boolean(state);

  return (
    <div className="verdict">
      <span className="verdict__side">
        <span className="verdict__k">Expected</span>
        <span className={`verdict__chip verdict__chip--${toneOf(expected)}`} data-testid="verdict-expected">
          {expected || '—'}
        </span>
      </span>
      <span className="verdict__side">
        <span className="verdict__k">Actual</span>
        <span
          className={`verdict__chip verdict__chip--${running ? 'running' : incomplete ? 'unproven' : toneOf(actual)}`}
          data-testid="verdict-actual"
        >
          {actualLabel}
        </span>
      </span>
      {showMatch && (
        <span
          className={`verdict__match verdict__match--${matched ? 'ok' : 'bad'}`}
          data-testid="verdict-match"
        >
          {matched ? '✅ matched' : '⚠️ not proven'}
        </span>
      )}
    </div>
  );
}
