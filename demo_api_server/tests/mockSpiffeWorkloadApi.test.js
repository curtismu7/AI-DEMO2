'use strict';

const mock = require('../services/mockSpiffeWorkloadApi');

beforeEach(() => mock.clearRegistrations());

describe('mock SPIFFE Workload API', () => {
  test('issues only for a registered workload whose selectors match', () => {
    mock.registerWorkload({
      workloadId: 'api',
      spiffeId: 'spiffe://demo.local/service/api',
      selectors: { namespace: 'demo', serviceAccount: 'api' },
    });

    const svid = mock.issueJwtSvid({
      workloadId: 'api',
      selectorContext: { namespace: 'demo', serviceAccount: 'api' },
      audience: 'demo.local',
    });

    expect(typeof svid).toBe('string');
    expect(svid.split('.')).toHaveLength(3);
  });

  test('rejects an unknown workload and a selector mismatch', () => {
    expect(() => mock.issueJwtSvid({
      workloadId: 'api',
      selectorContext: { namespace: 'demo', serviceAccount: 'api' },
      audience: 'demo.local',
    })).toThrow(/not registered/);

    mock.registerWorkload({
      workloadId: 'api',
      spiffeId: 'spiffe://demo.local/service/api',
      selectors: { namespace: 'demo', serviceAccount: 'api' },
    });

    expect(() => mock.issueJwtSvid({
      workloadId: 'api',
      selectorContext: { namespace: 'other', serviceAccount: 'api' },
      audience: 'demo.local',
    })).toThrow(/selectors/);
  });

  test('rejects a registration outside the configured trust domain', () => {
    expect(() => mock.registerWorkload({
      workloadId: 'evil',
      spiffeId: 'spiffe://other.example/service/evil',
      selectors: { namespace: 'demo', serviceAccount: 'evil' },
    })).toThrow(/trust domain/);
  });

  test('requires a workload id and non-empty selectors', () => {
    expect(() => mock.registerWorkload({
      workloadId: '',
      spiffeId: 'spiffe://demo.local/service/api',
      selectors: { namespace: 'demo' },
    })).toThrow(/workloadId/);

    expect(() => mock.registerWorkload({
      workloadId: 'api',
      spiffeId: 'spiffe://demo.local/service/api',
      selectors: {},
    })).toThrow(/selectors/);
  });

  test('lists registrations and clears them for isolation', () => {
    mock.registerWorkload({
      workloadId: 'api',
      spiffeId: 'spiffe://demo.local/service/api',
      selectors: { namespace: 'demo' },
    });

    expect(mock.listRegistrations()).toEqual([{
      workloadId: 'api',
      spiffeId: 'spiffe://demo.local/service/api',
      selectors: { namespace: 'demo' },
    }]);

    mock.clearRegistrations();
    expect(mock.listRegistrations()).toEqual([]);
  });
});
