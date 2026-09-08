import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.forge/**',
      '**/*.d.ts',
      '**/static/**/build/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Explicit project list rather than `projectService: true`: package
        // tsconfigs cover `src` only (so the build does not emit test files),
        // while `tsconfig.tests.json` covers the test files and the root
        // tooling configs. Both must be visible to the type-aware rules.
        project: ['./packages/*/tsconfig.json', './apps/*/tsconfig.json', './tsconfig.tests.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/require-await': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  {
    files: ['**/*.test.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      // Spread first: `disableTypeChecked` turns the type-aware parser off
      // through `languageOptions.parserOptions`, and replacing the whole
      // object would turn it back on.
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: {
        // Node build scripts, plus the browser globals that appear inside
        // Playwright `page.evaluate` callbacks — those run in the page, not in
        // Node, so ESLint sees them in a Node file and would otherwise object.
        process: 'readonly',
        console: 'readonly',
        // Node 22 globals used by tools/seed-dev-site.mjs. `fetch` in
        // particular has no importable form, so it has to be declared here
        // rather than pulled in from `node:` like the other two could be.
        Buffer: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        window: 'readonly',
        document: 'readonly',
      },
    },
  },
  prettier,
);
