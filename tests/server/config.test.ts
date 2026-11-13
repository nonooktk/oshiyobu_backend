import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig, MIN_PASSPHRASE_LENGTH } from '../../src/server/config';

// 設計 D-24: 環境変数 PORT・DATA_DIR・CORS_ORIGINS・PRESENTER_PASSPHRASE・NODE_ENV。
// 合言葉の値は、テストの中で実行のたびに乱数で作る（ソースに値を書かない）。
const passphrase = (length: number) => randomBytes(length).toString('hex').slice(0, length);

describe('待ち受けの番号 PORT', () => {
  it('無ければ 8787（I-130 (b)）。空文字も無いものとして扱う（.env.example を写して値が空のとき）', () => {
    expect(loadConfig({}).config.port).toBe(8787);
    expect(loadConfig({ PORT: '' }).config.port).toBe(8787);
  });

  it('1〜65535 の整数を受ける', () => {
    expect(loadConfig({ PORT: '3456' }).config.port).toBe(3456);
    expect(loadConfig({ PORT: '1' }).config.port).toBe(1);
    expect(loadConfig({ PORT: '65535' }).config.port).toBe(65535);
  });

  it.each([['0'], ['65536'], ['-1'], ['abc'], ['80.5'], ['8080 '], ['\\\\.\\pipe\\x']])(
    '「%s」は使えない。8787 にして、警告を 1 件出す',
    (value) => {
      const { config, warnings } = loadConfig({ PORT: value });
      expect(config.port).toBe(8787);
      expect(warnings.map((w) => w.code)).toContain('invalid_port');
    },
  );
});

describe('保存先 DATA_DIR', () => {
  it('無ければ ./data（Git 管理外）。空文字も無いものとして扱う', () => {
    expect(loadConfig({}).config.dataDir).toBe('./data');
    expect(loadConfig({ DATA_DIR: '' }).config.dataDir).toBe('./data');
    expect(loadConfig({ DATA_DIR: '/home/data' }).config.dataDir).toBe('/home/data');
  });
});

describe('許す接続元 CORS_ORIGINS（完全一致。D-16）', () => {
  it('カンマ区切りで受ける。前後の空白と、末尾の / は取る', () => {
    const { config } = loadConfig({
      NODE_ENV: 'production',
      CORS_ORIGINS: ' https://a.example.test , https://b.example.test/ ',
    });
    expect(config.corsOrigins).toEqual(['https://a.example.test', 'https://b.example.test']);
  });

  it('NODE_ENV が未設定のときだけ、http://localhost:5173 を足す（開発の画面）。production では足さない', () => {
    expect(loadConfig({ CORS_ORIGINS: 'https://a.example.test' }).config.corsOrigins).toEqual([
      'https://a.example.test',
      'http://localhost:5173',
    ]);
    expect(loadConfig({}).config.corsOrigins).toEqual(['http://localhost:5173']);
    expect(loadConfig({ NODE_ENV: 'production' }).config.corsOrigins).toEqual([]);
  });

  it.each([
    ['*'],
    ['https://a.example.test/path'],
    ['ftp://a.example.test'],
    ['not a url'],
    ['https://A.Example.test'],
  ])('「%s」は origin の形でないので使わず、警告を出す（ワイルドカードも使わない）', (value) => {
    const { config, warnings } = loadConfig({ NODE_ENV: 'production', CORS_ORIGINS: value });
    expect(config.corsOrigins).toEqual([]);
    expect(warnings.map((w) => w.code)).toContain('invalid_cors_origin');
  });

  it('同じ origin が重なっていても、1 つにする', () => {
    const { config } = loadConfig({
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://a.example.test,https://a.example.test/',
    });
    expect(config.corsOrigins).toEqual(['https://a.example.test']);
  });
});

describe('発表者の合言葉 PRESENTER_PASSPHRASE（12 文字以上。D-15）', () => {
  it('12 文字以上なら有効（reset を使える）', () => {
    const value = passphrase(MIN_PASSPHRASE_LENGTH);
    const { config, warnings } = loadConfig({ PRESENTER_PASSPHRASE: value });
    expect(config.presenterPassphrase).toBe(value);
    expect(warnings.filter((w) => w.code.startsWith('passphrase'))).toEqual([]);
  });

  it('未設定・空文字は無効にして、警告を出す（reset は 503 になる）', () => {
    for (const env of [{}, { PRESENTER_PASSPHRASE: '' }]) {
      const { config, warnings } = loadConfig(env);
      expect(config.presenterPassphrase).toBeUndefined();
      expect(warnings.map((w) => w.code)).toContain('passphrase_not_configured');
    }
  });

  it('11 文字は短いので無効にして、警告を出す。境界の 12 文字は有効', () => {
    const short = loadConfig({ PRESENTER_PASSPHRASE: passphrase(11) });
    expect(short.config.presenterPassphrase).toBeUndefined();
    expect(short.warnings.map((w) => w.code)).toContain('passphrase_too_short');
    expect(
      loadConfig({ PRESENTER_PASSPHRASE: passphrase(12) }).config.presenterPassphrase,
    ).toBeDefined();
  });

  it('文字数は文字（コードポイント）で数える。12 文字の日本語も有効', () => {
    expect(
      loadConfig({ PRESENTER_PASSPHRASE: 'あ'.repeat(12) }).config.presenterPassphrase,
    ).toBeDefined();
    expect(
      loadConfig({ PRESENTER_PASSPHRASE: 'あ'.repeat(11) }).config.presenterPassphrase,
    ).toBeUndefined();
  });

  it('警告に、合言葉の値を入れない', () => {
    const value = passphrase(11);
    const { warnings } = loadConfig({ PRESENTER_PASSPHRASE: value });
    expect(JSON.stringify(warnings)).not.toContain(value);
  });
});
