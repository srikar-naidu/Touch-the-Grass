import eslint from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
  eslint.configs.recommended,
  {
    files: ['apps/**/*.js', 'apps/**/*.mjs'],
    rules: {
      'no-undef': 'off',
    },
  },
  {
    files: ['apps/**/*.ts', 'apps/**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      sourceType: 'module',
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
];
