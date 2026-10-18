// demo_api_ui/src/config/inspectorVerticals.js
//
// What the three inspectors (MCP, Authorize, Agent Gateway) offer per vertical:
// its tools, its sample scenarios and its Authorize preset defaults. Nothing
// here is invented. Every source, and the tests that keep it honest:
//
//   tools      that vertical plugin's own MCP-callable tools
//              (demo_api_server/config/verticals/<id>/tools.js getTools(),
//              also in scope-topology.json and mcp-tool-schemas.json). Banking
//              leaves out get_weather / brave_news_search so the gateway
//              showcase tools stay visible in every vertical.
//   ids        seed data: config/verticals/<id>/seed.json (investment: data.js;
//              airlines: demo_mcp_resource_server/seed/airlines.seed.json). The
//              resource server's own seeds use the same ids.
//   amounts    the seeded amount when it sits in the hold band ($250 consent ..
//              $2000 deny, scope-topology.json policy + demo_authz_server),
//              else $500 (stepUpThresholdUsd), the banking withdrawal amount.
//   expect     DENY = a2aDelegated tool (no two-hop act chain from this page);
//              APPROVAL = consent/step_up tool with an amount in the hold band;
//              PERMIT = plain read. Same rules as snapshots/gen-authorize-snapshot.js.
//   authorize  toolName = the vertical's amount-gated write; txTypes = the types
//              mcpToolAuthorizationService WRITE_TOOL_TYPE_MAP sends for it.
//   capture    which id a chain step 1 returns (family as extractCapturedValues
//              names it) and which later argument it fills.
//
// Tests: src/config/inspectorVerticals.test.js (topology + MCP schemas) and
// demo_api_server/tests/inspectorVerticalsCatalog.test.js (runs every sample
// against the vertical's seed in-process).

const w = (s) => s.split(' ');

const sensitive = (tool) => ({ id: 'sensitive', label: 'Sensitive read (expect DENY)', expect: 'DENY', tool, args: {} });

export const INSPECTOR_VERTICALS = {
  // The gateway page's original scenarios, unchanged.
  banking: {
    tools: w('get_my_accounts get_account_balance get_my_transactions get_sensitive_account_details create_transfer create_deposit create_withdrawal request_fee_waiver'),
    capture: { tool: 'get_my_accounts', family: 'account', arg: 'account_id', hint: 'Run "Read accounts" first to fill account_id.' },
    authorize: { toolName: 'transfer', txTypes: ['transfer', 'withdrawal', 'deposit'] },
    scenarios: [
      { id: 'read', label: 'Read accounts (expect PERMIT)', expect: 'PERMIT', tool: 'get_my_accounts', args: {} },
      { id: 'sensitive', label: 'Sensitive read (expect DENY)', expect: 'DENY', tool: 'get_sensitive_account_details', args: { account_id: '' } },
      { id: 'withdrawal', label: 'Withdrawal (expect approval)', expect: 'APPROVAL', tool: 'create_withdrawal', args: { account_id: '', amount: 500 } },
      {
        id: 'chain',
        label: 'Run chain: accounts → balance → sensitive',
        steps: [
          { tool: 'get_my_accounts', args: {} },
          { tool: 'get_account_balance', args: { account_id: '' } },
          { tool: 'get_sensitive_account_details', args: { account_id: '' } },
        ],
      },
    ],
  },
  healthcare: {
    tools: w('view_records view_coverage list_appointments view_claims view_billing pay_bill cancel_appointment reschedule_appointment view_medications refill_prescription view_lab_results view_vitals view_care_team list_messages view_referrals view_documents view_immunizations view_allergies view_dependents view_care_plan mark_message_read request_document cancel_referral book_appointment release_records sensitive_patient_records'),
    capture: { tool: 'view_records', family: 'record', arg: 'recordId', hint: 'Run "Read records" first to fill recordId.' },
    authorize: { toolName: 'pay_bill', txTypes: ['transfer'] },
    scenarios: [
      { id: 'read', label: 'Read records (expect PERMIT)', expect: 'PERMIT', tool: 'view_records', args: {} },
      sensitive('sensitive_patient_records'),
      // Seeded bills are $15-50, under the hold band, so this uses $500.
      { id: 'approval', label: 'Pay bill (expect approval)', expect: 'APPROVAL', tool: 'pay_bill', args: { billId: '404', amount: 500 } },
      {
        id: 'chain',
        label: 'Run chain: records → release → sensitive',
        steps: [
          { tool: 'view_records', args: {} },
          { tool: 'release_records', args: { recordId: '' } },
          { tool: 'sensitive_patient_records', args: {} },
        ],
      },
    ],
  },
  retail: {
    tools: w('initiate_return add_to_wishlist reorder remove_payment_method pause_subscription close_support_ticket remove_price_alert redeem_store_credit cancel_order view_payment_methods view_addresses view_subscriptions view_support_tickets view_gift_cards view_price_alerts view_recently_viewed view_wishlist view_returns request_price_adjustment list_orders order_status rewards_balance checkout cash_out_store_credit sensitive_order_history'),
    capture: { tool: 'list_orders', family: 'order', arg: 'orderId', hint: 'Run "Read orders" first to fill orderId.' },
    authorize: { toolName: 'checkout', txTypes: ['transfer'] },
    scenarios: [
      { id: 'read', label: 'Read orders (expect PERMIT)', expect: 'PERMIT', tool: 'list_orders', args: {} },
      sensitive('sensitive_order_history'),
      // Seeded order 1002.
      { id: 'approval', label: 'Checkout (expect approval)', expect: 'APPROVAL', tool: 'checkout', args: { product: 'MacBook Pro 14"', amount: 1999 } },
      {
        id: 'chain',
        label: 'Run chain: orders → order status → sensitive',
        steps: [
          { tool: 'list_orders', args: {} },
          { tool: 'order_status', args: { orderId: '' } },
          { tool: 'sensitive_order_history', args: {} },
        ],
      },
    ],
  },
  // Bookings carry confirmation numbers, not ids, so nothing is captured.
  airlines: {
    tools: w('pay_airline_fee book_airline_flight cancel_airline_reservation sensitive_airline_bookings get_airline_bookings get_flight_status check_seat_availability sensitive_passenger_record get_loyalty_status redeem_miles'),
    capture: null,
    authorize: { toolName: 'pay_airline_fee', txTypes: ['transfer'] },
    scenarios: [
      { id: 'read', label: 'Read bookings (expect PERMIT)', expect: 'PERMIT', tool: 'get_airline_bookings', args: {} },
      sensitive('sensitive_passenger_record'),
      // Manifest chip "pay a $300 change fee"; seeded booking K7XR2M.
      { id: 'approval', label: 'Pay change fee (expect approval)', expect: 'APPROVAL', tool: 'pay_airline_fee', args: { amount: 300, fee_type: 'change', confirmation_number: 'K7XR2M' } },
      {
        id: 'chain',
        label: 'Run chain: bookings → flight status → sensitive',
        steps: [
          { tool: 'get_airline_bookings', args: {} },
          { tool: 'get_flight_status', args: { flight_number: 'UA328' } },
          { tool: 'sensitive_passenger_record', args: {} },
        ],
      },
    ],
  },
  investment: {
    tools: w('view_portfolios view_holdings view_trades view_dividends view_portfolio_value buy_security sell_security deposit withdraw large_trade rebalance_portfolio sensitive_holdings request_fee_tier_review'),
    capture: { tool: 'view_portfolios', family: 'portfolio', arg: 'portfolioId', hint: 'Run "Read portfolios" first to fill portfolioId.' },
    authorize: { toolName: 'large_trade', txTypes: ['transfer'] },
    scenarios: [
      { id: 'read', label: 'Read portfolios (expect PERMIT)', expect: 'PERMIT', tool: 'view_portfolios', args: {} },
      sensitive('sensitive_holdings'),
      // Seeded VTI holding; seeded trades are above the $2000 deny line, so $500.
      { id: 'approval', label: 'Large trade (expect approval)', expect: 'APPROVAL', tool: 'large_trade', args: { portfolioType: 'Brokerage', symbol: 'VTI', amount: 500 } },
      {
        id: 'chain',
        label: 'Run chain: portfolios → fee review → sensitive',
        steps: [
          { tool: 'view_portfolios', args: {} },
          { tool: 'request_fee_tier_review', args: { portfolioId: '' } },
          { tool: 'sensitive_holdings', args: {} },
        ],
      },
    ],
  },
  government: {
    tools: w('dispute_violation reschedule_gov_appointment cancel_permit submit_filing approve_inspection close_violation schedule_inspection renew_permit cancel_appointment view_inspections view_violations view_business_licenses view_appointments view_tax_assessments view_records_requests view_complaints view_documents view_payment_history view_zoning_info view_notifications view_permits view_fees view_filings pay_fee release_record sensitive_tax_record'),
    capture: { tool: 'view_permits', family: 'permit', arg: 'permitId', hint: 'Run "Read permits" first to fill permitId.' },
    authorize: { toolName: 'pay_fee', txTypes: ['transfer'] },
    scenarios: [
      { id: 'read', label: 'Read permits (expect PERMIT)', expect: 'PERMIT', tool: 'view_permits', args: {} },
      sensitive('sensitive_tax_record'),
      // Seeded fees total ($480 outstanding).
      { id: 'approval', label: 'Pay fees (expect approval)', expect: 'APPROVAL', tool: 'pay_fee', args: { amount: 480 } },
      {
        id: 'chain',
        label: 'Run chain: permits → release → sensitive',
        steps: [
          { tool: 'view_permits', args: {} },
          { tool: 'release_record', args: { permitId: '' } },
          { tool: 'sensitive_tax_record', args: {} },
        ],
      },
    ],
  },
  manufacturing: {
    tools: w('close_maintenance_ticket complete_quality_inspection receive_shipment approve_purchase_order reject_purchase_order void_purchase_order flag_defect reopen_defect put_machine_offline expedite_shipment escalate_maintenance_ticket view_machines view_machine_utilization view_quality_inspections view_shipments view_purchase_orders view_maintenance_tickets view_defects view_scrap_report view_supplier_scorecard request_spec_exception view_work_orders view_inventory view_production_history schedule_run release_work_order sensitive_supplier_contract'),
    capture: { tool: 'view_work_orders', family: 'workorder', arg: 'orderId', hint: 'Run "Read work orders" first to fill orderId.' },
    authorize: { toolName: 'approve_purchase_order', txTypes: ['transfer'] },
    scenarios: [
      { id: 'read', label: 'Read work orders (expect PERMIT)', expect: 'PERMIT', tool: 'view_work_orders', args: {} },
      sensitive('sensitive_supplier_contract'),
      // Seeded pending PO; its $8750 total is above the $2000 deny line, so $500.
      { id: 'approval', label: 'Approve purchase order (expect approval)', expect: 'APPROVAL', tool: 'approve_purchase_order', args: { poId: 'PO-6001', amount: 500 } },
      {
        id: 'chain',
        label: 'Run chain: work orders → release → sensitive',
        steps: [
          { tool: 'view_work_orders', args: {} },
          { tool: 'release_work_order', args: { orderId: '' } },
          { tool: 'sensitive_supplier_contract', args: {} },
        ],
      },
    ],
  },
  workforce: {
    tools: w('cancel_expense enroll_training close_ticket complete_goal request_schedule_change update_goal_progress withdraw_training_enrollment view_payslips view_trainings view_tickets view_schedule view_goals view_colleagues view_payslip_detail view_policies view_announcements view_direct_deposit view_benefits pto_balance list_expenses submit_expense request_time_off sensitive_payroll_details'),
    capture: { tool: 'list_expenses', family: 'expense', arg: 'expenseId', hint: 'Run "Read expenses" first to fill expenseId.' },
    authorize: { toolName: 'submit_expense', txTypes: ['transfer'] },
    scenarios: [
      { id: 'read', label: 'Read expenses (expect PERMIT)', expect: 'PERMIT', tool: 'list_expenses', args: {} },
      sensitive('sensitive_payroll_details'),
      // Seeded expense 203.
      { id: 'approval', label: 'Submit expense (expect approval)', expect: 'APPROVAL', tool: 'submit_expense', args: { category: 'Equipment', amount: 429.99 } },
      {
        id: 'chain',
        label: 'Run chain: expenses → cancel → sensitive',
        steps: [
          { tool: 'list_expenses', args: {} },
          { tool: 'cancel_expense', args: { expenseId: '' } },
          { tool: 'sensitive_payroll_details', args: {} },
        ],
      },
    ],
  },
  'sporting-goods': {
    tools: w('cancel_order return_order cancel_rental redeem_points close_support_ticket cancel_subscription remove_wishlist_item cancel_coaching_session list_payments list_addresses list_invoices list_support_tickets list_subscriptions list_wishlist list_promotions list_coaching_sessions list_store_credit list_gear list_rentals gear_order_status loyalty_balance extend_rental sensitive_membership_details gear_warranty_demo request_price_match transfer_membership browse_gear add_to_cart'),
    capture: { tool: 'list_gear', family: 'order', arg: 'orderId', hint: 'Run "Read gear orders" first to fill orderId.' },
    authorize: { toolName: 'extend_rental', txTypes: ['transfer'] },
    scenarios: [
      { id: 'read', label: 'Read gear orders (expect PERMIT)', expect: 'PERMIT', tool: 'list_gear', args: {} },
      sensitive('sensitive_membership_details'),
      // Seeded rental 3001 at $45/day: 12 days = $540.
      { id: 'approval', label: 'Extend rental (expect approval)', expect: 'APPROVAL', tool: 'extend_rental', args: { rentalId: '3001', days: 12, amount: 540 } },
      {
        id: 'chain',
        label: 'Run chain: gear orders → order status → sensitive',
        steps: [
          { tool: 'list_gear', args: {} },
          { tool: 'gear_order_status', args: { orderId: '' } },
          { tool: 'sensitive_membership_details', args: {} },
        ],
      },
    ],
  },
  university: {
    tools: w('cancel_course_registration waitlist_course accept_financial_aid pay_tuition_balance release_hold request_housing_assignment renew_parking_permit checkout_library_item apply_scholarship view_financial_aid view_billing view_holds view_degree_audit view_housing view_dining view_exam_schedule view_parking view_library view_scholarships view_advisors view_courses view_standing view_enrollment_history register_course release_transcript sensitive_student_finance'),
    capture: { tool: 'view_courses', family: 'course', arg: 'courseId', hint: 'Run "Read courses" first to fill courseId.' },
    authorize: { toolName: 'pay_tuition_balance', txTypes: ['transfer'] },
    scenarios: [
      { id: 'read', label: 'Read courses (expect PERMIT)', expect: 'PERMIT', tool: 'view_courses', args: {} },
      sensitive('sensitive_student_finance'),
      // Seeded bill 3002 (Technology Fee).
      { id: 'approval', label: 'Pay tuition (expect approval)', expect: 'APPROVAL', tool: 'pay_tuition_balance', args: { billId: '3002', amount: 250 } },
      {
        id: 'chain',
        label: 'Run chain: courses → waitlist → sensitive',
        steps: [
          { tool: 'view_courses', args: {} },
          { tool: 'waitlist_course', args: { courseId: '' } },
          { tool: 'sensitive_student_finance', args: {} },
        ],
      },
    ],
  },
};

export const DEFAULT_VERTICAL = 'banking';

/** Sample args for a tool in this vertical; a sample with an unfilled id does not count. */
export function argsFor(vertical, tool) {
  const calls = vertical.scenarios.flatMap((s) => s.steps ?? [s]);
  const hit = calls.find((c) => c.tool === tool && !Object.values(c.args).includes(''));
  return hit ? hit.args : {};
}

const OWNERS = new Map();
for (const [id, v] of Object.entries(INSPECTOR_VERTICALS)) {
  for (const t of v.tools) OWNERS.set(t, [...(OWNERS.get(t) ?? []), id]);
}

/** True when another vertical owns this tool and this one does not. Unowned tools show everywhere. */
export function belongsElsewhere(verticalId, tool) {
  const owners = OWNERS.get(tool);
  return !!owners && !owners.includes(verticalId);
}
