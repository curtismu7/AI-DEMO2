'use strict';

/**
 * Parser coverage for the Protocol Playground generator.
 *
 * `generateProtocolFlows.js` reads JSDoc annotations off routes/ and writes the
 * committed `demo_api_ui/src/data/protocolFlows.json` that ProtocolPlayground
 * renders. Before this suite it had NO tests, and there is no `protocols:check`
 * drift gate either — so a parser regression would reach the Playground with
 * nothing to catch it.
 *
 * Ported from the closed #1707, which reimplemented `@rfc` / `@title` / leading
 * prose that #1654 and #1657 had already landed. The tests were the salvageable
 * part; they are rewritten here against main's field names (`prose`, `stepTitle`)
 * and extended to lock in the two guards main has and #1707 lacked.
 */

const path = require('path');
const scriptPath = path.join(__dirname, '../scripts/generateProtocolFlows.js');
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

  test('captures @title as stepTitle', () => {
    const doc = [
      ' * Push an authorization request for later retrieval.',
      ' *',
      ' * @flow par',
      ' * @title Push Authorization Request',
      ' * @actor client-app',
      ' * @step 1',
    ].join('\n');

    expect(parseFlowAnnotation(doc).stepTitle).toBe('Push Authorization Request');
  });

  test('captures the leading prose paragraph, stopping at the first blank line', () => {
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

    const { prose } = parseFlowAnnotation(doc);
    expect(prose).toBe(
      'Initiate a CIBA request for human approval. Client initiates a transfer that requires human review.',
    );
    // The Body: {...} block after the blank line must not leak into the prose.
    expect(prose).not.toContain('Body:');
    expect(prose).not.toContain('scope?');
  });

  test('an annotation with no prose yields an empty string, not undefined', () => {
    const doc = [' * @flow dpop', ' * @actor gateway', ' * @step 2'].join('\n');
    expect(parseFlowAnnotation(doc).prose).toBe('');
  });

  // --- guards main has that #1707 did not: keep them ------------------------

  test('@rfc without a label is ignored rather than duplicating the URL into rfcLabel', () => {
    const doc = [
      ' * @flow rar',
      ' * @rfc https://datatracker.ietf.org/doc/html/rfc9396',
      ' * @actor client-app',
      ' * @step 1',
    ].join('\n');

    const result = parseFlowAnnotation(doc);
    expect(result.rfcUrl).toBeUndefined();
    expect(result.rfcLabel).toBeUndefined();
  });

  test('a duplicated @rfc or @title cannot overwrite the first occurrence', () => {
    const doc = [
      ' * @flow rar',
      ' * @rfc https://example.test/first RFC First',
      ' * @rfc https://example.test/second RFC Second',
      ' * @title First Title',
      ' * @title Second Title',
      ' * @actor client-app',
      ' * @step 1',
    ].join('\n');

    const result = parseFlowAnnotation(doc);
    expect(result.rfcUrl).toBe('https://example.test/first');
    expect(result.rfcLabel).toBe('RFC First');
    expect(result.stepTitle).toBe('First Title');
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

  test('sets flow.spec from the first annotation carrying @rfc, with prose as why', () => {
    const flows = buildFlowSpecs([
      baseRoute({
        displayName: 'RAR',
        rfcUrl: 'https://datatracker.ietf.org/doc/html/rfc9396',
        rfcLabel: 'RFC 9396',
        prose: 'Execute a transfer whose intent is declared via RAR.',
      }),
    ]);

    expect(flows.rar.spec).toEqual({
      url: 'https://datatracker.ietf.org/doc/html/rfc9396',
      label: 'RFC 9396',
      title: 'RAR',
      why: 'Execute a transfer whose intent is declared via RAR.',
    });
  });

  test('a flow with no @rfc keeps spec null and the placeholder description', () => {
    const flows = buildFlowSpecs([baseRoute({})]);
    expect(flows.rar.spec).toBeNull();
    // Flow-level description is always the placeholder — prose reaches the UI
    // via spec.why and steps[].description, never by overwriting this.
    expect(flows.rar.description).toBe('Protocol flow: rar');
  });

  test('@name overrides the title-caser, which mangles acronym flow ids', () => {
    const flows = buildFlowSpecs([
      baseRoute({ flowId: 'ciba-hitl', displayName: 'CIBA / HITL' }),
      baseRoute({ flowId: 'dpop' }),
    ]);
    expect(flows['ciba-hitl'].name).toBe('CIBA / HITL');
    expect(flows.dpop.name).toBe('Dpop');
  });

  test('sets step.title from @title, falling back to the derived action label', () => {
    const flows = buildFlowSpecs([
      baseRoute({ stepTitle: 'Execute RAR Transfer' }),
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
    expect(flows.par.steps[0].title).toBeNull();
    expect(flows.par.steps[0].label).toBe('GET /api/auth/authorize');
  });

  test('sets step.description from step-level prose, or null when absent', () => {
    const flows = buildFlowSpecs([
      baseRoute({ prose: 'Client authenticates and obtains a token.' }),
      baseRoute({ flowId: 'dpop', prose: '' }),
    ]);

    expect(flows.rar.steps[0].description).toBe('Client authenticates and obtains a token.');
    expect(flows.dpop.steps[0].description).toBeNull();
  });

  test('deduplicates steps by step number within a flow', () => {
    const flows = buildFlowSpecs([baseRoute({}), baseRoute({ stepTitle: 'ignored duplicate' })]);
    expect(flows.rar.steps).toHaveLength(1);
    expect(flows.rar.steps[0].title).toBeNull();
  });
});
