'use strict';
const axios = require('axios');
const { register } = require('./registry');

const PROXY = (process.env.LLAMACPP_BASE_URL || 'http://127.0.0.1:8090').replace(/\/+$/, '');
const PER_MODEL_TIMEOUT = 180000;

const deep = {
  id: 'llm.deep', name: 'Deep LLM test (all models)', category: 'LLM', heavy: true,
  async run() {
    let models;
    try {
      const { data } = await axios.get(`${PROXY}/status`, { timeout: 3000 });
      models = Array.isArray(data.models) ? data.models : [];
    } catch (err) {
      return { status: 'fail', detail: `LLM proxy unreachable: ${err.message}` };
    }
    if (!models.length) return { status: 'fail', detail: 'Proxy reported no models' };

    const results = [];
    for (const m of models) {
      try {
        const { data } = await axios.post(`${PROXY}/v1/chat/completions`,
          { model: m.name, messages: [{ role: 'user', content: 'reply READY' }], max_tokens: 8 },
          { timeout: PER_MODEL_TIMEOUT });
        const content = data?.choices?.[0]?.message?.content;
        results.push({ name: m.name, ok: !!(content && content.trim()) });
      } catch (err) {
        results.push({ name: m.name, ok: false, error: err.message });
      }
    }
    const okCount = results.filter((r) => r.ok).length;
    const status = okCount === results.length ? 'pass' : okCount === 0 ? 'fail' : 'warn';
    return { status, detail: `${okCount}/${results.length} models generated`, meta: { models: results } };
  },
};

register(deep);
module.exports = { deep };
