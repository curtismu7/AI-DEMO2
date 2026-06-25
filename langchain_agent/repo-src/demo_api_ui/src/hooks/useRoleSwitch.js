import { useState } from 'react';
import { startRoleSwitch } from '../utils/roleSwitch';

/**
 * Initiate a real role switch (sign out + re-login as `targetRole`) via the BFF,
 * with a guard against double-invoke and a `switching` flag for button state.
 * Shared by the header switch button and the admin-token block/notice surfaces.
 */
export function useRoleSwitch() {
  const [switching, setSwitching] = useState(false);
  const switchRole = async (targetRole) => {
    if (switching) return;
    setSwitching(true);
    try {
      await startRoleSwitch(targetRole);
    } catch (e) {
      console.error('[useRoleSwitch] Role switch failed:', e?.message || e);
      setSwitching(false);
    }
  };
  return { switching, switchRole };
}
