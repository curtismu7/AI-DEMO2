'use strict';

const https = require('https');

// PREFLIGHT_BFF_BASE lets scripts/preflight-signin.js point at a port-forward to the cluster BFF.
const BFF_BASE   = process.env.PREFLIGHT_BFF_BASE || 'https://api.ping.demo:3001';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

module.exports = { BFF_BASE, httpsAgent };
