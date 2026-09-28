import { defineConfig } from 'vite';

// Relative base so the build works from any folder or project path.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
