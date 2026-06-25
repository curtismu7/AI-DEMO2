'use strict';

describe('activity event useCaseId in metadata', () => {
  it('metadata.useCaseId is present when logEvent includes it', () => {
    // Simulate what logEvent callers now do.
    const useCaseId = 'delegated-access-with-proof';
    const opts = {
      tag: 'agent/route',
      metadata: { ...(useCaseId ? { useCaseId } : {}) },
    };
    expect(opts.metadata.useCaseId).toBe('delegated-access-with-proof');
  });

  it('metadata.useCaseId is absent when useCaseId is empty', () => {
    const useCaseId = '';
    const opts = {
      tag: 'agent/route',
      metadata: { ...(useCaseId ? { useCaseId } : {}) },
    };
    expect(opts.metadata.useCaseId).toBeUndefined();
  });

  it('stampUseCaseId treats activity event objects consistently', () => {
    // stampUseCaseId is designed for token events (top-level useCaseId).
    // Activity events use metadata.useCaseId — do NOT call stampUseCaseId on them.
    // This test documents the shape boundary.
    const { stampUseCaseId } = require('../../services/useCaseTagging');
    const tokenEvent = { id: 't1' };
    const activityEvent = { id: 'a1', metadata: {} };
    stampUseCaseId([tokenEvent], 'some-uc');
    expect(tokenEvent.useCaseId).toBe('some-uc');
    // stampUseCaseId must NOT be applied to activity events
    expect(activityEvent.useCaseId).toBeUndefined();
    expect(activityEvent.metadata.useCaseId).toBeUndefined();
  });
});
