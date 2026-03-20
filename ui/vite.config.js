import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.js'],
  },
  server: {
    port: 4444,
    host: '0.0.0.0',
    proxy: {
      '/ws': {
        target: 'ws://localhost:4445',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:4445',
      },
    },
  },
});
