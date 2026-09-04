import { useState } from 'react';
import { enableUseCaseFlags } from '../services/demoFlagsClient';
import './FlagGate.css';

/**
 * Inline banner shown on a use-case card when one or more of its required
 * flags are off. Guest-safe: Enable calls the unauthenticated
 * POST /api/demo-flags/enable, which resolves and enables exactly this use
 * case's required flags server-side — no session, no admin check.
 */
export default function FlagGate({ useCaseId, flagIds, flagMap, loading, onEnabled }) {
  const [enabling, setEnabling] = useState(false);
  const [error, setError] = useState(null);

  const missing = (flagIds || []).filter((id) => flagMap == null || flagMap[id] !== 'true');
  if (loading || missing.length === 0) return null;

  async function handleEnable() {
    setEnabling(true);
    setError(null);
    try {
      const result = await enableUseCaseFlags(useCaseId);
      onEnabled(result.flags || flagIds);
    } catch (e) {
      setError('Could not enable — try again');
    } finally {
      setEnabling(false);
    }
  }

  return (
    <div className="flag-gate" role="status">
      <span className="flag-gate__icon" aria-hidden="true">⚠️</span>
      <div className="flag-gate__body">
        <div className="flag-gate__title">
          {missing.length > 1 ? `${missing.length} feature flags are off` : '1 feature flag is off'}
        </div>
        <div className="flag-gate__chips">
          {missing.map((id) => (
            <span key={id} className="flag-gate__chip">{id}</span>
          ))}
        </div>
        {error && <p className="flag-gate__error">{error}</p>}
      </div>
      <button
        type="button"
        className="flag-gate__enable"
        disabled={enabling}
        onClick={handleEnable}
      >
        {enabling ? 'Enabling…' : '🔑 Enable'}
      </button>
    </div>
  );
}
