import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const nativeDialogs = ['alert', 'confirm', 'prompt']
const NATIVE_DIALOG = "Use the design system's dialogs from src/design/dialogs (confirm, prompt, notify, copyText), not the browser's."

export default defineConfig([
  globalIgnores(['dist', 'dist-accounts', 'playwright-report', 'test-results']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactRefresh.configs.vite,
    ],
    // The rules of plugin v5's recommended set; v7's React Compiler rules aren't adopted yet.
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // The browser's own dialogs: use confirm, prompt, notify and copyText from src/design/dialogs instead.
      'no-restricted-globals': ['error', ...nativeDialogs.map((name) => ({ name, message: NATIVE_DIALOG }))],
      'no-restricted-properties': ['error', ...['window', 'globalThis', 'self'].flatMap((object) => nativeDialogs.map((property) => ({ object, property, message: NATIVE_DIALOG })))],
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
