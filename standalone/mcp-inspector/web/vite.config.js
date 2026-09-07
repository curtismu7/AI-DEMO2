import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /api and the PingOne OAuth callback to the local
// Express server (see ../server) so the browser only ever talks to one
// origin during development, same as production (where the server also
// serves this app's build output).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3900',
    },
  },
});
