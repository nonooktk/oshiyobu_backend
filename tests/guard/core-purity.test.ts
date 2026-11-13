import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// 設計 D-06・D-07・テスト設計 I-109: src/core/ は、ブラウザでも Node でも動く純粋な TypeScript で、外部への依存を持たない。
// ESLint・tsconfig.core.json・build でも守っているが、ここでは「検索で確かめる」形で、ソースの文字そのものを調べる。
const CORE_DIR = join(import.meta.dirname, '..', '..', 'src', 'core');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

/** コメントと文字列の中身を除いたコード（import の行・識別子の検索に使う）。 */
function codeOf(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

describe('src/core/ の純粋さ（外部への依存と、Node だけの API が無い）', () => {
  const files = sourceFiles(CORE_DIR);

  it('core のソースが見つかる（検索の対象が空でない）', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('import / export from は、相対パス（./ か ../）だけ。パッケージ・node: の import が 0 件', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)) {
        const specifier = match[1] ?? '';
        if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
          offenders.push(`${file}: ${specifier}`);
        }
      }
      if (/\brequire\s*\(|\bimport\s*\(/.test(codeOf(text))) {
        offenders.push(`${file}: require / 動的 import`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('Node だけの API・ブラウザだけの API・呼ぶたびに値が変わる関数を使っていない', () => {
    const forbidden = [
      /\bprocess\b/,
      /\bBuffer\b/,
      /\b__dirname\b|\b__filename\b/,
      /\bglobalThis\b/,
      /\bwindow\b|\bdocument\b|\bnavigator\b/,
      /\blocalStorage\b|\bsessionStorage\b/,
      /\bfetch\s*\(/,
      /\bconsole\b/,
      /\bsetTimeout\b|\bsetInterval\b/,
      /\bMath\.random\b/,
      /\bDate\.now\b/,
      /\bnew Date\s*\(\s*\)/,
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const code = codeOf(readFileSync(file, 'utf8'));
      for (const pattern of forbidden) {
        if (pattern.test(code)) offenders.push(`${file}: ${pattern.source}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
