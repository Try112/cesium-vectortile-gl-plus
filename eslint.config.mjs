/**
 * ESLint 扁平配置（Flat Config）
 * @see https://eslint.org/docs/latest/use/configure/configuration-files
 */
import js from '@eslint/js'
import prettier from 'eslint-config-prettier'

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '*.config.js',
      '*.config.mjs',
      '*.config.cjs',
      'vite.config.js',
      'Cesium.d.ts'
    ]
  },
  js.configs.recommended,
  prettier,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        Cesium: 'readonly',
        // 浏览器 / 运行环境全局
        window: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        requestAnimationFrame: 'readonly',
        devicePixelRatio: 'readonly',
        URL: 'readonly',
        performance: 'readonly',
        setTimeout: 'readonly'
      }
    },
    rules: {
      // 代码风格由 Prettier 统一处理
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }]
    }
  },
  {
    files: ['Source/workers/**/*.js'],
    languageOptions: {
      globals: {
        self: 'readonly'
      }
    }
  }
]
