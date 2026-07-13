module.exports = [
  { id: 'mfg1', label: 'Order status', message: 'check order status', mode: 'both', tool: 'get_order_status', useCaseId: 'view_order_status' },
  { id: 'mfg2', label: 'Inventory levels', message: 'check inventory', mode: 'both', tool: 'check_inventory', useCaseId: 'view_inventory' },
  { id: 'mfg3', label: 'Production schedule', message: 'show production schedule', mode: 'both', tool: 'get_schedule', useCaseId: 'view_schedule' },
  { id: 'mfg4', label: 'Create quote', message: 'create a quote', mode: 'both', tool: 'create_quote', useCaseId: 'create_quote' },
  { id: 'mfg-direct', label: 'Direct MCP', message: 'check order status', mode: 'direct', tool: 'get_order_status', useCaseId: 'view_order_status_direct' },
];
