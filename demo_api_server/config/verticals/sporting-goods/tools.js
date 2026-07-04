'use strict';

/**
 * Sporting-goods tools — the vertical's OWN actions over its OWN data store.
 * No banking action names, no relabeling. Each handler returns
 * { result, render } where `render` is the manifest render-descriptor key
 * (the UI resolves the descriptor from the active manifest's `render` block).
 */
function buildSportingGoodsTools(store) {
  const tools = [
    /* PACK:defs:start */
    { name: 'cancel_order', description: "Cancel a pending gear order by order id", inputSchema: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] }, scopes: ['write'], authz: {} },
    { name: 'return_order', description: "Initiate a return for a delivered gear order by order id", inputSchema: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] }, scopes: ['write'], authz: {} },
    { name: 'cancel_rental', description: "Cancel an active equipment rental by rental id", inputSchema: { type: 'object', properties: { rentalId: { type: 'string' } }, required: ['rentalId'] }, scopes: ['write'], authz: {} },
    { name: 'redeem_points', description: "Redeem loyalty points for a reward or discount by loyalty account id", inputSchema: { type: 'object', properties: { loyaltyId: { type: 'string' } }, required: ['loyaltyId'] }, scopes: ['write'], authz: {} },
    { name: 'close_support_ticket', description: "Close an open support ticket by ticket id", inputSchema: { type: 'object', properties: { ticketId: { type: 'string' } }, required: ['ticketId'] }, scopes: ['write'], authz: {} },
    { name: 'cancel_subscription', description: "Cancel an active subscription or membership plan by subscription id", inputSchema: { type: 'object', properties: { subscriptionId: { type: 'string' } }, required: ['subscriptionId'] }, scopes: ['write'], authz: {} },
    { name: 'remove_wishlist_item', description: "Remove a specific item from the customer wishlist by id", inputSchema: { type: 'object', properties: { wishlistItemId: { type: 'string' } }, required: ['wishlistItemId'] }, scopes: ['write'], authz: {} },
    { name: 'cancel_coaching_session', description: "Cancel a booked coaching session or lesson by session id", inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] }, scopes: ['write'], authz: {} },
    { name: 'list_payments', description: "List saved payment methods on the customer account", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'list_addresses', description: "List saved shipping addresses on the customer account", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'list_invoices', description: "List past invoices and billing history for the customer", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'list_support_tickets', description: "List customer support tickets and their current status", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'list_subscriptions', description: "List active and past memberships or subscription plans for the customer", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'list_wishlist', description: "List items saved to the customer wishlist or favorites", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'list_promotions', description: "List available promotions, discount codes, and coupons for the customer", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'list_coaching_sessions', description: "List booked coaching sessions, clinics, and lessons for the customer", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'list_store_credit', description: "List store credit balances and gift card credits available on the account", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    /* PACK:defs:end */
    {
      name: 'list_gear',
      description: 'List the member\'s gear orders.',
      inputSchema: { type: 'object', properties: {} },
      scopes: ['read'],
      authz: {},
    },
    {
      name: 'list_rentals',
      description: 'List the member\'s active equipment rentals.',
      inputSchema: { type: 'object', properties: {} },
      scopes: ['read'],
      authz: {},
    },
    {
      name: 'gear_order_status',
      description: 'Show the status of a gear order. Defaults to the most recent order when no orderId is given.',
      inputSchema: {
        type: 'object',
        properties: { orderId: { type: 'string' } },
      },
      scopes: ['read'],
      authz: {},
    },
    {
      name: 'loyalty_balance',
      description: 'Show the member\'s loyalty points and tier.',
      inputSchema: { type: 'object', properties: {} },
      scopes: ['read'],
      authz: {},
    },
    {
      name: 'extend_rental',
      description: 'Extend an active rental. Requires confirmation.',
      inputSchema: {
        type: 'object',
        properties: { rentalId: { type: 'string' }, days: { type: 'number' } },
        required: ['rentalId'],
      },
      scopes: ['write'],
      authz: { consent: true },
    },
    {
      name: 'sensitive_membership_details',
      description: 'Access sensitive membership details including payment information. Requires explicit user consent.',
      inputSchema: { type: 'object', properties: {} },
      scopes: ['read'],
      authz: { consent: true },
    },
    {
      name: 'api_key_demo',
      description: 'Demo API-key path.',
      inputSchema: { type: 'object', properties: {} },
      scopes: ['read'],
      authz: {},
    },
    {
      name: 'dual_token_demo',
      description: 'Demo access and ID token path.',
      inputSchema: { type: 'object', properties: {} },
      scopes: ['read'],
      authz: {},
    },
  ];

  async function execute(name, params, ctx) {
    const userId = ctx && ctx.userId ? ctx.userId : 'anon';
    switch (name) {
      /* PACK:cases:start */
      case 'cancel_order': {
        const _id = params && (params.orderId || params.recordId);
        const _arr = store.get(userId).orders || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'order not found' }, render: 'text' };
        Object.assign(_item, { status: 'cancelled' });
        return { result: _item, render: 'cancel_order' };
      }
      case 'return_order': {
        const _id = params && (params.orderId || params.recordId);
        const _arr = store.get(userId).orders || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'order not found' }, render: 'text' };
        Object.assign(_item, { status: 'return_requested' });
        return { result: _item, render: 'return_order' };
      }
      case 'cancel_rental': {
        const _id = params && (params.rentalId || params.recordId);
        const _arr = store.get(userId).rentals || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'rental not found' }, render: 'text' };
        Object.assign(_item, { status: 'cancelled' });
        return { result: _item, render: 'cancel_rental' };
      }
      case 'redeem_points': {
        const _id = params && (params.loyaltyId || params.recordId);
        const _arr = store.get(userId).loyalty || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'loyalty reward not found' }, render: 'text' };
        Object.assign(_item, { status: 'redeemed' });
        return { result: _item, render: 'redeem_points' };
      }
      case 'close_support_ticket': {
        const _id = params && (params.ticketId || params.recordId);
        const _arr = store.get(userId).support_tickets || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'support ticket not found' }, render: 'text' };
        Object.assign(_item, { status: 'closed' });
        return { result: _item, render: 'close_support_ticket' };
      }
      case 'cancel_subscription': {
        const _id = params && (params.subscriptionId || params.recordId);
        const _arr = store.get(userId).subscriptions || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'subscription not found' }, render: 'text' };
        Object.assign(_item, { status: 'cancelled' });
        return { result: _item, render: 'cancel_subscription' };
      }
      case 'remove_wishlist_item': {
        const _id = params && (params.wishlistItemId || params.recordId);
        const _arr = store.get(userId).wishlist || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'wishlist item not found' }, render: 'text' };
        Object.assign(_item, { status: 'removed' });
        return { result: _item, render: 'remove_wishlist_item' };
      }
      case 'cancel_coaching_session': {
        const _id = params && (params.sessionId || params.recordId);
        const _arr = store.get(userId).coaching_sessions || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'coaching session not found' }, render: 'text' };
        Object.assign(_item, { status: 'cancelled' });
        return { result: _item, render: 'cancel_coaching_session' };
      }
      case 'list_payments':
        return { result: { payments: store.get(userId).payments }, render: 'list_payments' };
      case 'list_addresses':
        return { result: { addresses: store.get(userId).addresses }, render: 'list_addresses' };
      case 'list_invoices':
        return { result: { invoices: store.get(userId).invoices }, render: 'list_invoices' };
      case 'list_support_tickets':
        return { result: { support_tickets: store.get(userId).support_tickets }, render: 'list_support_tickets' };
      case 'list_subscriptions':
        return { result: { subscriptions: store.get(userId).subscriptions }, render: 'list_subscriptions' };
      case 'list_wishlist':
        return { result: { wishlist: store.get(userId).wishlist }, render: 'list_wishlist' };
      case 'list_promotions':
        return { result: { promotions: store.get(userId).promotions }, render: 'list_promotions' };
      case 'list_coaching_sessions':
        return { result: { coaching_sessions: store.get(userId).coaching_sessions }, render: 'list_coaching_sessions' };
      case 'list_store_credit':
        return { result: { store_credit: store.get(userId).store_credit }, render: 'list_store_credit' };
      /* PACK:cases:end */
      case 'list_gear':
        return { result: { orders: store.get(userId).orders }, render: 'list_gear' };
      case 'list_rentals':
        return { result: { rentals: store.get(userId).rentals }, render: 'list_rentals' };
      case 'gear_order_status': {
        // One-click "Track my order" chip carries no orderId — default to the
        // member's most recent gear order rather than dead-ending on a missing param.
        const orders = store.get(userId).orders || [];
        const wantedId = params && params.orderId;
        const order = wantedId ? orders.find((o) => o.id === wantedId) : orders[0];
        if (!order) return { result: { error: 'order not found' }, render: 'text' };
        return { result: order, render: 'gear_order_status' };
      }
      case 'loyalty_balance':
        // loyalty is array-shaped (see redeem handler above); the loyalty_balance
        // render descriptor is a flat fieldList, so return the current loyalty
        // record, not the raw array.
        return { result: (store.get(userId).loyalty || [])[0] || {}, render: 'loyalty_balance' };
      case 'extend_rental': {
        const r = store.extendRental(userId, params || {});
        if (!r) return { result: { error: 'rental not found' }, render: 'text' };
        return { result: r, render: 'extend_rental' };
      }
      case 'sensitive_membership_details':
        return {
          result: {
            data: {
              membershipTier: 'Gold',
              paymentMethod: { type: 'card', last4: '****', expiry: '**/**' },
              lifetimeSpend: 1842.50,
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

module.exports = { buildSportingGoodsTools };
