'use strict';

const { correlationMiddleware } = require('../src/correlationMiddleware');
const { getCorrelationId } = require('../src/correlationContext');

describe('hitl correlation middleware', () => {
  it('binds X-Correlation-ID header into ALS', (done) => {
    const req = { headers: { 'x-correlation-id': 'gw-1' }, body: {} };
    correlationMiddleware(req, {}, () => {
      expect(getCorrelationId()).toBe('gw-1');
      done();
    });
  });
  it('falls back to body.correlationId when no header', (done) => {
    const req = { headers: {}, body: { correlationId: 'body-2' } };
    correlationMiddleware(req, {}, () => {
      expect(getCorrelationId()).toBe('body-2');
      done();
    });
  });
  it('prefers header over body when both present', (done) => {
    const req = { headers: { 'x-correlation-id': 'hdr' }, body: { correlationId: 'bod' } };
    correlationMiddleware(req, {}, () => {
      expect(getCorrelationId()).toBe('hdr');
      done();
    });
  });
  it('generates one when absent', (done) => {
    const req = { headers: {}, body: {} };
    correlationMiddleware(req, {}, () => {
      expect(typeof getCorrelationId()).toBe('string');
      expect(getCorrelationId().length).toBeGreaterThan(0);
      done();
    });
  });
  it('is safe when req.body is undefined', (done) => {
    const req = { headers: {} };
    correlationMiddleware(req, {}, () => {
      expect(typeof getCorrelationId()).toBe('string');
      done();
    });
  });
});
