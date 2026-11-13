// 型の検査。3 つの設定で tsc を順に走らせる（npm の scripts に && を書かず、Windows でも同じに動かすため）。
//   1. tsconfig.core.json … src/core/ だけ。lib は ES2022 のみ・types は空。
//      ブラウザでも Node でも動くこと（Node 専用 API・DOM を使っていないこと）を、型で確かめる。
//   2. tsconfig.json … src/・tests/ の全体。
//   3. tsconfig.loadtest.json … k6 の台本（loadtest/n22.js・lib.js）。@types/k6 で、k6 の API の使い方を型で確かめる
//      （k6 が手元に無くても、書き方の誤りに気づける）。
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tsc = require.resolve('typescript/bin/tsc');

for (const project of ['tsconfig.core.json', 'tsconfig.json', 'tsconfig.loadtest.json']) {
  console.log(`> tsc -p ${project} --noEmit`);
  const result = spawnSync(process.execPath, [tsc, '-p', project, '--noEmit'], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
console.log('型の検査: エラー 0 件');
