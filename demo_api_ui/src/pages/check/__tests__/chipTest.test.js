// demo_api_ui/src/pages/check/__tests__/chipTest.test.js
vi.mock('../../../services/bffAxios', () => ({ __esModule: true, default: { post: vi.fn() } }));
import bffAxios from '../../../services/bffAxios';
import { runChipTest } from '../chipTest';

describe('runChipTest', () => {
  afterEach(() => vi.clearAllMocks());

  test('pass when agent calls a tool', async () => {
    bffAxios.post.mockResolvedValue({ status: 200, data: { toolsCalled: ['get_account_balance'], finalMessage: 'Your balance is…' } });
    const r = await runChipTest({ vertical: 'banking', prompt: 'What is my balance?' });
    expect(r.status).toBe('pass');
    expect(r.id).toBe('chip.e2e');
  });

  test('fail when server rejects', async () => {
    bffAxios.post.mockRejectedValue({ response: { status: 403, data: { message: 'authorize denied' } } });
    const r = await runChipTest({ vertical: 'banking', prompt: 'x' });
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/authorize denied/);
  });
});
