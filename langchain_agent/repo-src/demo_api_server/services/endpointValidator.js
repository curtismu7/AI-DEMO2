const axios = require('axios');

const ENDPOINTS = {
  tokenEndpoint: {
    name: 'Token Exchange (RFC 8693)',
    get url() { return process.env.OAUTH_TOKEN_ENDPOINT || ''; },
    test: async (url) => {
      const res = await axios.post(url, 'grant_type=test', {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 5000,
        validateStatus: () => true,
      });
      return res.status < 500;
    },
  },
  authorizationEndpoint: {
    name: 'Authorization Endpoint',
    get url() { return process.env.OAUTH_AUTHORIZATION_ENDPOINT || ''; },
    test: async (url) => {
      const res = await axios.get(url, { timeout: 5000, validateStatus: () => true });
      return res.status < 500;
    },
  },
  jwksEndpoint: {
    name: 'JWKS Endpoint',
    get url() { return process.env.OAUTH_JWKS_URI || ''; },
    test: async (url) => {
      const res = await axios.get(url, { timeout: 5000, validateStatus: () => true });
      return res.status < 500;
    },
  },
};

async function validateEndpoints() {
  const results = {};
  const errors = [];

  for (const [key, endpoint] of Object.entries(ENDPOINTS)) {
    if (!endpoint.url) {
      results[key] = { status: 'unconfigured', url: null };
      continue;
    }

    try {
      const healthy = await endpoint.test(endpoint.url);
      results[key] = {
        status: healthy ? 'healthy' : 'unhealthy',
        url: endpoint.url,
        error: healthy ? null : 'Server returned 5xx error',
      };
      if (!healthy) errors.push(`${endpoint.name}: server unhealthy`);
    } catch (err) {
      results[key] = {
        status: 'unreachable',
        url: endpoint.url,
        error: err.message,
      };
      errors.push(`${endpoint.name}: ${err.message}`);
    }
  }

  return { results, errors };
}

module.exports = { validateEndpoints };
