module.exports = [
  { id: 'rt1', label: 'My orders', message: 'show my orders', mode: 'both', tool: 'list_orders', useCaseId: 'view_orders' },
  { id: 'rt2', label: 'Track order', message: 'track my order', mode: 'both', tool: 'track_order', useCaseId: 'track_order' },
  { id: 'rt3', label: 'Return item', message: 'return an item', mode: 'both', tool: 'initiate_return', useCaseId: 'return_item' },
  { id: 'rt4', label: 'Apply coupon', message: 'apply a coupon code', mode: 'both', tool: 'apply_coupon', useCaseId: 'apply_coupon' },
  { id: 'rt5', label: 'Payment methods', message: 'show my payment methods', mode: 'both', tool: 'list_payment_methods', useCaseId: 'view_payments' },
  { id: 'rt6', label: 'Wishlist', message: 'show my wishlist', mode: 'both', tool: 'get_wishlist', useCaseId: 'view_wishlist' },
  { id: 'rt-direct', label: 'Direct MCP', message: 'list my orders', mode: 'direct', tool: 'list_orders', useCaseId: 'view_orders_direct' },
];
