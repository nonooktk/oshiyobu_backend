// ESLint 10（flat config）。型を見る規則（typescript-eslint の strictTypeChecked）を使う。
import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

// src/core/ は、ブラウザでも Node でも動く純粋な TypeScript（設計 D-06・D-07）。
// frontend がそのまま取り込むため、外への依存・Node だけの API・実行のたびに変わる値を禁止する。
const corePurity = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          regex: '^[^.]',
          message: 'src/core/ は外部への依存を持てません（相対パスの import だけ使えます）。',
        },
      ],
    },
  ],
  'no-restricted-globals': [
    'error',
    ...[
      'process',
      'Buffer',
      'require',
      'module',
      'exports',
      '__dirname',
      '__filename',
      'global',
      'window',
      'document',
      'navigator',
      'localStorage',
      'sessionStorage',
      'fetch',
      'console',
      'setTimeout',
      'setInterval',
    ].map((name) => ({
      name,
      message:
        'src/core/ は、Node だけ・ブラウザだけの API を使えません（純粋な計算だけを書きます）。',
    })),
  ],
  'no-restricted-properties': [
    'error',
    {
      object: 'Math',
      property: 'random',
      message: 'src/core/ は、呼ぶたびに値が変わる関数を使えません（結果が決まる純関数だけ）。',
    },
    {
      object: 'Date',
      property: 'now',
      message: 'src/core/ は、呼ぶたびに値が変わる関数を使えません（結果が決まる純関数だけ）。',
    },
  ],
};

export default tseslint.config(
  { ignores: ['node_modules/', 'dist/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // 数字を文字列に差し込む書き方（テンプレートリテラル）は、数値に限って許す。
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: corePurity,
  },
  {
    // 設定ファイルと検査用スクリプトは JavaScript。型を見る規則を外し、Node のグローバルを許す。
    files: ['scripts/**/*.mjs', 'eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
