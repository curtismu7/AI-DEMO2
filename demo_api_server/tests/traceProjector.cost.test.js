'use strict';
const { project } = require('../services/traceProjector');

const tag = (key, value) => ({ key, value });
const step = (n, tags) => ({
  spanID: `s${n}`, processID: 'p1', operationName: `reasoning-step-${n}`,
  startTime: n * 1000, duration: 5000, tags: tags.map(([k, v]) => tag(k, v)),
});
const trace = (...steps) => ({
  data: [{ traceID: 't1', processes: { p1: { serviceName: 'agent-service' } }, spans: steps }],
});
const reasoningMeta = (res) => Object.fromEntries(
  res.spans.find((s) => s.id === 'agent_reasoning').summary
    .filter((f) => f.facet === 'additionalMetadata').map((f) => [f.key, f.value]));

describe('agent reasoning cost', () => {
  test('prices tokens per step by model tag (sonnet-5-5 = $2 in / $10 out per 1M)', () => {
    const res = project(trace(
      step(1, [['model', 'claude-sonnet-5-5'], ['input_tokens', '1000000'], ['output_tokens', '100000']]),
      step(2, [['model', 'claude-sonnet-5-5'], ['input_tokens', '500000'], ['output_tokens', '0']]),
    ));
    // (1.5M in * $2 + 0.1M out * $10) / 1M = $3 + $1 = $4
    expect(reasoningMeta(res)['estimated cost']).toBe('$4.0000 (est.)');
  });

  test('unpriced model: tokens shown, no cost, no throw', () => {
    const meta = reasoningMeta(project(trace(
      step(1, [['model', 'phi-4-mini-instruct'], ['input_tokens', '100'], ['output_tokens', '50']]),
    )));
    expect(meta.tokens).toBe('100 in / 50 out');
    expect(meta['estimated cost']).toBeUndefined();
  });

  test('one unpriced step among priced ones: omit the total rather than under-report it', () => {
    const meta = reasoningMeta(project(trace(
      step(1, [['model', 'claude-sonnet-5-5'], ['input_tokens', '1000'], ['output_tokens', '10']]),
      step(2, [['input_tokens', '1000'], ['output_tokens', '10']]),
    )));
    expect(meta['estimated cost']).toBeUndefined();
  });
});
