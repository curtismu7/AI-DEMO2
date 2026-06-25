// demo_api_ui/src/components/ArchitectureSimStepDesc.jsx
import { memo } from 'react';

function ArchitectureSimStepDesc({ stepIndex, totalSteps, desc, why, isBlock, isComplete, mode, allSteps }) {
  const hasWhy = Boolean(why);

  if (mode === 'live' && stepIndex === 0) {
    return (
      <div style={barStyle('live', false)}>
        <span style={tagStyle('#64748b')}>LIVE</span>
        Waiting for real system events… trigger a login or MCP tool call in another tab.
      </div>
    );
  }

  if (stepIndex === 0) {
    return (
      <div style={barStyle('ready', false)}>
        <span style={tagStyle('#64748b')}>READY</span>
        Select a scenario and press Play — or use Step to advance manually.
      </div>
    );
  }

  if (isComplete) {
    const headerVariant = isBlock ? 'blocked' : 'done';
    const headerColor   = isBlock ? '#dc2626' : '#166534';
    const headerTag     = isBlock ? 'BLOCKED' : 'DONE';
    const headerMsg     = isBlock
      ? 'Attack neutralised by security controls.'
      : 'Scenario complete.';

    return (
      <div>
        {/* Completion header */}
        <div style={barStyle(headerVariant, false)}>
          <span style={tagStyle(headerColor)}>{headerTag}</span>
          {headerMsg} Press Reset to replay.
        </div>

        {/* Step-by-step recap */}
        {allSteps && allSteps.length > 0 && (
          <div style={summaryContainerStyle}>
            <div style={summaryHeaderStyle}>
              <span style={tagStyle('#64748b')}>RECAP</span>
              {allSteps.length} steps — what happened and why
            </div>
            <div style={{ overflowY: 'auto', maxHeight: 460 }}>
              {allSteps.map((step, i) => {
                const stepIsBlock = Boolean(step.isBlock);
                const accentColor = stepIsBlock ? '#ef4444' : '#3b82f6';
                return (
                  <div key={step.desc} style={summaryStepStyle(stepIsBlock, i === allSteps.length - 1)}>
                    <div style={summaryStepRowStyle}>
                      <span style={stepBadgeStyle(accentColor)}>{i + 1}</span>
                      <span style={summaryDescStyle(stepIsBlock)}>{step.desc}</span>
                    </div>
                    {step.why && (
                      <div style={summaryWhyRowStyle}>
                        <span style={{ ...tagStyle(accentColor), fontSize: '0.65rem' }}>WHY</span>
                        <span style={summaryWhyTextStyle}>{step.why}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  const variant = isBlock ? 'blocked' : 'step';

  return (
    <div>
      <div style={barStyle(variant, hasWhy)}>
        <span style={tagStyle(isBlock ? '#dc2626' : '#1d4ed8')}>
          {isBlock ? 'BLOCKED' : `STEP ${stepIndex}/${totalSteps}`}
        </span>
        <span style={{ fontWeight: 600 }}>{desc}</span>
      </div>
      {hasWhy && (
        <div style={whyPanelStyle(isBlock)}>
          <span style={tagStyle(isBlock ? '#dc2626' : '#1d4ed8')}>WHY</span>
          <span>{why}</span>
        </div>
      )}
    </div>
  );
}

// ── Style helpers ─────────────────────────────────────────────────────────────

function tagStyle(color) {
  return {
    color,
    fontWeight: 700,
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  };
}

function barStyle(variant, hasWhy) {
  const map = {
    done:    { bg: '#f0fdf4', border: '#bbf7d0', color: '#166534' },
    blocked: { bg: '#fef2f2', border: '#fecaca', color: '#991b1b' },
    step:    { bg: '#eff6ff', border: '#bfdbfe', color: '#1e40af' },
    live:    { bg: '#f8fafc', border: '#e2e8f0', color: '#475569' },
    ready:   { bg: '#f8fafc', border: '#e2e8f0', color: '#475569' },
  };
  const v = map[variant] || map.step;
  return {
    background: v.bg,
    border: `1px solid ${v.border}`,
    borderTop: 'none',
    borderBottom: hasWhy ? 'none' : undefined,
    borderRadius: hasWhy ? 0 : '0 0 6px 6px',
    padding: '0.45rem 0.8rem',
    fontSize: '1rem',
    color: v.color,
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    minHeight: '2.2rem',
  };
}

function whyPanelStyle(isBlockStep) {
  return {
    background: isBlockStep ? '#fef2f2' : '#dbeafe',
    border: `1px solid ${isBlockStep ? '#fecaca' : '#bfdbfe'}`,
    borderTop: `1px solid ${isBlockStep ? '#fca5a5' : '#93c5fd'}`,
    borderRadius: '0 0 6px 6px',
    padding: '0.5rem 0.8rem',
    fontSize: '1rem',
    color: isBlockStep ? '#7f1d1d' : '#1e3a8a',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.5rem',
    lineHeight: 1.6,
  };
}

const summaryContainerStyle = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderTop: 'none',
  borderRadius: '0 0 6px 6px',
};

const summaryHeaderStyle = {
  padding: '0.4rem 0.8rem',
  fontSize: '0.75rem',
  color: '#64748b',
  borderBottom: '1px solid #f1f5f9',
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  background: '#f8fafc',
};

function summaryStepStyle(isBlockStep, isLast) {
  return {
    padding: '0.55rem 0.8rem 0.55rem 0.65rem',
    borderLeft: `3px solid ${isBlockStep ? '#fca5a5' : '#e2e8f0'}`,
    borderBottom: isLast ? 'none' : '1px solid #f8fafc',
    background: isBlockStep ? '#fff8f8' : '#ffffff',
    marginLeft: '0.5rem',
  };
}

const summaryStepRowStyle = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '0.5rem',
};

function stepBadgeStyle(color) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 20,
    height: 20,
    borderRadius: '50%',
    background: color,
    color: '#ffffff',
    fontSize: '0.65rem',
    fontWeight: 700,
    flexShrink: 0,
    marginTop: 1,
  };
}

function summaryDescStyle(isBlockStep) {
  return {
    fontSize: '0.875rem',
    fontWeight: 600,
    color: isBlockStep ? '#991b1b' : '#0f172a',
    lineHeight: 1.4,
  };
}

const summaryWhyRowStyle = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '0.4rem',
  marginTop: '0.3rem',
  paddingLeft: '1.6rem',
};

const summaryWhyTextStyle = {
  fontSize: '0.8rem',
  color: '#475569',
  lineHeight: 1.55,
};

export default memo(ArchitectureSimStepDesc);
