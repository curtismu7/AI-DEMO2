'use strict';

/**
 * RFC 8693 token-exchange telemetry — every exchange variant in oauthService.js
 * must emit `token-exchange/request` → `token-exchange/{ok,fail}` via
 * appEventService.logEvent so a New Relic dashboard can facet on the metadata.
 *
 * These tests assert on what logEvent was called with (per te-instrument-brief.md) —
 * never on anything reaching New Relic. newRelicForwarder._isTestRun() already
 * guards that (see tests/newRelicForwarder.test.js); we don't touch it.
 */

jest.mock('axios');
const axios = require('axios');

// NOT { virtual: true }: newrelic is a real dependency. Outside an active
// transaction (which every unit test is), the real newrelic.startSegment
// silently swallows a rejected handler's promise instead of propagating it
// — see tests/nrSegments.test.js. performTokenExchange / performTokenExchangeWithActor
// go through nrSegments.tokenExchangeSubject/tokenExchangeActor, so without this
// mock their failure-path assertions would see the wrong (or no) error.
jest.mock('newrelic', () => ({
  startSegment: jest.fn((name, record, fn) => fn()),
}));

const appEventService = require('../services/appEventService');
const configStore = require('../services/configStore');
const clientAssertionService = require('../services/clientAssertionService');
const oauthService = require('../services/oauthService');

const SENTINEL_SUBJECT = 'sentinel-subject-token-AAAA1111';
const SENTINEL_ACTOR = 'sentinel-actor-token-BBBB2222';
const SENTINEL_ID_TOKEN = 'sentinel-id-token-CCCC3333';
const SENTINEL_ISSUED = 'sentinel-issued-access-token-DDDD4444';
const SENTINEL_CLIENT_SECRET = 'sentinel-client-secret-EEEE5555';

function tokenExchangeCalls(logEventSpy) {
  return logEventSpy.mock.calls.filter(([category]) => category === 'token_exchange');
}

function tagsOf(logEventSpy) {
  return tokenExchangeCalls(logEventSpy).map(([, , , options]) => options.tag);
}

describe('oauthService RFC 8693 token-exchange telemetry', () => {
  let logEventSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    logEventSpy = jest.spyOn(appEventService, 'logEvent');
  });

  afterEach(() => {
    logEventSpy.mockRestore();
  });

  describe('performTokenExchange (variant: subject)', () => {
    it('emits request then ok on success', async () => {
      axios.post.mockResolvedValueOnce({ data: { access_token: SENTINEL_ISSUED } });
      const result = await oauthService.performTokenExchange(SENTINEL_SUBJECT, 'https://api.example.com', ['read']);
      expect(result).toBe(SENTINEL_ISSUED);
      expect(tagsOf(logEventSpy)).toEqual(['token-exchange/request', 'token-exchange/ok']);

      const [, , , okOptions] = tokenExchangeCalls(logEventSpy)[1];
      expect(okOptions.metadata).toMatchObject({
        exchangeVariant: 'subject',
        audience: 'https://api.example.com',
        scope: 'read',
        exchangeClientId: oauthService.config.clientId,
        hasActorToken: false,
        subjectTokenType: 'access_token',
      });
      expect(typeof okOptions.metadata.latencyMs).toBe('number');
    });

    it('emits request then fail on error, preserving the enriched error', async () => {
      const axiosErr = new Error('boom');
      axiosErr.response = { status: 400, data: { error: 'invalid_target', error_description: 'bad audience' } };
      // mockRejectedValue (not Once): performTokenExchange routes the POST through
      // nrSegments.tokenExchangeSubject, whose real newrelic.startSegment re-invokes
      // the handler on rejection when there's no active APM transaction (true for
      // every unit test, and for any non-request/background caller in production —
      // see this suite's report for the pre-existing nrSegments.js defect this
      // exposed). Using a persistent rejection keeps the assertion correct
      // regardless of whether the POST fires once or twice.
      axios.post.mockRejectedValue(axiosErr);

      await expect(
        oauthService.performTokenExchange(SENTINEL_SUBJECT, 'https://api.example.com', ['read'])
      ).rejects.toMatchObject({
        httpStatus: 400,
        pingoneError: 'invalid_target',
        pingoneErrorDescription: 'bad audience',
        requestContext: { audience: 'https://api.example.com', scope: 'read', client_id: oauthService.config.clientId },
      });

      expect(tagsOf(logEventSpy)).toEqual(['token-exchange/request', 'token-exchange/fail']);
      const [, , , failOptions] = tokenExchangeCalls(logEventSpy)[1];
      expect(failOptions.metadata.httpStatus).toBe(400);
      expect(failOptions.metadata.pingoneError).toBe('invalid_target');
      expect(typeof failOptions.metadata.latencyMs).toBe('number');
    });
  });

  describe('performTokenExchangeFromIdToken (variant: id-token)', () => {
    it('emits request then ok, subjectTokenType=id_token, hasActorToken=false', async () => {
      axios.post.mockResolvedValueOnce({ data: { access_token: SENTINEL_ISSUED } });
      await oauthService.performTokenExchangeFromIdToken(SENTINEL_ID_TOKEN, 'https://api.example.com', ['read']);
      expect(tagsOf(logEventSpy)).toEqual(['token-exchange/request', 'token-exchange/ok']);
      const [, , , okOptions] = tokenExchangeCalls(logEventSpy)[1];
      expect(okOptions.metadata).toMatchObject({
        exchangeVariant: 'id-token',
        subjectTokenType: 'id_token',
        hasActorToken: false,
      });
    });

    it('emits request then fail on error', async () => {
      const axiosErr = new Error('boom');
      axiosErr.response = { status: 401, data: { error: 'invalid_client' } };
      axios.post.mockRejectedValueOnce(axiosErr);
      await expect(
        oauthService.performTokenExchangeFromIdToken(SENTINEL_ID_TOKEN, 'https://api.example.com', ['read'])
      ).rejects.toMatchObject({ httpStatus: 401, pingoneError: 'invalid_client' });
      expect(tagsOf(logEventSpy)).toEqual(['token-exchange/request', 'token-exchange/fail']);
    });
  });

  describe('performTokenExchangeWithActor (variant: subject+actor)', () => {
    it('emits request then ok, hasActorToken=true', async () => {
      axios.post.mockResolvedValueOnce({ data: { access_token: SENTINEL_ISSUED } });
      await oauthService.performTokenExchangeWithActor(SENTINEL_SUBJECT, SENTINEL_ACTOR, 'https://api.example.com', ['read']);
      expect(tagsOf(logEventSpy)).toEqual(['token-exchange/request', 'token-exchange/ok']);
      const [, , , okOptions] = tokenExchangeCalls(logEventSpy)[1];
      expect(okOptions.metadata).toMatchObject({
        exchangeVariant: 'subject+actor',
        subjectTokenType: 'access_token',
        hasActorToken: true,
      });
    });

    it('emits request then fail on error', async () => {
      const axiosErr = new Error('boom');
      axiosErr.response = { status: 400, data: { error: 'invalid_grant' } };
      // mockRejectedValue (not Once) — see the comment on the performTokenExchange
      // fail test above: this variant also goes through nrSegments.tokenExchangeActor.
      axios.post.mockRejectedValue(axiosErr);
      await expect(
        oauthService.performTokenExchangeWithActor(SENTINEL_SUBJECT, SENTINEL_ACTOR, 'https://api.example.com', ['read'])
      ).rejects.toMatchObject({ httpStatus: 400, pingoneError: 'invalid_grant' });
      expect(tagsOf(logEventSpy)).toEqual(['token-exchange/request', 'token-exchange/fail']);
    });
  });

  describe('performTokenExchangeWithActorIdToken (variant: id-token+actor)', () => {
    it('emits request then ok, subjectTokenType=id_token, hasActorToken=true', async () => {
      axios.post.mockResolvedValueOnce({ data: { access_token: SENTINEL_ISSUED } });
      await oauthService.performTokenExchangeWithActorIdToken(SENTINEL_ID_TOKEN, SENTINEL_ACTOR, 'https://api.example.com', ['read']);
      const [, , , okOptions] = tokenExchangeCalls(logEventSpy)[1];
      expect(okOptions.metadata).toMatchObject({
        exchangeVariant: 'id-token+actor',
        subjectTokenType: 'id_token',
        hasActorToken: true,
      });
    });

    it('emits request then fail on error', async () => {
      const axiosErr = new Error('boom');
      axiosErr.response = { status: 403, data: { error: 'access_denied' } };
      axios.post.mockRejectedValueOnce(axiosErr);
      await expect(
        oauthService.performTokenExchangeWithActorIdToken(SENTINEL_ID_TOKEN, SENTINEL_ACTOR, 'https://api.example.com', ['read'])
      ).rejects.toMatchObject({ httpStatus: 403, pingoneError: 'access_denied' });
      expect(tagsOf(logEventSpy)).toEqual(['token-exchange/request', 'token-exchange/fail']);
    });
  });

  describe('performTokenExchangeAs (variant: exchange-as)', () => {
    const PARAM_CLIENT_ID = 'exchanger-client-id-xyz';

    it('exchangeClientId is the parameter clientId, not this.config.clientId', async () => {
      axios.post.mockResolvedValueOnce({ data: { access_token: SENTINEL_ISSUED } });
      await oauthService.performTokenExchangeAs(
        SENTINEL_SUBJECT, null, PARAM_CLIENT_ID, SENTINEL_CLIENT_SECRET, 'https://api.example.com', ['read']
      );
      const [, , , okOptions] = tokenExchangeCalls(logEventSpy)[1];
      expect(okOptions.metadata.exchangeClientId).toBe(PARAM_CLIENT_ID);
      expect(okOptions.metadata.exchangeClientId).not.toBe(oauthService.config.clientId);
    });

    it('hasActorToken is false when called without an actor token', async () => {
      axios.post.mockResolvedValueOnce({ data: { access_token: SENTINEL_ISSUED } });
      await oauthService.performTokenExchangeAs(
        SENTINEL_SUBJECT, null, PARAM_CLIENT_ID, SENTINEL_CLIENT_SECRET, 'https://api.example.com', ['read']
      );
      const [, , , okOptions] = tokenExchangeCalls(logEventSpy)[1];
      expect(okOptions.metadata.hasActorToken).toBe(false);
    });

    it('hasActorToken is true when called with an actor token', async () => {
      axios.post.mockResolvedValueOnce({ data: { access_token: SENTINEL_ISSUED } });
      await oauthService.performTokenExchangeAs(
        SENTINEL_SUBJECT, SENTINEL_ACTOR, PARAM_CLIENT_ID, SENTINEL_CLIENT_SECRET, 'https://api.example.com', ['read']
      );
      const [, , , okOptions] = tokenExchangeCalls(logEventSpy)[1];
      expect(okOptions.metadata.hasActorToken).toBe(true);
    });

    it('emits request then fail on error, preserving the enriched error', async () => {
      const axiosErr = new Error('boom');
      axiosErr.response = { status: 400, data: { error: 'invalid_scope', error_description: 'nope' } };
      axios.post.mockRejectedValueOnce(axiosErr);
      await expect(
        oauthService.performTokenExchangeAs(
          SENTINEL_SUBJECT, SENTINEL_ACTOR, PARAM_CLIENT_ID, SENTINEL_CLIENT_SECRET, 'https://api.example.com', ['read']
        )
      ).rejects.toMatchObject({
        httpStatus: 400,
        pingoneError: 'invalid_scope',
        pingoneErrorDescription: 'nope',
        requestContext: { audience: 'https://api.example.com', scope: 'read', client_id: PARAM_CLIENT_ID },
      });
      expect(tagsOf(logEventSpy)).toEqual(['token-exchange/request', 'token-exchange/fail']);
    });

    it('never puts clientSecret into any emitted event, message or metadata', async () => {
      axios.post.mockResolvedValueOnce({ data: { access_token: SENTINEL_ISSUED } });
      await oauthService.performTokenExchangeAs(
        SENTINEL_SUBJECT, SENTINEL_ACTOR, PARAM_CLIENT_ID, SENTINEL_CLIENT_SECRET, 'https://api.example.com', ['read']
      );
      const serialized = JSON.stringify(tokenExchangeCalls(logEventSpy));
      expect(serialized).not.toContain(SENTINEL_CLIENT_SECRET);
    });
  });

  describe('performTokenExchangeWithDedicatedApp (variant: dedicated-app)', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('emits under the dedicated-app variant, with exchangeClientId = exchangerClientId, when the dedicated exchanger is enabled', async () => {
      jest.spyOn(clientAssertionService, 'isExchangerPrivateKeyJwtEnabled').mockReturnValue(true);
      jest.spyOn(clientAssertionService, 'buildExchangerClientAssertion').mockReturnValue('fake-assertion');
      jest.spyOn(configStore, 'getEffective').mockImplementation((key) => {
        if (String(key).toLowerCase() === 'pingone_private_key_jwt_exchanger_client_id') {
          return 'dedicated-exchanger-client-id';
        }
        return jest.requireActual('../services/configStore').getEffective(key);
      });

      axios.post.mockResolvedValueOnce({ data: { access_token: SENTINEL_ISSUED } });
      await oauthService.performTokenExchangeWithDedicatedApp(SENTINEL_SUBJECT, 'https://api.example.com', ['read']);

      expect(tagsOf(logEventSpy)).toEqual(['token-exchange/request', 'token-exchange/ok']);
      const [, , , okOptions] = tokenExchangeCalls(logEventSpy)[1];
      expect(okOptions.metadata).toMatchObject({
        exchangeVariant: 'dedicated-app',
        exchangeClientId: 'dedicated-exchanger-client-id',
      });
    });

    it('emits request then fail on error when the dedicated exchanger is enabled', async () => {
      jest.spyOn(clientAssertionService, 'isExchangerPrivateKeyJwtEnabled').mockReturnValue(true);
      jest.spyOn(clientAssertionService, 'buildExchangerClientAssertion').mockReturnValue('fake-assertion');
      jest.spyOn(configStore, 'getEffective').mockImplementation((key) => {
        if (String(key).toLowerCase() === 'pingone_private_key_jwt_exchanger_client_id') {
          return 'dedicated-exchanger-client-id';
        }
        return jest.requireActual('../services/configStore').getEffective(key);
      });

      const axiosErr = new Error('boom');
      axiosErr.response = { status: 400, data: { error: 'invalid_client' } };
      axios.post.mockRejectedValueOnce(axiosErr);

      await expect(
        oauthService.performTokenExchangeWithDedicatedApp(SENTINEL_SUBJECT, 'https://api.example.com', ['read'])
      ).rejects.toMatchObject({ httpStatus: 400, pingoneError: 'invalid_client' });
      expect(tagsOf(logEventSpy)).toEqual(['token-exchange/request', 'token-exchange/fail']);
    });

    it('falls back to performTokenExchange and emits ONLY the subject variant (no double-emit) when the dedicated exchanger is disabled', async () => {
      jest.spyOn(clientAssertionService, 'isExchangerPrivateKeyJwtEnabled').mockReturnValue(false);
      axios.post.mockResolvedValueOnce({ data: { access_token: SENTINEL_ISSUED } });

      const result = await oauthService.performTokenExchangeWithDedicatedApp(SENTINEL_SUBJECT, 'https://api.example.com', ['read']);

      expect(result).toBe(SENTINEL_ISSUED);
      const calls = tokenExchangeCalls(logEventSpy);
      expect(tagsOf(logEventSpy)).toEqual(['token-exchange/request', 'token-exchange/ok']);
      // Exactly one request + one ok — never 4 (i.e. never dedicated-app AND subject/subject+actor both firing).
      expect(calls).toHaveLength(2);
      expect(calls[0][3].metadata.exchangeVariant).toBe('subject');
      expect(calls[1][3].metadata.exchangeVariant).toBe('subject');
      expect(calls.some((c) => c[3].tag === 'token-exchange/dedicated-app')).toBe(false);
    });

    it('falls back to performTokenExchangeWithActor (still no double-emit) when an actor token is supplied and the dedicated exchanger is disabled', async () => {
      jest.spyOn(clientAssertionService, 'isExchangerPrivateKeyJwtEnabled').mockReturnValue(false);
      axios.post.mockResolvedValueOnce({ data: { access_token: SENTINEL_ISSUED } });

      await oauthService.performTokenExchangeWithDedicatedApp(SENTINEL_SUBJECT, 'https://api.example.com', ['read'], SENTINEL_ACTOR);

      const calls = tokenExchangeCalls(logEventSpy);
      expect(calls).toHaveLength(2);
      expect(calls[0][3].metadata.exchangeVariant).toBe('subject+actor');
      expect(calls[1][3].metadata.exchangeVariant).toBe('subject+actor');
    });
  });

  describe('security — no token value ever leaks into an emitted event', () => {
    const sentinels = [SENTINEL_SUBJECT, SENTINEL_ACTOR, SENTINEL_ID_TOKEN, SENTINEL_ISSUED, SENTINEL_CLIENT_SECRET];

    function assertNoSentinelLeak(logSpy) {
      const serialized = JSON.stringify(logSpy.mock.calls);
      for (const s of sentinels) {
        expect(serialized).not.toContain(s);
      }
    }

    it('on every variant success path', async () => {
      axios.post.mockResolvedValue({ data: { access_token: SENTINEL_ISSUED } });

      await oauthService.performTokenExchange(SENTINEL_SUBJECT, 'https://api.example.com', ['read']);
      await oauthService.performTokenExchangeFromIdToken(SENTINEL_ID_TOKEN, 'https://api.example.com', ['read']);
      await oauthService.performTokenExchangeWithActor(SENTINEL_SUBJECT, SENTINEL_ACTOR, 'https://api.example.com', ['read']);
      await oauthService.performTokenExchangeWithActorIdToken(SENTINEL_ID_TOKEN, SENTINEL_ACTOR, 'https://api.example.com', ['read']);
      await oauthService.performTokenExchangeAs(SENTINEL_SUBJECT, SENTINEL_ACTOR, 'cid', SENTINEL_CLIENT_SECRET, 'https://api.example.com', ['read']);

      assertNoSentinelLeak(logEventSpy);
    });

    it('on every variant failure path', async () => {
      const axiosErr = () => {
        const e = new Error('boom');
        e.response = { status: 400, data: { error: 'invalid_request', error_description: 'nope' } };
        return e;
      };
      axios.post.mockRejectedValue(axiosErr());

      await oauthService.performTokenExchange(SENTINEL_SUBJECT, 'https://api.example.com', ['read']).catch(() => {});
      await oauthService.performTokenExchangeFromIdToken(SENTINEL_ID_TOKEN, 'https://api.example.com', ['read']).catch(() => {});
      await oauthService.performTokenExchangeWithActor(SENTINEL_SUBJECT, SENTINEL_ACTOR, 'https://api.example.com', ['read']).catch(() => {});
      await oauthService.performTokenExchangeWithActorIdToken(SENTINEL_ID_TOKEN, SENTINEL_ACTOR, 'https://api.example.com', ['read']).catch(() => {});
      await oauthService.performTokenExchangeAs(SENTINEL_SUBJECT, SENTINEL_ACTOR, 'cid', SENTINEL_CLIENT_SECRET, 'https://api.example.com', ['read']).catch(() => {});

      assertNoSentinelLeak(logEventSpy);
    });
  });

  describe('a throwing logEvent never masks the real PingOne error', () => {
    it('propagates the enriched PingOne error unchanged even when logEvent throws', async () => {
      logEventSpy.mockImplementation(() => {
        throw new Error('logEvent exploded');
      });
      const axiosErr = new Error('boom');
      axiosErr.response = { status: 400, data: { error: 'invalid_target', error_description: 'bad audience' } };
      // mockRejectedValue (not Once) — see the comment on the performTokenExchange
      // fail test above: this variant goes through nrSegments.tokenExchangeSubject.
      axios.post.mockRejectedValue(axiosErr);

      await expect(
        oauthService.performTokenExchange(SENTINEL_SUBJECT, 'https://api.example.com', ['read'])
      ).rejects.toMatchObject({
        httpStatus: 400,
        pingoneError: 'invalid_target',
        pingoneErrorDescription: 'bad audience',
      });
    });

    it('does not throw at all on the success path when logEvent throws', async () => {
      logEventSpy.mockImplementation(() => {
        throw new Error('logEvent exploded');
      });
      axios.post.mockResolvedValueOnce({ data: { access_token: SENTINEL_ISSUED } });

      await expect(
        oauthService.performTokenExchange(SENTINEL_SUBJECT, 'https://api.example.com', ['read'])
      ).resolves.toBe(SENTINEL_ISSUED);
    });
  });
});
