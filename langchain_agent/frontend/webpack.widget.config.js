const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const webpack = require('webpack');

module.exports = {
  mode: 'production',
  entry: './src/widget.js',
  output: {
    path: path.resolve(__dirname, 'dist/widget'),
    filename: 'banking-chat-widget.js',
    library: {
      name: 'BankingChatWidget',
      type: 'umd',
    },
    globalObject: 'this',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', {
                targets: {
                  browsers: ['> 1%', 'last 2 versions']
                }
              }],
              ['@babel/preset-react', {
                runtime: 'automatic'
              }]
            ],
          },
        },
      },
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader'],
      },
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.env': JSON.stringify({}),
    }),
    new MiniCssExtractPlugin({
      filename: 'banking-chat-widget.css',
    }),
    new HtmlWebpackPlugin({
      template: './public/widget-demo.html',
      filename: 'demo.html',
    }),
  ],
  resolve: {
    extensions: ['.js', '.jsx'],
    fallback: {
      "process": false,
      "buffer": false,
    }
  },
  // Remove externals to bundle React with the widget
  // externals: {
  //   react: {
  //     commonjs: 'react',
  //     commonjs2: 'react',
  //     amd: 'React',
  //     root: 'React'
  //   },
  //   'react-dom': {
  //     commonjs: 'react-dom',
  //     commonjs2: 'react-dom',
  //     amd: 'ReactDOM',
  //     root: 'ReactDOM'
  //   }
  // },
};