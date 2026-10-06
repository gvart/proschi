import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// As in build.mjs: packages that frontend files import resolve from tooling/node_modules.
const modules = fileURLToPath(new URL('./node_modules/', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^(elkjs|react|react-dom|react-icons|lucide-react|lz-string)(\/.*)?$/, replacement: `${modules}$1$2` }],
  },
  esbuild: { jsx: 'automatic' },
});
