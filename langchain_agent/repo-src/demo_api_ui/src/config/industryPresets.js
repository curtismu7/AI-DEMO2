// banking_api_ui/src/config/industryPresets.js
/**
 * Industry / white-label presets: logos, colors, display names.
 * Keys must match server `ui_industry_preset` (configStore FIELD_DEFS).
 */

/** @typedef {{ id: string, label: string, shortName: string, tagline?: string, description: string, logoPath: string, cssVars: Record<string, string> }} IndustryPreset */

/** @type {IndustryPreset[]} */
export const INDUSTRY_PRESETS = [
  {
    id: 'bx_finance',
    label: 'Demo (default)',
    shortName: 'Demo',
    tagline: 'PingOne AI IAM Core',
    description:
      'Default demo branding: crimson primary actions and blue dashboard header.',
    logoPath: '/logo.png',
    cssVars: {
      '--app-primary-red': '#b91c1c',
      '--app-primary-red-hover': '#991b1b',
      '--app-primary-red-mid': '#dc2626',
      '--app-primary-red-border': '#7f1d1d',
      '--brand-dashboard-header-start': 'var(--brand-navy)',
      '--brand-dashboard-header-end': 'var(--brand-navy)',
      '--brand-app-shell-hero-start': 'var(--brand-navy)',
      '--brand-app-shell-hero-end': 'var(--brand-navy)',
    },
  },
  {
    id: 'banking',
    label: 'Finance',
    shortName: 'Finance',
    tagline: 'AI-Powered Finance Demo',
    description: 'Finance branding with navy blue header and crimson actions.',
    logoPath: '/logo.png',
    cssVars: {
      '--app-primary-red': '#b91c1c',
      '--app-primary-red-hover': '#991b1b',
      '--app-primary-red-mid': '#dc2626',
      '--app-primary-red-border': '#7f1d1d',
      '--brand-dashboard-header-start': '#1e3a8a',
      '--brand-dashboard-header-end': '#1e3a8a',
      '--brand-app-shell-hero-start': '#1e3a8a',
      '--brand-app-shell-hero-end': '#1e3a8a',
    },
  },
  {
    id: 'healthcare',
    label: 'Healthcare',
    shortName: 'Healthcare',
    tagline: 'AI-Powered Healthcare Demo',
    description: 'Healthcare branding with teal/green header and blue actions.',
    logoPath: '/logo.png',
    cssVars: {
      '--app-primary-red': '#0369a1',
      '--app-primary-red-hover': '#075985',
      '--app-primary-red-mid': '#0ea5e9',
      '--app-primary-red-border': '#0c4a6e',
      '--brand-dashboard-header-start': '#0f766e',
      '--brand-dashboard-header-end': '#0f766e',
      '--brand-app-shell-hero-start': '#0f766e',
      '--brand-app-shell-hero-end': '#0f766e',
    },
  },
  {
    id: 'retail',
    label: 'Retail & E-Commerce',
    shortName: 'Retail',
    tagline: 'AI-Powered Retail Demo',
    description: 'Retail branding with green header and emerald actions.',
    logoPath: '/logo.png',
    cssVars: {
      '--app-primary-red': '#065f46',
      '--app-primary-red-hover': '#064e3b',
      '--app-primary-red-mid': '#10b981',
      '--app-primary-red-border': '#022c22',
      '--brand-dashboard-header-start': '#065f46',
      '--brand-dashboard-header-end': '#065f46',
      '--brand-app-shell-hero-start': '#065f46',
      '--brand-app-shell-hero-end': '#065f46',
    },
  },
  {
    id: 'insurance',
    label: 'Insurance',
    shortName: 'Insurance',
    tagline: 'AI-Powered Insurance Demo',
    description: 'Insurance branding with deep purple header and violet actions.',
    logoPath: '/logo.png',
    cssVars: {
      '--app-primary-red': '#5b21b6',
      '--app-primary-red-hover': '#4c1d95',
      '--app-primary-red-mid': '#7c3aed',
      '--app-primary-red-border': '#3b0764',
      '--brand-dashboard-header-start': '#4c1d95',
      '--brand-dashboard-header-end': '#4c1d95',
      '--brand-app-shell-hero-start': '#4c1d95',
      '--brand-app-shell-hero-end': '#4c1d95',
    },
  },
  {
    id: 'government',
    label: 'Government Services',
    shortName: 'Government',
    tagline: 'AI-Powered Gov Services Demo',
    description: 'Government branding with slate blue header and indigo actions.',
    logoPath: '/logo.png',
    cssVars: {
      '--app-primary-red': '#1e40af',
      '--app-primary-red-hover': '#1e3a8a',
      '--app-primary-red-mid': '#3b82f6',
      '--app-primary-red-border': '#1e3a8a',
      '--brand-dashboard-header-start': '#374151',
      '--brand-dashboard-header-end': '#374151',
      '--brand-app-shell-hero-start': '#374151',
      '--brand-app-shell-hero-end': '#374151',
    },
  },
  {
    id: 'funnybank',
    label: 'FunnyBank (demo)',
    shortName: 'FunnyBank',
    tagline: 'Serious security, silly name',
    description:
      'Purple / violet primary actions and indigo header for a distinct demo tenant. Uses /branding/funnybank-logo.svg.',
    logoPath: '/branding/funnybank-logo.svg',
    cssVars: {
      '--app-primary-red': '#6d28d9',
      '--app-primary-red-hover': '#5b21b6',
      '--app-primary-red-mid': '#7c3aed',
      '--app-primary-red-border': '#4c1d95',
      '--brand-dashboard-header-start': '#4c1d95',
      '--brand-dashboard-header-end': '#6366f1',
      '--brand-app-shell-hero-start': '#5b21b6',
      '--brand-app-shell-hero-end': '#7c3aed',
    },
  },
  {
    id: 'medical',
    label: 'Medical & Healthcare',
    shortName: 'Medical',
    tagline: 'AI-Powered Healthcare Platform',
    description: 'Medical branding with blue header and medical blue actions for patient portals and provider workflows.',
    logoPath: '/logo.png',
    cssVars: {
      '--app-primary-red': '#0369a1',
      '--app-primary-red-hover': '#0284c7',
      '--app-primary-red-mid': '#06b6d4',
      '--app-primary-red-border': '#0c4a6e',
      '--brand-dashboard-header-start': '#0c4a6e',
      '--brand-dashboard-header-end': '#0369a1',
      '--brand-app-shell-hero-start': '#0c4a6e',
      '--brand-app-shell-hero-end': '#0369a1',
    },
  },
];

export const DEFAULT_INDUSTRY_ID = 'bx_finance';

/** @param {string} [id] */
export function getIndustryPreset(id) {
  const found = INDUSTRY_PRESETS.find((p) => p.id === id);
  return found || INDUSTRY_PRESETS[0];
}
