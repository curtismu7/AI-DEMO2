'use strict';
jest.mock('../../../services/oboConfig', () => ({
  getOboConfig: () => ({ audience: 'obo-demo.ping.demo', scope: 'obo:invoke', exchanger: { id: 'EX' } }),
  OBO_ACT_SPEL: "${{'client_id': #root.context.requestData.actorToken.client_id}}",
}));
const { PingOneProvisionService } = require('../../../services/pingoneProvisionService');
const { OBO_ACT_SPEL } = require('../../../services/oboConfig');

function stub() {
  const svc = new PingOneProvisionService();
  svc.createResourceServer = jest.fn().mockResolvedValue({ resource: { id: 'R1', audience: ['obo-demo.ping.demo'] }, exists: false });
  svc.createScopes = jest.fn().mockResolvedValue([]);
  svc._setResourceAttribute = jest.fn().mockResolvedValue({});
  svc.grantScopesToApplication = jest.fn().mockResolvedValue({ success: true });
  return svc;
}

test('creates the OBO Demo resource with scope, act map-literal attribute, and exchanger grant', async () => {
  const svc = stub();
  const out = await svc.ensureOboDemoResource();
  expect(svc.createResourceServer).toHaveBeenCalledWith(expect.stringContaining('OBO Demo'), expect.any(String), 'obo-demo.ping.demo');
  expect(svc.createScopes).toHaveBeenCalledWith('R1', expect.arrayContaining([expect.objectContaining({ name: 'obo:invoke' })]));
  expect(svc._setResourceAttribute).toHaveBeenCalledWith('R1', 'act', OBO_ACT_SPEL);
  expect(svc._setResourceAttribute).not.toHaveBeenCalledWith('R1', 'sub', expect.anything());
  expect(svc.grantScopesToApplication).toHaveBeenCalledWith('EX', 'R1', ['obo:invoke']);
  expect(out).toEqual({ resourceId: 'R1', audience: 'obo-demo.ping.demo' });
});

test('is idempotent: an existing resource is reused and the attribute is re-applied', async () => {
  const svc = stub();
  svc.createResourceServer.mockResolvedValue({ resource: { id: 'R1', audience: ['obo-demo.ping.demo'] }, exists: true });
  await svc.ensureOboDemoResource();
  expect(svc._setResourceAttribute).toHaveBeenCalledTimes(1);
});
