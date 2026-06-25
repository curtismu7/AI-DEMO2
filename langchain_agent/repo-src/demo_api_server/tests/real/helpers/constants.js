'use strict';

const https = require('https');

const BFF_BASE   = 'https://api.ping.demo:3001';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

module.exports = { BFF_BASE, httpsAgent };
