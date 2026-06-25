import { useEffect } from 'react';
import { useVertical } from '../vertical/useVertical';

const ADMIN_CSS_VARS = {
  '--app-primary-red': '#1e293b',
  '--app-primary-red-hover': '#0f172a',
  '--app-primary-red-mid': '#334155',
  '--app-primary-red-border': '#0f172a',
  '--brand-dashboard-header-start': '#0f172a',
  '--brand-dashboard-header-end': '#1e3a5f',
  '--brand-app-shell-hero-start': '#0f172a',
  '--brand-app-shell-hero-end': '#1e3a5f',
  '--theme-accent': '#f59e0b',
  '--brand-dashboard-header-text': '#f1f5f9',
};

export function useAdminTheme(active = true) {
  const { pageManifest } = useVertical();
  const cssVars = pageManifest?.theme?.cssVars;

  useEffect(() => {
    if (!active) return;

    const root = document.documentElement;
    const previous = {};

    // Save ADMIN_CSS_VARS keys plus any current manifest cssVars so both are restored on exit
    const keysToSave = new Set([
      ...Object.keys(ADMIN_CSS_VARS),
      ...(cssVars ? Object.keys(cssVars) : []),
    ]);
    keysToSave.forEach((k) => {
      previous[k] = root.style.getPropertyValue(k);
    });

    // Apply admin palette
    Object.entries(ADMIN_CSS_VARS).forEach(([k, v]) => {
      root.style.setProperty(k, v);
    });

    const prevIndustry = root.dataset.industry;
    root.dataset.industry = 'admin';

    return () => {
      // Restore saved CSS vars
      Object.entries(previous).forEach(([k, v]) => {
        if (v) {
          root.style.setProperty(k, v);
        } else {
          root.style.removeProperty(k);
        }
      });
      // Only restore industry if we're still the last writer (not overwritten by async manifest fetch)
      if (root.dataset.industry === 'admin') {
        root.dataset.industry = prevIndustry || '';
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
