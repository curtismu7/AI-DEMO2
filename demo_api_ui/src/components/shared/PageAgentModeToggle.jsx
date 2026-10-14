import { useCallback, useState } from 'react';
import './PageAgentModeToggle.css';

const MODES = [
  { id: 'heuristics', label: 'Heuristics', hint: 'Deterministic routing, no model call: fastest' },
  { id: 'llm', label: 'llama.cpp', hint: 'The real model decides' },
];

/** A page's own Heuristics | llama.cpp choice, kept per page in localStorage; it never touches the global agent mode. */
export function usePageAgentMode(pageKey, defaultMode = 'llm') {
  const storageKey = `agentMode:${pageKey}`;
  const [mode, setModeState] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved === 'heuristics' || saved === 'llm' ? saved : defaultMode;
    } catch { return defaultMode; }
  });
  const setMode = useCallback((next) => {
    setModeState(next);
    try { localStorage.setItem(storageKey, next); } catch { /* storage blocked: the choice lasts for this visit */ }
  }, [storageKey]);
  return [mode, setMode];
}

export default function PageAgentModeToggle({ mode, onChange, disabled = false }) {
  return (
    <div className="page-agent-mode" role="radiogroup" aria-label="Agent mode for this page">
      {MODES.map(({ id, label, hint }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={mode === id}
          title={hint}
          disabled={disabled}
          className={`page-agent-mode__opt${mode === id ? ' page-agent-mode__opt--on' : ''}`}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
