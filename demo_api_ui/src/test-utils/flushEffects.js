import { act } from '@testing-library/react';

// Resolve once the passive effects of the last render have run. React runs them from a scheduler task
// (setImmediate); RTL's waitFor can resolve a timer turn earlier on a loaded runner, so a test that presses
// something straight after waitFor/findBy may act on a render whose effects are still pending. A setImmediate
// queued now runs after React's, in order, so this is a turn boundary, not a sleep. Not for fake-timer tests.
export const flushEffects = () => act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
