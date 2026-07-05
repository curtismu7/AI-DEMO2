import React from 'react';
import './ReasoningPanel.css';

/**
 * ReasoningPanel — live agent reasoning visibility.
 *
 * Reads the `reasoningState` slice that STATE_DELTA (/reasoningState/*) drives:
 *   { phase, toolOptions: [{ toolName, description, confidence }], contextTokens: { inputTokens, outputTokens, estimatedTotal, pctWindow } }
 *
 * Renders nothing until the agent reports a phase, so it stays out of the way
 * on a fresh thread. Phase 1: Anthropic-only (other providers report no phase).
 */

const PHASE_LABEL = {
  planning: 'Planning',
  tool_selection: 'Selecting tools',
  tool_execution: 'Running tools',
  synthesis: 'Writing answer',
};

export default function ReasoningPanel({ reasoningState }) {
  if (!reasoningState || !reasoningState.phase) return null;

  const { phase, toolOptions, contextTokens } = reasoningState;
  const pct = contextTokens && typeof contextTokens.pctWindow === 'number' ? contextTokens.pctWindow : null;

  return (
    <div className="reasoning-panel" role="status" aria-live="polite">
      <div className="reasoning-panel-header">
        <span className={`reasoning-phase reasoning-phase--${phase}`}>
          {PHASE_LABEL[phase] || phase}
        </span>
        {contextTokens && typeof contextTokens.estimatedTotal === 'number' && (
          <span className="reasoning-tokens" title="Tokens used this step">
            {contextTokens.estimatedTotal.toLocaleString()} tokens
          </span>
        )}
      </div>

      {Array.isArray(toolOptions) && toolOptions.length > 0 && (
        <ul className="reasoning-tools">
          {toolOptions.map((t, i) => (
            <li className="reasoning-tool" key={`${t.toolName}-${i}`}>
              <span className="reasoning-tool-name">{t.toolName}</span>
              {typeof t.confidence === 'number' && (
                <span className="reasoning-tool-confidence">
                  {Math.round(t.confidence * 100)}%
                </span>
              )}
              {t.description && (
                <span className="reasoning-tool-desc">{t.description}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {pct !== null && (
        <div className="reasoning-context-gauge" title={`${pct}% of context window`}>
          <div className="reasoning-context-track">
            <div
              className="reasoning-context-fill"
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          <span className="reasoning-context-label">{pct}% context</span>
        </div>
      )}
    </div>
  );
}
