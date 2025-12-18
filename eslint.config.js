import js from '@eslint/js';
import prettier from 'eslint-config-prettier';

export default [
    js.configs.recommended,
    prettier,
    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                // Browser globals
                window: 'readonly',
                document: 'readonly',
                navigator: 'readonly',
                console: 'readonly',
                fetch: 'readonly',
                FormData: 'readonly',
                localStorage: 'readonly',
                sessionStorage: 'readonly',
                indexedDB: 'readonly',
                IndexedDB: 'readonly',
                DOMPurify: 'readonly',
                marked: 'readonly',
                hljs: 'readonly',
                Prism: 'readonly',
                katex: 'readonly',
                atob: 'readonly',
                btoa: 'readonly',
                Blob: 'readonly',
                URL: 'readonly',
                AbortController: 'readonly',
                Image: 'readonly',
                FileReader: 'readonly',
                TextDecoder: 'readonly',
                TextEncoder: 'readonly',
                CSS: 'readonly',
                WebSocket: 'readonly',
                // Timers (both Node.js and Browser)
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                requestAnimationFrame: 'readonly',
                cancelAnimationFrame: 'readonly',
                requestIdleCallback: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                setImmediate: 'readonly',
                clearImmediate: 'readonly',
                // Electron globals
                require: 'readonly',
                process: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                module: 'readonly',
                exports: 'readonly',
                Buffer: 'readonly',
                // Capacitor globals
                Capacitor: 'readonly'
            }
        },
        rules: {
            'no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_'
            }],
            'no-console': 'off', // 暂时允许，后续统一替换为日志系统
            'no-debugger': 'warn',
            'no-eval': 'error', // ❌ 禁止 eval（P0 安全问题）
            'no-implied-eval': 'error',
            'prefer-const': 'warn',
            'no-var': 'warn'
        }
    },
    {
        ignores: [
            'node_modules/',
            'dist/',
            'build/',
            'android/',
            'ios/',
            '*.min.js',
            '*.config.js',
            'capacitor.config.ts'
        ]
    }
];
