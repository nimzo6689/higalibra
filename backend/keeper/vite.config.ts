import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    conditions: ['node'],
  },
  build: {
    lib: {
      entry: resolve(
        fileURLToPath(new URL('.', import.meta.url)),
        'src/index.ts',
      ),
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: [
        /^@aws-sdk\//,
        '@higalibra/push',
        '@higalibra/scraping',
        'web-push',
      ],
    },
  },
});
