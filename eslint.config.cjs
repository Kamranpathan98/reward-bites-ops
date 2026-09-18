// @ts-check
// CommonJS on purpose: ESLint's flat-config loader `require()`s a `.cjs`
// file synchronously, but dynamically `import()`s a `.mjs` file — and Jest
// (apps/api/test/lint/module-boundaries.spec.ts loads this file through
// ESLint's own API) can't resolve a real dynamic import without
// --experimental-vm-modules. `.cjs` sidesteps that entirely.
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const eslintConfigPrettier = require('eslint-config-prettier');
const globals = require('globals');

/**
 * Module boundary enforcement for apps/api/src/modules/* — mirrors the
 * dependency graph in the Implementation Blueprint section 4. Intentionally
 * a small, explicit list of the forbidden edges called out by name in the
 * blueprint, not a fully generic graph checker.
 *
 * Every module folder also forbids importing `pg` directly — tenant-table
 * access must go through TransactionContext / withTenantTx in common/db.
 */
const allModules = [
  'tenancy',
  'identity',
  'tables',
  'menu',
  'orders',
  'billing',
  'payments',
  'kitchen',
  'expenses',
  'reporting',
  'audit',
  'public',
  'storage',
];

// Patterns are matched against the import specifier text itself (e.g.
// `../orders/orders.service`), not a resolved filesystem path — each
// module's other modules are always reached via `../<module>`.
/** @type {Record<string, string[]>} */
const forbiddenCrossImports = {
  // menu must never know an order exists
  menu: ['../orders', '../orders/**'],
  // billing depends on orders, never the reverse
  orders: ['../billing', '../billing/**', '../payments', '../payments/**'],
  // payments only ever touches a bill, never orders directly
  payments: ['../orders', '../orders/**'],
};

// No module other than platform itself may import from platform.
for (const moduleName of allModules) {
  if (moduleName === 'platform') continue;
  forbiddenCrossImports[moduleName] = [
    ...(forbiddenCrossImports[moduleName] ?? []),
    '../platform',
    '../platform/**',
  ];
}

const moduleBoundaryOverrides = allModules.map((moduleName) => ({
  files: [`apps/api/src/modules/${moduleName}/**/*.ts`],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: 'pg',
            message:
              'Do not import `pg` directly in a module. Use TransactionContext / withTenantTx from common/db.',
          },
        ],
        patterns: (forbiddenCrossImports[moduleName] ?? []).map((pattern) => ({
          group: [pattern],
          message:
            'Forbidden cross-module import: violates the module dependency graph in the Implementation Blueprint (section 4).',
        })),
      },
    ],
  },
}));

module.exports = tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.turbo/**',
      'apps/web/dist/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.es2022, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // This config file and other plain Node config/scripts are genuinely
    // CommonJS — require() here is correct, not a style slip.
    files: ['**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.es2022, ...globals.browser },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },
  ...moduleBoundaryOverrides,
  eslintConfigPrettier,
);
