/** @type {import('tailwindcss').Config} */
import config from './tailwind.config.js'

// The docs' live examples (src/docs/live.css): the app's Tailwind utilities
// for the diagram and player components, without the preflight reset, which
// would restyle the docs' long-form text around them.
export default {
  ...config,
  corePlugins: { preflight: false },
}
