'use strict';
// Assembled list of check descriptors. Each check file pushes its descriptors
// here at require time. checkService requires this module once at startup.
const ALL_CHECKS = [];
function register(...descriptors) { ALL_CHECKS.push(...descriptors); }
module.exports = { ALL_CHECKS, register };
