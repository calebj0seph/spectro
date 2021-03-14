const path = require('path');

module.exports = {
    entry: './src/index.ts',
    devtool: 'source-map',
    target: 'web',
    output: {
        filename: 'main.js',
        path: path.resolve(__dirname, 'dist'),
    },
    resolve: {
        extensions: ['.ts', '.tsx', '.js', '.json'],
    },
    devServer: {
        contentBase: path.join(__dirname, 'dist'),
        compress: true,
        port: 9000,
    },
    module: {
        rules: [
            {
                test: /\.glsl$/,
                exclude: /node_modules/,
                use: [{ loader: 'webpack-glsl-minify' }],
            },
            {
                test: /\.worker\.ts$/,
                use: [
                    { loader: 'babel-loader' },
                    {
                        loader: 'worker-loader',
                        options: {
                            filename: '[contenthash].worker.js',
                        },
                    },
                ],
            },
            {
                test: /\.tsx?$/,
                exclude: /node_modules/,
                loader: 'babel-loader',
            },
        ],
    },
};
