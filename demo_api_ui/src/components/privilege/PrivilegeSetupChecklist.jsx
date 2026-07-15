// demo_api_ui/src/components/privilege/PrivilegeSetupChecklist.jsx
import { useCallback, useEffect, useState } from 'react';
import {
  PRIVILEGE_DEMO,
  PRIVILEGE_SETUP_STORAGE_KEY,
  setupStepConsoleUrl,
} from '../../config/privilegeDemoConfig';

/** Load completed setup step ids from localStorage. */
function readCompletedSteps() {
  try {
    const raw = localStorage.getItem(PRIVILEGE_SETUP_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

/** Persist completed setup step ids to localStorage. */
function writeCompletedSteps(completed) {
  try {
    localStorage.setItem(PRIVILEGE_SETUP_STORAGE_KEY, JSON.stringify([...completed]));
  } catch {
    /* ignore quota errors */
  }
}

/**
 * SE setup checklist for Privilege shared demo VMs and agent onboarding.
 */
export default function PrivilegeSetupChecklist() {
  const [completed, setCompleted] = useState(() => readCompletedSteps());

  useEffect(() => {
    writeCompletedSteps(completed);
  }, [completed]);

  const handleToggle = useCallback((stepId) => {
    setCompleted((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  }, []);

  const handleReset = useCallback(() => {
    setCompleted(new Set());
  }, []);

  const doneCount = PRIVILEGE_DEMO.setupSteps.filter((s) => completed.has(s.id)).length;
  const total = PRIVILEGE_DEMO.setupSteps.length;

  return (
    <div className="pd-setup">
      <section className="pd-setup__overview" aria-label="SE1 overview">
        <p>{PRIVILEGE_DEMO.overview}</p>
        <p className="pd-setup__groups">
          Groups: {PRIVILEGE_DEMO.groups.join(', ')} (static membership)
        </p>
        <a
          className="pd-setup__guide-link"
          href={PRIVILEGE_DEMO.se1GuideUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Full SE1 setup guide
        </a>
        <div className="pd-setup__tools">
          <h3>Workstation tools</h3>
          <ul>
            {PRIVILEGE_DEMO.workstationTools.map((tool) => (
              <li key={tool}>{tool}</li>
            ))}
          </ul>
        </div>
      </section>

      <div className="pd-setup__progress">
        <span>{doneCount} of {total} steps complete</span>
        <button type="button" className="pd-setup__reset" onClick={handleReset}>
          Reset checklist
        </button>
      </div>

      <ol className="pd-setup__list">
        {PRIVILEGE_DEMO.setupSteps.map((step, index) => {
          const isDone = completed.has(step.id);
          const consoleUrl = setupStepConsoleUrl(step.linkEnv);
          return (
            <li key={step.id} className={`pd-setup__item${isDone ? ' pd-setup__item--done' : ''}`}>
              <label className="pd-setup__label">
                <input
                  type="checkbox"
                  checked={isDone}
                  onChange={() => handleToggle(step.id)}
                />
                <span className="pd-setup__title">
                  {index + 1}. {step.title}
                </span>
              </label>
              <p className="pd-setup__desc">{step.description}</p>
              {step.persona && (
                <span className="pd-setup__persona">
                  Persona: {step.persona === 'both' ? 'Admin + EndUser VMs' : step.persona}
                </span>
              )}
              {consoleUrl && (
                <a
                  className="pd-setup__link"
                  href={consoleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open PingOne console
                </a>
              )}
            </li>
          );
        })}
      </ol>

      <div className="pd-warnings">
        <h3>Before you demo</h3>
        <ul>
          {PRIVILEGE_DEMO.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
