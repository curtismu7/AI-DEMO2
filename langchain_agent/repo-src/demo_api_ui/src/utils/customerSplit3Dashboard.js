// banking_api_ui/src/utils/customerSplit3Dashboard.js
import { getDashboardLayout } from './dashboardLayout';

/**
 * True when customer is on home/dashboard with the 3-column layout (inline agent in middle).
 * Used by App.js to avoid duplicate floating FAB / bottom dock.
 * @param {'classic' | 'split3' | undefined} layout — when set, avoids reading localStorage (keeps React deps explicit).
 */
export function isCustomerSplit3Dashboard(pathname, user, layout) {
  if (!user || user.role === 'admin') return false;
  const p = (pathname || '').replace(/\/$/, '') || '/';
  if (p !== '/' && p !== '/dashboard') return false;
  const mode = layout !== undefined ? layout : getDashboardLayout();
  return mode === 'split3';
}
