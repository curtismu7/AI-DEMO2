'use strict';
// One case-insensitive reading of ciba_login_enabled for the routes and the pi.flow driver, so 'TRUE'/'True'
// can never enable the routes while the driver silently skips parking.
const configStore = require('./configStore');

module.exports = () => String(configStore.getEffective('ciba_login_enabled')).toLowerCase() === 'true';
