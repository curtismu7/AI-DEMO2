/**
 * Apply a vertical's CSS custom properties to :root, removing any properties
 * that were set by the previous theme but are absent from this one.
 *
 * State (the previously-applied keys) is owned by the CALLER — pass the keys
 * returned by the last call back in as `priorKeys`. Keeping the module stateless
 * means concurrent providers / parallel tests don't clobber a shared Set.
 *
 * @param {Object<string,string>} cssVars  the new theme's custom properties
 * @param {Set<string>} [priorKeys]         keys applied by the previous call
 * @returns {Set<string>}                   keys applied this call (pass back next time)
 */
export function applyThemeTokens(cssVars, priorKeys = new Set()) {
  const root = document.documentElement;
  const newKeys = new Set(Object.keys(cssVars || {}));
  for (const key of priorKeys) {
    if (!newKeys.has(key)) root.style.removeProperty(key);
  }
  for (const [key, value] of Object.entries(cssVars || {})) {
    root.style.setProperty(key, value);
  }
  return newKeys;
}
