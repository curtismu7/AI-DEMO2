'use strict';

const { verticalManifest } = require('../../../services/verticalManifest');
const { createRetailStore } = require('./data');
const { buildRetailTools } = require('./tools');
const { EDUCATION_HEURISTICS } = require('../shared/educationHeuristics');

const store = createRetailStore();
const { tools, execute } = buildRetailTools(store);

// Most specific first. sensitive_order_history must precede list_orders.
const HEURISTICS = [
  /* PACK:heuristics:start */
  { re: /\b(start|initiate|request|begin|open)\b.{0,20}\breturn\b/i, action: 'initiate_return', extractsRecordId: true },
  { re: /\badd\b.{0,20}\bwish\s*list\b|\bsave\b.{0,20}\bwish\s*list\b/i, action: 'add_to_wishlist', extractsRecordId: true },
  { re: /\breorder\b|\brepeat\b.{0,15}\border\b|\border\s+again\b/i, action: 'reorder', extractsRecordId: true },
  { re: /\bcancel\b.*\border\b/i, action: 'cancel_order', extractsRecordId: true },
  { re: /\bpayment\s+method(s)?\b|\bsaved\s+(card|payment)s?\b|\b(credit|debit)\s+cards?\b/i, action: 'view_payment_methods' },
  { re: /\b(saved|my|shipping|delivery)\s+address(es)?\b/i, action: 'view_addresses' },
  { re: /\bsubscription(s)?\b|\bauto.?ship\b|\brepeat\s+deliver(y|ies)\b/i, action: 'view_subscriptions' },
  { re: /\bsupport\s+ticket(s)?\b|\bopen\s+(case|ticket|issue)(s)?\b|\bmy\s+(case|ticket|complaint)(s)?\b/i, action: 'view_support_tickets' },
  { re: /\bgift\s+card(s)?\b|\bgc\s+balance\b/i, action: 'view_gift_cards' },
  { re: /\bprice\s+(alerts?|drops?)\b|\bprice\s+watch\w*\b|\bwatching\b.{0,15}\bprices?\b/i, action: 'view_price_alerts' },
  { re: /\brecently\s+(viewed|browsed?|browse)\b|\bbrowsing\s+history\b|\bview\s+history\b/i, action: 'view_recently_viewed' },
  { re: /\bwish\s*list\b|\bsaved\s+items?\b/i, action: 'view_wishlist' },
  { re: /\breturns?\b|\breturn\s+history\b|\breturn\s+an?\s+item\b/i, action: 'view_returns' },
  /* PACK:heuristics:end */
  // UC28 request-only. Must precede the order/list heuristics, which own
  // "order" and would otherwise claim the phrase.
  { re: /\bprice[\s-]?adjust\w*\b|\badjust\b.{0,15}\bprice\b/i, action: 'request_price_adjustment' },
  { re: /\bsensitive\b.*\border\b|\border\b.*\bsensitive\b/i, action: 'sensitive_order_history' },
  // Points advice (chip rt8) before checkout so "buy with my points" ≠ checkout
  { re: /\b(buy|spend|redeem|use)\b.*\bpoints?\b|\bpoints?\b.*\b(buy|spend|redeem|use|what should)\b|\bwhat should i buy\b/i, action: 'rewards_balance' },
  // Deals on viewed items (chip rt10)
  { re: /\b(deals?|offers?|promos?|discounts?)\b.*\b(viewed|browsed|watched)\b|\b(viewed|browsed)\b.*\b(deals?|offers?)\b|\bany deals on what i viewed\b/i, action: 'view_recently_viewed' },
  // Cash out store credit (step-up chip rt-mfa) before checkout so it isn't caught by "buy"
  { re: /\bcash\s*out\b.*\b(store\s*)?credit\b|\bstore\s*credit\b.*\bcash\s*out\b/i, action: 'cash_out_store_credit' },
  // "check out my cart" (showcase MFA) — space form must match, not only "checkout"
  { re: /\bcheck\s*out\b|\bplace\s+(an?\s+)?order\b|\bbuy\b(?!\s+with\b)/, action: 'checkout', extractsCheckoutParams: true, paramHint: 'e.g. "checkout laptop $999" or "buy headphones $79"' },
  { re: /\b(unusual|anomal\w*|suspicious|unexpected)\b.*\b(pattern|transaction|activity|purchase|order|charge|spend)|check for unusual|flag any unusual|spot unusual/i, action: 'list_orders' },
  { re: /\border\s+status\b|\bwhere\s+is\s+my\s+order\b|\btrack\s+(my\s+)?order\b/, action: 'order_status', extractsOrderId: true, paramHint: 'e.g. "order status 1234" — find your order ID in your orders list' },
  { re: /\b(my\s+|list\s+|show\s+)?orders?\b|\border\s+history\b/, action: 'list_orders' },
  { re: /\bcompare\b.*\b(orders?|purchases?|buys?)\b|\b(recent|last|my)\b.*\bpurchases?\b/, action: 'list_orders' },
  { re: /\b(my\s+|check\s+)?(rewards?\s+points?|store\s+credit|point\s+balance)\b|\bhow\s+many\s+points\b/, action: 'rewards_balance' },
];

function getManifest() {
  return verticalManifest.resolver.resolve('retail');
}

function getSystemPrompt(ctx) {
  const role = ctx && ctx.role ? ctx.role : 'customer';
  return [
    'You are Great Buy\'s Shopping Assistant, a retail orders and rewards helper.',
    'You help customers review their orders, check order status, see reward points and store credit, and place orders at checkout.',
    `The signed-in user role is "${role}".`,
    'Only emit one of the allowed retail actions; never reference financial or account concepts.',
  ].join(' ');
}

function getAuthz() {
  const out = {};
  for (const t of tools) out[t.name] = t.authz || {};
  return out;
}

module.exports = {
  getManifest,
  getTools: () => tools,
  getHeuristics: () => [...HEURISTICS, ...EDUCATION_HEURISTICS],
  getSystemPrompt,
  getDataStore: () => store,
  executeTool: (name, params, ctx) => execute(name, params, ctx),
  getAuthz,
};
