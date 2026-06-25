// banking_api_ui/src/components/RetailDashboard.js
// Phase 1 retail dashboard: product grid + local cart + recent orders.
// Mock data comes from the theme manifest (manifest.dashboard.mockData).
// No real persistence — Phase 2 owns real retail MCP tools.
import React, { useState, useMemo } from 'react';
import './RetailDashboard.css';

function stockClass(stock) {
  if (/out/i.test(stock)) return 'retail-stock--out';
  if (/low|limited/i.test(stock)) return 'retail-stock--low';
  return 'retail-stock--in';
}

export default function RetailDashboard({ data }) {
  const products = (data && data.products) || [];
  const orders = (data && data.orders) || [];
  const [cart, setCart] = useState([]);

  const total = useMemo(
    () => cart.reduce((sum, p) => sum + (p.price || 0), 0),
    [cart],
  );

  return (
    <div className="retail-dashboard">
      <section>
        <h2 className="retail-section-title">Products</h2>
        <div className="retail-product-grid">
          {products.map((p) => (
            <div key={p.id} className="retail-product-card">
              <div className="retail-product-name">{p.name}</div>
              <div className="retail-product-meta">
                <span className="retail-product-price">${p.price}</span>
                <span className={`retail-stock ${stockClass(p.stock)}`}>{p.stock}</span>
              </div>
              <button
                type="button"
                className="retail-add-btn"
                onClick={() => setCart((c) => [...c, p])}
              >
                Add to Cart
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="retail-cart-summary">
        <h2 className="retail-section-title">Cart</h2>
        <div>
          {cart.length} item(s) — Subtotal:{' '}
          <strong data-testid="retail-cart-total">${total}</strong>
        </div>
      </section>

      <section>
        <h2 className="retail-section-title">Recent Orders</h2>
        <ul className="retail-orders-list">
          {orders.map((o) => (
            <li key={o.id} className="retail-order-row">
              <span>{o.product}</span>
              <span>${o.amount}</span>
              <span className="retail-order-status">{o.status}</span>
              <span>{o.date}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
