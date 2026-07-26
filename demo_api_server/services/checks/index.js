'use strict';
// Requiring each check file runs its register(...) call. Order = display order.
require('./serversCheck');
require('./authorizeCheck');
require('./configCheck');
require('./flagOverrideCheck');
require('./llmCheck');
require('./llmDeepCheck');
require('./gatewayCheck');
require('./usecaseCheck');
module.exports = require('./registry');
