import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// 設計 D-26 の文言ガード①、CLAUDE.md §7: 次の語は、データにも文言にも使わない。
// 口座に触れる言い方は、「今の口座に推しを登録する」「推し活定期」にする。
const FORBIDDEN_WORDS = ['新しい口座を開く', '口座開設', '確約'];
const SRC_DIR = join(import.meta.dirname, '..', '..', 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

describe('文言ガード（禁止語 0 件）', () => {
  it('src/ のどのファイルにも、禁止語が無い', () => {
    const files = sourceFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const word of FORBIDDEN_WORDS) {
        if (text.includes(word)) offenders.push(`${file}: ${word}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
