// demo_api_server/tests/llamacppModels.test.js
jest.mock('child_process', () => ({
  spawn: jest.fn(() => ({
    on: jest.fn(),
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() },
  })),
}));

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-models-'));
process.env.MODELS_DIR = tmpDir;

const {
  getInventory,
  dedupeModels,
  startDownload,
  _downloadJobs,
} = require('../services/llamacppModelsService');

beforeEach(() => {
  _downloadJobs.clear();
  for (const name of fs.readdirSync(tmpDir)) {
    fs.rmSync(path.join(tmpDir, name), { recursive: true, force: true });
  }
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.MODELS_DIR;
});

describe('llamacppModelsService', () => {
  test('inventory marks tier present when alias source exists', () => {
    const source = path.join(tmpDir, 'gemma-3-12b-it-qat-UD-Q4_K_XL.gguf');
    fs.writeFileSync(source, 'x'.repeat(100));

    const inv = getInventory();
    const tier2 = inv.tiers.find((t) => t.tier === 2);
    const tier4 = inv.tiers.find((t) => t.tier === 4);

    expect(tier2.present).toBe(true);
    expect(tier4.present).toBe(true);
    expect(tier4.aliased).toBe(true);
    expect(tier4.skipDownload).toBe(true);
  });

  test('dedupe replaces duplicate tier-4 file with symlink to tier-2 file', () => {
    const source = path.join(tmpDir, 'gemma-3-12b-it-qat-UD-Q4_K_XL.gguf');
    const duplicate = path.join(tmpDir, 'gemma-3-12b-it-UD-Q4_K_XL.gguf');
    fs.writeFileSync(source, 'canonical');
    fs.writeFileSync(duplicate, 'duplicate-copy');

    const result = dedupeModels();

    expect(fs.lstatSync(duplicate).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(duplicate)).toBe('gemma-3-12b-it-qat-UD-Q4_K_XL.gguf');
    expect(result.freedBytes).toBeGreaterThan(0);
  });

  test('startDownload returns satisfied_by_alias when canonical file missing but alias exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'gemma-3-12b-it-qat-UD-Q4_K_XL.gguf'), 'alias');

    const result = startDownload(4);
    expect(result.status).toBe('satisfied_by_alias');
    expect(result.aliasFile).toBe('gemma-3-12b-it-qat-UD-Q4_K_XL.gguf');
  });
});
