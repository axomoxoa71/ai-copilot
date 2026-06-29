import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tsParser from '@typescript-eslint/parser'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'node_modules']),
  {
    files: ['**/*.{js,jsx,ts,tsx,mjs,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // TypeScript already handles unresolved names and type-only symbols.
      'no-undef': 'off',
      // Base rule is not TypeScript-aware and reports types/interfaces incorrectly.
      'no-unused-vars': 'off',
    },
  },
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['agent-api/**/*.js', 'vite.config.js', 'playwright.config.js'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // Keep node logs intentional while preserving existing inline disables.
      'no-console': 'warn',
    },
  },
])
