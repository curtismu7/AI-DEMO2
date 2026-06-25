import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import RetailDashboard from '../RetailDashboard';

const DATA = {
  products: [
    { id: 'p1', sku: 'BB-1', name: 'AirPods Pro', price: 249, stock: 'In Stock', category: 'Audio' },
    { id: 'p2', sku: 'BB-2', name: 'PS5', price: 499, stock: 'Low Stock', category: 'Gaming' },
  ],
  orders: [
    { id: 'o1', product: 'AirPods Pro', sku: 'BB-1', amount: 249, status: 'Delivered', date: '2026-04-20' },
  ],
};

test('renders products, orders, and updates cart total on add', () => {
  render(<RetailDashboard data={DATA} />);
  // product appears in the product grid (scope the query to avoid the orders row)
  expect(screen.getByText('PS5')).toBeInTheDocument();
  const orders = screen.getByRole('list');
  expect(within(orders).getByText('Delivered')).toBeInTheDocument();
  expect(within(orders).getByText('AirPods Pro')).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: /add to cart/i })[0]);
  expect(screen.getByTestId('retail-cart-total')).toHaveTextContent('249');
});

test('renders nothing harmful when data missing', () => {
  const { container } = render(<RetailDashboard data={null} />);
  expect(container).toBeInTheDocument();
});
