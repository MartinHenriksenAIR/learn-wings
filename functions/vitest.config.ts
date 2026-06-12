import { defineConfig } from 'vitest/config';
export default defineConfig({
  css: { postcss: { plugins: [] } }, // prevent vite from loading the repo-root postcss/tailwind config
  test: {
    include: ['**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
