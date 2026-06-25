// banking_api_ui/src/components/BrandLogo.js
import React from 'react';
import { useIndustryBranding } from '../context/IndustryBrandingContext';

/**
 * Industry-aware logo image; falls back to preset logo path and short name for alt text.
 */
export default function BrandLogo({ className = '', style = {}, height = 40, width = 40 }) {
  const { preset } = useIndustryBranding();
  return (
    <img
      src={preset.logoPath}
      alt=""
      className={className}
      style={{ height, width, objectFit: 'contain', ...style }}
    />
  );
}
