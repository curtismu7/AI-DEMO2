'use strict';
/**
 * envReconcile — classification + boot verdict for PingOne env-id self-heal.
 * Pure logic: classification of keys as env-scoped or agnostic, and verdict
 * computation. No side effects (LMDB, process mutations, or I/O). See
 * docs/superpowers/specs/2026-06-19-config-env-id-self-heal-design.md.
 */

const ENV_STAMP_KEY = '__SEEDED_ENV_ID__';

function normalizeKey(key) {
  return String(key == null ? '' : key).trim().toLowerCase();
}

// Keys whose value would be WRONG if the PingOne env_id changed -> purge + reseed from .env.
// Canonical lowercase. Spans FIELD_DEFS keys, envFallbackMap canonical keys, and Vault names.
const ENV_SCOPED_KEYS = new Set([
  // environment
  'pingone_environment_id', 'pingone_region', 'pingone_base_url',
  'pingone_root_domain', 'pingone_mcp_environment_id',
  // admin / user / management apps
  'pingone_admin_client_id', 'pingone_admin_client_secret', 'pingone_admin_redirect_uri',
  'admin_client_id',
  'pingone_user_client_id', 'pingone_user_client_secret', 'pingone_user_redirect_uri',
  'user_client_id',
  // SDK centralized-login demo (public PKCE SPA client) — id + redirect URI are PingOne-app-specific
  'pingone_sdk_demo_client_id', 'pingone_sdk_demo_redirect_uri',
  'pingone_management_client_id', 'pingone_management_client_secret',
  'pingone_mgmt_client_id', 'pingone_mgmt_client_secret',
  'pingone_worker_client_id', 'pingone_worker_token_client_id', 'pingone_worker_token_client_secret',
  'pingone_authorization_code_client_id',
  // authorize
  'pingone_authorize_worker_client_id', 'pingone_authorize_worker_client_secret',
  'pingone_authorize_decision_endpoint_id', 'pingone_authorize_mcp_decision_endpoint_id',
  'pingone_authorize_policy_id', 'authorize_decision_endpoint_id', 'authorize_mcp_decision_endpoint_id',
  'pingauthorize_endpoint', 'pingauthorize_worker_id',
  // ai agent / mcp exchanger / mcp gateway
  'pingone_ai_agent_client_id', 'pingone_ai_agent_client_secret',
  'pingone_ai_agent_actor_client_id', 'pingone_ai_agent_actor_client_secret',
  'pingone_mcp_token_exchanger_client_id', 'pingone_mcp_token_exchanger_client_secret',
  'pingone_token_exchanger_client_id', 'pingone_token_exchanger_client_secret',
  'pingone_mcp_gateway_client_id', 'pingone_mcp_gateway_client_secret',
  'mcp_gw_client_id', 'mcp_gw_client_secret',
  'gw_introspection_client_id', 'gw_introspection_client_secret',
  // a2a specialists (FIELD_DEFS uses pingone_a2a_ prefix)
  'pingone_a2a_investment_agent_client_id', 'pingone_a2a_investment_agent_client_secret',
  'pingone_a2a_records_agent_client_id', 'pingone_a2a_records_agent_client_secret',
  'pingone_a2a_purchase_agent_client_id', 'pingone_a2a_purchase_agent_client_secret',
  'pingone_a2a_membership_agent_client_id', 'pingone_a2a_membership_agent_client_secret',
  'pingone_a2a_payroll_agent_client_id', 'pingone_a2a_payroll_agent_client_secret',
  // a2a specialist aliases (without pingone_a2a_ prefix, used in brief)
  'pingone_investment_agent_client_id', 'pingone_investment_agent_client_secret',
  'pingone_records_agent_client_id', 'pingone_records_agent_client_secret',
  'pingone_purchase_agent_client_id', 'pingone_purchase_agent_client_secret',
  'pingone_membership_agent_client_id', 'pingone_membership_agent_client_secret',
  'pingone_payroll_agent_client_id', 'pingone_payroll_agent_client_secret',
  // copilot (copilot_agent_client_id/secret — copilot Studio auth to PingOne, env-specific)
  'copilot_agent_client_id', 'copilot_agent_client_secret',
  // resource/audience URIs (env-scoped resource servers)
  'pingone_resource_mcp_server_uri', 'mcp_resource_uri', 'pingone_resource_mcp_gateway_uri',
  'pingone_resource_agent_gateway_uri', 'agent_gateway_audience', 'ai_agent_intermediate_audience',
  'pingone_resource_two_exchange_uri', 'pingone_resource_pinggateway_uri',
  'pingone_resource_a2a_intermediate_uri', 'a2a_intermediate_audience',
  'pingone_resource_langchain_agent_uri', 'mcp_gw_resource_uri',
  'enduser_audience', 'ai_agent_audience', 'banking_api_resource_uri',
  // introspection + oauth endpoints (embed the env id)
  'pingone_introspection_endpoint', 'pingone_introspection_client_id', 'pingone_introspection_client_secret',
  'oauth_authorization_endpoint', 'oauth_token_endpoint', 'oauth_userinfo_endpoint',
  'oauth_jwks_uri', 'oauth_issuer', 'oauth_discovery_endpoint',
  // per-env identity data
  'admin_population_id', 'pingone_mfa_policy_id',
  // private_key_jwt credentials for BFF admin client (tied to the PingOne app's JWK config)
  'pingone_client_jwt_private_key', 'pingone_client_jwt_kid',
  // private_key_jwt credentials for the dedicated token-exchange app (also PingOne-env-specific)
  'pingone_private_key_jwt_exchanger_client_id',
  'pingone_private_key_jwt_exchanger_private_key', 'pingone_private_key_jwt_exchanger_kid',
]);

// Keys that SURVIVE an env change (flags, thresholds, UI, deployment topology, internal secrets,
// behavioral config, Helix). Populate the rest of the current FIELD_DEFS/vault keys here against
// the completeness guard (Step 5). Start with the known-stable set:
const ENV_AGNOSTIC_KEYS = new Set([
  // helix (separate environment from the PingOne env_id)
  'helix_base_url', 'helix_api_key', 'helix_environment_id', 'helix_agent_id', 'helix_prompt_field_id',
  // deployment topology URLs
  'mcp_server_url', 'mcp_gateway_http_url', 'mcp_pinggateway_url', 'mcp_demo_gateway_url', 'mcp_step9_resource_uri',
  'frontend_url', 'frontend_admin_url', 'react_app_client_url', 'public_app_url', 'frontend_dashboard_url',
  'mcp_olb_ws_url', 'mcp_invest_ws_url', 'upstream_mcp_url',
  // pingone_mcp_server_url is an alias for mcp_server_url — deployment URL, not env identity
  'pingone_mcp_server_url',
  // internal shared secrets + session
  'session_secret', 'bff_internal_secret', 'hitl_internal_secret',
  // pingone_session_secret is an alias for session_secret
  'pingone_session_secret',
  // behavioral / provider config
  'llm_framework', 'agent_mode', 'agent_external_wiring', 'agent_history_limit',
  'lmstudio_base_url', 'lmstudio_model', 'anthropic_api_key', 'google_api_key',
  'ai_agent_token_endpoint_auth_method', 'mcp_exchanger_token_endpoint_auth_method',
  'pingone_token_exchange_auth_method', 'pingone_mcp_token_exchanger_cc_auth_method',
  'pingone_admin_token_endpoint_auth_method', 'pingone_mgmt_token_auth_method',
  'pingone_worker_token_auth_method', 'pingone_introspection_auth_method', 'mcp_gw_token_endpoint_auth_method',
  // introspection provider selection (p1az vs pingone) — a behaviour choice, not env identity
  'introspectionprovider',
  // thresholds / step-up
  'confirm_threshold_usd', 'mfa_threshold_usd', 'step_up_amount_threshold',
  'step_up_method', 'step_up_acr_value',
  // HITL consent challenge UX mode ('onetime' | 'multi') — behaviour, not env identity
  'hitl_consent_mfa_mode',
  'max_transaction_amount',
  // rfc 8707 single-resource scopes (provisioner-aligned scope names, not env identity)
  'agent_gateway_cc_scope', 'mcp_gateway_cc_scope', 'two_exchange_intermediate_scope',
  'gateway_mcp_invoke_scope', 'pinggateway_invoke_scope', 'a2a_intermediate_scope', 'a2a_invest_scope',
  'mcp_token_exchange_scopes', 'agent_mcp_allowed_scopes', 'ai_agent_scope',
  'pingone_mcp_token_exchanger_client_scopes',
  // SDK centralized-login demo scope string (not env identity)
  'pingone_sdk_demo_scope',
  // role mapping / marketing / demo
  'admin_role', 'user_role', 'admin_username', 'admin_role_claim', 'pingone_admin_role_claim',
  'marketing_customer_login_mode', 'marketing_demo_username_hint', 'marketing_demo_password_hint',
  'demo_username', 'demo_password', 'demo_admin_username', 'demo_admin_password', 'demo_accounts',
  'demo_apikey_backend_service_key', 'demo_mortgage_service_key', 'demo_invest_service_key',
  'enterprise_mcp_allowed_groups', 'enterprise_mcp_resource_uris',
  'default_user_type',
  // oauth behavior / callbacks (deployment, not env identity)
  'oauth_admin_callback_path', 'oauth_user_callback_path', 'oauth_discovery_enabled',
  'oauth_role_claim_name', 'oauth_role_claim_value_admin', 'oauth_role_claim_value_customer',
  'oauth_role_claim_is_array',
  // pi.flow / misc behavior
  'admin_pingone_authorize_pi_flow', 'user_pingone_authorize_pi_flow',
  // pingone-prefixed behavioral aliases in FIELD_DEFS
  'pingone_admin_authorize_pi_flow', 'pingone_user_authorize_pi_flow',
  'pingone_authorize_enabled',
  'debug_oauth', 'pingone_debug_oauth', 'debug_scopes', 'debug_tokens',
  'skip_token_signature_validation', 'strict_scope_validation', 'scope_validation_timeout',
  'cache_token_validation', 'token_cache_ttl', 'jwks_requests_per_minute', 'jwks_cache_max_age',
  'use_agent_actor_for_mcp', 'token_exchange_auto_fallback', 'token_exchange_log_mode_switches',
  'mcp_use_legacy_protocol', 'mcp_gw_passthrough_to_mcp_server', 'gateway_health_probe_insecure',
  'mcp_gateway_reject_unauthorized', 'pingone_validate_on_startup', 'mcp_gw_p1az_enabled',
  // enterprise-managed MCP auth policy (Phase 2 demo — group/resource allowlists, not env identity)
  'enterprise_mcp_allowed_groups', 'enterprise_mcp_resource_uris',
  // ciba
  'ciba_enabled', 'ciba_token_delivery_mode', 'ciba_binding_message',
  'ciba_poll_interval_ms', 'ciba_auth_request_expiry',
  // ciba notification endpoint — typically a local/deploy-topology URL, not PingOne env identity
  'ciba_notification_endpoint',
  // intent
  'ff_intent_authorization_enabled', 'intent_min_confidence', 'intent_requires_consent',
  'intent_max_amount_low_confidence', 'ff_intent_token_enabled',
  // observability / misc
  'posthog_api_key', 'posthog_host', 'ping_email', 'port', 'admin_token_lifetime',
  'admin_refresh_token_lifetime',
  // UI / demo experience keys
  'show_education_panel', 'enable_token_chain_display', 'agent_ui_mode',
  'demo_scenario', 'industry_id', 'demo_account_count', 'transaction_preset',
  'max_token_chain_history', 'agent_transaction_count_limit', 'agent_transaction_value_limit',
  'active_vertical', 'ui_industry_preset',
  // simulated authorize thresholds (demo/sim config, not env identity)
  'simulated_authorize_confirm_amount', 'simulated_authorize_deny_amount',
  'simulated_authorize_stepup_amount', 'simulated_mcp_deny_tools', 'simulated_mcp_hitl_tools',
  // authorize mode / failover behavioral flags
  'authorize_failover_mode', 'authorize_mode',
  // RFC 8693 behavioral flags
  'enablemayactsupport',
  // server debug/logging
  'log_level', 'debug_show_token_details', 'debug_show_api_calls', 'log_filter_categories',
  // routing / MCP inspector flags (feature/behavior, not env identity)
  'mcp_use_pingone_server', 'mcp_inspector_pingone_live',
  // step-up feature flag
  'step_up_enabled',
  // copilot configuration (Microsoft Entra / Copilot Studio, not PingOne env identity)
  'copilot_mode_enabled', 'copilot_entra_client_id', 'copilot_entra_tenant_id',
  'copilot_environment_id', 'copilot_agent_schema_name',
  // PingOne Recognize (separate Recognize service, not tied to PingOne env_id)
  'recognize_api_key', 'recognize_tenant_name',
  // NOTE: all ff_* feature-flag ids are env-agnostic (not listed above). isEnvScoped
  // only does a Set lookup; the completeness guard treats ff_* as agnostic. Flags
  // return false from isEnvScoped (not in ENV_SCOPED_KEYS), so they never purge.
]);

// Pure infra / bootstrap keys that are neither env-scoped config nor user settings.
const IGNORED_KEYS = new Set([
  'vault_password', 'vault_path', normalizeKey(ENV_STAMP_KEY),
  'node_env', 'activity_log_file',
]);

function isEnvScoped(key) {
  const k = normalizeKey(key);
  return ENV_SCOPED_KEYS.has(k);
}

function computeVerdict({ currentEnvId, stampEnvId, hasEnvScopedRows }) {
  const cur = String(currentEnvId || '').trim();
  if (!cur) return 'skip-warn';
  const stamp = String(stampEnvId || '').trim();
  if (stamp && stamp === cur) return 'noop';
  if (!stamp && !hasEnvScopedRows) return 'stamp-only';
  return 'reconcile';
}

function buildRecord({ verdict, fromEnvId, toEnvId, purgedKeys, vaultDropped, now }) {
  return {
    verdict,
    fromEnvId: fromEnvId || null,
    toEnvId: toEnvId || null,
    purgedKeys: Array.isArray(purgedKeys) ? purgedKeys.slice() : [],
    vaultDropped: Array.isArray(vaultDropped) ? vaultDropped.slice() : [],
    at: now,
  };
}

function emitRecord(record) {
  if (!record) return;
  const { verdict, fromEnvId, toEnvId, purgedKeys, vaultDropped } = record;
  // Prominent startup banner (names only — never values).
  if (verdict === 'reconcile') {
    const line = '='.repeat(72);
    const body = [
      line,
      '[env-reconcile] PingOne environment change detected at boot',
      `  verdict : ${verdict}`,
      `  env_id  : ${fromEnvId || '(none)'} -> ${toEnvId || '(none)'}`,
      `  purged  : ${purgedKeys.length ? purgedKeys.join(', ') : '(none)'}`,
      `  vault   : ${vaultDropped.length ? vaultDropped.join(', ') : '(none)'}`,
      line,
    ].join('\n');
    console.warn(body);
  } else if (verdict === 'skip-warn') {
    console.warn('[env-reconcile] PINGONE_ENVIRONMENT_ID is empty — skipping reconcile (no purge).');
  }
  // Durable audit (lazy require avoids a circular import with configStore).
  try {
    const appEventService = require('./appEventService');
    const auditMsg = verdict === 'reconcile'
      ? `env-id change reconciled (${purgedKeys.length} keys purged)`
      : `env-id reconcile skipped (PINGONE_ENVIRONMENT_ID empty)`;
    appEventService.logEvent('config', 'warn', auditMsg,
      { tag: 'config/env-reconcile', metadata: { verdict, fromEnvId, toEnvId,
        purgedCount: purgedKeys.length, vaultDroppedCount: vaultDropped.length,
        purgedKeys, vaultDropped } });
  } catch (_) { /* audit is best-effort */ }
}

module.exports = {
  ENV_STAMP_KEY, ENV_SCOPED_KEYS, ENV_AGNOSTIC_KEYS, IGNORED_KEYS,
  normalizeKey, isEnvScoped, computeVerdict, buildRecord, emitRecord,
};
