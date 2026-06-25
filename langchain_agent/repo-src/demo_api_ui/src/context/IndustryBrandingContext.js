// banking_api_ui/src/context/IndustryBrandingContext.js
// COMPATIBILITY LAYER (permanent): delegates to useVertical(); this
// thin adapter preserves the historical useIndustryBranding() API for its
// many consumers. Intentionally retained — not slated for removal.
import { useVertical } from '../vertical/useVertical';

export function IndustryBrandingProvider({ children }) {
  return children;
}

export function useIndustryBranding() {
  const { activeId, pageManifest } = useVertical();
  const id = activeId || 'bx_finance';
  return {
    industryId: id,
    preset: { id, shortName: pageManifest?.identity?.displayName || 'AI Demo', logoPath: pageManifest?.identity?.logoPath || '/super-bank-icon.png' },
    setIndustryId: () => {},
    applyIndustryId: () => {},
  };
}
