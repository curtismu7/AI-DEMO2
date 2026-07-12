// demo_api_ui/src/pages/check/chipTest.js
import bffAxios from '../../services/bffAxios';

export async function runChipTest({ vertical = 'banking', prompt = 'What is my account balance?' } = {}) {
  const start = Date.now();
  const base = { id: 'chip.e2e', name: 'End-to-end chip', category: 'End-to-End Chip' };
  try {
    const res = await bffAxios.post('/api/agent/invoke', { prompt, vertical });
    const toolsCalled = res.data?.toolsCalled || [];
    const ok = res.status >= 200 && res.status < 300 && (toolsCalled.length > 0 || !!res.data?.finalMessage);
    return {
      ...base,
      status: ok ? 'pass' : 'warn',
      detail: ok ? `Completed via ${toolsCalled.join(', ') || 'agent response'}` : 'Agent responded but called no tool',
      meta: { toolsCalled, vertical },
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const msg = err?.response?.data?.message || err?.message || 'agent invoke failed';
    return { ...base, status: 'fail', detail: `${err?.response?.status || ''} ${msg}`.trim(), meta: null, durationMs: Date.now() - start };
  }
}
