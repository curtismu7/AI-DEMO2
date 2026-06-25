'use strict';

const { blockInDemoMode, isDemoMode } = require('../../middleware/demoMode');

describe('demoMode middleware', () => {
  const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json   = jest.fn().mockReturnValue(res);
    return res;
  };

  afterEach(() => {
    delete process.env.DEMO_MODE;
  });

  describe('isDemoMode()', () => {
    it('returns false when DEMO_MODE is not set', () => {
      delete process.env.DEMO_MODE;
      expect(isDemoMode()).toBe(false);
    });

    it('returns true when DEMO_MODE=true', () => {
      process.env.DEMO_MODE = 'true';
      expect(isDemoMode()).toBe(true);
    });

    it('returns true for any truthy DEMO_MODE value', () => {
      process.env.DEMO_MODE = '1';
      expect(isDemoMode()).toBe(true);
    });
  });

  describe('blockInDemoMode()', () => {
    it('calls next() when DEMO_MODE is not set', () => {
      delete process.env.DEMO_MODE;
      const next = jest.fn();
      const res  = mockRes();
      blockInDemoMode('test op')({}, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 403 when DEMO_MODE=true', () => {
      process.env.DEMO_MODE = 'true';
      const next = jest.fn();
      const res  = mockRes();
      blockInDemoMode('account deletion')({}, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error:     'demo_mode',
          operation: 'account deletion',
        }),
      );
    });

    it('includes the operation label and self-hosting hint in the message', () => {
      process.env.DEMO_MODE = 'true';
      const res  = mockRes();
      blockInDemoMode('user deletion')({}, res, jest.fn());
      const body = res.json.mock.calls[0][0];
      expect(body.message).toContain('user deletion');
      expect(body.message).toContain('own instance');
    });
  });
});
