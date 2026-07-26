const request = require('supertest');
const express = require('express');

jest.mock('../services/pingOneClientService', () => ({
  getManagementToken: jest.fn().mockResolvedValue('worker-tkn'),
}));
jest.mock('../services/pingoneManagementService', () => ({
  managementService: {
    initialize: jest.fn(),
    getApplications: jest.fn().mockResolvedValue({ success: true, applications: [{ id: 'a1' }] }),
    createApplication: jest.fn().mockResolvedValue({ success: true, id: 'newapp', application: { id: 'newapp' } }),
    deleteApplication: jest.fn().mockResolvedValue({ success: true }),
    getUsers: jest.fn().mockResolvedValue({ success: true, users: [] }),
    getPopulations: jest.fn().mockResolvedValue({ success: true, populations: [{ id: 'p1' }] }),
    createUser: jest.fn().mockResolvedValue({ success: true, id: 'newuser', user: { id: 'newuser' } }),
    deleteUser: jest.fn().mockResolvedValue({ success: true }),
  },
}));

const { managementService } = require('../services/pingoneManagementService');
const mgmtApiRoutes = require('../routes/mgmtApi');

const app = express();
app.use(express.json());
app.use('/api/admin/mgmt-api', mgmtApiRoutes);

describe('GET /operations', () => {
  it('returns the catalog grouped with mutates flags', async () => {
    const res = await request(app).get('/api/admin/mgmt-api/operations');
    expect(res.status).toBe(200);
    const keys = res.body.map((o) => o.key);
    expect(keys).toEqual(expect.arrayContaining(['apps_list', 'apps_create', 'users_list', 'users_create', 'populations_list']));
    const create = res.body.find((o) => o.key === 'apps_create');
    expect(create).toMatchObject({ mutates: true, cleanup: true });
    expect(res.body.find((o) => o.key === 'apps_list')).toMatchObject({ mutates: false });
  });
});

describe('POST /run', () => {
  beforeEach(() => jest.clearAllMocks());

  it('read-only op returns the service JSON and a curl with $TOKEN (never a real token)', async () => {
    const res = await request(app).post('/api/admin/mgmt-api/run').send({ operationKey: 'apps_list' });
    expect(res.status).toBe(200);
    expect(managementService.getApplications).toHaveBeenCalled();
    expect(res.body.curl).toContain('$TOKEN');
    expect(res.body.curl).not.toContain('worker-tkn');
    expect(res.body.steps[0].status).toBeLessThan(400);
  });

  it('create op runs create then delete of the returned id (auto-cleanup)', async () => {
    const res = await request(app).post('/api/admin/mgmt-api/run').send({ operationKey: 'apps_create', params: { name: 'demo-x', type: 'SINGLE_PAGE_APP' } });
    expect(res.status).toBe(200);
    expect(managementService.createApplication).toHaveBeenCalled();
    expect(managementService.deleteApplication).toHaveBeenCalledWith('newapp');
    expect(res.body).toMatchObject({ cleanedUp: true, leakedId: null });
    expect(res.body.steps.map((s) => s.status)).toEqual([201, 204]);
  });

  it('create op with failing cleanup reports leakedId + not cleaned up', async () => {
    managementService.deleteApplication.mockResolvedValueOnce({ success: false, error: 'boom' });
    const res = await request(app).post('/api/admin/mgmt-api/run').send({ operationKey: 'apps_create', params: { name: 'demo-x', type: 'SINGLE_PAGE_APP' } });
    expect(res.body).toMatchObject({ cleanedUp: false, leakedId: 'newapp' });
  });

  it('unknown operation returns 400', async () => {
    const res = await request(app).post('/api/admin/mgmt-api/run').send({ operationKey: 'nope' });
    expect(res.status).toBe(400);
  });
});
