// demo_api_ui/src/components/ArchitectureSimControls.jsx
import { memo } from 'react';
import { DiagramControls } from './diagram';

/**
 * Toolbar for the architecture simulation page.
 * Uses DiagramControls with mode tabs + scenario dropdown in the `extra` prop.
 * No zoom block — the SVG scales with the container.
 */
function ArchitectureSimControls({
  mode, scenarioId, scenarios, playing, stepMs, stepTimeOptions, stepIndex, totalSteps,
  onPlay, onPause, onStep, onReset, onSetMode, onSetScenario, onSetStepMs,
}) {
  const MODES = [
    { id: 'scenario',  label: 'Scenario' },
    { id: 'step',      label: 'Step-through' },
    { id: 'live',      label: 'Live trace' },
  ];

  const showScenarioDropdown = mode === 'scenario';
  const atEnd = stepIndex >= totalSteps && totalSteps > 0;

  const extra = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
      {/* Mode tabs */}
      <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569' }}>Mode:</span>
      <div style={{ display: 'flex', gap: '2px' }}>
        {MODES.map(m => (
          <button
            key={m.id}
            type="button"
            onClick={() => onSetMode(m.id)}
            style={{
              fontSize: '0.72rem',
              padding: '0.2rem 0.55rem',
              border: '1px solid',
              borderRadius: '3px',
              cursor: 'pointer',
              background: mode === m.id ? '#1d4ed8' : '#f1f5f9',
              borderColor: mode === m.id ? '#1d4ed8' : '#cbd5e1',
              color: mode === m.id ? '#fff' : '#475569',
              fontWeight: mode === m.id ? 700 : 400,
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Scenario dropdown — only in scenario mode */}
      {showScenarioDropdown && (
        <>
          <div style={{ width: '1px', height: '18px', background: '#e2e8f0' }} />
          <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569' }}>Scenario:</span>
          <select
            value={scenarioId}
            onChange={e => onSetScenario(e.target.value)}
            style={{
              fontSize: '0.78rem',
              border: '1px solid #cbd5e1',
              borderRadius: '4px',
              padding: '0.22rem 0.5rem',
              background: '#f8fafc',
              color: '#0f172a',
            }}
          >
            {(() => {
              const groups = {};
              scenarios.forEach(s => {
                const g = s.group || 'Other';
                if (!groups[g]) groups[g] = [];
                groups[g].push(s);
              });
              return Object.entries(groups).map(([groupName, groupScenarios]) => (
                <optgroup key={groupName} label={groupName}>
                  {groupScenarios.map(s => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </optgroup>
              ));
            })()}
          </select>
        </>
      )}

      {/* Playback controls */}
      <div style={{ width: '1px', height: '18px', background: '#e2e8f0' }} />
      <button
        type="button"
        onClick={playing ? onPause : onPlay}
        style={ctrlBtn(playing ? '#f59e0b' : '#004687')}
        disabled={mode === 'live' && atEnd}
      >
        {playing ? 'Pause' : '▶ Play'}
      </button>
      {mode !== 'live' && (
        <button type="button" onClick={onStep} style={ctrlBtn('#004687')} disabled={playing || atEnd}>
          Step
        </button>
      )}
      <button type="button" onClick={onReset} style={ctrlBtn(null)}>
        ↺ Reset
      </button>

      {/* Step-time selector — not shown in live mode */}
      {mode !== 'live' && (
        <>
          <div style={{ width: '1px', height: '18px', background: '#e2e8f0' }} />
          <label className="dc-steptime" title="Time each step takes during playback">
            <span className="dc-steptime-label">Step time:</span>
            <select
              className="dc-steptime-select"
              value={stepMs}
              onChange={e => onSetStepMs(Number(e.target.value))}
            >
              {stepTimeOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        </>
      )}

      {/* Step counter */}
      {totalSteps > 0 && (
        <span style={{ fontSize: '0.72rem', color: '#475569', marginLeft: '0.25rem' }}>
          {stepIndex}/{totalSteps}
        </span>
      )}
    </div>
  );

  // DiagramControls with no zoom props — only the extra content rendered
  return <DiagramControls extra={extra} />;
}

function ctrlBtn(bgColor) {
  return {
    fontSize: '0.78rem',
    fontWeight: 600,
    padding: '0.25rem 0.7rem',
    border: '1px solid',
    borderRadius: '4px',
    cursor: 'pointer',
    background: bgColor ?? '#ffffff',
    borderColor: bgColor ?? '#cbd5e1',
    color: bgColor ? '#ffffff' : '#0f172a',
  };
}

export default memo(ArchitectureSimControls);
