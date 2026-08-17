import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PingProductChip, PingProductLegend } from './PingProductChip';
import { PING_PRODUCTS } from '../utils/pingProducts';

describe('PingProductChip', () => {
  it('renders label text', () => {
    render(<PingProductChip product={PING_PRODUCTS.idp} />);
    expect(screen.getByText('PingOne')).toBeTruthy();
  });
  it('applies correct CSS class', () => {
    const { container } = render(<PingProductChip product={PING_PRODUCTS.authz} />);
    expect(container.querySelector('.pp--authz')).toBeTruthy();
  });
  it('renders nothing for null product', () => {
    const { container } = render(<PingProductChip product={null} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('PingProductLegend', () => {
  it('renders all provided products', () => {
    const prods = [PING_PRODUCTS.idp, PING_PRODUCTS.gw];
    render(<PingProductLegend products={prods} />);
    expect(screen.getByText('PingOne')).toBeTruthy();
    expect(screen.getByText('PingOne Agent Gateway')).toBeTruthy();
  });
  it('renders nothing for empty array', () => {
    const { container } = render(<PingProductLegend products={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
