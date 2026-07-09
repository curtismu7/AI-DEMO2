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

// modelCatalog captures MODELS_DIR at first load — env must be set first.
const { TIERS } = require('../../demo_llm_proxy/modelCatalog');
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
  test('inventory marks tier present when canonical GGUF exists', () => {
    const tier1 = TIERS.find((t) => t.tier === 1);
    fs.writeFileSync(path.join(tmpDir, tier1.file), 'x'.repeat(100));

    const inv = getInventory();
    const row = inv.tiers.find((t) => t.tier === 1);

    expect(row.present).toBe(true);
    expect(row.aliased).toBe(false);
    expect(row.skipDownload).toBe(false);
  });

  test('dedupe clears Hugging Face cache under MODELS_DIR', () => {
    const cacheDir = path.join(tmpDir, '.cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'blob'), 'cached');

    const result = dedupeModels();

    expect(fs.existsSync(cacheDir)).toBe(false);
    expect(result.freedBytes).toBeGreaterThanOrEqual(0);
  });

  test('startDownload returns already_present when canonical file exists', () => {
    const tier1 = TIERS.find((t) => t.tier === 1);
    fs.writeFileSync(path.join(tmpDir, tier1.file), 'present');

    const result = startDownload(1);
    expect(result.status).toBe('already_present');
    expect(result.tier).toBe(1);
    expect(result.file).toBe(tier1.file);
  });
});
