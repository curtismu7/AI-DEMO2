// With a BFF configured, invest tools forward the caller's bearer to it. A
// gateway static token is not a user token, so that caller must read the
// bundled database instead of being sent to a BFF that would answer 401.
import fs from 'fs';
import os from 'os';
import path from 'path';
import axios from 'axios';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invest-static-'));
process.env.INVEST_DB_PATH = path.join(tmpDir, 'invest.db');
process.env.INVEST_SEED_PATH = path.join(__dirname, '..', 'seed', 'invest.seed.json');
process.env.BANKING_API_BASE_URL = 'https://bff.test';

jest.mock('axios');
const mockedGet = axios.get as jest.Mock;

import { dispatchTool } from '../src/tools/investToolHandler';

const STATIC = 's'.repeat(48);

beforeEach(() => {
  mockedGet.mockReset();
  mockedGet.mockResolvedValue({ data: { from: 'bff' } });
  process.env.MCP_RESOURCE_SERVER_GATEWAY_STATIC_TOKEN = STATIC;
});

afterAll(() => {
  delete process.env.MCP_RESOURCE_SERVER_GATEWAY_STATIC_TOKEN;
  delete process.env.BANKING_API_BASE_URL;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('invest tools with a gateway static token', () => {
  it('reads the bundled database and never calls the BFF', async () => {
    const result = await dispatchTool('get_investment_accounts', {}, STATIC) as { accounts: unknown[] };
    expect(result.accounts).toHaveLength(1);
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('still sends any other bearer to the BFF', async () => {
    const result = await dispatchTool('get_investment_accounts', {}, 'a-user-token');
    expect(result).toEqual({ from: 'bff' });
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('sends the same string to the BFF when no static token is configured', async () => {
    delete process.env.MCP_RESOURCE_SERVER_GATEWAY_STATIC_TOKEN;
    await dispatchTool('get_investment_accounts', {}, STATIC);
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });
});
