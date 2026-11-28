import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Where `npm run dev` sends API calls. Not 8787: that is the host ai-bridge.
const apiTarget = process.env.CAREER_OS_API_PROXY ?? 'http://127.0.0.1:3000';
const proxy = { target: apiTarget, changeOrigin: false };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': proxy, '/healthz': proxy },
  },
});
