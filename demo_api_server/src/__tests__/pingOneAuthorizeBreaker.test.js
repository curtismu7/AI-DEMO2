/**
 * Per-endpoint circuit breaker wiring (P1AZ hardening amendment §E).
 *
 * Verifies the classification rules at the service boundary: only outages
 * (5xx / network) trip the breaker; a reachable 4xx (incl. 404 policy_not_found)
 * does not; breakers are isolated per endpoint key.
 */
jest.mock('../../services/configStore');
const svc = require('../../services/pingOneAuthorizeService');

const httpErr = (status) => Object.assign(new Error(`http ${status}`), { status });
const netErr = () => new Error('ECONNRESET'); // no .status → outage

beforeEach(() => svc._resetAuthorizeRuntimeState());

async function failTimes(key, makeErr, n) {
  for (let i = 0; i < n; i++) {
    await expect(svc._evaluateWithBreaker(key, async () => { throw makeErr(); })).rejects.toBeDefined();
  }
}

test('opens after 3 consecutive 5xx failures and then fails fast', async () => {
  await failTimes('decision:e1', () => httpErr(503), 3);
  await expect(svc._evaluateWithBreaker('decision:e1', async () => ({ ok: true })))
    .rejects.toMatchObject({ code: 'authorize_circuit_open' });
});

test('network/timeout errors (no status) also trip the breaker', async () => {
  await failTimes('decision:e2', netErr, 3);
  await expect(svc._evaluateWithBreaker('decision:e2', async () => ({ ok: true })))
    .rejects.toMatchObject({ code: 'authorize_circuit_open' });
});

test('a reachable 4xx (incl. 404 policy_not_found) never trips the breaker', async () => {
  await failTimes('decision:e3', () => httpErr(404), 5); // policy_not_found status
  await failTimes('decision:e3', () => httpErr(400), 5); // e.g. UserGroups self-heal
  // Still closed: the next call actually runs doEvaluate rather than fast-failing.
  const ran = jest.fn(async () => ({ decision: 'PERMIT' }));
  await svc._evaluateWithBreaker('decision:e3', ran);
  expect(ran).toHaveBeenCalled();
});

test('a success resets the consecutive-failure count', async () => {
  await failTimes('decision:e4', () => httpErr(503), 2);
  await svc._evaluateWithBreaker('decision:e4', async () => ({ decision: 'PERMIT' })); // reset
  await failTimes('decision:e4', () => httpErr(503), 2);
  const ran = jest.fn(async () => ({ decision: 'PERMIT' }));
  await svc._evaluateWithBreaker('decision:e4', ran); // only 2 since reset → still closed
  expect(ran).toHaveBeenCalled();
});

test('breakers are isolated per endpoint key', async () => {
  await failTimes('decision:openOne', () => httpErr(503), 3); // open this one
  const ran = jest.fn(async () => ({ decision: 'PERMIT' }));
  await svc._evaluateWithBreaker('decision:healthyTwo', ran); // unrelated endpoint unaffected
  expect(ran).toHaveBeenCalled();
  await expect(svc._evaluateWithBreaker('decision:openOne', async () => ({})))
    .rejects.toMatchObject({ code: 'authorize_circuit_open' });
});
