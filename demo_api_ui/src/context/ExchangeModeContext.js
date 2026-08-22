import React, { createContext, useContext, useState, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';

/**
 * ExchangeModeContext — Manages RFC 8693 token exchange mode state
 *
 * Provides global state for whether to use 1-exchange (subject-only) or
 * 2-exchange (subject + agent actor) mode. Shares mode across all components
 * without prop drilling.
 *
 * Usage:
 *   <ExchangeModeProvider>
 *     <YourApp />
 *   </ExchangeModeProvider>
 *
 *   In any component:
 *   const { mode, setMode, loading, error } = useExchangeMode();
 */

const ExchangeModeContext = createContext(null);

export function useExchangeMode() {
  const ctx = useContext(ExchangeModeContext);
  if (!ctx) {
    throw new Error('useExchangeMode must be used within ExchangeModeProvider');
  }
  return ctx;
}

export function ExchangeModeProvider({ children }) {
  const [mode, setModeState] = useState('single'); // 'single' or 'double'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Sequence number of the most recently STARTED request. Only that request may
  // commit state — otherwise a slower earlier POST resolving last overwrites the
  // newer one's confirmed mode (rapid single→double→single toggling).
  const requestSeqRef = useRef(0);

  // Don't fetch initial mode - always default to 'single' to prevent 401 errors
  // Mode is only fetched when user explicitly changes it

  /**
   * Update exchange mode (calls API to persist)
   */
  const setMode = useCallback(async (newMode) => {
    if (!['single', 'double'].includes(newMode)) {
      console.error(`ExchangeModeContext: Invalid mode "${newMode}"`);
      return;
    }

    // Capture previous mode before the optimistic update so rapid calls
    // each revert to their own baseline, not the stale closure value.
    const previousMode = mode;
    const seq = ++requestSeqRef.current;
    setModeState(newMode);
    setLoading(true);

    try {
      const response = await axios.post('/api/mcp/exchange-mode', { mode: newMode });
      // A newer setMode already started — its optimistic state is what the user
      // last asked for, so this stale success must not repaint it.
      if (seq !== requestSeqRef.current) return;
      const confirmedMode = response.data.mode === 'double' ? 'double' : 'single';
      setModeState(confirmedMode);
      setError(null);
    } catch (err) {
      console.warn('Failed to update exchange mode:', err.message);
      if (seq !== requestSeqRef.current) return;
      setError(err.message);
      // Revert to the mode that was active when this call started, not the
      // potentially-stale closure value from a later render.
      setModeState(previousMode);
    } finally {
      // Only the newest request owns the spinner; an older one finishing must
      // not clear it while the current request is still in flight.
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, [mode]);

  // Memoised to avoid cascading re-renders on every unrelated render of the provider.
  const value = useMemo(() => ({
    mode,
    setMode,
    loading,
    error,
  }), [mode, setMode, loading, error]);

  return (
    <ExchangeModeContext.Provider value={value}>
      {children}
    </ExchangeModeContext.Provider>
  );
}

// Export context for advanced use cases (ref, etc.)
export { ExchangeModeContext };
