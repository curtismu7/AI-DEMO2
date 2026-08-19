// demo_api_ui/src/config/themeZones.js
//
// Single source of truth for theme ZONES. Drives the picker UI (rows + grouping)
// AND the zone→CSS-var mapping. The server never reads this — it blindly merges
// whatever cssVars the client sends. See skill: vertical-theme-zones.
//
// To add a colorable zone:
//   1. Append an entry here (key, group, label, vars, from).
//   2. Point the consuming component's CSS var at the new brand token, using its
//      current value as the literal fallback: `--component-var: var(--brand-x, <oldValue>)`.
//      Do NOT declare a default for the brand token in :root — that would override
//      the current look immediately (see the invariant comment in index.css).
// No server/API/merge changes are ever required.

import { PALETTES } from './designSystems';

/**
 * Each zone maps one-or-more brand CSS vars to named palette tokens.
 * `vars[i]` is filled from `from[i]` (same length). `group` controls UI grouping.
 */
export const THEME_ZONES = [
  { key: 'header',        group: 'Chrome',    label: 'Header gradient',
    vars: ['--brand-dashboard-header-start', '--brand-dashboard-header-end'],
    from: ['primary', 'secondary'] },
  { key: 'hero',          group: 'Chrome',    label: 'Hero banner',
    vars: ['--brand-app-shell-hero-start', '--brand-app-shell-hero-end'],
    from: ['primary', 'secondary'] },
  { key: 'headerText',    group: 'Chrome',    label: 'Header text',
    vars: ['--brand-dashboard-header-text'],
    from: ['onPrimary'] },
  { key: 'button',        group: 'Actions',   label: 'Primary button',
    vars: ['--app-primary-red', '--app-primary-red-hover', '--app-primary-red-mid', '--app-primary-red-border'],
    from: ['primary', 'primaryHover', 'primaryMid', 'primaryBorder'] },
  { key: 'accent',        group: 'Actions',   label: 'Links & accents',
    vars: ['--theme-accent'],
    from: ['accent'] },
  { key: 'sidebarActive', group: 'Structure', label: 'Sidebar active item',
    vars: ['--brand-sidebar-active-bg', '--brand-sidebar-active-text'],
    from: ['primarySoft', 'primary'] },
  { key: 'cardAccent',    group: 'Structure', label: 'Card accent bar',
    vars: ['--brand-card-accent'],
    from: ['primary'] },
  { key: 'agentRequest',  group: 'Agent',     label: 'Agent request bubble',
    vars: ['--brand-agent-request-bg'],
    from: ['primary'] },
  { key: 'agentResponse', group: 'Agent',     label: 'Agent response bubble',
    vars: ['--brand-agent-response-bg'],
    from: ['card'] },
  { key: 'agentDock',     group: 'Agent',     label: 'Agent dock background',
    vars: ['--brand-agent-dock-bg'],
    from: ['foreground'] },
];

/** Ordered list of group names (for rendering section headers). */
export const ZONE_GROUPS = [...new Set(THEME_ZONES.map((z) => z.group))];

/** All brand CSS var names this system can write (for reference/validation). */
const ALL_THEME_VARS = [...new Set(THEME_ZONES.flatMap((z) => z.vars))];

/**
 * Resolve { cssVar: value } for applying `palette` to `zone`.
 * e.g. resolveZoneCssVars(buttonZone, saas) → { '--app-primary-red': '#2563EB', ... }
 */
export function resolveZoneCssVars(zone, palette) {
  const out = {};
  zone.vars.forEach((cssVar, i) => {
    const tokenName = zone.from[i] ?? zone.from[zone.from.length - 1];
    out[cssVar] = palette.tokens[tokenName];
  });
  return out;
}

/**
 * Given the currently-applied cssVars for a vertical, find which palette (if any)
 * is selected for `zone` — by comparing the zone's first var to each palette's
 * resolved value. Returns the palette id, or null if no override / no match.
 */
export function matchPaletteForZone(zone, currentCssVars = {}, palettes = PALETTES) {
  const probe = zone.vars[0];
  const current = currentCssVars[probe];
  if (!current) return null;
  const norm = (v) => String(v).toLowerCase();
  const hit = palettes.find((p) => norm(resolveZoneCssVars(zone, p)[probe]) === norm(current));
  return hit ? hit.id : null;
}
