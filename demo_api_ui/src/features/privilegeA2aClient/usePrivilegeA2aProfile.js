import { useEffect, useState } from 'react';
import { useVertical } from '../../vertical/useVertical';
import { loadPrivilegeA2aProfile } from '../../utils/privilegeA2aProfile';

/** The active vertical's A2A profile, or null (not loaded yet, no specialist, or a failed call). Refetches when the vertical changes. */
export function usePrivilegeA2aProfile() {
  const { activeId } = useVertical();
  const [state, setState] = useState({ id: undefined, profile: null });
  useEffect(() => {
    let live = true;
    loadPrivilegeA2aProfile().then((profile) => { if (live) setState({ id: activeId, profile }); });
    return () => { live = false; };
  }, [activeId]);
  // A profile fetched for another vertical is never shown for this one.
  return state.id === activeId ? state.profile : null;
}
