'use strict';
const configStore = require('../../services/configStore');
const { register } = require('./registry');

const prereqs = {
  id: 'config.prereqs', name: 'Config & secrets for current flags', category: 'Config / Secrets',
  severity: 'blocking',
  async run({ flags }) {
    const missing = [];
    const needStore = (key) => { if (!configStore.getEffective(key)) missing.push(key); };
    const needEnv = (key) => { if (!process.env[key]) missing.push(key); };

    if (flags.ff_authorize_real === true) {
      needStore('authorize_worker_client_id');
      needStore('authorize_decision_endpoint_id');
    }
    if (!flags.ff_authorize_real && flags.ff_mcp_gateway_pinggateway && flags.ff_mcp_gateway_jwks) {
      needEnv('AUTHZ_JWT_SECRET');
    }
    return missing.length
      ? { status: 'fail', detail: `Missing: ${missing.join(', ')}`, meta: { missing } }
      : { status: 'pass', detail: 'All required config present', meta: { missing: [] } };
  },
};

register(prereqs);
module.exports = { prereqs };
