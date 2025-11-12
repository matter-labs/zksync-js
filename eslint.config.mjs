// eslint.config.mjs
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  // 0) Global ignores
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'examples/**',
      'scripts/**',
      'eslint.config.mjs',
      'docs/**',
      '**/__tests__/**',
      '**/*.test.ts',
      'typechain/**/**',
      'tsup.config.ts',
      'src/adapters/__tests__/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((cfg) => ({
    ...cfg,
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      ...cfg.languageOptions,
      parserOptions: {
        ...(cfg.languageOptions?.parserOptions ?? {}),
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: process.cwd(),
      },
    },
  })),
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'no-console': 'warn',
      '@typescript-eslint/consistent-type-imports': 'warn',
    },
  },
];
