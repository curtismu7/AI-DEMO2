import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { transformWithEsbuild } from 'vite';

// CRA convention: JSX lives in .js files. Vite 7's oxc pipeline keys the JSX
// loader off the .jsx extension only, so transform .js → JSX-aware esbuild
// before anything else parses it (build, dev, and vitest SSR alike).
const craJsx = {
  name: 'cra-js-in-jsx',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('.js') || id.includes('node_modules')) return null;
    return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
  },
};


// The suite predates Vitest and uses Jest's global API (jest.fn, jest.mock,
// jest.clearAllMocks). Rewrite those references to vi.* at transform time so
// vitest's vi.mock hoisting applies — keeps the test files untouched.
const jestToVi = {
  name: 'jest-globals-to-vi',
  enforce: 'pre',
  transform(code, id) {
    if (!id.includes('__tests__') || id.includes('node_modules')) return null;
    return code.replaceAll(/\bjest\./g, 'vi.');
  },
};

export default defineConfig({
  plugins: [jestToVi, craJsx, react()],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
  build: {
    outDir: 'build', // Dockerfile copies /app/build into the nginx stage
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js',
  },
});
