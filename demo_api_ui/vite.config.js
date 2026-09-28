import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Resolve mkcert TLS files — repo ../certs locally, /certs in Docker dev mount. */
function resolveMkcertPaths() {
  const dirs = [
    resolve(__dirname, '../certs'),
    '/certs',
    process.env.CERT_DIR,
  ].filter(Boolean)
  for (const dir of dirs) {
    const cert = resolve(dir, 'api.ping.demo+2.pem')
    const key = resolve(dir, 'api.ping.demo+2-key.pem')
    if (existsSync(cert) && existsSync(key)) return { cert, key, dir }
  }
  return null
}

function legacyJsxPlugin(name) {
  return {
    name,
    enforce: 'pre',
    async transform(code, id) {
      if (!id.endsWith('.js') || id.includes('node_modules')) return null
      const esbuild = await import('esbuild')
      const result = await esbuild.transform(code, {
        loader: 'jsx',
        jsx: 'automatic',
        sourcefile: id,
        sourcemap: true,
      })
      return { code: result.code, map: result.map }
    },
  }
}

export default defineConfig(({ mode }) => {
  // Load env vars prefixed with REACT_APP_ or VITE_ (REACT_APP_ for CRA compat).
  // IMPORTANT: loadEnv only reads .env* files — it does NOT see process.env. In
  // Docker the proxy-target vars (REACT_APP_API_HOST/PORT/HTTPS) arrive via the
  // container environment, so we must prefer process.env and fall back to .env.
  // Missing this made REACT_APP_API_HOST=demo-api-server silently ignored: the
  // proxy fell back to api.ping.demo → 127.0.0.1 inside the container
  // (ECONNREFUSED), surfacing as a false "Required servers not running" modal.
  const env = loadEnv(mode, process.cwd(), ['REACT_APP_', 'VITE_'])
  const cfg = (key) => process.env[key] || env[key]

  // Proxy config — mirrors setupProxy.js logic exactly
  const apiPort = cfg('REACT_APP_API_PORT') || '3001'
  const mkcert = resolveMkcertPaths()
  const apiHttps = Boolean(mkcert) || cfg('REACT_APP_API_HTTPS') === 'true'
  const hostname = cfg('REACT_APP_API_HOST') || (apiHttps ? 'api.ping.demo' : 'localhost')
  const httpTarget = `${apiHttps ? 'https' : 'http'}://${hostname}:${apiPort}`
  const wsTarget = `${apiHttps ? 'wss' : 'ws'}://${hostname}:${apiPort}`
  // Fail loud: surface the resolved proxy target at boot so a misconfigured
  // host/port is visible in `docker logs ai-demo-ui` instead of silently
  // hitting loopback and masquerading as a "servers down" error.
  console.log(
    `[vite] dev proxy: /api,/a2a/,/health,/mcp-facade,/pinggateway-test.html → ${httpTarget}  |  /ws → ${wsTarget}`,
  )
  if (process.env.HTTPS !== 'false') {
    if (mkcert) {
      console.log(
        `[vite] dev TLS: https://api.ping.demo:4000 (certs from ${mkcert.dir})`,
      )
    } else {
      const msg =
        '[vite] FATAL: mkcert TLS files missing — https://api.ping.demo:4000 will not work. ' +
        'Run: npm run certs:ensure (or ./run-docker.sh restart ui)'
      if (process.env.REQUIRE_DEV_TLS === '1') {
        console.error(msg)
        process.exit(1)
      }
      console.warn(`${msg} (continuing HTTP-only — set REQUIRE_DEV_TLS=1 to fail fast)`)
    }
  }

  // Shim process.env.REACT_APP_* so existing source files need no changes.
  // Vite replaces these string patterns at build time with the actual values.
  // Include process.env keys (Docker) and always define NODE_ENV — bare `process`
  // references crash in the browser when a key is missing from .env.
  const reactAppKeys = new Set([
    ...Object.keys(env).filter((k) => k.startsWith('REACT_APP_')),
    ...Object.keys(process.env).filter((k) => k.startsWith('REACT_APP_')),
    'REACT_APP_CLIENT_URL',
    'REACT_APP_API_URL',
    'REACT_APP_API_PORT',
    'REACT_APP_API_HOST',
    'REACT_APP_API_HTTPS',
  ]);
  const reactAppDefines = Object.fromEntries(
    [...reactAppKeys].map((k) => [`process.env.${k}`, JSON.stringify(cfg(k) || '')]),
  );

  return {
    plugins: [
      react(),
      // CRA allowed JSX inside .js files. Keep a narrow pre-transform for those
      // legacy modules; dependency optimization itself stays on Vite 8's OXC
      // path and no longer uses the deprecated esbuildOptions setting.
      legacyJsxPlugin('vite:js-jsx'),
    ],

    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
      ...reactAppDefines,
    },

    // The BFF has its own older OpenTelemetry dependency tree. Vite can walk
    // up from the UI package and pair the browser exporter with that tree's
    // transformer, which omits the exporter's 0.222 metrics helper. Pin the
    // shared transformer to the UI dependency tree so the browser packages
    // stay on one compatible OpenTelemetry release line.
    resolve: {
      alias: {
        '@opentelemetry/otlp-transformer': resolve(
          __dirname,
          'node_modules/@opentelemetry/otlp-transformer',
        ),
        '@azure/msal-common': resolve(
          __dirname,
          'node_modules/@azure/msal-common',
        ),
      },
    },

    // Vitest's transform pipeline does not consume Vite 8's OXC JSX runtime
    // settings for test modules yet. Keep the automatic runtime there only;
    // production builds use OXC exclusively.
    ...(process.env.VITEST ? { esbuild: { jsx: 'automatic' } } : {}),

    optimizeDeps: {
      rolldownOptions: {
        plugins: [legacyJsxPlugin('vite:dep-js-jsx')],
        transform: { jsx: { runtime: 'automatic' } },
      },
    },

    server: {
      host: true,
      // Honor PORT / HTTPS from the environment so the Playwright webServer
      // (which sets PORT=3000, HTTPS=false to self-host the dev server on plain
      // HTTP) works after the CRA→Vite migration. Default stays 4000 + HTTPS
      // (mkcert cert present) for `npm start` and the Docker dev mount.
      port: process.env.PORT ? Number(process.env.PORT) : 4000,
      // local.ping-devops.com is the passkey-capable local origin: WebAuthn needs
      // rp.id to be the host or a registrable parent of it, and PingOne rejects a
      // rp.id whose TLD isn't public — so `api.ping.demo` can never carry passkeys.
      allowedHosts: ['local.ping-devops.com', 'api.ping.demo'],
      ...(process.env.HTTPS !== 'false' && mkcert && {
        https: {
          key: readFileSync(mkcert.key),
          cert: readFileSync(mkcert.cert),
        },
      }),
      proxy: {
        '/health': {
          target: httpTarget,
          changeOrigin: true,
          secure: false,
        },
        // MCP façade doors live on the BFF, but every door URL is built from
        // PUBLIC_APP_URL (https://local.ping-devops.com:4000) because that is the
        // address a real MCP client is handed. In SE/k8s port 4000 is nginx and
        // fronts both; in dev it is this server, which forwarded no such prefix —
        // so every door 404'd locally, for the browser and for the BFF's own
        // preflight alike. Same reason as the entry below: mirror what nginx
        // already serves rather than rewrite the published URL, which is also the
        // token audience and must not change.
        '/mcp-facade': {
          target: httpTarget,
          changeOrigin: true,
          secure: false,
        },
        // BFF public test pages (demo_api_server/public/) — mirrors nginx.conf
        // location ~ \.(html)$ so AdminSideNav "PingGateway Test" works in dev.
        '/pinggateway-test.html': {
          target: httpTarget,
          changeOrigin: true,
          secure: false,
        },
        '/api': {
          target: httpTarget,
          changeOrigin: true,
          secure: false,
          configure: (proxy) => {
            proxy.on('error', (err, req, res) => {
              const detail = err.code || err.message
              console.error('[proxy] Error forwarding', req.method, req.url, '->', httpTarget, ':', detail)
              if (res && !res.headersSent && typeof res.writeHead === 'function') {
                res.writeHead(502, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: 'proxy_error', target: httpTarget, detail }))
              }
            })
          },
        },
        // A2A wire protocol (Linux Foundation): the Agent Card is served
        // UNAUTHENTICATED at /a2a/specialists/:vertical/.well-known/agent-card.json
        // and the JSON-RPC POST beside it is bearer-gated. Proxied so the
        // walkthrough page can fetch both SAME-ORIGIN from the browser: without
        // this the card 404s in dev and falls through to the SPA's index.html in
        // prod, and cross-origin is not an option either — server.js CORS
        // defaults to https://api.ping.demo, not local.ping-devops.com:4000.
        // Mirrors nginx.conf's location /a2a/ — keep the two in step.
        // Trailing slash is load-bearing: vite matches proxy keys as bare
        // PREFIXES, so '/a2a' would also swallow the SPA route
        // /a2a-protocol-learning and forward it to the BFF (503). nginx's
        // `location /a2a/` already has the slash; keep the two identical.
        '/a2a/': {
          target: httpTarget,
          changeOrigin: true,
          secure: false,
        },
        '/ws': {
          target: wsTarget,
          ws: true,
          changeOrigin: true,
          secure: false,
        },
        // No /jaeger proxy: nothing links to Jaeger's own UI any more. The
        // "Open Jaeger UI" button became "Open traces in Grafana" when the
        // public /jaeger/ route was removed — Jaeger has no authentication, and
        // that route was serving its query API to anyone. Traces are reached
        // through Grafana's Jaeger datasource, which requires a login.
      },
    },

    build: {
      outDir: 'build',
      sourcemap: mode !== 'production',
      rollupOptions: {
        output: {
          manualChunks(id) {
            // Keep mermaid and its diagram chunks together in a single bundle
            // to avoid dynamic import failures when chunks aren't deployed
            if (id.includes('node_modules/mermaid')) {
              return 'mermaid'
            }
          },
        },
      },
    },

    // Vitest configuration (replaces react-scripts test)
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/setupTests.js'],
      css: true,
      testTimeout: 30000,
      // Pin the test process to UTC so date/time formatting assertions are
      // deterministic across machines and CI runners regardless of local TZ.
      env: { TZ: 'UTC' },
      // Give each worker a heap big enough for the whole suite.
      //
      // Node's default old-space limit is ~4 GB per process, and vitest reuses a
      // worker across many files, so memory accumulates: 3.5k tests over 440+
      // jsdom files with `css: true` walks past 8 GB and the worker dies with
      // "Ineffective mark-compacts near heap limit". That reads as a machine
      // problem — it is not. Measured on a 64 GB box with 51% memory free, the
      // suite OOMed at 4 GB, at 6 GB and at 8 GB, and passed at 14 GB; a single
      // heavy file (a full dashboard render) OOMed on its own at 3 GB.
      //
      // CI has been surviving on the default because its Node 22 collects
      // differently from a local Node 26 — which makes this the worst kind of
      // trap: green on the runner, unrunnable on the machine of whoever is
      // trying to verify before pushing. Keep the worker cap at the measured
      // 14 GB pass too; the CI parent NODE_OPTIONS does not override this value.
      poolOptions: {
        forks: { execArgv: ['--max-old-space-size=14336'] },
      },
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        'tests/e2e/**',
        'tests/integration/**',
      ],
    },
  }
})
