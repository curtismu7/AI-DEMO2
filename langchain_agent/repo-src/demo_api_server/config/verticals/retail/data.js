'use strict';

const path = require('path');
const fs = require('fs');

const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8'));

/**
 * Per-vertical retail data store — genuine retail objects (orders, rewards,
 * wishlist) keyed by userId, NOT relabeled banking accounts. Deep clone per user.
 */
function createRetailStore() {
  const byUser = new Map();
  function get(userId) {
    if (!byUser.has(userId)) byUser.set(userId, structuredClone(SEED));
    return byUser.get(userId);
  }
  let seq = 0;
  function checkout(userId, { product, amount }) {
    const data = get(userId);
    seq += 1;
    const order = { id: `ord-new-${seq}`, product, amount, status: 'Processing', date: '2026-05-31' };
    data.orders.push(order);
    return order;
  }

  // Admin back-office write actions. Each resolves an item by id in the user's
  // store, mutates its status, and returns the item (or null when not found).
  function cancelOrder(userId, orderId) {
    const o = (get(userId).orders || []).find((x) => String(x.id) === String(orderId));
    if (!o || o.status === 'Cancelled' || o.status === 'Delivered') return null;
    o.status = 'Cancelled';
    return o;
  }
  function cancelSubscription(userId, subscriptionId) {
    const s = (get(userId).subscriptions || []).find((x) => String(x.id) === String(subscriptionId));
    if (!s || s.status === 'Cancelled') return null;
    s.status = 'Cancelled';
    return s;
  }
  function resolveTicket(userId, ticketId) {
    const t = (get(userId).support_tickets || []).find((x) => String(x.id) === String(ticketId));
    if (!t || t.status === 'Resolved' || t.status === 'Closed') return null;
    t.status = 'Resolved';
    return t;
  }
  function approveReturn(userId, returnId) {
    const r = (get(userId).returns || []).find((x) => String(x.id) === String(returnId));
    if (!r || r.status === 'Refunded') return null;
    r.status = 'Refunded';
    return r;
  }

  return { get, checkout, cancelOrder, cancelSubscription, resolveTicket, approveReturn };
}

module.exports = { createRetailStore };
