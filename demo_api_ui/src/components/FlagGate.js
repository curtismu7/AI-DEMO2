import { useState } from 'react';
import { enableUseCaseFlags, disableUseCaseFlags } from '../services/demoFlagsClient';
import './FlagGate.css';

/**
 * Inline control on a use-case card for its required flag(s). Guest-safe
 * both ways: Enable/Disable call the unauthenticated
 * POST /api/demo-flags/{enable,disable}, which resolve and flip exactly
 * this use case's required flags server-side — no session, no admin check.
 * Renders a warning banner while any required flag is off, or a compact
 * "on" control (with a Disable button) once they're all on.
 */
export default function FlagGate({ useCaseId, flagIds, flagMap, loading, onEnabled, onDisabled }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (loading || (flagIds || []).length === 0) return null;

  const missing = flagIds.filter((id) => flagMap == null || flagMap[id] !== 'true');
  const allOn = missing.length === 0;

  async function handleEnable() {
    setBusy(true);
    setError(null);
    try {
      const result = await enableUseCaseFlags(useCaseId);
      onEnabled(result.flags || flagIds);
    } catch (e) {
      setError('Could not enable — try again');
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setBusy(true);
    setError(null);
    try {
      const result = await disableUseCaseFlags(useCaseId);
      onDisabled(result.flags || flagIds);
    } catch (e) {
      setError('Could not disable — try again');
    } finally {
      setBusy(false);
    }
  }

  if (allOn) {
    return (
      <div className="flag-gate flag-gate--on" role="status">
        <span className="flag-gate__icon" aria-hidden="true">✅</span>
        <div className="flag-gate__body">
          <div className="flag-gate__title flag-gate__title--on">Flags on</div>
          {error && <p className="flag-gate__error">{error}</p>}
        </div>
        <button
          type="button"
          className="flag-gate__disable"
          disabled={busy}
          onClick={handleDisable}
        >
          {busy ? 'Disabling…' : 'Disable'}
        </button>
      </div>
    );
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
        disabled={busy}
        onClick={handleEnable}
      >
        {busy ? 'Enabling…' : '🔑 Enable'}
      </button>
    </div>
  );
}
