// banking_api_ui/src/context/EducationUIContext.js
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

const EducationUIContext = createContext(null);

/**
 * Controls which education panel is visible (only one at a time) and optional initial tab id.
 */
export function EducationUIProvider({ children }) {
  const [panel, setPanel] = useState(null);
  const [tab, setTab] = useState(null);

  const open = useCallback((panelId, initialTab = null) => {
    setPanel(panelId);
    setTab(initialTab);
  }, []);

  const close = useCallback(() => {
    setPanel(null);
    setTab(null);
  }, []);

  const value = useMemo(
    () => ({ panel, tab, open, close }),
    [panel, tab, open, close]
  );

  return (
    <EducationUIContext.Provider value={value}>
      {children}
    </EducationUIContext.Provider>
  );
}

export function useEducationUI() {
  const ctx = useContext(EducationUIContext);
  if (!ctx) {
    throw new Error('useEducationUI must be used within EducationUIProvider');
  }
  return ctx;
}

/** Safe hook for optional context (e.g. tests) */
export function useEducationUIOptional() {
  return useContext(EducationUIContext);
}
