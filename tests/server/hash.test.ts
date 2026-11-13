import { describe, expect, it } from 'vitest';
import { hashDeviceId } from '../../src/server/hash';

// 端末の番号は、保存するときハッシュにする（設計 D-12・D-31）。SHA-256 の先頭 16 桁（16 進数）。
describe('端末の番号のハッシュ hashDeviceId', () => {
  it('SHA-256 の先頭 16 桁（標準のテストベクトル: "abc" → ba7816bf8f01cfea…）', () => {
    expect(hashDeviceId('abc')).toBe('ba7816bf8f01cfea');
  });

  it('16 桁の 16 進数で、元の文字列を含まない。同じ入力は同じ結果、違う入力は違う結果', () => {
    const id = 'A_b-C_d-E_f-G_h-0123';
    const hash = hashDeviceId(id);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hash).not.toContain(id);
    expect(hashDeviceId(id)).toBe(hash);
    expect(hashDeviceId(id + 'x')).not.toBe(hash);
  });
});
