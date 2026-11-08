import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

const here = import.meta.dirname;

export default defineConfig({
  root: here,
  base: './',
  plugins: [react()],
  build: { outDir: path.resolve(here, '../dist/ui'), emptyOutDir: true },
  server: {
    // `npm run dev:ui` with MOCKBREW_API=http://127.0.0.1:<port> from "mockbrew ui".
    // The control API only accepts its own Host and Origin, so both are rewritten.
    proxy: process.env.MOCKBREW_API
      ? { '/api': { target: process.env.MOCKBREW_API, changeOrigin: true, headers: { Origin: process.env.MOCKBREW_API } } }
      : undefined,
  },
});
