import { describe, expect, it } from 'vitest';
import {
  ARTISTS,
  CITY_NAMES,
  REG_MAX,
  areaFor,
  colorStep,
  metricValues,
  radiusOf,
} from '../../src/core';

// 期待値の出どころ: 仕様.md SP-10（丸の半径・色の段）・SP-32（支援の状況）、テスト設計.md I-04・I-05・I-30。

describe('丸の半径 radiusOf（仕様 SP-10・I-04）', () => {
  it('基準の登録者数は 5 組 × 9 市の最大（krs48 の福岡市 21,800人）', () => {
    expect(REG_MAX).toBe(21_800);
  });

  it('krs48・福岡市（21,800人）＝ 44', () => {
    expect(radiusOf(21_800)).toBe(44);
  });

  it('tech0・久留米市（1,380人）＝ 約 11.1（±0.05）、tech0・福岡市（4,820人）＝ 約 20.7', () => {
    expect(radiusOf(1_380)).toBeCloseTo(11.1, 1);
    expect(Math.abs(radiusOf(1_380) - 11.1)).toBeLessThan(0.05);
    expect(radiusOf(4_820)).toBeCloseTo(20.7, 1);
  });

  it('登録者およそ 550人以下は 7（下限）。境界: 551 は下限のまま、553 から下限を超える', () => {
    expect(radiusOf(510)).toBe(7); // tech0・宮崎市
    expect(radiusOf(1)).toBe(7);
    expect(radiusOf(551)).toBe(7);
    expect(radiusOf(553)).toBeGreaterThan(7);
  });

  it('登録者が多いほど大きい（同じ市で、組どうしを比べる）', () => {
    for (const city of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      const sorted = ARTISTS.map((artist) => artist.reg[city] ?? 0).sort((a, b) => a - b);
      const radii = sorted.map((reg) => radiusOf(reg));
      expect(radii).toEqual([...radii].sort((a, b) => a - b));
    }
  });
});

describe('色の段 colorStep（仕様 SP-10・I-05）', () => {
  it('tech0 の払える熱量: 最小の市は 0、最大の市は 4。9 市を固定の配列で照合する', () => {
    // 熱量 [41, 33, 86, 47, 29, 52, 31, 26, 38]（最小 26・最大 86）→ min(4, ⌊(値 − 26) ÷ 60 × 5⌋)
    const values = metricValues('tech0', 'hot');
    expect(values).toEqual([41, 33, 86, 47, 29, 52, 31, 26, 38]);
    expect(values.map((v) => colorStep(values, v))).toEqual([1, 0, 4, 1, 0, 2, 0, 0, 1]);
  });

  it('tech0 の人数（登録者数）: 最大の市は 4（⌊5⌋ を 4 で止める）。9 市を固定の配列で照合する', () => {
    // 登録者数（最小 510・最大 4,820）→ min(4, ⌊(値 − 510) ÷ 4,310 × 5⌋)
    const values = metricValues('tech0', 'reg');
    expect(values.map((v) => colorStep(values, v))).toEqual([4, 1, 1, 0, 0, 1, 0, 0, 0]);
  });

  it('最大 ＝ 最小のとき（全部同じ値）は、分母を 1 にして 0 段にそろえる', () => {
    expect(colorStep([50, 50, 50], 50)).toBe(0);
  });

  it('段は 0〜4 の範囲に収まる（どの組・どの指標でも）', () => {
    for (const artist of ARTISTS) {
      for (const metric of ['reg', 'hot'] as const) {
        const values = metricValues(artist.id, metric);
        for (const v of values) {
          expect([0, 1, 2, 3, 4]).toContain(colorStep(values, v));
        }
      }
    }
  });
});

describe('支援の状況の表 areaFor（仕様 SP-32・I-30）', () => {
  it('基準（久留米市・N = 74）: 福岡県 60（久留米市 43［地元］・福岡市 14・北九州市 3）・佐賀県 7・熊本県 5・そのほか 2。合計 74', () => {
    const area = areaFor(74, '久留米市', 0);
    expect(area).toEqual([
      {
        pref: '福岡県',
        n: 60,
        cities: [
          { name: '久留米市', n: 43, isHome: true },
          { name: '福岡市', n: 14 },
          { name: '北九州市', n: 3 },
        ],
      },
      { pref: '佐賀県', n: 7, cities: [] },
      { pref: '熊本県', n: 5, cities: [] },
      { pref: 'そのほか', n: 2, cities: [] },
    ]);
    expect(area.reduce((sum, row) => sum + row.n, 0)).toBe(74);
  });

  it('申し込んだ後（1 人増）: 地元の市と地元の県に +1。合計 75', () => {
    const area = areaFor(74, '久留米市', 1);
    expect(area[0]).toMatchObject({ pref: '福岡県', n: 61 });
    expect(area[0]?.cities[0]).toEqual({ name: '久留米市', n: 44, isHome: true });
    expect(area.reduce((sum, row) => sum + row.n, 0)).toBe(75);
  });

  it('地元の県に市が 1 つだけの市（佐賀市・N = 31）: 残りは「ほかの市町村」。隣の県は佐賀県の近い順（福岡県・長崎県）', () => {
    const area = areaFor(31, '佐賀市', 0);
    expect(area).toEqual([
      {
        pref: '佐賀県',
        n: 25,
        cities: [
          { name: '佐賀市', n: 18, isHome: true },
          { name: 'ほかの市町村', n: 7 },
        ],
      },
      { pref: '福岡県', n: 3, cities: [] },
      { pref: '長崎県', n: 2, cities: [] },
      { pref: 'そのほか', n: 1, cities: [] },
    ]);
  });

  it('福岡市が地元のときの、同じ県の市の並びは、tech0 の登録者 × 熱量の大きい順（久留米市・北九州市）', () => {
    const area = areaFor(74, '福岡市', 0);
    expect(area[0]?.cities.map((city) => city.name)).toEqual(['福岡市', '久留米市', '北九州市']);
  });

  it('どの市・どの人数でも、表の合計は 初めの支援者 ＋ 申し込んだ人数 になり、人数 0 の行は出ない', () => {
    for (const city of CITY_NAMES) {
      for (const start of [1, 2, 5, 31, 74, 199, 300]) {
        for (const extra of [0, 1, 3]) {
          const area = areaFor(start, city, extra);
          expect(area.reduce((sum, row) => sum + row.n, 0)).toBe(start + extra);
          for (const row of area) {
            expect(row.n).toBeGreaterThan(0);
            if (row.cities.length > 0) {
              expect(row.cities.reduce((sum, c) => sum + c.n, 0)).toBe(row.n);
            }
          }
        }
      }
    }
  });
});
