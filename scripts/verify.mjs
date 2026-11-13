// CI の job「verify」と同じ検査を、手元で順に走らせる（npm run verify）。
// 1 つでも失敗したら、そこで止めて、同じ終了コードで終わる。
import { spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const steps = ['lint', 'format:check', 'check:secrets', 'typecheck', 'test', 'build'];

for (const step of steps) {
  console.log(`\n=== npm run ${step} ===`);
  const result = spawnSync(npm, ['run', step], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error(`\nverify: 「${step}」が失敗しました（終了コード ${result.status ?? 'なし'}）`);
    process.exit(result.status ?? 1);
  }
}
console.log('\nverify: すべて成功しました');
