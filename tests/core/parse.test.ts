import { describe, expect, it } from 'vitest';
import { MAX_COST_YEN, parseCost, parseMinPeople } from '../../src/core';

// 期待値の出どころ: 仕様.md SP-16・SP-70・SP-71（決定 13）、テスト設計.md I-07・I-08。
// 理由の文言は frontend の仕事。core は理由の種類（と、文言に使う値）を返す。

describe('最低人数の入力の検査 parseMinPeople（基準: キャパ 144。I-08・仕様 SP-70）', () => {
  it.each([
    ['80', 80],
    ['1', 1], // 下限
    ['144', 144], // キャパと同じ数は入る
    ['８０', 80], // 全角の数字は半角に直す
    [' 80 ', 80], // 前後の空白は無視する
    ['　80　', 80], // 全角の空白も無視する
    ['080', 80],
  ])('「%s」は受け付けて %i人', (input, value) => {
    expect(parseMinPeople(input, 144)).toEqual({ ok: true, value });
  });

  it.each([
    ['0', 0],
    ['145', 145], // キャパの 1 つ上
    ['99999999999999999999999', Number('99999999999999999999999')],
  ])('「%s」は範囲の外（1 以上・キャパ以下）', (input, value) => {
    expect(parseMinPeople(input, 144)).toEqual({
      ok: false,
      reason: 'out_of_range',
      input,
      value,
    });
  });

  it.each([['1.5'], ['abc'], ['-1'], ['+80'], ['1e2'], ['8 0'], ['80人']])(
    '「%s」は、数字だけの整数ではないので使えない',
    (input) => {
      expect(parseMinPeople(input, 144)).toEqual({ ok: false, reason: 'invalid_format', input });
    },
  );

  it('使えない入力は、全角の数字を半角に直したあとの文字で返す（理由の文言に写すため）', () => {
    expect(parseMinPeople('１．５', 144)).toEqual({
      ok: false,
      reason: 'invalid_format',
      input: '1．5',
    });
    expect(parseMinPeople('８０．５', 144)).toEqual({
      ok: false,
      reason: 'invalid_format',
      input: '80．5',
    });
  });

  it.each([[''], ['   '], ['　']])(
    '空欄（「%s」）は、打ち直しの途中として扱い、理由を出さない',
    (input) => {
      expect(parseMinPeople(input, 144)).toEqual({ ok: false, reason: 'blank' });
    },
  );

  it('桁が極端に多くても例外にならず、範囲の外になる（数が無限大になっても）', () => {
    const result = parseMinPeople('9'.repeat(400), 144);
    expect(result).toMatchObject({ ok: false, reason: 'out_of_range' });
  });

  it('キャパが 1 の会場でも、1 だけが入る', () => {
    expect(parseMinPeople('1', 1)).toEqual({ ok: true, value: 1 });
    expect(parseMinPeople('2', 1)).toMatchObject({ ok: false, reason: 'out_of_range' });
  });
});

describe('費用の入力の検査 parseCost（I-07・仕様 SP-71。0 以上の整数）', () => {
  it.each([
    ['0', 0], // 0 円は許す
    ['120', 120],
    ['１２０', 120], // 全角の数字は半角に直す
    ['65,000', 65_000], // 欄を離れると 3 桁区切りに整える。そのまま書き直せるように、区切りは受ける
    ['65，000', 65_000],
    [' 120 ', 120],
    ['100000', 100_000],
  ])('「%s」は受け付けて %i円', (input, value) => {
    expect(parseCost(input)).toEqual({ ok: true, value });
  });

  it.each([['-1'], ['1.5'], ['abc'], ['1e3'], ['１２０円'], [',']])(
    '「%s」は反映せず、理由を出して直させる',
    (input) => {
      expect(parseCost(input)).toMatchObject({ ok: false, reason: 'invalid_format' });
    },
  );

  it('空欄は 0 円にしない。直させる（決定 13。モックの「空欄は 0 円」から変えた）', () => {
    expect(parseCost('')).toEqual({ ok: false, reason: 'blank' });
    expect(parseCost('   ')).toEqual({ ok: false, reason: 'blank' });
  });

  it('上限は置かないが、5 項目の合計が正確に足せる大きさまで（MAX_COST_YEN）。超えたら too_large', () => {
    expect(parseCost(String(MAX_COST_YEN))).toEqual({ ok: true, value: MAX_COST_YEN });
    expect(parseCost(String(MAX_COST_YEN + 1))).toMatchObject({ ok: false, reason: 'too_large' });
    expect(parseCost('9'.repeat(400))).toMatchObject({ ok: false, reason: 'too_large' });
    // 5 項目すべてが上限でも、合計が安全な整数に収まる。
    expect(MAX_COST_YEN * 5).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
  });
});
