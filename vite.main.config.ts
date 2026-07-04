import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // Native modules must stay external — rollup can't bundle .node binaries
      external: ['bufferutil', 'utf-8-validate', '@nut-tree-fork/nut-js'],
    },
  },
});
