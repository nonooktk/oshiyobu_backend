import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32, createZip } from '../../scripts/lib/zip.mjs';
import { readZip } from './zip-reader';

// 配備物の zip（設計 D-23）。外部の道具（zip コマンド）に頼らず、Node だけで作る（Windows でも同じに動かす）。
describe('CRC-32', () => {
  it('標準のテストベクトル（"123456789" → 0xCBF43926。空 → 0）', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });
});

describe('zip の作成 createZip', () => {
  const files = [
    { name: 'server.mjs', data: Buffer.from('console.log("こんにちは");\n'.repeat(200)) },
    { name: 'package.json', data: Buffer.from('{"type":"module"}\n') },
    { name: 'empty.txt', data: Buffer.alloc(0) },
  ];

  it('別の実装（テストの中の読み取り）で読み直して、名前・中身・CRC・大きさが、すべて元と一致する', () => {
    const entries = readZip(createZip(files));
    expect(entries.map((e) => e.name)).toEqual(['server.mjs', 'package.json', 'empty.txt']);
    for (const [i, file] of files.entries()) {
      const entry = entries[i];
      expect(entry).toBeDefined();
      const body = entry?.method === 8 ? inflateRawSync(entry.compressed) : entry?.compressed;
      expect(Buffer.from(body ?? []).equals(file.data)).toBe(true);
      expect(entry?.crc).toBe(crc32(file.data));
      expect(entry?.uncompressedSize).toBe(file.data.length);
    }
  });

  it('同じ入力からは、毎回、同じバイト列ができる（固定の日時。前の版との差を見やすくする）', () => {
    expect(createZip(files).equals(createZip(files))).toBe(true);
  });

  it('繰り返しの多い中身は圧縮し、圧縮で大きくなる中身（短いもの）は、そのまま入れる', () => {
    const entries = readZip(createZip(files));
    expect(entries[0]?.method).toBe(8);
    const serverFile = files[0];
    expect(serverFile).toBeDefined();
    expect(
      (entries[0]?.compressed.length ?? Number.POSITIVE_INFINITY) < (serverFile?.data.length ?? 0),
    ).toBe(true);
    expect(entries[1]?.method).toBe(0);
    expect(entries[2]?.method).toBe(0);
  });

  it('名前は UTF-8（フラグ付き）。パスの区切りは / で、先頭の / や .. は受けない', () => {
    expect(readZip(createZip([{ name: '日本語/あ.txt', data: Buffer.from('a') }]))[0]?.name).toBe(
      '日本語/あ.txt',
    );
    for (const name of ['/abs', '../up', 'a/../b', 'a\\b', '']) {
      expect(() => createZip([{ name, data: Buffer.from('a') }])).toThrow();
    }
  });

  it('同じ名前を 2 回入れたら例外にする', () => {
    expect(() =>
      createZip([
        { name: 'a', data: Buffer.from('1') },
        { name: 'a', data: Buffer.from('2') },
      ]),
    ).toThrow(/重複/);
  });
});
