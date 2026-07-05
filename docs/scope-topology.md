# Scope Topology (generated — do not edit by hand)

> Source of truth: `scope-topology.json`. Regenerate with `npm run scopes:doc`.

## Scopes

| Scope | Risk | Resource | Description |
|---|---|---|---|
| `read` | low | Super Banking API | Read accounts, balances, transactions |
| `write` | high | Super Banking API | Write operations (deposit/withdrawal/transfer) |
| `transfer` | high | Super Banking API | Execute fund transfers |
| `accounts:read` | low | Super Banking API | Read account information and balances |
| `transactions:read` | low | Super Banking API | Read transaction history and details |
| `mortgage:read` | low | Super Banking API | Read mortgage/feature-specific data (banking vertical) |
| `largepurchase:read` | low | Super Banking API | Read large purchase data (retail vertical) |
| `records:read` | low | Super Banking API | Read health record data (healthcare vertical) |
| `gear:read` | low | Super Banking API | Read gear order data (sporting-goods vertical) |
| `expense:read` | low | Super Banking API | Read expense report data (workforce vertical) |
| `permits:read` | low | Super Banking API | Read permit status data (government vertical) |
| `transcript:read` | low | Super Banking API | Read enrollment/transcript status data (university vertical) |
| `invest:read` | low | Super Banking API | Read investment accounts, balances, and portfolio summaries (A2A specialist scope) |
| `ai:agent:read` | medium | Super Banking API | Agent invocation permission |
| `mcp:invoke` | medium | Super Banking MCP Server | Invoke MCP tools via the gateway (RFC 8693 exchange) |
| `code:search` | low | Super Banking MCP Server | Search and read the indexed source code (read-only) |
| `agent:invoke` | medium | Super Banking Agent Gateway | Invoke the Agent Gateway (Two-Exchange Step 1 audience) |
| `ai_agent` | medium | Super Banking API | AI agent identity |
| `admin:read` | medium | Super Banking API | Read access to administrative data |
| `admin:write` | high | Super Banking API | Write access to administrative operations |
| `admin:delete` | critical | Super Banking API | Delete operations for administrative tasks |
| `users:read` | medium | Super Banking API | Read access to user management data |
| `users:manage` | high | Super Banking API | Full user management capabilities |
| `workorders:read` | low | Super Banking API | Read Work Order Status data (manufacturing vertical) |
| `sensitive:read` | high | Super Banking API | Read sensitive account details (full account/routing numbers) — requires user consent |

## Resources

### Super Banking API

Audience: `enduser.ping.demo`

Native scopes: `read`, `write`, `transfer`, `accounts:read`, `transactions:read`, `mortgage:read`, `largepurchase:read`, `records:read`, `gear:read`, `expense:read`, `permits:read`, `transcript:read`, `invest:read`, `ai:agent:read`, `ai_agent`, `admin:read`, `admin:write`, `admin:delete`, `users:read`, `users:manage`, `workorders:read`, `sensitive:read`

### Super Banking MCP Server

Audience: `mcpserver.ping.demo`

Native scopes: `mcp:invoke`, `code:search`

Mirrored scopes (RFC 8693 exchange-hop, ARCHITECTURE-TRUTHS T-10): `read`, `write`, `transfer`, `mortgage:read`, `largepurchase:read`, `records:read`, `gear:read`, `expense:read`, `permits:read`, `transcript:read`, `invest:read`, `ai:agent:read`, `admin:read`, `admin:write`, `admin:delete`, `users:read`, `users:manage`, `workorders:read`, `sensitive:read`

### Super Banking MCP Invest

Audience: `mcp-invest.ping.demo`

Native scopes: `mcp:invoke`

Mirrored scopes (RFC 8693 exchange-hop, ARCHITECTURE-TRUTHS T-10): `invest:read`, `read`

### Super Banking MCP Gateway

Audience: `mcpgateway.ping.demo`

Native scopes: `mcp:invoke`

Mirrored scopes (RFC 8693 exchange-hop, ARCHITECTURE-TRUTHS T-10): `read`, `write`, `transfer`, `mortgage:read`, `largepurchase:read`, `records:read`, `gear:read`, `expense:read`, `permits:read`, `transcript:read`, `invest:read`, `workorders:read`, `sensitive:read`, `code:search`

### Super Banking Agent Gateway

Audience: `agentgateway.ping.demo`

Native scopes: `agent:invoke`

Mirrored scopes (RFC 8693 exchange-hop, ARCHITECTURE-TRUTHS T-10): `read`, `write`, `transfer`, `mortgage:read`, `largepurchase:read`, `records:read`, `gear:read`, `expense:read`, `permits:read`, `transcript:read`, `invest:read`, `workorders:read`, `sensitive:read`, `code:search`

### Super Banking A2A Intermediate

Audience: `a2a-intermediate.ping.demo`

Native scopes: `agent:invoke`

## Servers

| Service | Resource | Validates aud | Gates on tool scopes | Notes |
|---|---|---|---|---|
| `demo_api_server` | Super Banking API | `enduser.ping.demo` | no | BFF / token custodian. Performs RFC 8693 two-exchange delegation (user token -> mcpgateway.ping.demo). |
| `demo_mcp_gateway` | Super Banking MCP Gateway | `mcpgateway.ping.demo` | yes | MCP Gateway. Validates inbound aud === mcpgateway.ping.demo and enforces per-tool requiredScopes (getScopesForGatewayTool) on the inbound bearer BEFORE credential swap. Therefore every gateway-surface tool scope MUST be mirrored onto the Super Banking MCP Gateway resource (ARCHITECTURE-TRUTHS T-10). |
| `demo_mcp_server` | Super Banking MCP Server | `mcpgateway.ping.demo` | yes | Backend MCP tool server. Gateway forwards the inbound bearer UNCHANGED (no re-exchange — see authorizeMcpRequest.ts Step 4 + GatewayTokenPolicy D-05), so the server validates aud === mcpgateway.ping.demo (MCP_SERVER_RESOURCE_URI), the same gateway-targeted audience. PingOne token exchange cannot issue a separate server aud alongside the gateway aud (returns invalid_scope: May not request scopes for multiple resources). |
| `demo_agent_service` | Super Banking Agent Gateway | `agentgateway.ping.demo` | no | Agent Gateway (Two-Exchange Step 1 audience for the AI Agent client-credentials token). |

## App Grants

### Super Banking User App

Type: `WEB_APP`  ·  Grants: `authorization_code`, `refresh_token`, `token_exchange`

Granted scopes: `ai:agent:read`, `read`, `write`, `transfer`, `mortgage:read`, `largepurchase:read`, `records:read`, `gear:read`, `expense:read`, `permits:read`, `transcript:read`, `workorders:read`, `invest:read`

### Super Banking Admin App

Type: `WEB_APP`  ·  Grants: `authorization_code`, `refresh_token`, `token_exchange`

Granted scopes: `read`, `write`, `transfer`, `accounts:read`, `transactions:read`, `mortgage:read`, `ai:agent:read`, `ai_agent`, `admin:read`, `admin:write`, `admin:delete`, `users:read`, `users:manage`

### Super Banking MCP Server

Type: `WEB_APP`  ·  Grants: `client_credentials`

Is resource server: `Super Banking MCP Server`

Granted scopes: — (none; resource-server or worker app)

### Super Banking MCP Gateway

Type: `WEB_APP`  ·  Grants: `client_credentials`, `token_exchange`

Is resource server: `Super Banking MCP Gateway`

Granted scopes: — (none; resource-server or worker app)

### Super Banking MCP Exchanger

Type: `WEB_APP`  ·  Grants: `token_exchange`

Granted scopes: `read`, `write`, `mcp:invoke`

### Super Banking AI Agent

Type: `WEB_APP`  ·  Grants: `client_credentials`, `token_exchange`

Granted scopes: `agent:invoke`

### Super Banking Investment Advisor Agent

Type: `WEB_APP`  ·  Grants: `client_credentials`, `token_exchange`

Granted scopes: `invest:read`

### Super Banking Records Specialist Agent

Type: `WEB_APP`  ·  Grants: `client_credentials`, `token_exchange`

Granted scopes: `read`

### Super Banking Purchase Specialist Agent

Type: `WEB_APP`  ·  Grants: `client_credentials`, `token_exchange`

Granted scopes: `read`

### Super Banking Membership Specialist Agent

Type: `WEB_APP`  ·  Grants: `client_credentials`, `token_exchange`

Granted scopes: `read`

### Super Banking Payroll Specialist Agent

Type: `WEB_APP`  ·  Grants: `client_credentials`, `token_exchange`

Granted scopes: `read`

### Super Banking Agent

Type: `WORKER`  ·  Grants: `client_credentials`

Granted scopes: — (none; resource-server or worker app)

### Super Banking Worker

Type: `WORKER`  ·  Grants: `client_credentials`

Granted scopes: — (none; resource-server or worker app)

## Tool → Scope Dependencies

| Tool | Surface | Required Scopes | Challenge |
|---|---|---|---|
| `code_search` | gateway | `code:search` | — |
| `get_code` | gateway | `code:search` | — |
| `list_codebases` | gateway | `code:search` | — |
| `get_my_accounts` | gateway | `read` | — |
| `get_account_balance` | gateway | `read` | — |
| `get_my_transactions` | gateway | `read` | — |
| `get_sensitive_account_details` | gateway | `read` `sensitive:read` | consent |
| `sequential_think` | gateway | `read` | — |
| `get_investment_balance` | gateway | `invest:read` | — |
| `get_investment_accounts` | gateway | `invest:read` | — |
| `get_investment_transactions` | gateway | `invest:read` | — |
| `get_portfolio_summary` | gateway | `invest:read` | — |
| `show_mortgage` | gateway | `mortgage:read` | — |
| `show_investment` | gateway | `invest:read` | — |
| `show_large_purchase` | gateway | `largepurchase:read` | — |
| `show_health_record` | gateway | `records:read` | — |
| `show_gear_order` | gateway | `gear:read` | — |
| `show_expense_report` | gateway | `expense:read` | — |
| `show_permit` | gateway | `permits:read` | — |
| `show_enrollment` | gateway | `transcript:read` | — |
| `create_deposit` | gateway | `write` | step_up |
| `create_withdrawal` | gateway | `write` | step_up |
| `create_transfer` | gateway | `write` `transfer` | consent |
| `update_contact_email` | gateway | `write` | — |
| `request_fee_waiver` | gateway | `write` | — |
| `view_benefits` | gateway | `read` | — |
| `pto_balance` | gateway | `read` | — |
| `list_expenses` | gateway | `read` | — |
| `submit_expense` | gateway | `write` | step_up |
| `request_time_off` | gateway | `write` | consent |
| `view_records` | gateway | `read` | — |
| `view_coverage` | gateway | `read` | — |
| `list_appointments` | gateway | `read` | — |
| `book_appointment` | gateway | `write` | consent |
| `release_records` | gateway | `write` | step_up |
| `list_orders` | gateway | `read` | — |
| `order_status` | gateway | `read` | — |
| `rewards_balance` | gateway | `read` | — |
| `checkout` | gateway | `write` | consent |
| `list_gear` | gateway | `read` | — |
| `list_rentals` | gateway | `read` | — |
| `gear_order_status` | gateway | `read` | — |
| `loyalty_balance` | gateway | `read` | — |
| `extend_rental` | gateway | `write` | consent |
| `sensitive_patient_records` | gateway | `read` | consent |
| `sensitive_order_history` | gateway | `read` | consent |
| `sensitive_membership_details` | gateway | `read` | consent |
| `sensitive_payroll_details` | gateway | `read` | consent |
| `query_user_by_email` | exchange-only | `ai_agent` | — |
| `admin_list_all_users` | exchange-only | `admin:read` `users:read` | — |
| `admin_get_user_details` | exchange-only | `admin:read` `users:read` | — |
| `admin_delete_user` | exchange-only | `admin:write` `admin:delete` `users:manage` | — |
| `admin_manage_accounts` | exchange-only | `admin:write` `users:manage` | — |
| `admin_view_audit_logs` | exchange-only | `admin:read` | — |
| `admin_system_status` | exchange-only | `admin:read` | — |
| `lookup_customer` | exchange-only | `admin:read` `users:read` | — |
| `get_customer_profile` | exchange-only | `admin:read` `users:read` | — |
| `get_customer_accounts` | exchange-only | `admin:read` `users:read` | — |
| `get_customer_transactions` | exchange-only | `admin:read` `users:read` | — |
| `freeze_account` | exchange-only | `admin:write` `users:manage` | — |
| `reset_customer_password` | exchange-only | `admin:write` `users:manage` | — |
| `adjust_balance` | exchange-only | `admin:write` `users:manage` | — |
| `delete_customer` | exchange-only | `admin:write` `admin:delete` `users:manage` | — |
| `list_accounts` | legacy-alias | `read` | — |
| `list_transactions` | legacy-alias | `read` | — |
| `transfer` | legacy-alias | `write` | — |
| `deposit` | legacy-alias | `write` | — |
| `withdraw` | legacy-alias | `write` | — |
| `discover_oas_operations` | gateway | `read` | — |
| `call_pingone_operation` | gateway | `read` | — |
| `api_key_demo` | gateway | `read` | — |
| `dual_token_demo` | gateway | `read` | — |
| `show_work_order` | gateway | `workorders:read` | — |
| `cancel_appointment` | gateway | `write` | — |
| `cancel_order` | gateway | `write` | — |
| `close_support_ticket` | gateway | `write` | — |
| `view_billing` | gateway | `read` | — |
| `view_documents` | gateway | `read` | — |
| `approve_inspection` | gateway | `write` | — |
| `cancel_permit` | gateway | `write` | — |
| `close_violation` | gateway | `write` | — |
| `dispute_violation` | gateway | `write` | — |
| `pay_fee` | gateway | `write` | — |
| `release_record` | gateway | `write` | step_up |
| `renew_permit` | gateway | `write` | — |
| `reschedule_gov_appointment` | gateway | `write` | — |
| `schedule_inspection` | gateway | `write` | — |
| `submit_filing` | gateway | `write` | — |
| `view_appointments` | gateway | `read` | — |
| `view_business_licenses` | gateway | `read` | — |
| `view_complaints` | gateway | `read` | — |
| `view_fees` | gateway | `read` | — |
| `view_filings` | gateway | `read` | — |
| `view_inspections` | gateway | `read` | — |
| `view_notifications` | gateway | `read` | — |
| `view_payment_history` | gateway | `read` | — |
| `view_permits` | gateway | `read` | — |
| `view_records_requests` | gateway | `read` | — |
| `view_tax_assessments` | gateway | `read` | — |
| `view_violations` | gateway | `read` | — |
| `view_zoning_info` | gateway | `read` | — |
| `cancel_referral` | gateway | `write` | — |
| `list_messages` | gateway | `read` | — |
| `mark_message_read` | gateway | `write` | — |
| `pay_bill` | gateway | `write` | — |
| `refill_prescription` | gateway | `write` | — |
| `request_document` | gateway | `write` | — |
| `reschedule_appointment` | gateway | `write` | — |
| `view_allergies` | gateway | `read` | — |
| `view_care_plan` | gateway | `read` | — |
| `view_care_team` | gateway | `read` | — |
| `view_claims` | gateway | `read` | — |
| `view_dependents` | gateway | `read` | — |
| `view_immunizations` | gateway | `read` | — |
| `view_lab_results` | gateway | `read` | — |
| `view_medications` | gateway | `read` | — |
| `view_referrals` | gateway | `read` | — |
| `view_vitals` | gateway | `read` | — |
| `approve_purchase_order` | gateway | `write` | — |
| `close_maintenance_ticket` | gateway | `write` | — |
| `complete_quality_inspection` | gateway | `write` | — |
| `escalate_maintenance_ticket` | gateway | `write` | — |
| `expedite_shipment` | gateway | `write` | — |
| `flag_defect` | gateway | `write` | — |
| `put_machine_offline` | gateway | `write` | — |
| `receive_shipment` | gateway | `write` | — |
| `reject_purchase_order` | gateway | `write` | — |
| `release_work_order` | gateway | `write` | step_up |
| `reopen_defect` | gateway | `write` | — |
| `schedule_run` | gateway | `write` | — |
| `view_defects` | gateway | `read` | — |
| `view_inventory` | gateway | `read` | — |
| `view_machine_utilization` | gateway | `read` | — |
| `view_machines` | gateway | `read` | — |
| `view_maintenance_tickets` | gateway | `read` | — |
| `view_production_history` | gateway | `read` | — |
| `view_purchase_orders` | gateway | `read` | — |
| `view_quality_inspections` | gateway | `read` | — |
| `view_scrap_report` | gateway | `read` | — |
| `view_shipments` | gateway | `read` | — |
| `view_supplier_scorecard` | gateway | `read` | — |
| `view_work_orders` | gateway | `read` | — |
| `void_purchase_order` | gateway | `write` | — |
| `add_to_wishlist` | gateway | `write` | — |
| `initiate_return` | gateway | `write` | — |
| `pause_subscription` | gateway | `write` | — |
| `redeem_store_credit` | gateway | `write` | — |
| `remove_payment_method` | gateway | `write` | — |
| `remove_price_alert` | gateway | `write` | — |
| `reorder` | gateway | `write` | — |
| `view_addresses` | gateway | `read` | — |
| `view_gift_cards` | gateway | `read` | — |
| `view_payment_methods` | gateway | `read` | — |
| `view_price_alerts` | gateway | `read` | — |
| `view_recently_viewed` | gateway | `read` | — |
| `view_returns` | gateway | `read` | — |
| `view_subscriptions` | gateway | `read` | — |
| `view_support_tickets` | gateway | `read` | — |
| `view_wishlist` | gateway | `read` | — |
| `cancel_coaching_session` | gateway | `write` | — |
| `cancel_rental` | gateway | `write` | — |
| `cancel_subscription` | gateway | `write` | — |
| `list_addresses` | gateway | `read` | — |
| `list_coaching_sessions` | gateway | `read` | — |
| `list_invoices` | gateway | `read` | — |
| `list_payments` | gateway | `read` | — |
| `list_promotions` | gateway | `read` | — |
| `list_store_credit` | gateway | `read` | — |
| `list_subscriptions` | gateway | `read` | — |
| `list_support_tickets` | gateway | `read` | — |
| `list_wishlist` | gateway | `read` | — |
| `redeem_points` | gateway | `write` | — |
| `remove_wishlist_item` | gateway | `write` | — |
| `return_order` | gateway | `write` | — |
| `accept_financial_aid` | gateway | `write` | — |
| `apply_scholarship` | gateway | `write` | — |
| `cancel_course_registration` | gateway | `write` | — |
| `checkout_library_item` | gateway | `write` | — |
| `pay_tuition_balance` | gateway | `write` | — |
| `register_course` | gateway | `write` | — |
| `release_hold` | gateway | `write` | — |
| `release_transcript` | gateway | `write` | step_up |
| `renew_parking_permit` | gateway | `write` | — |
| `request_housing_assignment` | gateway | `write` | — |
| `view_advisors` | gateway | `read` | — |
| `view_courses` | gateway | `read` | — |
| `view_degree_audit` | gateway | `read` | — |
| `view_dining` | gateway | `read` | — |
| `view_enrollment_history` | gateway | `read` | — |
| `view_exam_schedule` | gateway | `read` | — |
| `view_financial_aid` | gateway | `read` | — |
| `view_holds` | gateway | `read` | — |
| `view_housing` | gateway | `read` | — |
| `view_library` | gateway | `read` | — |
| `view_parking` | gateway | `read` | — |
| `view_scholarships` | gateway | `read` | — |
| `view_standing` | gateway | `read` | — |
| `waitlist_course` | gateway | `write` | — |
| `cancel_expense` | gateway | `write` | — |
| `close_ticket` | gateway | `write` | — |
| `complete_goal` | gateway | `write` | — |
| `enroll_training` | gateway | `write` | — |
| `request_schedule_change` | gateway | `write` | — |
| `update_goal_progress` | gateway | `write` | — |
| `view_announcements` | gateway | `read` | — |
| `view_colleagues` | gateway | `read` | — |
| `view_direct_deposit` | gateway | `read` | — |
| `view_goals` | gateway | `read` | — |
| `view_payslip_detail` | gateway | `read` | — |
| `view_payslips` | gateway | `read` | — |
| `view_policies` | gateway | `read` | — |
| `view_schedule` | gateway | `read` | — |
| `view_tickets` | gateway | `read` | — |
| `view_trainings` | gateway | `read` | — |
| `withdraw_training_enrollment` | gateway | `write` | — |
| `buy_security` | gateway | `write` | — |
| `large_trade` | gateway | `write` | step_up |
| `rebalance_portfolio` | gateway | `write` | — |
| `sell_security` | gateway | `write` | — |
| `view_dividends` | gateway | `read` | — |
| `view_holdings` | gateway | `read` | — |
| `view_portfolio_value` | gateway | `read` | — |
| `view_portfolios` | gateway | `read` | — |
| `view_trades` | gateway | `read` | — |
