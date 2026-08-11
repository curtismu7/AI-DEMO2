'use strict';

const path = require('path');
const scriptPath = path.join(__dirname, '../scripts/generateProtocolFlows.js');

// generateProtocolFlows.js only exports `main` (it scans the real routes/
// dir). Requiring internals directly isn't possible without changing the
// module's exports, so this test suite requires the exported helpers by
// re-requiring the module with its internal functions exposed for testing.
// The functions under test are pure string-in/object-out — no fs, no
// network — so re-implementing the same regex-driven parse here would
// drift from the real implementation. Instead, module.exports is extended
// (see Step 3) to also export parseFlowAnnotation and buildFlowSpecs.
const { parseFlowAnnotation, buildFlowSpecs } = require(scriptPath);

describe('parseFlowAnnotation', () => {
  test('captures @rfc as rfcUrl and rfcLabel', () => {
    const doc = [
      ' * Execute a transfer whose intent is declared via RAR.',
      ' *',
      ' * @flow rar',
      ' * @name RAR',
      ' * @rfc https://datatracker.ietf.org/doc/html/rfc9396 RFC 9396',
      ' * @actor client-app',
      ' * @to auth-server',
      ' * @step 1',
    ].join('\n');

    const result = parseFlowAnnotation(doc);
    expect(result.rfcUrl).toBe('https://datatracker.ietf.org/doc/html/rfc9396');
    expect(result.rfcLabel).toBe('RFC 9396');
  });

  test('captures @title', () => {
    const doc = [
      ' * Push an authorization request for later retrieval.',
      ' *',
      ' * @flow par',
      ' * @title Push Authorization Request',
      ' * @actor client-app',
      ' * @step 1',
    ].join('\n');

    const result = parseFlowAnnotation(doc);
    expect(result.title).toBe('Push Authorization Request');
  });

  test('captures the leading prose paragraph as description, stopping at the first blank line', () => {
    const doc = [
      ' * Initiate a CIBA request for human approval.',
      ' * Client initiates a transfer that requires human review.',
      ' *',
      ' * Body: {',
      ' *   scope?: default includes offline_access',
      ' * }',
      ' *',
      ' * @flow ciba-hitl',
      ' * @actor client-app',
      ' * @step 1',
    ].join('\n');

    const result = parseFlowAnnotation(doc);
    expect(result.description).toBe(
      'Initiate a CIBA request for human approval. Client initiates a transfer that requires human review.'
    );
    // The Body: {...} block after the blank line must NOT leak into description.
    expect(result.description).not.toContain('Body:');
    expect(result.description).not.toContain('scope?');
  });

  test('a step with no prose and no tags-adjacent description has description undefined', () => {
    const doc = [' * @flow dpop', ' * @actor gateway', ' * @step 2'].join('\n');
    const result = parseFlowAnnotation(doc);
    expect(result.description).toBeUndefined();
  });
});

describe('buildFlowSpecs', () => {
  const baseRoute = (overrides) => ({
    file: 'test.js',
    annotation: {
      flowId: 'rar',
      actor: 'client-app',
      toActor: 'auth-server',
      step: 1,
      method: 'POST',
      endpoint: '/api/demo/intent-binding/run',
      ...overrides,
    },
  });

  test('sets flow.spec and flow.description when the annotation has @rfc', () => {
    const flows = buildFlowSpecs([
      baseRoute({
        displayName: 'RAR',
        rfcUrl: 'https://datatracker.ietf.org/doc/html/rfc9396',
        rfcLabel: 'RFC 9396',
        description: 'Execute a transfer whose intent is declared via RAR.',
      }),
    ]);

    expect(flows.rar.spec).toEqual({
      url: 'https://datatracker.ietf.org/doc/html/rfc9396',
      label: 'RFC 9396',
      title: 'RAR',
      why: 'Execute a transfer whose intent is declared via RAR.',
    });
    expect(flows.rar.description).toBe('Execute a transfer whose intent is declared via RAR.');
  });

  test('a flow with no @rfc anywhere has no spec, and keeps the placeholder description', () => {
    const flows = buildFlowSpecs([baseRoute({})]);
    expect(flows.rar.spec).toBeUndefined();
    expect(flows.rar.description).toBe('Protocol flow: rar');
  });

  test('sets step.title from @title, falling back to the auto-derived label', () => {
    const flows = buildFlowSpecs([
      baseRoute({ title: 'Execute RAR Transfer' }),
      baseRoute({
        flowId: 'par',
        step: 2,
        actor: 'auth-server',
        toActor: 'client-app',
        method: 'GET',
        endpoint: '/api/auth/authorize',
      }),
    ]);

    expect(flows.rar.steps[0].title).toBe('Execute RAR Transfer');
    expect(flows.par.steps[0].title).toBe('GET /api/auth/authorize');
  });

  test('sets step.description from the step-level prose, or null when absent', () => {
    const flows = buildFlowSpecs([
      baseRoute({ description: 'Client authenticates and obtains a token.' }),
      baseRoute({ flowId: 'dpop', step: 1, description: undefined }),
    ]);

    expect(flows.rar.steps[0].description).toBe('Client authenticates and obtains a token.');
    expect(flows.dpop.steps[0].description).toBeNull();
  });
});
