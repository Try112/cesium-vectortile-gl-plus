/**
 * prettier 配置文件
 * @see https://prettier.io/docs/en/options.html
 * @type {import("prettier").Config}
 */
const config = {
  arrowParens: 'avoid',
  bracketSpacing: true,
  endOfLine: 'lf', // 统一为 LF（可选：crlf | auto）

  // 为 JSON/JSONC 文件单独配置（兼容 JSON 语法）
  overrides: [
    {
      files: ['*.json', '*.jsonc', '*.geojson'], // 匹配 JSON/JSONC 文件
      options: {
        parser: 'json', // 指定 JSON 解析器
        singleQuote: false, // JSON 必须用双引号，禁用单引号
        trailingComma: 'none' // 避免 JSON 末尾逗号报错
      }
    }
  ],
  printWidth: 80,
  semi: false,
  singleQuote: true,
  tabWidth: 2,
  trailingComma: 'none',
  useTabs: false
}

export default config
