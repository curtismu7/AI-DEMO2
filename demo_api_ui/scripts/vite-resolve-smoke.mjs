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

const OTEL_EXPORTER_ENTRY = path.join(
  root,
  'node_modules/@opentelemetry/exporter-trace-otlp-http/build/esm/platform/browser/OTLPTraceExporter.js',
);

const MSAL_BROWSER_ENTRY = path.join(
  root,
  'node_modules/@azure/msal-browser/dist/BrowserAuthError.mjs',
);

async function closeServer(server) {
  // Vite's middleware-mode close can remain pending when no HTTP listener was
  // started. Bound cleanup so Node exits with the smoke-test result instead of
  // reporting an unsettled top-level await.
  await Promise.race([
    server.close(),
    new Promise((resolve) => setTimeout(resolve, 1000)),
  ]);
}

async function main() {
  const server = await createServer({
    root,
    configFile: path.join(root, 'vite.config.js'),
    // This is an import-resolution probe, not a dev server. Keep HMR and its
    // WebSocket listener disabled because the smoke test never uses them.
    server: { middlewareMode: true, hmr: false, ws: false },
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
    const otelTransformer = await server.pluginContainer.resolveId(
      '@opentelemetry/otlp-transformer',
      OTEL_EXPORTER_ENTRY,
    );
    const expectedTransformerRoot = path.join(root, 'node_modules');
    if (!otelTransformer?.id?.startsWith(expectedTransformerRoot)) {
      throw new Error(
        `OpenTelemetry transformer resolved outside the UI dependency tree: ${otelTransformer?.id || 'unresolved'}`,
      );
    }
    const msalCommon = await server.pluginContainer.resolveId(
      '@azure/msal-common',
      MSAL_BROWSER_ENTRY,
    );
    if (!msalCommon?.id?.startsWith(expectedTransformerRoot)) {
      throw new Error(
        `MSAL common resolved outside the UI dependency tree: ${msalCommon?.id || 'unresolved'}`,
      );
    }
    console.log('vite-resolve-smoke: ok');
  } catch (err) {
    console.error('vite-resolve-smoke: FAIL');
    console.error(err?.stack || err);
    process.exitCode = 1;
  } finally {
    await closeServer(server);
  }
}

main().catch((err) => {
  console.error('vite-resolve-smoke: FAIL');
  console.error(err?.stack || err);
  process.exitCode = 1;
});
