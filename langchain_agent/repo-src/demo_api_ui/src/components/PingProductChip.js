// PingProductChip -- A8 Ping product attribution chip.
// SVG-dot + text label. No emoji. Pure presentational.
import React from 'react';
import './PingProductChip.css';

const DOT_SVG = (
  <svg viewBox="0 0 9 9" aria-hidden="true" focusable="false">
    <circle cx="4.5" cy="4.5" r="4.5" />
  </svg>
);

/**
 * A single Ping product chip.
 * @param {{ product: { id: string, label: string, cssClass: string }, size?: 'sm' | 'xs' }} props
 */
export function PingProductChip({ product, size = 'sm' }) {
  if (!product) return null;
  return (
    <span className={`pp pp--${product.id} pp--${size}`} aria-label={product.label}>
      {DOT_SVG}
      {product.label}
    </span>
  );
}

/**
 * Horizontal legend of products present in a token chain.
 * Rendered once at the top of the Token Chain panel.
 * @param {{ products: Array<{ id: string, label: string, cssClass: string }> }} props
 */
export function PingProductLegend({ products }) {
  if (!products?.length) return null;
  return (
    <div className="pp-legend" aria-label="Ping products in this chain">
      {products.map((p) => (
        <span key={p.id} className="pp-legend__item">
          <PingProductChip product={p} size="sm" />
        </span>
      ))}
    </div>
  );
}
