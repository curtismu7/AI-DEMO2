'use strict';
// Requiring each check file runs its register(...) call. Order = display order.
require('./serversCheck');
require('./authorizeCheck');
require('./configCheck');
require('./flagOverrideCheck');
require('./llmCheck');
require('./llmDeepCheck');
require('./gatewayCheck');
require('./gatewayPostureCheck');
// Follows the RFC 9728 resource_metadata pointer the gateway's 401 challenge
// advertises — the PG_GATEWAY_RESOURCE_ID dual-role failure was silent for
// months precisely because nobody dereferenced it (TECH_DEBT 2026-08-17).
require('./gatewayMetadataCheck');
// Proves the intent-token HMAC key is identical on the BFF and BOTH gateways.
// It was not, for weeks, in two different ways at once — and nothing surfaced it
// because the PDP records IntentTokenValid=false and PERMITs anyway
// (TECH_DEBT 2026-08-26).
require('./intentTokenKeyCheck');
require('./usecaseCheck');
require('./uiDispatchCheck');
// Offline half of the A2A delegation guarantee: catches a specialist that is
// provisioned but not a registered actor in the policy, which denies a CORRECT
// two-hop chain and reads on the ProofStrip as the control working.
require('./a2aActorCheck');
require('./containerDriftCheck');
module.exports = require('./registry');
