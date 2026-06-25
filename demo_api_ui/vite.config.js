import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  // Load env vars prefixed with REACT_APP_ or VITE_ (REACT_APP_ for CRA compat)
  const env = loadEnv(mode, process.cwd(), ['REACT_APP_', 'VITE_'])

  // Proxy config — mirrors setupProxy.js logic exactly
  const apiPort = env.REACT_APP_API_PORT || '3001'
  const certFile = resolve(__dirname, '../certs/api.ping.demo+2.pem')
  const apiHttps = existsSync(certFile) || env.REACT_APP_API_HTTPS === 'true'
  const hostname = env.REACT_APP_API_HOST || (apiHttps ? 'api.ping.demo' : 'localhost')
  const httpTarget = `${apiHttps ? 'https' : 'http'}://${hostname}:${apiPort}`
  const wsTarget = `${apiHttps ? 'wss' : 'ws'}://${hostname}:${apiPort}`

  // Shim process.env.REACT_APP_* so existing source files need no changes.
  // Vite replaces these string patterns at build time with the actual values.
  const reactAppDefines = Object.fromEntries(
    Object.entries(env)
      .filter(([k]) => k.startsWith('REACT_APP_'))
      .map(([k, v]) => [`process.env.${k}`, JSON.stringify(v)])
  )

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

    define: reactAppDefines,

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
      port: 4000,
      allowedHosts: ['api.ping.demo'],
      ...(existsSync(certFile) && {
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
            proxy.on('error', (err, req) => {
              console.error('[proxy] Error forwarding', req.method, req.url, '->', httpTarget, ':', err.code || err.message)
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
