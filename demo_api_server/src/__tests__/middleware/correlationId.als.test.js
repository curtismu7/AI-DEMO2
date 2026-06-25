'use strict';

const { correlationIdMiddleware } = require('../../../middleware/correlationId');
const { getCorrelationId } = require('../../../utils/correlationContext');

function mockRes() {
  const headers = {};
  return { setHeader: (k, v) => { headers[k] = v; }, headers };
}

describe('correlationId middleware ALS', () => {
  it('still sets req.correlationId and echoes headers (Phase-1 behavior preserved)', (done) => {
    const req = { headers: { 'x-correlation-id': 'given-1' } };
    const res = mockRes();
    correlationIdMiddleware(req, res, () => {
      expect(req.correlationId).toBe('given-1');
      expect(req.requestId).toBe('given-1');
      expect(res.headers['X-Correlation-ID']).toBe('given-1');
      expect(res.headers['X-Request-ID']).toBe('given-1');
      done();
    });
  });
  it('runs next() inside the ALS scope so getCorrelationId() works downstream', (done) => {
    const req = { headers: { 'x-correlation-id': 'als-2' } };
    const res = mockRes();
    correlationIdMiddleware(req, res, () => {
      expect(getCorrelationId()).toBe('als-2');
      done();
    });
  });
  it('generates an id when no header present and binds it to ALS', (done) => {
    const req = { headers: {} };
    const res = mockRes();
    correlationIdMiddleware(req, res, () => {
      expect(typeof getCorrelationId()).toBe('string');
      expect(getCorrelationId()).toBe(req.correlationId);
      done();
    });
  });
});
