// demo_api_ui/src/config/designSystems.js
//
// Palette catalog for the per-vertical theme-zone picker.
// ~20 palettes curated from the ui-ux-pro-max `colors.csv` (161 WCAG-verified
// product-type palettes): https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
//
// Each palette stores the raw CSV tokens; derived tones (hover/border/soft) are
// computed once at module load. The theme-zone registry (themeZones.js) maps a
// zone's CSS vars to these named tokens. See skill: vertical-theme-zones.

/** Clamp a channel to 0..255. */
const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));

/** Parse #RGB / #RRGGBB → {r,g,b}. */
function toRgb(hex) {
  let h = String(hex).replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

/** Darken a hex color by `pct` percent (toward black). */
function darken(hex, pct) {
  const { r, g, b } = toRgb(hex);
  const f = 1 - pct / 100;
  const h = (n) => clamp(n * f).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** A translucent tint of `hex` (used for soft active-item backgrounds). */
function tint(hex, a) {
  const { r, g, b } = toRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// Raw CSV rows (No, name, primary, onPrimary, secondary, accent, foreground, card).
const RAW = [
  ['saas',        'SaaS Blue',          '#2563EB', '#FFFFFF', '#3B82F6', '#EA580C', '#1E293B', '#FFFFFF'],
  ['ecommerce',   'E-commerce Green',   '#059669', '#FFFFFF', '#10B981', '#EA580C', '#064E3B', '#FFFFFF'],
  ['luxury',      'Luxury Black',       '#1C1917', '#FFFFFF', '#44403C', '#A16207', '#0C0A09', '#FFFFFF'],
  ['financial',   'Financial Navy',     '#0F172A', '#FFFFFF', '#1E293B', '#22C55E', '#F8FAFC', '#0E1223'],
  ['analytics',   'Analytics Blue',     '#1E40AF', '#FFFFFF', '#3B82F6', '#D97706', '#1E3A8A', '#FFFFFF'],
  ['healthcare',  'Healthcare Cyan',    '#0891B2', '#FFFFFF', '#22D3EE', '#059669', '#164E63', '#FFFFFF'],
  ['portfolio',   'Portfolio Mono',     '#18181B', '#FFFFFF', '#3F3F46', '#2563EB', '#09090B', '#FFFFFF'],
  ['gaming',      'Gaming Neon',        '#7C3AED', '#FFFFFF', '#A78BFA', '#F43F5E', '#E2E8F0', '#1E1C35'],
  ['government',  'Government Slate',   '#0F172A', '#FFFFFF', '#334155', '#0369A1', '#020617', '#FFFFFF'],
  ['fintech',     'Fintech Gold',       '#F59E0B', '#0F172A', '#FBBF24', '#8B5CF6', '#F8FAFC', '#222735'],
  ['social',      'Social Rose',        '#E11D48', '#FFFFFF', '#FB7185', '#2563EB', '#881337', '#FFFFFF'],
  ['productivity','Productivity Teal',  '#0D9488', '#FFFFFF', '#14B8A6', '#EA580C', '#134E4A', '#FFFFFF'],
  ['designsys',   'Design System Indigo','#4F46E5','#FFFFFF', '#6366F1', '#EA580C', '#312E81', '#FFFFFF'],
  ['ai',          'AI Purple',          '#7C3AED', '#FFFFFF', '#A78BFA', '#0891B2', '#1E1B4B', '#FFFFFF'],
  ['collab',      'Collaboration Indigo','#6366F1','#FFFFFF', '#818CF8', '#059669', '#312E81', '#FFFFFF'],
  ['iot',         'Smart Home Slate',   '#1E293B', '#FFFFFF', '#334155', '#22C55E', '#F8FAFC', '#1B2336'],
  ['restaurant',  'Restaurant Red',     '#DC2626', '#FFFFFF', '#F87171', '#A16207', '#450A0A', '#FFFFFF'],
  ['fitness',     'Fitness Orange',     '#F97316', '#0F172A', '#FB923C', '#22C55E', '#F8FAFC', '#313742'],
  ['realestate',  'Real Estate Teal',   '#0F766E', '#FFFFFF', '#14B8A6', '#0369A1', '#134E4A', '#FFFFFF'],
  ['travel',      'Travel Sky',         '#0EA5E9', '#0F172A', '#38BDF8', '#EA580C', '#0C4A6E', '#FFFFFF'],
];

/** Build a palette's full named-token set (raw CSV + derived tones). */
function makePalette([id, name, primary, onPrimary, secondary, accent, foreground, card]) {
  return {
    id,
    name,
    swatchColor: primary,
    tokens: {
      primary,
      primaryHover: darken(primary, 12),
      primaryMid: secondary,
      primaryBorder: darken(primary, 22),
      primarySoft: tint(primary, 0.12),
      secondary,
      accent,
      onPrimary,
      card,
      foreground,
    },
  };
}

export const PALETTES = RAW.map(makePalette);

/** Look up a palette by id. */
export const getPalette = (id) => PALETTES.find((p) => p.id === id) || null;
