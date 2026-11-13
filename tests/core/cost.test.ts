import { describe, expect, it } from 'vitest';
import {
  COST,
  COST_ITEM_IDS,
  COST_TIERS,
  costItems,
  costsOfTier,
  defaultMinPeople,
  lineOf,
  MAX_COST_YEN,
  needOf,
} from '../../src/core';

// 期待値の出どころ: 仕様.md「データ > 固定のデータ（SP-19）> 費用の区分」の表と「検算（基準の組み合わせ）」。
describe('費用の区分（仕様 SP-19）', () => {
  it.each([
    // 区分, 到達ライン, 価格, 必要人数
    [30, 280_000, 7_000, 40],
    [100, 650_000, 7_000, 93],
    [300, 1_500_000, 6_000, 250],
    [500, 2_450_000, 7_000, 350],
    [1000, 4_650_000, 7_500, 620],
  ] as const)('区分 %i: 到達ライン %i円・価格 %i円・必要人数 %i人', (tier, line, price, need) => {
    expect(COST[tier].price).toBe(price);
    expect(lineOf(costsOfTier(tier))).toBe(line);
    expect(needOf(line, price)).toBe(need);
  });

  it('区分は 5 つ、内訳は 5 項目で、区分 100 の値が表のとおり', () => {
    expect(COST_TIERS).toEqual([30, 100, 300, 500, 1000]);
    expect(COST_ITEM_IDS).toEqual(['venue', 'prod', 'fee', 'travel', 'profit']);
    expect(costsOfTier(100)).toEqual({
      venue: 60_000,
      prod: 100_000,
      fee: 250_000,
      travel: 120_000,
      profit: 120_000,
    });
  });
});

describe('到達ラインの内訳 5 項目（決定 9。仕様 SP-07・I-11）', () => {
  it('基準（区分 100）: 5 項目が決まった順に並び、合計が 650,000円', () => {
    const items = costItems(costsOfTier(100));
    expect(items).toEqual([
      { id: 'venue', yen: 60_000 },
      { id: 'prod', yen: 100_000 },
      { id: 'fee', yen: 250_000 },
      { id: 'travel', yen: 120_000 },
      { id: 'profit', yen: 120_000 },
    ]);
    expect(items.reduce((sum, item) => sum + item.yen, 0)).toBe(650_000);
  });

  it('費用を書き換えると、書き換えた項目だけが変わる（会場費 100,000 → 合計 690,000円。I-06）', () => {
    const edited = { ...costsOfTier(100), venue: 100_000 };
    expect(costItems(edited).find((item) => item.id === 'venue')?.yen).toBe(100_000);
    expect(lineOf(edited)).toBe(690_000);
  });
});

describe('費用の値の検査（呼ぶ側の誤りを、数字のずれにしない）', () => {
  const base = costsOfTier(100);

  it.each([
    ['負の数', -1],
    ['小数', 1.5],
    ['NaN', Number.NaN],
    ['無限大', Number.POSITIVE_INFINITY],
    ['上限を 1 円超える', MAX_COST_YEN + 1],
  ])('費用に %s が入っていたら、到達ラインを出さずに例外にする', (_label, bad) => {
    expect(() => lineOf({ ...base, venue: bad })).toThrow(RangeError);
  });

  it('境界: 0 円と、上限ちょうどは受ける', () => {
    expect(lineOf({ ...base, venue: 0 })).toBe(590_000);
    expect(lineOf({ venue: MAX_COST_YEN, prod: 0, fee: 0, travel: 0, profit: 0 })).toBe(
      MAX_COST_YEN,
    );
  });
});

describe('必要人数（到達ライン ÷ 通常の席の価格を切り上げ。仕様 SP-12）', () => {
  it('基準で、会場費を 100,000 にすると 99人（⌈690,000 ÷ 7,000⌉。I-06）', () => {
    expect(needOf(690_000, 7_000)).toBe(99);
  });

  it('境界: ちょうど割り切れるとき（7,000 → 1人）と、1円超えたとき（7,001 → 2人）', () => {
    expect(needOf(7_000, 7_000)).toBe(1);
    expect(needOf(7_001, 7_000)).toBe(2);
  });

  it('全項目が 0 円のとき、必要人数は 0（仕様 SP-71）', () => {
    expect(needOf(0, 7_000)).toBe(0);
  });

  it('価格が 0 以下・数でないときは、0 で割らずに例外にする（呼ぶ側の誤り）', () => {
    expect(() => needOf(650_000, 0)).toThrow(RangeError);
    expect(() => needOf(650_000, -7_000)).toThrow(RangeError);
    expect(() => needOf(650_000, Number.NaN)).toThrow(RangeError);
  });
});

describe('最低人数の初めの値（仕様 SP-16・設計 §18.2 の N1）', () => {
  it.each([
    [93, 93],
    [1, 1],
    // 全項目 0 円（必要人数 0）のとき、達成率の割り算が 0 にならないよう 1 から始める。
    [0, 1],
  ])('必要人数 %i人 → 最低人数の初めの値 %i人', (need, expected) => {
    expect(defaultMinPeople(need)).toBe(expected);
  });
});
