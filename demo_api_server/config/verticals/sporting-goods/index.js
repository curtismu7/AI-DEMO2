'use strict';

const { verticalManifest } = require('../../../services/verticalManifest');
const { createSportingGoodsStore } = require('./data');
const { buildSportingGoodsTools } = require('./tools');
const { EDUCATION_HEURISTICS } = require('../shared/educationHeuristics');

const store = createSportingGoodsStore();
const { tools, execute } = buildSportingGoodsTools(store);

// Most specific first: extend_rental before list_rentals; gear_order_status before list_gear; sensitive_membership_details must be early.
const HEURISTICS = [
  /* PACK:heuristics:start */
  { re: /\bcancel\b.*\border\b|\border\b.*\bcancel\b/i, action: 'cancel_order', extractsRecordId: true },
  { re: /\breturn\b.*\border\b|\bstart\s+a\s+return\b|\brequest\s+return\b/i, action: 'return_order', extractsRecordId: true },
  { re: /\bcancel\b.*\brental\b|\brental\b.*\bcancel\b/i, action: 'cancel_rental', extractsRecordId: true },
  { re: /\bredeem\b.*\bpoints?\b|\buse\b.{0,20}\bpoints?\b/i, action: 'redeem_points', extractsRecordId: true },
  { re: /\bcancel\b.*\bsubscription\b|\bcancel\b.*\bmembership\b|\bunsubscribe\b/i, action: 'cancel_subscription', extractsRecordId: true },
  { re: /\bpayment\s+methods?\b|\bsaved\s+cards?\b|\bcards?\b.{0,15}\bsaved\b|\bmy\s+cards?\b/i, action: 'list_payments' },
  { re: /\baddress(es)?\b/i, action: 'list_addresses' },
  { re: /\binvoices?\b|\bbilling\s+history\b|\bbills?\b/i, action: 'list_invoices' },
  { re: /\bsupport\s+ticket(?:s)?\b|\bmy\s+ticket(?:s)?\b|\bopen\s+cases?\b/i, action: 'list_support_tickets' },
  { re: /\bmy\s+subscription(?:s)?\b|\bmembership\s+plan\b|\bsports\s+pass\b/i, action: 'list_subscriptions' },
  { re: /\bwish\s*list\b|\bsaved\s+items?\b|\bfavorites?\b|\bitems?\b.{0,15}\bsaved\b/i, action: 'list_wishlist' },
  { re: /\bpromotions?\b|\bcoupons?\b|\bdeals?\b|\boffers?\b|\bdiscount\s+codes?\b|\bpromo\s+codes?\b|\bdiscounts?\b/i, action: 'list_promotions' },
  { re: /\bcoaching\b|\blessons?\b|\bclinics?\b|\btraining\s+sessions?\b/i, action: 'list_coaching_sessions' },
  /* PACK:heuristics:end */
  { re: /\bsensitive\b.*\bmember\b|\bmember\b.*\bsensitive\b/i, action: 'sensitive_membership_details' },
  { re: /\bextend\b.*\brental\b|\brenew\b.*\brental\b/, action: 'extend_rental', extractsRentalId: true, paramHint: 'e.g. "extend rental r1" — find your rental ID in the rentals list' },
  { re: /\b(my\s+)?rentals?\b|\bgear\s+rentals?\b|\bdue\s+back\b/, action: 'list_rentals' },
  { re: /\border\s+status\b|\btrack\s+(my\s+)?order\b/, action: 'gear_order_status', extractsOrderId: true, paramHint: 'e.g. "order status 1003" — find your order ID in the gear list' },
  { re: /\b(my\s+)?gear\b|\bmy\s+equipment\b|\border\s+history\b/, action: 'list_gear' },
  { re: /\b(my\s+|check\s+)?(rewards?\s+points?|loyalty|point\s+balance)\b|\b(next\s+)?tier\b|\bhow\s+(close|far)\b.*\btier\b/, action: 'loyalty_balance' },
  // Chips sg8/sg10 — equipment suggestions (Heuristics-only → gear list)
  { re: /\b(suggest|recommend|recommend\w*|matching)\b.*\b(equipment|gear|purchases?)\b|\btrail[\s-]?ready\b|\bequipment matching\b/i, action: 'list_gear' },
  { re: /\b(unusual|anomal\w*|suspicious|unexpected)\b.*\b(pattern|transaction|activity|purchase|order|charge|spend)|check for unusual|flag any unusual|spot unusual/i, action: 'list_gear' },
];

function getManifest() {
  return verticalManifest.resolver.resolve('sporting-goods');
}

function getSystemPrompt(ctx) {
  const role = ctx && ctx.role ? ctx.role : 'member';
  return [
    'You are Super Sports\' Sports Assistant, a gear orders, rentals, and loyalty helper.',
    'You help members review gear orders, track order status, manage equipment rentals, check loyalty points, and extend rentals.',
    `The signed-in user role is "${role}".`,
    'Only emit one of the allowed sporting-goods actions; never reference financial or account concepts.',
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
