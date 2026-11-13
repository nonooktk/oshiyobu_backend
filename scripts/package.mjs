// 配備物（Azure App Service の Linux・Node 向けの zip）を作る（設計 D-23）。
//   中身: server.mjs（束ねた API・1 ファイル）と package.json（{"type":"module"} だけ）。node_modules は要らない。
//   出力: artifacts/oshiyobu-api-<core の版>-<コミット ID>.zip（Git 管理外。前の版の zip は、ここに残して、切り戻しに使う）。
//   配備そのものは、このスクリプトでは行わない（統括の承認後に、タキシードサムが手順どおりに行う）。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bundleServer } from './lib/server-bundle.mjs';
import { createZip } from './lib/zip.mjs';

const OUT_DIR = 'dist/server';
const ARTIFACTS_DIR = 'artifacts';

/** core の版（src/core/version.ts の CORE_VERSION）。 */
async function coreVersion() {
  const text = await readFile('src/core/version.ts', 'utf8');
  const match = /CORE_VERSION\s*=\s*'([^']+)'/.exec(text);
  if (match === null || match[1] === undefined) {
    throw new Error('src/core/version.ts から CORE_VERSION を読めません');
  }
  return match[1];
}

/** git のコミット ID（短い形）。未コミットの変更があれば -dirty を付ける。git が使えなければ nogit。 */
function commitId() {
  const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  if (head.status !== 0) return 'nogit';
  const dirty = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
  return `${head.stdout.trim()}${dirty.stdout.trim() === '' ? '' : '-dirty'}`;
}

const bundle = await bundleServer({ outDir: OUT_DIR });
const files = [
  { name: 'server.mjs', data: await readFile(join(OUT_DIR, 'server.mjs')) },
  { name: 'package.json', data: await readFile(join(OUT_DIR, 'package.json')) },
];
const zip = createZip(files);
const name = `oshiyobu-api-${await coreVersion()}-${commitId()}.zip`;
await mkdir(ARTIFACTS_DIR, { recursive: true });
const path = join(ARTIFACTS_DIR, name);
await writeFile(path, zip);

const sha256 = createHash('sha256').update(zip).digest('hex');
console.log(`配備物を作りました: ${path}`);
console.log(`  大きさ: ${zip.length} バイト（server.mjs ${bundle.bytes} バイト）`);
console.log(`  SHA-256: ${sha256}`);
console.log(`  中身: ${files.map((file) => file.name).join('・')}`);
if (name.endsWith('-dirty.zip')) {
  console.log(
    '  注意: 未コミットの変更があります。配備するのは、コミットした状態から作った zip にしてください。',
  );
}
