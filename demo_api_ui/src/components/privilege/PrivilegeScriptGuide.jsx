// demo_api_ui/src/components/privilege/PrivilegeScriptGuide.jsx
import { useCallback, useState } from 'react';
import { PRIVILEGE_DEMO } from '../../config/privilegeDemoConfig';
import PrivilegeActCard from './PrivilegeActCard';

/**
 * Act-by-act presenter script navigator for the Request Access demo flow.
 * @param {{ initialAct?: number }} props
 */
export default function PrivilegeScriptGuide({ initialAct = 1 }) {
  const acts = PRIVILEGE_DEMO.acts;
  const [actIndex, setActIndex] = useState(() => {
    const idx = acts.findIndex((a) => a.actNumber === initialAct);
    return idx >= 0 ? idx : 0;
  });

  const act = acts[actIndex];

  const handlePrev = useCallback(() => {
    setActIndex((i) => Math.max(0, i - 1));
  }, []);

  const handleNext = useCallback(() => {
    setActIndex((i) => Math.min(acts.length - 1, i + 1));
  }, [acts.length]);

  const handleSelectAct = useCallback((index) => {
    setActIndex(index);
  }, []);

  return (
    <div className="pd-script">
      <nav className="pd-script__dots" aria-label="Demo acts">
        {acts.map((a, index) => (
          <button
            key={a.id}
            type="button"
            className={`pd-script__dot${index === actIndex ? ' pd-script__dot--active' : ''}`}
            onClick={() => handleSelectAct(index)}
            aria-label={`Act ${a.actNumber}: ${a.title}`}
            aria-current={index === actIndex ? 'step' : undefined}
          >
            {a.actNumber}
          </button>
        ))}
      </nav>

      <PrivilegeActCard act={act} />

      <div className="pd-script__nav">
        <button type="button" onClick={handlePrev} disabled={actIndex === 0}>
          Previous
        </button>
        <span>Act {act.actNumber} of {acts.length}</span>
        <button type="button" onClick={handleNext} disabled={actIndex === acts.length - 1}>
          Next
        </button>
      </div>
    </div>
  );
}
