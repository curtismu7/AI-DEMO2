'use strict';

const crypto = require('node:crypto');

const INTENT_TTL_SECONDS = 300; // 5-minute window per agent run

function getSigningKey() {
  const key = process.env.INTENT_TOKEN_SECRET || process.env.SESSION_SECRET;
  if (!key) throw new Error('[intentTokenService] INTENT_TOKEN_SECRET (or SESSION_SECRET) not set');
  return key;
}

function sign(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sigInput = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', getSigningKey()).update(sigInput).digest('base64url');
  return `${sigInput}.${sig}`;
}

function verifySignature(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed intent token: expected 3 parts');
  const [headerB64, bodyB64, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getSigningKey())
    .update(`${headerB64}.${bodyB64}`)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (
    sigBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expectedBuf)
  ) {
    throw new Error('intent token signature invalid');
  }
  return JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8'));
}

// Map from intent label → tools the agent is permitted to call.
// Unknown intents fall back to all read-only tools (no write access).
const INTENT_TO_PERMITTED_TOOLS = {
  // Banking
  view_balance:             ['get_account_balance', 'get_my_accounts'],
  view_accounts:            ['get_my_accounts', 'get_account_balance'],
  view_transactions:        ['get_my_transactions', 'get_my_accounts'],
  view_sensitive_account:   ['get_sensitive_account_details', 'get_my_accounts'],
  transfer:                 ['create_transfer', 'get_my_accounts', 'get_account_balance'],
  deposit:                  ['create_deposit', 'get_my_accounts', 'get_account_balance'],
  withdraw:                 ['create_withdrawal', 'get_my_accounts', 'get_account_balance'],
  update_profile:           ['update_contact_email'],
  request_waiver:           ['request_fee_waiver'],
  // Investment
  view_investments:         ['get_investment_accounts', 'get_investment_balance', 'get_portfolio_summary', 'get_investment_transactions'],
  view_portfolios:          ['view_portfolios', 'view_holdings', 'view_portfolio_value', 'view_trades', 'view_dividends'],
  view_holdings:            ['view_holdings', 'view_portfolios', 'view_portfolio_value'],
  view_trades:              ['view_trades', 'view_holdings', 'view_portfolios'],
  large_trade:              ['large_trade', 'view_trades', 'view_portfolios'],
  // Healthcare
  view_records:             ['view_records', 'view_coverage', 'show_health_record'],
  view_coverage:            ['view_coverage', 'view_records', 'show_health_record'],
  list_appointments:        ['list_appointments', 'view_records', 'show_health_record'],
  book_appointment:         ['book_appointment', 'list_appointments', 'view_records'],
  release_records:          ['release_records', 'view_records'],
  pay_bill:                 ['pay_bill', 'view_coverage', 'view_records'],
  // Retail
  list_orders:              ['list_orders', 'order_status', 'show_large_purchase'],
  list_anf_orders:          ['list_anf_orders', 'order_status'],
  view_rewards:             ['rewards_balance', 'loyalty_balance'],
  checkout:                 ['checkout', 'list_orders', 'list_anf_orders'],
  // Sporting-goods
  list_gear:                ['list_gear', 'list_rentals', 'gear_order_status', 'show_gear_order'],
  list_rentals:             ['list_rentals', 'extend_rental', 'list_gear'],
  extend_rental:            ['extend_rental', 'list_rentals'],
  gear_order:               ['gear_order_status', 'list_gear', 'show_gear_order'],
  view_gear_warranty:       ['show_gear_warranty'],
  request_price_match:      ['request_price_match', 'list_gear'],
  // Workforce
  view_benefits:            ['view_benefits', 'pto_balance', 'show_expense_report'],
  pto_balance:              ['pto_balance', 'view_benefits', 'show_expense_report'],
  view_expenses:            ['list_expenses', 'show_expense_report'],
  submit_expense:           ['submit_expense', 'list_expenses'],
  request_time_off:         ['request_time_off', 'pto_balance'],
  // Mortgage
  view_mortgage:            ['show_mortgage'],
  // University
  view_courses:             ['view_courses', 'view_standing', 'view_enrollment_history'],
  view_standing:            ['view_standing', 'view_courses'],
  view_enrollment_history:  ['view_enrollment_history', 'view_courses'],
  register_course:          ['register_course', 'view_courses'],
  release_transcript:       ['release_transcript', 'view_courses'],
  view_financial_aid:       ['view_financial_aid', 'view_billing'],
  view_billing:             ['view_billing', 'view_financial_aid'],
  view_degree_audit:        ['view_degree_audit', 'view_courses'],
  pay_tuition_balance:      ['pay_tuition_balance', 'view_billing'],
  // Government
  view_permits:             ['view_permits', 'view_fees', 'view_filings', 'view_inspections', 'view_violations'],
  view_fees:                ['view_fees', 'view_permits', 'view_tax_assessments'],
  view_filings:             ['view_filings', 'view_permits', 'view_complaints'],
  view_complaints:          ['view_complaints', 'view_permits', 'view_filings'],
  view_tax_assessments:     ['view_tax_assessments', 'view_fees', 'view_permits'],
  pay_fee:                  ['pay_fee', 'view_fees', 'view_permits'],
  sensitive_tax_record:     ['sensitive_tax_record', 'view_permits'],
  release_record:           ['release_record', 'view_permits'],
  // Airlines
  pay_airline_fee:          ['pay_airline_fee', 'get_airline_bookings'],
  get_airline_bookings:     ['get_airline_bookings', 'get_flight_status', 'check_seat_availability'],
  get_flight_status:        ['get_flight_status', 'get_airline_bookings', 'check_seat_availability'],
  check_seat_availability:  ['check_seat_availability', 'get_flight_status', 'get_airline_bookings'],
  // Manufacturing
  approve_purchase_order:   ['approve_purchase_order', 'view_purchase_orders'],
  // Code search (cross-vertical, read-only)
  code_search:              ['code_search', 'get_code', 'list_codebases'],
  get_code:                 ['get_code', 'code_search'],
  list_codebases:           ['list_codebases', 'code_search'],
};

const READ_ONLY_TOOLS = [
  // Banking
  'get_my_accounts', 'get_account_balance', 'get_my_transactions',
  'get_investment_accounts', 'get_investment_balance', 'get_portfolio_summary',
  'get_investment_transactions', 'get_sensitive_account_details', 'query_user_by_email',
  'sequential_think',
  // Healthcare
  'view_records', 'view_coverage', 'list_appointments', 'show_health_record',
  // Retail
  'list_orders', 'list_anf_orders', 'order_status', 'rewards_balance', 'show_large_purchase',
  // Sporting-goods
  'list_gear', 'list_rentals', 'gear_order_status', 'loyalty_balance', 'show_gear_order',
  'show_gear_warranty',
  // Workforce
  'view_benefits', 'pto_balance', 'list_expenses', 'show_expense_report',
  // Mortgage
  'show_mortgage',
  // Government
  'view_permits', 'view_fees', 'view_filings', 'view_inspections', 'view_violations',
  'view_business_licenses', 'view_appointments', 'view_tax_assessments',
  'view_records_requests', 'view_complaints', 'view_documents', 'view_payment_history',
  'view_zoning_info', 'view_notifications',
  // University
  'view_courses', 'view_standing', 'view_enrollment_history',
  'view_financial_aid', 'view_billing', 'view_holds', 'view_degree_audit',
  'view_housing', 'view_dining', 'view_exam_schedule', 'view_parking',
  'view_library', 'view_scholarships', 'view_advisors',
  // Airlines
  'get_airline_bookings', 'get_flight_status', 'check_seat_availability',
  // Code search (cross-vertical, read-only)
  'code_search', 'get_code', 'list_codebases',
];

// Unknown-intent fallback, scoped per vertical and DELIBERATELY excluding the
// sensitive reads (get_sensitive_account_details, query_user_by_email): an
// unclassified prompt should not unlock cross-vertical or sensitive tools. A
// recognized intent (e.g. view_sensitive_account) is required for those.
const READ_ONLY_TOOLS_BY_VERTICAL = {
  banking: [
    'get_my_accounts', 'get_account_balance', 'get_my_transactions',
    'get_investment_accounts', 'get_investment_balance', 'get_portfolio_summary',
    'get_investment_transactions', 'sequential_think',
  ],
  healthcare: ['view_records', 'view_coverage', 'list_appointments', 'show_health_record', 'sequential_think'],
  retail: ['list_orders', 'order_status', 'rewards_balance', 'show_large_purchase', 'sequential_think'],
  'abercrombie-fitch': [
    'list_anf_orders', 'order_status', 'rewards_balance', 'view_wishlist',
    'view_returns', 'sequential_think',
  ],
  'sporting-goods': ['list_gear', 'list_rentals', 'gear_order_status', 'loyalty_balance', 'show_gear_order', 'show_gear_warranty', 'sequential_think'],
  workforce: ['view_benefits', 'pto_balance', 'list_expenses', 'show_expense_report', 'sequential_think'],
  mortgage: ['show_mortgage', 'sequential_think'],
  government: [
    'view_permits', 'view_fees', 'view_filings', 'view_inspections', 'view_violations',
    'view_business_licenses', 'view_appointments', 'view_tax_assessments',
    'view_records_requests', 'view_complaints', 'view_documents', 'view_payment_history',
    'view_zoning_info', 'view_notifications', 'sequential_think',
  ],
  university: [
    'view_courses', 'view_standing', 'view_enrollment_history',
    'view_financial_aid', 'view_billing', 'view_holds', 'view_degree_audit',
    'view_housing', 'view_dining', 'view_exam_schedule', 'view_parking',
    'view_library', 'view_scholarships', 'view_advisors', 'sequential_think',
  ],
  investment: [
    'view_portfolios', 'view_holdings', 'view_trades', 'view_dividends',
    'view_portfolio_value', 'sequential_think',
  ],
  airlines: [
    'get_airline_bookings', 'get_flight_status', 'check_seat_availability',
    'sequential_think',
  ],
  manufacturing: [
    'view_work_orders', 'view_inventory', 'view_production_history',
    'view_machines', 'view_machine_utilization', 'view_quality_inspections',
    'view_shipments', 'view_purchase_orders', 'view_maintenance_tickets',
    'view_defects', 'view_scrap_report', 'view_supplier_scorecard', 'sequential_think',
  ],
};

/** Own-key lookup. Both keys reach here from a request, and `constructor` passes
 *  VALID_VERTICAL_RE — a bare lookup returned the INHERITED Object constructor,
 *  which is truthy, so `permitted_tools` became a function. JSON.stringify then
 *  DROPPED the claim, minting an Intent Token with no tool binding at all. */
function ownEntry(map, key) {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

function permittedToolsForIntent(intent, vertical) {
  const byIntent = ownEntry(INTENT_TO_PERMITTED_TOOLS, intent);
  if (byIntent) return byIntent;
  // Unknown/unclassified intent: restrict to the current vertical's non-sensitive
  // reads instead of every read tool across every vertical (which exposed
  // get_sensitive_account_details / query_user_by_email / other verticals' data to
  // an unrecognized prompt). Fall back to banking reads when the vertical is unknown.
  return ownEntry(READ_ONLY_TOOLS_BY_VERTICAL, vertical) || READ_ONLY_TOOLS_BY_VERTICAL.banking;
}

function mintIntentToken({ userId, sessionId, prompt, intent, confidence, vertical }) {
  const now = Math.floor(Date.now() / 1000);
  const promptHash = crypto.createHash('sha256').update(String(prompt)).digest('hex');
  const payload = {
    jti:             crypto.randomUUID(),
    iss:             'bff:intent-token',
    sub:             userId || '',
    sid:             sessionId || '',
    iat:             now,
    exp:             now + INTENT_TTL_SECONDS,
    prompt_hash:     promptHash,
    intent:          intent || 'unknown',
    confidence:      typeof confidence === 'number' ? confidence : 0,
    permitted_tools: permittedToolsForIntent(intent, vertical),
    vertical:        vertical || 'banking',
  };
  return { token: sign(payload), payload };
}

function verifyIntentToken(token) {
  const payload = verifySignature(token);
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new Error('intent token expired');
  return payload;
}

module.exports = { mintIntentToken, verifyIntentToken, permittedToolsForIntent };
// Exported for the scope-topology parity test (drift-guard) — every tool named
// in these maps must exist in scope-topology.json.
module.exports.INTENT_TO_PERMITTED_TOOLS = INTENT_TO_PERMITTED_TOOLS;
module.exports.READ_ONLY_TOOLS = READ_ONLY_TOOLS;
