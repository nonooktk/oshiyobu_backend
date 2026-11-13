// 型の検査。2 つの設定で tsc を順に走らせる（npm の scripts に && を書かず、Windows でも同じに動かすため）。
//   1. tsconfig.core.json … src/core/ だけ。lib は ES2022 のみ・types は空。
//      ブラウザでも Node でも動くこと（Node 専用 API・DOM を使っていないこと）を、型で確かめる。
//   2. tsconfig.json … src/・tests/ の全体。
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tsc = require.resolve('typescript/bin/tsc');

for (const project of ['tsconfig.core.json', 'tsconfig.json']) {
  console.log(`> tsc -p ${project} --noEmit`);
  const result = spawnSync(process.execPath, [tsc, '-p', project, '--noEmit'], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
console.log('型の検査: エラー 0 件');
