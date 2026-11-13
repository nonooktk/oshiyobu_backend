// Git に入っている（追跡中）か、これから入る（未追跡で、.gitignore の対象でない）ファイルに、合言葉の値が無いことを確かめる（npm run check:secrets。CI の verify に含める）。
// 見つけたら、ファイル名・行・理由だけを出して、終了コード 1 で終わる（値は出さない）。
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { findSecretAssignments } from './lib/no-secrets.mjs';

const MAX_BYTES = 1_000_000;

const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
if (listed.status !== 0) {
  console.error('git ls-files を実行できません。Git のリポジトリの中で実行してください。');
  process.exit(2);
}

const files = [];
for (const path of listed.stdout.split('\0').filter((entry) => entry !== '')) {
  if (path === 'package-lock.json') continue;
  let stats;
  try {
    stats = statSync(path);
  } catch {
    continue; // 追跡しているが、手元に無い（削除の途中）
  }
  if (!stats.isFile() || stats.size > MAX_BYTES) continue;
  const buffer = readFileSync(path);
  if (buffer.includes(0)) continue; // バイナリ
  files.push({ path, text: buffer.toString('utf8') });
}

const findings = findSecretAssignments(files);
if (findings.length > 0) {
  console.error('合言葉の値（または .env 系のファイル）が、リポジトリに入っています:');
  for (const finding of findings) {
    console.error(
      `  ${finding.path}${finding.line > 0 ? `:${finding.line}` : ''}  ${finding.reason}`,
    );
  }
  console.error(
    '値を消し、Azure のアプリ設定で渡してください。すでにコミットした値は、使えないものとして、統括に伝えてください。',
  );
  process.exit(1);
}
console.log(`秘密の検査: Git に入る ${files.length} ファイルに、合言葉の値は見つかりませんでした`);
