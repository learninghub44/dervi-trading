import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In dev, proxy /oauth /accounts /otp /bulk-purchase to Express on :3001
    proxy: {
      '/oauth': 'http://localhost:3001',
      '/accounts': 'http://localhost:3001',
      '/otp': 'http://localhost:3001',
      '/bulk-purchase': 'http://localhost:3001',
      '/health': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'dist',
  },
});
