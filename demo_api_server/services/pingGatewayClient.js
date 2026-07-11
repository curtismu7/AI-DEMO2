'use strict';
const http = require('http');
const https = require('https');
const { URL } = require('url');

function callPingGateway(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const gwUrl = process.env.PINGGATEWAY_URL || 'https://localhost:3036';
    const url = new URL(path, gwUrl);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const opts = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(JSON.stringify(body)) } : {}),
      },
      timeout: 10000,
      ...(isHttps && process.env.NODE_ENV !== 'production' ? { rejectUnauthorized: false } : {}),
    };

    const req = transport.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
        } catch {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

module.exports = { callPingGateway };
