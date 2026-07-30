import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { readMockSelection, selectedVariant } from '../components/aiFootprintMocks/mockSelection';

const PATH_TO_CATEGORY = {
  'vscode-copilot': 'vscode',
  'chatgpt-desktop': 'chatgpt',
  'saas-embedded': 'saas',
  'coding-agent': 'coding',
};

/**
 * Auto-detect footprint category + variant from current route.
 * Demo routes map to their category; other routes use saved selection (default: saas).
 */
export function useFootprintAutoDetect() {
  const { pathname } = useLocation();

  return useMemo(() => {
    // Check if on a demo footprint route
    for (const [pathSegment, cat] of Object.entries(PATH_TO_CATEGORY)) {
      if (pathname.includes(`/demo/${pathSegment}`)) {
        const variant = selectedVariant(cat);
        return { category: cat, variant: variant.id };
      }
    }

    // Not on demo route — use default category (saas)
    const variant = selectedVariant('saas');
    return { category: 'saas', variant: variant.id };
  }, [pathname]);
}
