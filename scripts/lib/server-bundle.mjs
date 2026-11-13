// 共有メーター API を、esbuild で 1 ファイル（server.mjs）に束ねる（設計 D-02・D-23）。
// 配備物に node_modules は要らない。束ねたあと、外部への import が Node の組み込み（node:...）だけであることを確かめる
// （hono などが束ねから漏れていたら、配備した先で起動に失敗するため、ここで止める）。
import { build } from 'esbuild';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { join } from 'node:path';

/**
 * @param {{ outDir: string, entry?: string }} options
 * @returns {Promise<{ file: string, bytes: number, inputs: string[] }>}
 */
export async function bundleServer({ outDir, entry = 'src/server/index.ts' }) {
  await mkdir(outDir, { recursive: true });
  const file = join(outDir, 'server.mjs');
  const result = await build({
    entryPoints: [entry],
    outfile: file,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    metafile: true,
    logLevel: 'warning',
    // 束ねた依存に、require を使う書き方が残っていても動くようにする。
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
    },
  });

  const externals = Object.values(result.metafile.outputs)
    .flatMap((output) => output.imports)
    .filter((item) => item.external)
    .map((item) => item.path)
    .filter((path) => !path.startsWith('node:') && !builtinModules.includes(path));
  if (externals.length > 0) {
    throw new Error(
      `束ねから漏れた外部の import があります: ${[...new Set(externals)].join(', ')}`,
    );
  }

  // App Service が ESM として読むための package.json（設計 D-23。中身は type だけ）。
  await writeFile(join(outDir, 'package.json'), '{\n  "type": "module"\n}\n');
  const { size } = await stat(file);
  return { file, bytes: size, inputs: Object.keys(result.metafile.inputs) };
}
