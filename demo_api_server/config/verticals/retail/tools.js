'use strict';

/**
 * Retail tools — the vertical's OWN actions over its OWN data store.
 * No banking action names, no relabeling. Each handler returns
 * { result, render } where `render` is the manifest render-descriptor key
 * (the UI resolves the descriptor from the active manifest's `render` block).
 */
function buildRetailTools(store) {
  const tools = [
    /* PACK:defs:start */
    { name: 'initiate_return', description: "Initiate a new return request for a product by returnId.", inputSchema: { type: 'object', properties: { returnId: { type: 'string' } }, required: ['returnId'] }, scopes: ['write'], authz: {} },
    { name: 'add_to_wishlist', description: "Add an item to the shopper's wishlist by wishlistId.", inputSchema: { type: 'object', properties: { wishlistId: { type: 'string' } }, required: ['wishlistId'] }, scopes: ['write'], authz: {} },
    { name: 'reorder', description: "Place a reorder for a previously completed order by orderId.", inputSchema: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] }, scopes: ['write'], authz: {} },
    { name: 'remove_payment_method', description: "Remove a saved payment method by paymentId.", inputSchema: { type: 'object', properties: { paymentId: { type: 'string' } }, required: ['paymentId'] }, scopes: ['write'], authz: {} },
    { name: 'pause_subscription', description: "Pause an active product subscription by subscriptionId.", inputSchema: { type: 'object', properties: { subscriptionId: { type: 'string' } }, required: ['subscriptionId'] }, scopes: ['write'], authz: {} },
    { name: 'close_support_ticket', description: "Close an open support ticket by ticketId.", inputSchema: { type: 'object', properties: { ticketId: { type: 'string' } }, required: ['ticketId'] }, scopes: ['write'], authz: {} },
    { name: 'remove_price_alert', description: "Remove a price drop alert by alertId.", inputSchema: { type: 'object', properties: { alertId: { type: 'string' } }, required: ['alertId'] }, scopes: ['write'], authz: {} },
    { name: 'redeem_store_credit', description: "Redeem accumulated rewards points as store credit by rewardId.", inputSchema: { type: 'object', properties: { rewardId: { type: 'string' } }, required: ['rewardId'] }, scopes: ['write'], authz: {} },
    { name: 'cancel_order', description: "Cancel an existing order by orderId.", inputSchema: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] }, scopes: ['write'], authz: {} },
    { name: 'view_payment_methods', description: "List the shopper's saved payment methods.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_addresses', description: "List the shopper's saved shipping and billing addresses.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_subscriptions', description: "List the shopper's active and paused product subscriptions.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_support_tickets', description: "List the shopper's open and resolved customer support tickets.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_gift_cards', description: "List the shopper's gift cards and their remaining balances.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_price_alerts', description: "List the shopper's price drop alerts on watched products.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_recently_viewed', description: "List the products the shopper recently viewed.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_wishlist', description: "List the items on the shopper's wishlist.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_returns', description: "List the shopper's product returns and their status.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    /* PACK:defs:end */
    { name: 'list_orders', description: 'List the customer\'s orders.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'order_status', description: 'Show the status of an order. Defaults to the most recent order when no orderId is given.', inputSchema: { type: 'object', properties: { orderId: { type: 'string' } } }, scopes: ['read'], authz: {} },
    { name: 'rewards_balance', description: 'Show the customer\'s reward points and store credit.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'checkout', description: 'Place an order (checkout). Requires confirmation.', inputSchema: { type: 'object', properties: { product: { type: 'string' }, amount: { type: 'number' } }, required: ['product', 'amount'] }, scopes: ['write'], authz: { consent: true } },
    { name: 'sensitive_order_history', description: 'Access sensitive order history including payment details. Requires explicit user consent.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: { consent: true } },
    { name: 'api_key_demo', description: 'Demo API-key path.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'dual_token_demo', description: 'Demo access and ID token path.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
  ];

  async function execute(name, params, ctx) {
    const userId = ctx && ctx.userId ? ctx.userId : 'anon';
    switch (name) {
      /* PACK:cases:start */
      case 'initiate_return': {
        const _id = params && (params.returnId || params.recordId);
        const _arr = store.get(userId).returns || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'return not found' }, render: 'text' };
        Object.assign(_item, { status: 'Requested' });
        return { result: _item, render: 'initiate_return' };
      }
      case 'add_to_wishlist': {
        const _id = params && (params.wishlistId || params.recordId);
        const _arr = store.get(userId).wishlist || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'wishlist item not found' }, render: 'text' };
        Object.assign(_item, { status: 'Added' });
        return { result: _item, render: 'add_to_wishlist' };
      }
      case 'reorder': {
        const _id = params && (params.orderId || params.recordId);
        const _arr = store.get(userId).orders || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'order not found' }, render: 'text' };
        Object.assign(_item, { status: 'Reordered' });
        return { result: _item, render: 'reorder' };
      }
      case 'remove_payment_method': {
        const _id = params && (params.paymentId || params.recordId);
        const _arr = store.get(userId).payment_methods || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'payment method not found' }, render: 'text' };
        Object.assign(_item, { status: 'Removed' });
        return { result: _item, render: 'remove_payment_method' };
      }
      case 'pause_subscription': {
        const _id = params && (params.subscriptionId || params.recordId);
        const _arr = store.get(userId).subscriptions || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'subscription not found' }, render: 'text' };
        Object.assign(_item, { status: 'Paused' });
        return { result: _item, render: 'pause_subscription' };
      }
      case 'close_support_ticket': {
        const _id = params && (params.ticketId || params.recordId);
        const _arr = store.get(userId).support_tickets || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'support ticket not found' }, render: 'text' };
        Object.assign(_item, { status: 'Closed' });
        return { result: _item, render: 'close_support_ticket' };
      }
      case 'remove_price_alert': {
        const _id = params && (params.alertId || params.recordId);
        const _arr = store.get(userId).price_alerts || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'price alert not found' }, render: 'text' };
        Object.assign(_item, { status: 'Removed' });
        return { result: _item, render: 'remove_price_alert' };
      }
      case 'redeem_store_credit': {
        const _id = params && (params.rewardId || params.recordId);
        const _arr = store.get(userId).rewards || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'store credit not found' }, render: 'text' };
        Object.assign(_item, { status: 'Redeemed' });
        return { result: _item, render: 'redeem_store_credit' };
      }
      case 'cancel_order': {
        const _id = params && (params.orderId || params.recordId);
        const _arr = store.get(userId).orders || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'order not found' }, render: 'text' };
        Object.assign(_item, { status: 'Cancelled' });
        return { result: _item, render: 'cancel_order' };
      }
      case 'view_payment_methods':
        return { result: { payment_methods: store.get(userId).payment_methods }, render: 'view_payment_methods' };
      case 'view_addresses':
        return { result: { addresses: store.get(userId).addresses }, render: 'view_addresses' };
      case 'view_subscriptions':
        return { result: { subscriptions: store.get(userId).subscriptions }, render: 'view_subscriptions' };
      case 'view_support_tickets':
        return { result: { support_tickets: store.get(userId).support_tickets }, render: 'view_support_tickets' };
      case 'view_gift_cards':
        return { result: { gift_cards: store.get(userId).gift_cards }, render: 'view_gift_cards' };
      case 'view_price_alerts':
        return { result: { price_alerts: store.get(userId).price_alerts }, render: 'view_price_alerts' };
      case 'view_recently_viewed':
        return { result: { recently_viewed: store.get(userId).recently_viewed }, render: 'view_recently_viewed' };
      case 'view_wishlist':
        return { result: { wishlist: store.get(userId).wishlist }, render: 'view_wishlist' };
      case 'view_returns':
        return { result: { returns: store.get(userId).returns }, render: 'view_returns' };
      /* PACK:cases:end */
      case 'list_orders':
        return { result: { orders: store.get(userId).orders }, render: 'list_orders' };
      case 'order_status': {
        // One-click chips ("Where's my order?" / "Track my order") carry no orderId —
        // default to the customer's most recent order instead of dead-ending on a
        // missing-param prompt. An explicit orderId still selects a specific order.
        const orders = store.get(userId).orders || [];
        const wantedId = params && params.orderId;
        const order = wantedId ? orders.find((o) => o.id === wantedId) : orders[0];
        if (!order) return { result: { error: 'order not found' }, render: 'text' };
        return { result: order, render: 'order_status' };
      }
      case 'rewards_balance':
        return { result: store.get(userId).rewards, render: 'rewards_balance' };
      case 'checkout':
        return { result: store.checkout(userId, params || {}), render: 'checkout' };
      case 'sensitive_order_history':
        return {
          result: {
            data: {
              orders: [
                { orderId: 'ORD-9982', date: '2025-12-01', total: 249.99, paymentLast4: '****' },
                { orderId: 'ORD-8841', date: '2025-10-14', total: 89.00, paymentLast4: '****' },
              ],
              sensitiveDataAccessed: true,
              accessGrantedBy: 'consent',
            },
          },
          render: 'text',
        };
      case 'api_key_demo':
      case 'dual_token_demo':
        return { result: { data: {} }, render: 'text' };
      default:
        return { result: { error: `unknown tool: ${name}` }, render: 'text' };
    }
  }

  return { tools, execute };
}

module.exports = { buildRetailTools };
