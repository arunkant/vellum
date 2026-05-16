import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // node:sqlite is a Node 22+ builtin; Vite's default externals list doesn't
      // yet include it, so mark it external explicitly. Otherwise Rollup tries
      // to bundle it and fails ("DatabaseSync is not exported").
      external: ['node:sqlite'],
    },
  },
});
