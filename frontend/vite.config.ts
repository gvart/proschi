import { fileURLToPath } from 'node:url'
import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import { practiceListings } from './plugins/practiceListings'
import { siteShell } from './plugins/siteShell'
import { docsSite } from './plugins/docsSite'

// `ANALYZE=1 npx vite build` also writes dist/stats.html, a treemap of every chunk.
async function analyzer(): Promise<PluginOption> {
  if (!process.env.ANALYZE) return null
  const { visualizer } = await import('rollup-plugin-visualizer')
  return visualizer({ filename: 'dist/stats.html', gzipSize: true, template: 'treemap' }) as PluginOption
}

// Libraries in chunks of their own, named for what they are, so pages share
// them and an app update does not invalidate them.
const VENDOR_CHUNKS: [string, RegExp][] = [
  ['react', /\/node_modules\/(react|react-dom|scheduler)\//],
  ['codemirror', /\/node_modules\/(@codemirror|@lezer|codemirror|@marijn|crelt|style-mod|w3c-keyname)\//],
  ['html-to-image', /\/node_modules\/html-to-image\//],
  ['reactflow', /\/node_modules\/(reactflow|@reactflow|d3-[a-z]+|zustand|classcat|use-sync-external-store)\//],
]

function manualChunks(id: string): string | undefined {
  return VENDOR_CHUNKS.find(([, pattern]) => pattern.test(id))?.[0]
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react(),
    practiceListings(fileURLToPath(new URL('./src/practice/problems', import.meta.url))),
    // Before siteShell: the docs pages' layout goes in first, the header and footer around it.
    docsSite({
      docsDir: fileURLToPath(new URL('../docs', import.meta.url)),
      stubsDir: fileURLToPath(new URL('./docs', import.meta.url)),
    }),
    siteShell(),
    await analyzer(),
  ],
  // Relative asset paths so the build works under any sub-path,
  // e.g. https://<user>.github.io/proschi/ on GitHub Pages.
  base: './',
  build: {
    // Fonts stay files: the static pages' CSP allows fonts from 'self' only, not data: URLs.
    assetsInlineLimit: (file: string) => (/\.woff2?$/.test(file) ? false : undefined),
    rollupOptions: {
      // The landing page at the root, the editor under app/, system design
      // practice under practice/, and model/, which forwards to the docs.
      // docsSite adds the docs pages (docs/**/index.html).
      input: {
        landing: fileURLToPath(new URL('./index.html', import.meta.url)),
        app: fileURLToPath(new URL('./app/index.html', import.meta.url)),
        practice: fileURLToPath(new URL('./practice/index.html', import.meta.url)),
        model: fileURLToPath(new URL('./model/index.html', import.meta.url)),
      },
      output: { manualChunks },
    },
  },
}))
