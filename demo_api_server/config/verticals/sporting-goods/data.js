'use strict';

const path = require('path');
const fs = require('fs');

const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8'));

/**
 * Per-vertical sporting-goods data store — orders, rentals (a sporting-goods-only
 * domain), loyalty — keyed by userId, NOT relabeled banking accounts. Deep clone per user.
 */
function createSportingGoodsStore() {
  const byUser = new Map();
  function get(userId) {
    if (!byUser.has(userId)) byUser.set(userId, structuredClone(SEED));
    return byUser.get(userId);
  }
  function extendRental(userId, { rentalId }) {
    const data = get(userId);
    const rental = data.rentals.find((r) => String(r.id) === String(rentalId));
    if (!rental) return null;
    rental.status = 'Extended';
    return rental;
  }

  // Admin back-office write actions. Each resolves an item by id in the user's
  // store, mutates its status, and returns the item (or null when not found).
  function cancelOrder(userId, orderId) {
    const o = (get(userId).orders || []).find((x) => String(x.id) === String(orderId));
    if (!o || o.status === 'Cancelled' || o.status === 'Delivered') return null;
    o.status = 'Cancelled';
    return o;
  }
  function returnRental(userId, rentalId) {
    const r = (get(userId).rentals || []).find((x) => String(x.id) === String(rentalId));
    if (!r || r.status === 'Returned') return null;
    r.status = 'Returned';
    return r;
  }
  function resolveTicket(userId, ticketId) {
    const t = (get(userId).support_tickets || []).find((x) => String(x.id) === String(ticketId));
    if (!t || t.status === 'resolved' || t.status === 'closed') return null;
    t.status = 'resolved';
    return t;
  }
  function cancelCoaching(userId, sessionId) {
    const c = (get(userId).coaching_sessions || []).find((x) => String(x.id) === String(sessionId));
    if (!c || c.status === 'cancelled' || c.status === 'completed') return null;
    c.status = 'cancelled';
    return c;
  }
  function addToCart(userId, { productId }) {
    const data = get(userId);
    const product = (data.products || []).find((p) => p.id === productId);
    if (!product) return null;
    const entry = { id: `cart-${Date.now()}-${data.cart.length}`, productId, name: product.name, price: product.price, addedAt: new Date().toISOString() };
    data.cart.push(entry);
    return entry;
  }

  return { get, extendRental, cancelOrder, returnRental, resolveTicket, cancelCoaching, addToCart };
}

module.exports = { createSportingGoodsStore };
