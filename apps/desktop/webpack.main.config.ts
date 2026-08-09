import type { Configuration } from 'webpack';

import { typescriptRules } from './webpack.rules';

export const mainConfig: Configuration = {
  devtool: 'source-map',
  entry: {
    'index': './main/index.ts',
    'core/index': './core/index.ts',
  },
  module: {
    rules: typescriptRules,
  },
  output: {
    filename: '[name].js',
  },
  resolve: {
    extensionAlias: {
      '.js': ['.js', '.ts'],
    },
    extensions: ['.js', '.ts'],
  },
};
