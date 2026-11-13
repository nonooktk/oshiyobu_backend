// ビルド。いまは「src/core/ が、外部に依存せず、ブラウザ向けに 1 つに束ねられること」の確認だけを行う。
//   - core は配布物にしない（frontend はソースを `src/core/` にそのまま置く。設計 D-07）。
//     束ねた dist/core.mjs は、確認のための出力（Git 管理外）。
//   - platform を browser にするので、`node:fs` などの Node 専用モジュールを import していると、ここで失敗する。
//   - 束ねたファイルの入力が、すべて src/core/ の中にあることも確かめる（外部パッケージへの依存を 0 に保つ）。
// API（サーバー）の束ね（esbuild で server.mjs 1 ファイル。設計 D-02）は、B-2 で足す。
import { build } from 'esbuild';
import { statSync } from 'node:fs';

const result = await build({
  entryPoints: ['src/core/index.ts'],
  outfile: 'dist/core.mjs',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  metafile: true,
  logLevel: 'warning',
});

const outside = Object.keys(result.metafile.inputs).filter((path) => !path.startsWith('src/core/'));
if (outside.length > 0) {
  console.error('src/core/ の外のファイルを取り込んでいます（外部への依存は禁止）:');
  for (const path of outside) console.error(`  ${path}`);
  process.exit(1);
}

const inputs = Object.keys(result.metafile.inputs).length;
const bytes = statSync('dist/core.mjs').size;
console.log(
  `core を束ねました: dist/core.mjs（入力 ${inputs} ファイル・${bytes} バイト）。外部への依存は 0 件`,
);
