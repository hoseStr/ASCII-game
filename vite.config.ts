import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// base relativa: el build estático funciona en cualquier subruta (p. ej. GitHub Pages).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        atlas: resolve(import.meta.dirname, 'debug/atlas.html'),
        stamps: resolve(import.meta.dirname, 'debug/stamps.html'),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
