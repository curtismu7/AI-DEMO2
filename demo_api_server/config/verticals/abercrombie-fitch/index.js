'use strict';

const { verticalManifest } = require('../../../services/verticalManifest');
const retail = require('../retail');
const { buildRetailTools } = require('../retail/tools');
const { createAbercrombieFitchStore } = require('./data');

const store = createAbercrombieFitchStore();
const { tools: retailTools, execute } = buildRetailTools(store);
const ORDER_LIST_TOOL = 'list_anf_orders';
const ALLOWED_TOOL_NAMES = new Set([
  'initiate_return',
  'add_to_wishlist',
  'reorder',
  'remove_payment_method',
  'close_support_ticket',
  'redeem_store_credit',
  'cancel_order',
  'view_payment_methods',
  'view_addresses',
  'view_support_tickets',
  'view_gift_cards',
  'view_recently_viewed',
  'view_wishlist',
  'view_returns',
  'request_price_adjustment',
  ORDER_LIST_TOOL,
  'order_status',
  'rewards_balance',
  'checkout',
  'sensitive_order_history',
  'api_key_demo',
  'dual_token_demo',
]);
const tools = retailTools
  .map((tool) => (tool.name === 'list_orders'
    ? { ...tool, name: ORDER_LIST_TOOL, description: "List the customer's Abercrombie & Fitch orders." }
    : tool))
  .filter((tool) => ALLOWED_TOOL_NAMES.has(tool.name));

function getManifest() {
  return verticalManifest.resolver.resolve('abercrombie-fitch');
}

function getSystemPrompt(ctx) {
  const role = ctx && ctx.role ? ctx.role : 'customer';
  return [
    "You are Abercrombie & Fitch's Style Assistant.",
    'Help customers review A&F orders, track deliveries, check myAbercrombie rewards,',
    'manage returns and saved items, and complete apparel purchases.',
    `The signed-in user role is "${role}".`,
    'Use apparel language and only report products, sizes, prices, rewards, and order details returned by tools.',
    'Never invent inventory, discounts, order numbers, or customer data, and never reference electronics or banking products.',
  ].join(' ');
}

function getAuthz() {
  return Object.fromEntries(tools.map((tool) => [tool.name, tool.authz || {}]));
}

async function executeTool(name, params, ctx) {
  if (!ALLOWED_TOOL_NAMES.has(name)) {
    return { result: { error: `unknown Abercrombie & Fitch tool: ${name}` }, render: 'text' };
  }
  if (name === 'sensitive_order_history') {
    const userId = ctx && ctx.userId ? ctx.userId : 'anon';
    const data = store.get(userId);
    return {
      result: {
        data: {
          orders: data.orders.map((order) => ({
            orderId: order.id,
            item: order.product,
            size: order.size,
            total: order.amount,
            paymentLast4: data.payment_methods[0]?.last4 || null,
          })),
          sensitiveDataAccessed: true,
          accessGrantedBy: 'consent',
        },
      },
      render: 'text',
    };
  }
  if (name === ORDER_LIST_TOOL) {
    const response = await execute('list_orders', params, ctx);
    return { ...response, render: ORDER_LIST_TOOL };
  }
  return execute(name, params, ctx);
}

module.exports = {
  getManifest,
  getTools: () => tools,
  getHeuristics: () => retail.getHeuristics()
    .map((rule) => (rule.action === 'list_orders' ? { ...rule, action: ORDER_LIST_TOOL } : rule))
    .filter((rule) => ALLOWED_TOOL_NAMES.has(rule.action)),
  getSystemPrompt,
  getDataStore: () => store,
  executeTool,
  getAuthz,
};
