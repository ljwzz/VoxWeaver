import antfu from '@antfu/eslint-config';

const filenameCaseOptions = {
  cases: {
    camelCase: true,
    pascalCase: true,
  },
  ignore: [
    '.*.config.*',
    'package.json',
    '[a-z]+.[jt]s',
    '[a-z]+.d.ts',
  ],
};

export default antfu({
  ignores: [
    '.codex',
    '.codegraph',
    '**/coverage/**',
    '**/dist/**',
    '**/*.md',
    'data/**',
    'docs/**',
    'plan/**',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig*.json',
    '*.log',
    '.env*',
    '!.env.example',
  ],
  formatters: true,
  imports: true,
  isInEditor: false,
  jsx: true,
  pnpm: true,
  regexp: true,
  stylistic: {
    overrides: {
      'style/brace-style': ['error', '1tbs', { allowSingleLine: true }],
    },
    semi: true,
  },
  typescript: true,
  unicorn: true,
  vue: true,
})
  .override('antfu/unicorn/rules', {
    rules: {
      'node/prefer-global/process': 'off',
      'unicorn/filename-case': ['error', filenameCaseOptions],
    },
  })
  .append({
    name: 'local:built-package-tests',
    files: ['packages/*/test/**/*.test.mjs'],
    rules: {
      'antfu/no-import-dist': 'off',
      'test/no-import-node-test': 'off',
    },
  });
