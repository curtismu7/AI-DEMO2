'use strict';
// Requiring each check file runs its register(...) call. Order = display order.
require('./serversCheck');
require('./authorizeCheck');
require('./configCheck');
require('./llmCheck');
require('./gatewayCheck');
module.exports = require('./registry');
