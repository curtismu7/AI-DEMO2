import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

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
  const certFile = resolve(__dirname, '../certs/api.ping.demo+2.pem')
  const apiHttps = existsSync(certFile) || cfg('REACT_APP_API_HTTPS') === 'true'
  const hostname = cfg('REACT_APP_API_HOST') || (apiHttps ? 'api.ping.demo' : 'localhost')
  const httpTarget = `${apiHttps ? 'https' : 'http'}://${hostname}:${apiPort}`
  const wsTarget = `${apiHttps ? 'wss' : 'ws'}://${hostname}:${apiPort}`

  // Fail loud: surface the resolved proxy target at boot so a misconfigured
  // host/port is visible in `docker logs ai-demo-ui` instead of silently
  // hitting loopback and masquerading as a "servers down" error.
  console.log(`[vite] dev proxy: /api,/health → ${httpTarget}  |  /ws → ${wsTarget}`)

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
      // CRA allowed JSX inside .js files (Babel processed all of them). Vite's esbuild
      // plugin skips .js by default. This plugin intercepts src .js files and re-runs
      // them through esbuild with loader 'jsx' so no files need to be renamed to .jsx.
      {
        name: 'vite:js-jsx',
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
      },
    ],

    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
      ...reactAppDefines,
    },

    // Preserve function/class names through minification so React's
    // componentStack in the ErrorBoundary names real components (not mangled
    // single letters), making production crashes diagnosable.
    esbuild: { keepNames: true },

    // Dev server only: Vite's dependency scanner/optimizer runs raw esbuild,
    // which (unlike the vite:js-jsx plugin above) doesn't know our .js files
    // contain JSX. Without this, `vite` (dev/HMR — used by docker-compose.override.yml)
    // fails to boot with "JSX syntax extension is not currently enabled". Does not
    // affect `vite build` (Rollup + the plugin), so the nginx production path is unchanged.
    optimizeDeps: {
      esbuildOptions: {
        loader: { '.js': 'jsx' },
      },
    },

    server: {
      host: true,
      // Honor PORT / HTTPS from the environment so the Playwright webServer
      // (which sets PORT=3000, HTTPS=false to self-host the dev server on plain
      // HTTP) works after the CRA→Vite migration. Default stays 4000 + HTTPS
      // (mkcert cert present) for `npm start` and the Docker dev mount.
      port: process.env.PORT ? Number(process.env.PORT) : 4000,
      allowedHosts: ['api.ping.demo'],
      ...(process.env.HTTPS !== 'false' && existsSync(certFile) && {
        https: {
          key: readFileSync(resolve(__dirname, '../certs/api.ping.demo+2-key.pem')),
          cert: readFileSync(certFile),
        },
      }),
      proxy: {
        '/health': {
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
        '/ws': {
          target: wsTarget,
          ws: true,
          changeOrigin: true,
          secure: false,
        },
      },
    },

    build: {
      outDir: 'build',
      sourcemap: mode !== 'production',
    },

    // Vitest configuration (replaces react-scripts test)
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/setupTests.js'],
      css: true,
      testTimeout: 30000,
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        'tests/e2e/**',
        'tests/integration/**',
      ],
    },
  }
})
