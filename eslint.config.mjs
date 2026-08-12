import antfu from '@antfu/eslint-config';

export default antfu({
  ignores: [
    '.codegraph/**',
    '.vite/**',
    'apps/desktop/.vite/**',
    'apps/desktop/out/**',
    'apps/desktop/renderer/src/pages/**/*.css',
    'coverage/**',
    'dist/**',
    'docs/**',
    'node_modules/**',
    '**/*.md',
    'pnpm-lock.yaml',
  ],
  formatters: true,
  jsonc: true,
  markdown: false,
  pnpm: true,
  stylistic: {
    braceStyle: '1tbs',
    indent: 2,
    quotes: 'single',
    semi: true,
  },
  typescript: true,
  vue: true,
  yaml: true,
}, {
  files: ['apps/desktop/renderer/src/**/*.vue'],
  rules: {
    'vue/block-order': ['error', { order: ['script', 'template', 'style'] }],
    'vue/component-name-in-template-casing': ['error', 'PascalCase', {
      registeredComponentsOnly: false,
    }],
    'vue/html-self-closing': 'off',
  },
}, {
  files: ['apps/desktop/renderer/src/pages/**/*.vue'],
  rules: {
    'format/prettier': 'off',
    'no-irregular-whitespace': 'off',
    'style/comma-spacing': 'off',
    'style/no-trailing-spaces': 'off',
    'style/quotes': 'off',
    'vue/attributes-order': 'off',
    'vue/html-indent': 'off',
    'vue/multiline-html-element-content-newline': 'off',
    'vue/no-irregular-whitespace': 'off',
    'vue/singleline-html-element-content-newline': 'off',
  },
}, {
  files: ['apps/desktop/main/**/*.ts', 'apps/desktop/preload/**/*.ts', 'apps/desktop/scripts/**/*.mjs', 'apps/desktop/*.ts'],
  rules: {
    'node/prefer-global/process': 'off',
  },
}, {
  files: ['packages/**/*.test.ts', 'services/**/*.test.ts'],
  rules: {
    'test/no-import-node-test': 'off',
  },
});
