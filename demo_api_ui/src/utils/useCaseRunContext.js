import { useEffect, useState } from 'react';

export function runContextFromLocation(location) {
  const state = location?.state;
  if (!state?.triggerText || (!state.runContext && !state.useCaseId)) return null;

  return state.runContext || {
    source: 'use-cases',
    useCaseId: state.useCaseId,
    triggerText: state.triggerText,
  };
}

export function useUseCaseRunContext(location) {
  const [runContext, setRunContext] = useState(null);

  useEffect(() => {
    const nextRunContext = runContextFromLocation(location);
    if (nextRunContext) {
      setRunContext(nextRunContext);
    } else if (location?.pathname === '/dashboard') {
      setRunContext(null);
    }
  }, [location?.pathname, location?.state]);

  return runContext;
}
