import type { Configuration } from 'webpack';
import { VueLoaderPlugin } from 'vue-loader';

import { typescriptRules } from './webpack.rules';

export const rendererConfig: Configuration = {
  devtool: 'source-map',
  module: {
    rules: [
      ...typescriptRules,
      {
        test: /\.vue$/,
        loader: 'vue-loader',
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  plugins: [new VueLoaderPlugin()],
  resolve: {
    extensionAlias: {
      '.js': ['.js', '.ts'],
    },
    extensions: ['.js', '.ts', '.vue'],
  },
};
