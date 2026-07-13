module.exports = [
  { id: 'sg1', label: 'My orders', message: 'show my orders', mode: 'both', tool: 'list_orders', useCaseId: 'view_orders' },
  { id: 'sg2', label: 'Redeem points', message: 'redeem my points', mode: 'both', tool: 'redeem_points', useCaseId: 'redeem_loyalty_points' },
  { id: 'sg3', label: 'My rewards', message: 'show my rewards', mode: 'both', tool: 'get_loyalty_rewards', useCaseId: 'view_rewards' },
  { id: 'sg4', label: 'Store locator', message: 'find a store near me', mode: 'both', tool: 'find_stores', useCaseId: 'store_locator' },
  { id: 'sg5', label: 'Team roster', message: 'show team roster', mode: 'both', tool: 'get_team_roster', useCaseId: 'view_team' },
  { id: 'sg-direct', label: 'Direct MCP', message: 'list my orders', mode: 'direct', tool: 'list_orders', useCaseId: 'view_orders_direct' },
];
