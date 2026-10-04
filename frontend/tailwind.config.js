/** @type {import('tailwindcss').Config} */

// The design tokens (src/design/tokens.css) as Tailwind colours, so `bg-paper`
// or `text-ink/60` follow the theme. Accents are under `pop` so Tailwind's own
// yellow, pink and blue scales stay as they are.
const token = (name) => `rgb(var(--c-${name}) / <alpha-value>)`

export default {
  // html[data-theme="dark"], set by public/theme-init.js from the saved or system theme.
  darkMode: ['selector', '[data-theme="dark"]'],
  content: [
    "./index.html",
    "./app/index.html",
    "./practice/index.html",
    "./model/index.html",
    "./docs/**/*.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: token('paper'),
        surface: token('surface'),
        ink: token('ink'),
        muted: token('muted'),
        pass: token('pass'),
        fail: token('fail'),
        'on-accent': token('on-accent'),
        pop: {
          yellow: token('yellow'),
          pink: token('pink'),
          blue: token('blue'),
          lilac: token('lilac'),
        },
      },
      fontFamily: {
        display: ['var(--font-display)'],
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      borderWidth: {
        'bw-1': 'var(--bw-1)',
        'bw-2': 'var(--bw-2)',
        'bw-3': 'var(--bw-3)',
      },
      borderRadius: {
        brutal: 'var(--r-md)',
      },
      boxShadow: {
        'brutal-sm': 'var(--sh-sm)',
        'brutal-md': 'var(--sh-md)',
        'brutal-lg': 'var(--sh-lg)',
      },
      transitionTimingFunction: {
        'out-brutal': 'var(--e-out)',
        snap: 'var(--e-snap)',
        spring: 'var(--e-spring)',
      },
      transitionDuration: {
        d1: 'var(--d-1)',
        d2: 'var(--d-2)',
        d3: 'var(--d-3)',
        d4: 'var(--d-4)',
        spring: 'var(--d-spring)',
      },
    },
  },
  plugins: [],
}
