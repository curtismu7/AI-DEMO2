// Mock the axios instance the service creates at module load.
const mockAxios = { get: jest.fn(), post: jest.fn(), delete: jest.fn() };
jest.mock('axios', () => ({ create: () => mockAxios }));

const { managementService } = require('../services/pingoneManagementService');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.PINGONE_ENVIRONMENT_ID = 'test-env-id'; // initialize() still requires this even when a token is passed
  managementService.initialize('test-worker-token'); // token arg => no PINGONE_MANAGEMENT_API_TOKEN dependency
});

describe('pingoneManagementService added methods', () => {
  const base = () => managementService.baseURL;

  it('getPopulations GETs /populations and unwraps _embedded.populations', async () => {
    mockAxios.get.mockResolvedValueOnce({ data: { _embedded: { populations: [{ id: 'p1' }] } } });
    const r = await managementService.getPopulations();
    expect(mockAxios.get).toHaveBeenCalledWith(`${base()}/populations`, { headers: managementService.getHeaders() });
    expect(r).toEqual({ success: true, populations: [{ id: 'p1' }] });
  });

  it('getUsers GETs /users with a limit and unwraps _embedded.users', async () => {
    mockAxios.get.mockResolvedValueOnce({ data: { _embedded: { users: [{ id: 'u1' }] } } });
    const r = await managementService.getUsers(5);
    expect(mockAxios.get).toHaveBeenCalledWith(`${base()}/users?limit=5`, { headers: managementService.getHeaders() });
    expect(r).toEqual({ success: true, users: [{ id: 'u1' }] });
  });

  it('createUser POSTs /users with population + name and returns id', async () => {
    mockAxios.post.mockResolvedValueOnce({ data: { id: 'u9', username: 'demo' } });
    const r = await managementService.createUser({ populationId: 'p1', username: 'demo', email: 'demo@example.com' });
    expect(mockAxios.post).toHaveBeenCalledWith(
      `${base()}/users`,
      { population: { id: 'p1' }, username: 'demo', email: 'demo@example.com' },
      { headers: managementService.getHeaders() }
    );
    expect(r).toMatchObject({ success: true, id: 'u9' });
  });

  it('deleteApplication DELETEs /applications/:id', async () => {
    mockAxios.delete.mockResolvedValueOnce({ status: 204 });
    const r = await managementService.deleteApplication('a1');
    expect(mockAxios.delete).toHaveBeenCalledWith(`${base()}/applications/a1`, { headers: managementService.getHeaders() });
    expect(r).toEqual({ success: true });
  });

  it('deleteUser DELETEs /users/:id', async () => {
    mockAxios.delete.mockResolvedValueOnce({ status: 204 });
    const r = await managementService.deleteUser('u1');
    expect(mockAxios.delete).toHaveBeenCalledWith(`${base()}/users/u1`, { headers: managementService.getHeaders() });
    expect(r).toEqual({ success: true });
  });

  it('propagates errors through handleError (success:false)', async () => {
    mockAxios.get.mockRejectedValueOnce({ response: { status: 403, data: { message: 'nope' } } });
    const r = await managementService.getPopulations();
    expect(r.success).toBe(false);
  });
});
