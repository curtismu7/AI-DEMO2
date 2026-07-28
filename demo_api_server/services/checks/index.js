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
require('./usecaseCheck');
require('./uiDispatchCheck');
// Offline half of the A2A delegation guarantee: catches a specialist that is
// provisioned but not a registered actor in the policy, which denies a CORRECT
// two-hop chain and reads on the ProofStrip as the control working.
require('./a2aActorCheck');
require('./containerDriftCheck');
module.exports = require('./registry');
