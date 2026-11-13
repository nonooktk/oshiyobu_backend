import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  PERFORMANCE_IDS,
  isPerformanceId,
  isValidDeviceId,
  parseJoinResponse,
  parseMeterResponse,
  parseResetResponse,
  performanceIdOf,
} from '../../src/core';

// 期待値の出どころ: 設計 D-12（公演 ID）・D-13（API の応答の形）・D-18、テスト設計.md I-36・I-129・I-131・I-132。

const RESET_AT = '2026-11-20T00:30:00.000Z';

describe('公演 ID（設計 D-12）', () => {
  it('推し 5 × 会場 12 ＝ 60 件。重複が無い', () => {
    expect(PERFORMANCE_IDS).toHaveLength(60);
    expect(new Set(PERFORMANCE_IDS).size).toBe(60);
  });

  it('「推しの id:会場の id」の形で、基準の公演は tech0:cbox・負荷の試験の公演は terao:KGS-001（I-132）', () => {
    expect(performanceIdOf('tech0', 'cbox')).toBe('tech0:cbox');
    expect(isPerformanceId('tech0:cbox')).toBe(true);
    expect(isPerformanceId('terao:KGS-001')).toBe(true);
  });

  it.each([
    ['tech0:nope'],
    ['nobody:cbox'],
    ['tech0:cbox '],
    [' tech0:cbox'],
    ['TECH0:cbox'],
    ['tech0:CBOX'],
    ['tech0'],
    [''],
    ['__proto__'],
    ['constructor'],
    ['tech0:cbox\n'],
  ])('一覧に無い・形の違う「%s」は公演 ID として受けない', (value) => {
    expect(isPerformanceId(value)).toBe(false);
  });

  it('文字列以外は受けない', () => {
    expect(isPerformanceId(undefined)).toBe(false);
    expect(isPerformanceId(null)).toBe(false);
    expect(isPerformanceId(60)).toBe(false);
    expect(isPerformanceId(['tech0:cbox'])).toBe(false);
  });
});

describe('端末の番号の形（設計 D-13・D-14。^[A-Za-z0-9_-]{16,64}$）', () => {
  it.each([
    ['a'.repeat(16)], // 下限
    ['a'.repeat(64)], // 上限
    ['3f2b8c1e-9d4a-4e7b-8a61-2c5d7e9f0a13'], // UUID
    ['0123456789abcdef0123456789abcdef'], // 32 桁の 16 進数（randomUUID が無い環境。K-23）
    ['A_b-C_d-E_f-G_h-'],
  ])('「%s」は使える', (value) => {
    expect(isValidDeviceId(value)).toBe(true);
  });

  it.each([
    ['a'.repeat(15)], // 下限の 1 つ下
    ['a'.repeat(65)], // 上限の 1 つ上
    ['a'.repeat(15) + '!'],
    ['a'.repeat(15) + ' '],
    ['a'.repeat(16) + '\n'],
    ['あ'.repeat(16)],
    [''],
  ])('「%s」は使えない', (value) => {
    expect(isValidDeviceId(value)).toBe(false);
  });

  it('文字列以外は使えない', () => {
    expect(isValidDeviceId(undefined)).toBe(false);
    expect(isValidDeviceId(1e20)).toBe(false);
    expect(isValidDeviceId({})).toBe(false);
  });
});

describe('共有メーターの応答の検査 parseMeterResponse（I-36）', () => {
  const ok = { performanceId: 'tech0:cbox', joined: 0, resetAt: null };

  it('GET meter の応答: joined は申し込みの件数（0 から。開始人数 74 を含まない。K-06）', () => {
    expect(parseMeterResponse(ok)).toEqual({
      performanceId: 'tech0:cbox',
      joined: 0,
      resetAt: null,
    });
    expect(parseMeterResponse({ ...ok, joined: 19, resetAt: RESET_AT })).toEqual({
      performanceId: 'tech0:cbox',
      joined: 19,
      resetAt: RESET_AT,
    });
  });

  it('知らない項目は捨てて、決まった項目だけを返す（前もって項目が増えても、画面は落ちない）', () => {
    const parsed = parseMeterResponse({ ...ok, joined: 3, extra: 'x', counted: true });
    expect(parsed).toEqual({ performanceId: 'tech0:cbox', joined: 3, resetAt: null });
    expect(Object.keys(parsed ?? {}).sort()).toEqual(['joined', 'performanceId', 'resetAt']);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['文字列', 'tech0:cbox'],
    ['数', 3],
    ['配列', [ok]],
    ['空のオブジェクト', {}],
    ['performanceId が無い', { joined: 0, resetAt: null }],
    ['joined が無い', { performanceId: 'tech0:cbox', resetAt: null }],
    ['resetAt が無い（null ではなく項目が無い）', { performanceId: 'tech0:cbox', joined: 0 }],
    ['一覧に無い公演 ID', { ...ok, performanceId: 'tech0:nope' }],
    ['joined が負', { ...ok, joined: -1 }],
    ['joined が小数', { ...ok, joined: 1.5 }],
    ['joined が文字列', { ...ok, joined: '3' }],
    ['joined が NaN', { ...ok, joined: Number.NaN }],
    ['joined が無限大', { ...ok, joined: Number.POSITIVE_INFINITY }],
    ['joined が安全な整数を超える', { ...ok, joined: Number.MAX_SAFE_INTEGER + 1 }],
    ['resetAt が日付の形でない', { ...ok, resetAt: 'yesterday' }],
    ['resetAt が日付だけ', { ...ok, resetAt: '2026-11-20' }],
    ['resetAt が存在しない日時', { ...ok, resetAt: '2026-13-45T00:00:00.000Z' }],
    ['resetAt が数', { ...ok, resetAt: 20261120 }],
    ['resetAt が空文字', { ...ok, resetAt: '' }],
  ])('型が違う応答は無視する（null を返す）: %s', (_label, value) => {
    expect(parseMeterResponse(value)).toBeNull();
  });

  it('自分の項目ではなく、プロトタイプから受け継いだ項目は数えない', () => {
    const inherited = Object.create(ok) as unknown;
    expect(parseMeterResponse(inherited)).toBeNull();
  });

  it('resetAt は、ミリ秒の有無のどちらの ISO 8601（UTC）も受ける', () => {
    expect(parseMeterResponse({ ...ok, resetAt: '2026-11-20T00:30:00Z' })?.resetAt).toBe(
      '2026-11-20T00:30:00Z',
    );
    expect(parseMeterResponse({ ...ok, resetAt: RESET_AT })?.resetAt).toBe(RESET_AT);
  });
});

describe('申し込みの応答の検査 parseJoinResponse（I-36・I-37）', () => {
  const ok = { performanceId: 'tech0:cbox', joined: 1, counted: true, resetAt: null };

  it('counted つき: 1 回目は true、同じ端末の 2 回目は false（数は増えない）', () => {
    expect(parseJoinResponse(ok)).toEqual(ok);
    expect(parseJoinResponse({ ...ok, counted: false })).toEqual({ ...ok, counted: false });
  });

  it('counted が無い・真偽値でない応答、メーターの形に合わない応答は無視する', () => {
    expect(parseJoinResponse({ performanceId: 'tech0:cbox', joined: 1, resetAt: null })).toBeNull();
    expect(parseJoinResponse({ ...ok, counted: 'true' })).toBeNull();
    expect(parseJoinResponse({ ...ok, counted: 1 })).toBeNull();
    expect(parseJoinResponse({ ...ok, joined: -1 })).toBeNull();
    expect(parseJoinResponse(null)).toBeNull();
  });
});

describe('初期化の応答の検査 parseResetResponse', () => {
  it('{ resetAt } を受ける。resetAt は ISO 8601 の文字列で、null は受けない（reset は必ず時刻を返す）', () => {
    expect(parseResetResponse({ resetAt: RESET_AT })).toEqual({ resetAt: RESET_AT });
    expect(parseResetResponse({ resetAt: null })).toBeNull();
    expect(parseResetResponse({})).toBeNull();
    expect(parseResetResponse({ resetAt: 'now' })).toBeNull();
    expect(parseResetResponse('ok')).toBeNull();
  });
});

describe('エラーの種類', () => {
  it('API のエラーの種類は、設計 D-13 に出てくる 6 つ', () => {
    expect([...API_ERROR_CODES].sort()).toEqual(
      [
        'cap_reached',
        'invalid_body',
        'not_configured',
        'rate_limited',
        'unauthorized',
        'unknown_performance',
      ].sort(),
    );
  });
});
