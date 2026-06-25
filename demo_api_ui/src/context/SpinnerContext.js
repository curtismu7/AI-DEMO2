// banking_api_ui/src/context/SpinnerContext.js
import React, { createContext, useContext, useEffect, useState } from 'react';
import { spinner } from '../services/spinnerService';

/**
 * SpinnerContext — thin React wrapper over the imperative spinnerService singleton.
 * SpinnerHost reads this; components can also call useSpinner() for React idioms.
 */
const SpinnerContext = createContext({ visible: false });

/**
 * Wrap the app tree with SpinnerProvider so SpinnerHost can read state.
 * @param {{ children: React.ReactNode }} props
 */
export function SpinnerProvider({ children }) {
  const [state, setState] = useState(() => spinner.getState());

  useEffect(() => spinner.subscribe(setState), []);

  return (
    <SpinnerContext.Provider value={state}>
      {children}
    </SpinnerContext.Provider>
  );
}

/** Hook for components that want React-idiomatic access to spinner state. */
export function useSpinner() {
  return useContext(SpinnerContext);
}

export default SpinnerContext;
