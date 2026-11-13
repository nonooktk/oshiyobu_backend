import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findSecretAssignments } from '../../scripts/lib/no-secrets.mjs';

// 設計 D-30・テスト設計 I-45: 合言葉の値を、リポジトリ（追跡しているファイル）に書かない。
// 検査の入力（違反の例）は、このファイル自身が検査に引っかからないよう、名前を 2 つに割って組み立てる。
const NAME = ['PRESENTER', 'PASSPHRASE'].join('_');
const file = (path: string, text: string) => ({ path, text });

describe('合言葉の値を書いていない（違反を検出する）', () => {
  it.each([
    ['.env を追跡している', file('.env', `${NAME}=\n`)],
    ['.env.production を追跡している', file('config/.env.production', '\n')],
    ['.env.example に値がある', file('.env.example', `${NAME}=abc123abc123\n`)],
    ['.env.example に引用符つきの値がある', file('.env.example', `${NAME}="abc123abc123"\n`)],
    ['TypeScript の文字列', file('src/x.ts', `const env = { ${NAME}: 'abc123abc123' };\n`)],
    ['TypeScript のテンプレート文字列', file('src/x.ts', `process.env.${NAME} = \`abc\`;\n`)],
    ['yml の値', file('.github/workflows/x.yml', `        ${NAME}: abc123abc123\n`)],
    ['シェルの値', file('docs/x.sh', `export ${NAME}=abc123abc123\n`)],
    [
      'Markdown の値',
      file('README.md', `az webapp config appsettings set --settings ${NAME}=abc123\n`),
    ],
    ['JSON の値', file('x.json', `  "${NAME}": "abc123abc123",\n`)],
    ['PowerShell の値', file('x.ps1', `$env:${NAME} = "abc123abc123"\n`)],
  ])('%s', (_label, input) => {
    const found = findSecretAssignments([input]);
    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe(input.path);
  });

  it('見つけた場所の報告に、値そのものを入れない', () => {
    const value = 'zzzz-never-print-this-1234';
    const found = findSecretAssignments([file('docs/x.md', `${NAME}=${value}\n`)]);
    expect(JSON.stringify(found)).not.toContain(value);
    expect(found[0]).toMatchObject({ path: 'docs/x.md', line: 1 });
  });
});

describe('合言葉の値を書いていない（問題にしない書き方）', () => {
  it.each([
    ['.env.example の空の値', file('.env.example', `# 発表者の合言葉\n${NAME}=\n`)],
    ['.env.example の説明のコメント', file('.env.example', `# ${NAME} は 12 文字以上\n`)],
    ['環境変数を読む', file('src/x.ts', `const v = process.env.${NAME};\nconst k = '${NAME}';\n`)],
    ['変数を渡す（値を書かない）', file('tests/x.ts', `env: { ${NAME}: passphrase },\n`)],
    ['Actions の secret の参照', file('x.yml', `  ${NAME}: \${{ secrets.${NAME} }}\n`)],
    ['シェルの変数の参照', file('x.sh', `${NAME}="$LOCAL_VALUE"\n`)],
    ['Markdown の説明用の置き換え文字', file('README.md', `${NAME}=<12 文字以上の合言葉>\n`)],
    ['Markdown の省略', file('README.md', `${NAME}=…\n`)],
    ['名前だけの言及', file('README.md', `アプリ設定の ${NAME} に、統括が値を入れます。\n`)],
    ['.env.example という名前のファイルだけが許される', file('.env.example', '\n')],
  ])('%s', (_label, input) => {
    expect(findSecretAssignments([input])).toEqual([]);
  });
});

describe('このリポジトリ（追跡しているファイル）の検査（I-45）', () => {
  it('npm run check:secrets が成功する（終了コード 0）', () => {
    const result = spawnSync(process.execPath, ['scripts/check-no-secrets.mjs'], {
      cwd: join(import.meta.dirname, '..', '..'),
      encoding: 'utf8',
    });
    expect({ status: result.status, out: result.stdout + result.stderr }).toMatchObject({
      status: 0,
    });
  });

  it('.env.example は、キー名だけで値が空。使う環境変数が、すべて書いてある（設計 D-24）', () => {
    const text = readFileSync(join(import.meta.dirname, '..', '..', '.env.example'), 'utf8');
    const assignments = text
      .split('\n')
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => line.split('='));
    expect(assignments.map(([key]) => key)).toEqual(
      expect.arrayContaining([
        'PORT',
        'DATA_DIR',
        'CORS_ORIGINS',
        'PRESENTER_PASSPHRASE',
        'NODE_ENV',
      ]),
    );
    for (const [key, value] of assignments) {
      expect(value, `${key ?? ''} の値は空`).toBe('');
    }
  });
});
