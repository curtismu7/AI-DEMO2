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
  // This is an import-resolution probe, not a dev server. Disabling HMR keeps
  // Vite from opening a websocket listener that the smoke test never uses and
  // lets middleware-mode shutdown settle cleanly under Node 22.
  server: { middlewareMode: true, hmr: false },
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
  // Vite's middleware-mode close can await an internal watcher indefinitely
  // even after all transforms have completed. Bound cleanup so this probe's
  // exit status reflects resolution, not an unrelated dev-server shutdown.
  await Promise.race([
    server.close(),
    new Promise((resolve) => setTimeout(resolve, 1000)),
  ]);
}
