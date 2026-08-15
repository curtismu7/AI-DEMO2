'use strict';
/**
 * A request-supplied vertical id must never resolve an INHERITED Object.prototype
 * member as if it were configuration.
 *
 * `VALID_VERTICAL_RE` (/^[a-z][a-z0-9-]*$/) accepts `constructor`, and
 * `resolveVerticalRouting` prefers the explicit request param — so any bare
 * `SOME_MAP[verticalId]` on a plain-object map hands back `Object` (a function)
 * or `Object.prototype` instead of `undefined`, and the `||` / `?.` fallbacks
 * that were written for a miss never fire.
 *
 * Reproduced live before the fix (real routes, real routing, LLM + BFF stubbed):
 *
 *   POST /api/demo-agent/nl      {vertical:"constructor"}
 *     -> HTTP 500 {"error":"nl_parse_failed",
 *                  "message":"featureTrigger?.test is not a function"}
 *        (FEATURE_TRIGGERS["constructor"] is the Object constructor; `?.` only
 *         guards nullish, so `.test(t)` is called on a function that has none)
 *
 *   POST /api/demo-agent/message {vertical:"constructor",
 *                                 message:"spot any unusual activity"}
 *     -> verticalDispatch.executeToolFor called with `name` = [Function: Object]
 *        (READ_PRIMARY_TOOL_BY_VERTICAL["constructor"], truthy, so the caller's
 *         `if (activityTool)` passes and a FUNCTION reaches the tool executor)
 *
 *   permittedToolsForIntent('unknown', 'constructor')
 *     -> [Function: Object] instead of an array, so JSON.stringify drops the
 *        claim entirely and the minted Intent Token carries NO permitted_tools.
 *
 * Do NOT assert with JSON.stringify: it renders a function as `undefined` and
 * an inherited-key hit then reads as a clean pass.
 *
 * `__proto__` is rejected by the leading-underscore rule in VALID_VERTICAL_RE,
 * but the guards below do not rely on that — the map, not the router, is the
 * place this has to be safe.
 */

const express = require('express');
const request = require('supertest');

jest.setTimeout(20000);

const INHERITED_KEYS = ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty'];

/** Names verticalDispatch.executeToolFor was handed, captured with their type. */
const observedToolNames = [];

jest.mock('../../middleware/agentSessionMiddleware', () => {
  const middleware = (req, _res, next) => {
    req.agentContext = { userId: 'u1', accessToken: 'tok', tokenEvents: [] };
    next();
  };
  return { agentSessionMiddleware: middleware, agentGuestSessionMiddleware: middleware };
});

jest.mock('../../services/bffMcpToolExecutor', () => ({
  executeBffTool: jest.fn(async () => JSON.stringify({
    transactions: [{ id: 'T1', date: '2026-07-01', type: 'debit', amount: -42.5, description: 'Whole Foods' }],
  })),
  executeBffToolWithToken: jest.fn(),
}));

jest.mock('../../services/a2aDelegationService', () => ({
  isA2aEnabled: jest.fn(() => false),
  delegateToSpecialist: jest.fn(),
}));

jest.mock('../../services/agentReasoningClient', () => ({
  runReasonLoop: jest.fn(async () => ({ ok: true, answer: 'ok', toolsCalled: [], inputTokens: 0, outputTokens: 0 })),
}));

// Spy wrapper, not a stub: the real executeToolFor still runs, we only record the
// raw `name` value it was handed so its TYPE can be asserted.
jest.mock('../../services/verticalDispatch', () => {
  const actual = jest.requireActual('../../services/verticalDispatch');
  return {
    ...actual,
    executeToolFor: jest.fn((activeId, name, params, ctx, legacy) => {
      observedToolNames.push(name);
      return actual.executeToolFor(activeId, name, params, ctx, legacy);
    }),
  };
});

/**
 * setup.js resets the module registry between tests, so every module a test
 * touches must be require()'d inside that test.
 */
function loadAgentService() {
  require('../../services/verticalManifest').verticalManifest.init();
  const configStore = require('../../services/configStore');
  // The activity pre-fetch lives on the LLM/reason-loop path; the default
  // heuristics mode returns the capability catalog long before it.
  const realGet = configStore.getEffective.bind(configStore);
  jest.spyOn(configStore, 'getEffective').mockImplementation((k) => {
    if (k === 'ff_heuristic_enabled') return 'false';
    if (k === 'agent_mode') return 'llamacpp';
    return realGet(k);
  });
  return require('../../services/demoAgentLangGraphService');
}

function buildApp(routerPath) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { id: 's1', user: { id: 'u1', oauthId: 'u1' }, save: (cb) => cb && cb() };
    next();
  });
  app.use('/api/demo-agent', require(routerPath));
  return app;
}

describe('request-supplied vertical id cannot resolve an inherited prototype member', () => {
  beforeEach(() => { observedToolNames.length = 0; });

  describe('READ_PRIMARY_TOOL_BY_VERTICAL — activity pre-fetch tool', () => {
    it.each(INHERITED_KEYS)('readPrimaryToolFor(%p) selects no tool', (key) => {
      expect(loadAgentService().__test.readPrimaryToolFor(key)).toBeNull();
    });

    it('mapped verticals and banking still select their own tool', () => {
      const service = loadAgentService();
      expect(service.__test.readPrimaryToolFor('banking')).toBe('get_my_transactions');
      expect(service.__test.readPrimaryToolFor('healthcare')).toBe('view_coverage');
      expect(service.__test.readPrimaryToolFor('retail')).toBe('list_orders');
    });

    it('POST /message vertical=constructor never hands the executor a non-string tool name', async () => {
      loadAgentService();
      const res = await request(buildApp('../../routes/demoAgentRoutes'))
        .post('/api/demo-agent/message')
        .send({ message: 'spot any unusual activity', vertical: 'constructor' });

      expect(res.status).toBe(200);
      // typeof, not JSON.stringify — a function serializes to `undefined` and reads as clean.
      expect(observedToolNames.map((n) => typeof n)).not.toContain('function');
      expect(observedToolNames).toEqual([]);
    });
  });

  describe('FEATURE_TRIGGERS — heuristic vertical-feature chip', () => {
    it.each(INHERITED_KEYS)('parseHeuristic does not throw for vertical %p', (key) => {
      const { parseHeuristic } = require('../../services/nlIntentParser');
      expect(() => parseHeuristic('show my large purchases', key)).not.toThrow();
    });

    it('POST /nl vertical=constructor answers instead of throwing', async () => {
      const res = await request(buildApp('../../routes/demoAgentNl'))
        .post('/api/demo-agent/nl')
        .send({ message: 'show my large purchases', vertical: 'constructor', provider: 'heuristic' });

      expect(res.status).toBe(200);
      expect(res.body.error).toBeUndefined();
    });

    it('retail still matches its own feature trigger', () => {
      const { parseHeuristic } = require('../../services/nlIntentParser');
      expect(parseHeuristic('show my large purchases', 'retail'))
        .toEqual({ kind: 'banking', banking: { action: 'vertical_feature_demo' } });
    });
  });

  describe('HELIX_AGENT_DIRECTIVES themes — LLM system prompt', () => {
    // Equality with a plain unknown id, not a /native code/ match: `__proto__`
    // resolves Object.prototype, which concatenates as "[object Object]" and
    // would slip past a function-shaped assertion.
    it.each(INHERITED_KEYS)('buildSystem(%p) is the same prompt as any unthemed vertical', (key) => {
      const { buildSystem } = require('../../services/geminiNlIntent').__test;
      expect(buildSystem(key)).toBe(buildSystem('no-such-vertical'));
    });

    it('a themed vertical still gets its own directive theme', () => {
      const { buildSystem } = require('../../services/geminiNlIntent').__test;
      expect(buildSystem('retail').length).toBeGreaterThan(buildSystem('constructor').length);
    });
  });

  describe('READ_ONLY_TOOLS_BY_VERTICAL — Intent Token permitted_tools', () => {
    it.each(INHERITED_KEYS)('an unclassified intent in vertical %p still yields a tool array', (key) => {
      const tools = require('../../services/intentTokenService').permittedToolsForIntent('unknown', key);
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.every((t) => typeof t === 'string')).toBe(true);
    });

    it.each(INHERITED_KEYS)('intent %p is not a permitted-tools key', (key) => {
      const tools = require('../../services/intentTokenService').permittedToolsForIntent(key, 'banking');
      expect(Array.isArray(tools)).toBe(true);
    });

    it('the minted token still carries permitted_tools for an unknown vertical', () => {
      process.env.INTENT_TOKEN_SECRET = process.env.INTENT_TOKEN_SECRET || 'test-intent-secret';
      const { mintIntentToken } = require('../../services/intentTokenService');
      const { token } = mintIntentToken({
        userId: 'u1', sessionId: 's1', prompt: 'p', intent: 'unknown', confidence: 0.3, vertical: 'constructor',
      });
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      expect(Object.prototype.hasOwnProperty.call(claims, 'permitted_tools')).toBe(true);
      expect(Array.isArray(claims.permitted_tools)).toBe(true);
      expect(claims.permitted_tools.length).toBeGreaterThan(0);
    });

    it('a mapped vertical still gets its own read tools', () => {
      const tools = require('../../services/intentTokenService').permittedToolsForIntent('unknown', 'healthcare');
      expect(tools).toContain('view_coverage');
    });
  });
});
