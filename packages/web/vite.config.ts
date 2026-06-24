import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The built SPA is served by the server as static files (copied to /app/public
// in the image). Relative base keeps asset URLs correct under that static root.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // Proxy the API to the server during `vite` dev so the SPA can fetch
    // /api/v1/* without CORS.
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
});
