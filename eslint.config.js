const js = require('@eslint/js');

module.exports = [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                console: 'readonly',
                process: 'readonly',
                Buffer: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                require: 'readonly',
                module: 'readonly',
                exports: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly'
            }
        },
        rules: {
            'no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
            'no-console': 'off',
            'semi': ['error', 'always'],
            'quotes': ['error', 'single']
        }
    },
    {
        files: ['src/**/*.js', 'tools/**/*.js'],
        languageOptions: {
            sourceType: 'commonjs'
        }
    }
];