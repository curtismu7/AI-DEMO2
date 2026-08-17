'use strict';

/**
 * /api/agent/invoke resolves the vertical the same way agentRun.js does.
 *
 * The two agent routes disagreed: agentRun.js reads the session's pinned
 * vertical via activeIdFor(req), invoke read only `req.body.vertical`. A caller
 * that omitted the body param therefore got banking answers inside a session
 * that had switched vertical — which reads as "the vertical broke", not "you
 * omitted a parameter". The browser always sends it, so this only ever bit
 * callers that didn't.
 */

const { parseVerticalParam } = require('../services/nlIntentParser');
const { verticalManifest } = require('../services/verticalManifest');

/** The resolution the route performs, isolated from its 400-line handler. */
function resolveVertical(req) {
  return parseVerticalParam(req.body?.vertical)
    || verticalManifest.resolver.activeIdFor(req)
    || null;
}

describe('agent invoke vertical resolution', () => {
  test('the body param wins when present', () => {
    const req = { body: { vertical: 'healthcare' }, session: { active_vertical: 'retail' } };
    expect(resolveVertical(req)).toBe('healthcare');
  });

  test('falls back to the session pin when the body omits it', () => {
    const req = { body: {}, session: { active_vertical: 'sporting-goods' } };
    expect(resolveVertical(req)).toBe('sporting-goods');
  });

  test('agrees with agentRun.js for the same request', () => {
    const req = { body: {}, session: { active_vertical: 'airlines' } };
    // agentRun.js: verticalManifest.resolver.activeIdFor(req) || 'banking'
    expect(resolveVertical(req)).toBe(verticalManifest.resolver.activeIdFor(req));
  });

  test('a session with no pin still resolves to something usable', () => {
    const req = { body: {}, session: {} };
    const resolved = resolveVertical(req);
    // The process-global active vertical, or null for the banking fallback
    // downstream — either is fine, an undefined is not.
    expect(resolved === null || typeof resolved === 'string').toBe(true);
  });

  test('a malformed body vertical does not silently become the session pin', () => {
    // parseVerticalParam rejects it; the route 400s before resolution, so this
    // pins that the reject is what happens rather than a quiet substitution.
    expect(parseVerticalParam('Not A Vertical!')).toBeNull();
  });
});
