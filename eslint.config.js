import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
      'stitch_project_blueprint_system/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node },
    },
    rules: {
      // Correctness over convenience. These catch real defects in a domain codebase, so they are
      // errors rather than warnings.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Interpolating a number is safe and legible. The rule's real value is catching `object`,
      // `any` and nullables in template strings, which stay disallowed.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],

      // Security and privacy: gap-spec section 54 forbids sensitive values in logs, and console.*
      // bypasses the redacting logger entirely.
      'no-console': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },

  // Config and script files are plain Node and sit outside any tsconfig project, so type-aware
  // rules cannot run against them. This must be its own entry: merging it into an object that also
  // defines `rules` would overwrite the rule-disabling map it carries.
  {
    files: ['*.config.js', '*.config.ts', 'scripts/**/*.{mjs,js}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['*.config.js', '*.config.ts', 'scripts/**/*.{mjs,js}'],
    rules: { 'no-console': 'off' },
  },

  // Tests may assert on shapes the type system cannot express, and deliberately construct invalid
  // input to prove validation rejects it.
  {
    files: ['**/test/**/*.ts', '**/*.test.ts', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },

  prettier,
);
