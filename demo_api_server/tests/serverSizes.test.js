'use strict';

const fs = require('fs');
const { getServerSizes, _api, _resetCaches } = require('../services/serverSizes');

describe('serverSizes', () => {
  let dockerGetSpy, dirSizeSpy, existsSpy;

  beforeEach(() => {
    _resetCaches();
    existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true); // socket present
    dirSizeSpy = jest.spyOn(_api, 'dirSize').mockResolvedValue(1234);
    dockerGetSpy = jest.spyOn(_api, 'dockerGet').mockImplementation(async (apiPath) => {
      if (apiPath.startsWith('/containers/json')) {
        return [
          { Names: ['/ai-demo-api-server'], ImageID: 'sha256:aaa' },
          { Names: ['/ai-demo-mcp-gateway'], ImageID: 'sha256:bbb' },
        ];
      }
      if (apiPath.startsWith('/images/json')) {
        return [
          { Id: 'sha256:aaa', Size: 500_000_000 },
          { Id: 'sha256:bbb', Size: 250_000_000 },
        ];
      }
      if (apiPath.includes('/stats')) {
        return { memory_stats: { usage: 100_000_000, limit: 8_000_000_000, stats: { inactive_file: 20_000_000 } } };
      }
      return null;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  test('maps image size, memory (minus inactive_file), and code size per key', async () => {
    const { sizes, timestamp } = await getServerSizes();
    expect(timestamp).toBeTruthy();
    const bff = sizes['api-server'];
    expect(bff.imageBytes).toBe(500_000_000);
    expect(bff.memBytes).toBe(80_000_000); // usage - inactive_file
    expect(bff.memLimitBytes).toBe(8_000_000_000);
    expect(bff.codeBytes).toBe(1234);
  });

  test('entries whose container is unknown to docker get null image/memory but real code size', async () => {
    const { sizes } = await getServerSizes();
    const mortgage = sizes['mortgage-service']; // not in the mocked container list
    expect(mortgage.imageBytes).toBeNull();
    expect(mortgage.memBytes).toBeNull();
    expect(mortgage.codeBytes).toBe(1234);
  });

  test('host llama tiers and null-sourceDir entries are all-null except what applies', async () => {
    const { sizes } = await getServerSizes();
    expect(sizes['llama-tier-1']).toEqual({ imageBytes: null, memBytes: null, memLimitBytes: null, codeBytes: null });
    expect(sizes['weaviate'].codeBytes).toBeNull(); // vendor image, no repo dir
  });

  test('missing docker socket degrades to null image/memory, keeps code sizes', async () => {
    existsSpy.mockReturnValue(false);
    const { sizes } = await getServerSizes();
    expect(dockerGetSpy).not.toHaveBeenCalled();
    expect(sizes['api-server'].imageBytes).toBeNull();
    expect(sizes['api-server'].memBytes).toBeNull();
    expect(sizes['api-server'].codeBytes).toBe(1234);
  });

  test('image list and code walks are cached across calls; stats are always live', async () => {
    await getServerSizes();
    const imageCalls1 = dockerGetSpy.mock.calls.filter(([p]) => p.startsWith('/images/json')).length;
    const dirCalls1 = dirSizeSpy.mock.calls.length;
    const statsCalls1 = dockerGetSpy.mock.calls.filter(([p]) => p.includes('/stats')).length;
    await getServerSizes();
    const imageCalls2 = dockerGetSpy.mock.calls.filter(([p]) => p.startsWith('/images/json')).length;
    const dirCalls2 = dirSizeSpy.mock.calls.length;
    const statsCalls2 = dockerGetSpy.mock.calls.filter(([p]) => p.includes('/stats')).length;
    expect(imageCalls2).toBe(imageCalls1); // cached
    expect(dirCalls2).toBe(dirCalls1);     // cached
    expect(statsCalls2).toBe(statsCalls1 * 2); // live every call
  });

  test('docker API failure yields nulls, not a throw', async () => {
    dockerGetSpy.mockResolvedValue(null);
    const { sizes } = await getServerSizes();
    expect(sizes['api-server'].imageBytes).toBeNull();
    expect(sizes['api-server'].memBytes).toBeNull();
  });
});

describe('serverInventory sourceDir', () => {
  test('every sourceDir points at a real directory in the repo', () => {
    const path = require('path');
    const { SERVER_INVENTORY } = require('../data/serverInventory');
    const repoRoot = path.resolve(__dirname, '..', '..');
    for (const e of SERVER_INVENTORY) {
      expect(e.sourceDir === null || typeof e.sourceDir === 'string').toBe(true);
      if (e.sourceDir) {
        expect(fs.existsSync(path.join(repoRoot, e.sourceDir))).toBe(true);
      }
    }
  });
});
