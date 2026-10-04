import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the build works under any sub-path,
  // e.g. https://<user>.github.io/proschi/ on GitHub Pages.
  base: './',
  build: {
    rollupOptions: {
      // Three pages: the landing page at the root, the editor under app/,
      // system design practice under practice/.
      input: {
        landing: fileURLToPath(new URL('./index.html', import.meta.url)),
        app: fileURLToPath(new URL('./app/index.html', import.meta.url)),
        practice: fileURLToPath(new URL('./practice/index.html', import.meta.url)),
      },
    },
  },
})
