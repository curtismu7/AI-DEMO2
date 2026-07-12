'use strict';
const axios = require('axios');
const { register } = require('./registry');

const PROXY = (process.env.LLAMACPP_BASE_URL || 'http://127.0.0.1:8090').replace(/\/+$/, '');

const status = {
  id: 'llm.status', name: 'LLM models', category: 'LLM',
  async run() {
    let models;
    try {
      const { data } = await axios.get(`${PROXY}/status`, { timeout: 3000 });
      models = Array.isArray(data.models) ? data.models : [];
    } catch (err) {
      return { status: 'fail', detail: `LLM proxy unreachable: ${err.message}` };
    }
    const healthy = models.filter((m) => m.healthy).length;
    if (!models.length) return { status: 'warn', detail: 'Proxy responded with no models', meta: { models } };
    return {
      status: healthy ? 'pass' : 'warn',
      detail: `${healthy}/${models.length} model(s) loaded/healthy`,
      meta: { models },
    };
  },
};

register(status);
module.exports = { status };
