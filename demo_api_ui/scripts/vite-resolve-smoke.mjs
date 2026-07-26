// demo_api_ui/scripts/vite-resolve-smoke.mjs
/**
 * Catches Vite import-analysis failures (missing relative modules) before
 * Docker / Vite dev serve blows up — e.g. AIAgent importing a util not on disk.
 *
 * Run: npm run test:vite
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ENTRY_URLS = [
  '/src/index.jsx',
  '/src/App.js',
  '/src/components/AIAgent.js',
  '/src/pages/UseCaseLauncherPage.js',
];

const server = await createServer({
  root,
  configFile: path.join(root, 'vite.config.js'),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  await server.pluginContainer.buildStart({});
  for (const url of ENTRY_URLS) {
    const result = await server.transformRequest(url);
    if (!result?.code) {
      throw new Error(`Vite transform returned empty for ${url}`);
    }
    console.log(`✓ resolves ${url}`);
  }
  console.log('vite-resolve-smoke: ok');
} catch (err) {
  console.error('vite-resolve-smoke: FAIL');
  console.error(err?.stack || err);
  process.exitCode = 1;
} finally {
  await server.close();
}
