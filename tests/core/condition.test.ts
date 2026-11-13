import { describe, expect, it } from 'vitest';
import {
  conditionOf,
  courseOffersOf,
  defaultVenueIdOf,
  demandOf,
  exceedsCapacity,
  levelOf,
  shortfallOf,
  upliftOf,
  venueById,
} from '../../src/core';
import type { Level, VenueId } from '../../src/core';

// 期待値の出どころ: 仕様.md「データ > 固定のデータ（SP-19）> 会場 12 件」の表（書記の検算つき）と「検算（基準の組み合わせ）」。
// 表の列: 会場 ID・キャパ・区分・到達ライン・必要人数・初めの支援者・前方の席の席数・上乗せ・tech0 の見込み・札。
const VENUE_TABLE: ReadonlyArray<
  readonly [VenueId, number, number, number, number, number, number, number, number, Level]
> = [
  ['FUK-020', 50, 30, 280_000, 40, 31, 5, 642_000, 311, '高'],
  ['FUK-016', 180, 100, 650_000, 93, 74, 18, 824_000, 311, '高'],
  ['FUK-012', 300, 300, 1_500_000, 250, 199, 30, 936_000, 311, '中'],
  ['FUK-018', 120, 100, 650_000, 93, 74, 12, 740_000, 112, '中'],
  ['cbox', 144, 100, 650_000, 93, 74, 14, 768_000, 187, '高'],
  ['riseup', 150, 100, 650_000, 93, 74, 15, 782_000, 187, '高'],
  ['SAG-003', 60, 30, 280_000, 40, 31, 6, 656_000, 47, '中'],
  ['NGS-001', 40, 30, 280_000, 40, 31, 4, 628_000, 45, '中'],
  ['KMM-002', 100, 100, 650_000, 93, 74, 10, 712_000, 144, '高'],
  ['OIT-004', 100, 100, 650_000, 93, 74, 10, 712_000, 35, '低'],
  ['MYZ-004', 300, 300, 1_500_000, 250, 199, 30, 936_000, 21, '低'],
  ['KGS-001', 60, 30, 280_000, 40, 31, 6, 656_000, 67, '高'],
];

describe('会場 12 件の表（仕様 SP-19。tech0 での検算）', () => {
  it.each(VENUE_TABLE)(
    '%s: キャパ %i・区分 %i → 到達ライン %i円・必要人数 %i人・初めの支援者 %i人・前方 %i席・上乗せ %i円・見込み %i人（札 %s）',
    (id, cap, tier, line, need, start, frontSeats, uplift, expected, level) => {
      const venue = venueById(id);
      expect(venue.cap).toBe(cap);
      expect(venue.tier).toBe(tier);

      const cond = conditionOf(id);
      expect(cond.line).toBe(line);
      expect(cond.need).toBe(need);
      expect(cond.min).toBe(need); // 最低人数の初めの値は必要人数
      expect(cond.start).toBe(start);

      const front = cond.courses.find((course) => course.id === 'front');
      expect(front?.slots).toBe(frontSeats);
      expect(upliftOf(cond).total).toBe(uplift);

      const demand = demandOf('tech0', venue.city);
      expect(demand.expected).toBe(expected);
      expect(levelOf(demand.expected, cond.need)).toBe(level);
    },
  );
});

// 到達ライン・必要人数・見込み・札・初めの支援者の検算は golden.test.ts。ここは、コースの金額・枠と上乗せの内訳。
describe('基準の組み合わせの、応援コースと上乗せ（tech0・久留米市・Cボックス）', () => {
  const cond = conditionOf('cbox');

  it('応援コース 4 つの金額と枠（前方 21,000円・14席。通常はキャパまで）', () => {
    expect(cond.courses.map(({ id, price, slots, unit }) => ({ id, price, slots, unit }))).toEqual([
      { id: 'normal', price: 7_000, slots: 144, unit: '席' },
      { id: 'front', price: 21_000, slots: 14, unit: '席' },
      { id: 'special', price: 100_000, slots: 3, unit: '枠' },
      { id: 'top', price: 300_000, slots: 1, unit: '枠' },
    ]);
  });

  it('上位コースの上乗せは (金額 − 通常の席) × 枠 の合計 768,000円（196,000 + 279,000 + 293,000）', () => {
    const uplift = upliftOf(cond);
    expect(uplift.rows.map(({ courseId, plus }) => ({ courseId, plus }))).toEqual([
      { courseId: 'front', plus: 196_000 },
      { courseId: 'special', plus: 279_000 },
      { courseId: 'top', plus: 293_000 },
    ]);
    expect(uplift.total).toBe(768_000);
  });
});

describe('条件の書き換え（「条件を調整」。仕様 SP-05・SP-06）', () => {
  it('会場費を 100,000 にすると、到達ライン 690,000円・必要人数 99人・最低人数 99人。上乗せ・初めの支援者は変わらない（I-06）', () => {
    const base = conditionOf('cbox');
    const cond = conditionOf('cbox', { costs: { ...base.costs, venue: 100_000 } });
    expect(cond.line).toBe(690_000);
    expect(cond.need).toBe(99);
    expect(cond.min).toBe(99);
    expect(upliftOf(cond).total).toBe(768_000);
    // ファン向けには到達ライン・必要人数・最低人数だけを渡す（設計 D-44）。初めの支援者は変えない。
    expect(cond.start).toBe(74);
  });

  it('最低人数を手で決めると、その値を保つ。必要人数と同じ数でも手で決めた値として保つ（仕様 SP-16）', () => {
    expect(conditionOf('cbox', { minPeople: 80 }).min).toBe(80);
    expect(conditionOf('cbox', { minPeople: 93 }).min).toBe(93);
  });

  it('最低人数を手で決めても、必要人数・札は変わらない（決定 12）', () => {
    const cond = conditionOf('cbox', { minPeople: 80 });
    expect(cond.need).toBe(93);
    expect(levelOf(187, cond.need)).toBe('高');
  });

  it('全項目が 0 円のとき、必要人数 0・最低人数 1・札「高」（仕様 SP-71・設計 N1）', () => {
    const zero = { venue: 0, prod: 0, fee: 0, travel: 0, profit: 0 };
    const cond = conditionOf('cbox', { costs: zero });
    expect(cond.line).toBe(0);
    expect(cond.need).toBe(0);
    expect(cond.min).toBe(1);
    expect(levelOf(187, cond.need)).toBe('高');
  });

  it('最低人数に 1 未満・小数が渡されたら例外にする（入力の検査は parseMinPeople の仕事）', () => {
    expect(() => conditionOf('cbox', { minPeople: 0 })).toThrow(RangeError);
    expect(() => conditionOf('cbox', { minPeople: 1.5 })).toThrow(RangeError);
  });
});

describe('必要人数がキャパを超えるか（仕様 SP-72。費用を上げたとき）', () => {
  // キャパ 144・価格 7,000円。出演料以外は基準のまま（60,000 + 100,000 + 120,000 + 120,000 = 400,000円）。
  const withFee = (fee: number) => {
    const base = conditionOf('cbox');
    return conditionOf('cbox', { costs: { ...base.costs, fee } });
  };

  it('基準（必要人数 93人）は、キャパ 144席に収まる', () => {
    expect(exceedsCapacity(conditionOf('cbox'))).toBe(false);
  });

  it('境界: 出演料 608,000円 → 到達ライン 1,008,000円 → ちょうど 144人でキャパに収まる。1 円上げると 145人で超える', () => {
    expect(withFee(608_000).need).toBe(144);
    expect(exceedsCapacity(withFee(608_000))).toBe(false);
    expect(withFee(608_001).need).toBe(145);
    expect(exceedsCapacity(withFee(608_001))).toBe(true);
  });

  it('警告を出しても、札は必要人数と見込みだけで決まる（提案の可否は変わらない。A3）', () => {
    const cond = withFee(700_000); // 到達ライン 1,100,000円 → 必要人数 158人
    expect(cond.need).toBe(158);
    expect(exceedsCapacity(cond)).toBe(true);
    expect(levelOf(187, cond.need)).toBe('中'); // 187 ÷ 158 ＝ 1.18
  });
});

describe('札（見込み ÷ 必要人数。仕様 SP-13）', () => {
  it.each([
    [150, 100, '高'], // 1.5 ちょうどは「高」
    [149, 100, '中'],
    [100, 100, '中'], // 1 ちょうどは「中」
    [99, 100, '低'],
    [187, 0, '高'], // 必要人数 0（全項目 0 円）
  ] as const)('見込み %i人・必要人数 %i人 → 「%s」', (expected, need, level) => {
    expect(levelOf(expected, need)).toBe(level);
  });

  it('terao・久留米市: 見込み 45人 ÷ 必要人数 93人 → 「低」で、あと 48人（I-02）', () => {
    const need = conditionOf('cbox').need;
    expect(levelOf(45, need)).toBe('低');
    expect(shortfallOf(45, need)).toBe(48);
  });

  it('不足は 0 未満にならない（見込みが必要人数以上なら 0）', () => {
    expect(shortfallOf(187, 93)).toBe(0);
  });
});

describe('会場候補（仕様 SP-11・SP-49）', () => {
  it('市を変えたときの会場は、久留米市は Cボックス、ほかは tech0 の見込みにキャパが最も近い 1 件', () => {
    expect(defaultVenueIdOf('久留米市')).toBe('cbox');
    expect(defaultVenueIdOf('福岡市')).toBe('FUK-012'); // 見込み 311 に、キャパ 300 が最も近い
    expect(defaultVenueIdOf('北九州市')).toBe('FUK-018');
    expect(defaultVenueIdOf('佐賀市')).toBe('SAG-003');
    expect(defaultVenueIdOf('長崎市')).toBe('NGS-001');
    expect(defaultVenueIdOf('熊本市')).toBe('KMM-002');
    expect(defaultVenueIdOf('大分市')).toBe('OIT-004');
    expect(defaultVenueIdOf('宮崎市')).toBe('MYZ-004');
    expect(defaultVenueIdOf('鹿児島市')).toBe('KGS-001');
  });
});

describe('応援コース（仕様 SP-19「コース 4 つ」・決定 15）', () => {
  it('手に入るもの: 通常 1・前方 2・特別 5・最上位 5。入場は全コースに含む', () => {
    const offers = courseOffersOf('cbox');
    expect(offers.map((offer) => offer.perks.length)).toEqual([1, 2, 5, 5]);
    for (const offer of offers) {
      expect(offer.perks[0]).toMatch(/^ライブへの入場/);
    }
  });

  it('預金の条件: 20,000・100,000・300,000・1,000,000円以上。メイン口座は前方以上で要る', () => {
    expect(
      courseOffersOf('cbox').map(({ id, deposit, mainAccount }) => ({ id, deposit, mainAccount })),
    ).toEqual([
      { id: 'normal', deposit: 20_000, mainAccount: false },
      { id: 'front', deposit: 100_000, mainAccount: true },
      { id: 'special', deposit: 300_000, mainAccount: true },
      { id: 'top', deposit: 1_000_000, mainAccount: true },
    ]);
  });

  it('会場の価格が違う市（福岡市 FUK-012・6,000円）では、前方の席が 18,000円。預金の条件は同じ（I-73）', () => {
    const front = courseOffersOf('FUK-012').find((offer) => offer.id === 'front');
    expect(front?.price).toBe(18_000);
    expect(front?.deposit).toBe(100_000);
  });
});

describe('需要（市 × 組。仕様 SP-13・SP-18）', () => {
  it('5 組の久留米市の見込みは 187・120・96・45・66、1 点あたりの人数は 3・6・2・3・2', () => {
    expect(
      (['tech0', 'krs48', 'riji', 'terao', 'heisei'] as const).map((id) => {
        const demand = demandOf(id, '久留米市');
        return [demand.expected, demand.perDot];
      }),
    ).toEqual([
      [187, 3],
      [120, 6],
      [96, 2],
      [45, 3],
      [66, 2],
    ]);
  });

  it('tech0・福岡市: 久留米市の人数 ×（登録者 × 熱量の比）を丸める。1 点 5 人（点が 150 以内になる最小の刻み）', () => {
    // 比 = (4,820 × 41) ÷ (1,380 × 86) ≒ 1.665。187 → 311、54 → 90、42 → 70、24 → 40（合計 511 → 5 人で 103 点）。
    const demand = demandOf('tech0', '福岡市');
    expect(demand.people).toEqual({ hotRich: 311, hotPoor: 90, coolRich: 70, coolPoor: 40 });
    expect(demand.perDot).toBe(5);
    expect(demand.seed).toBe(20261120 + 7919);
  });

  it('久留米市以外では、全組・全市で点が 150 以内になり、刻みは最小（I-12）', () => {
    const steps = [1, 2, 3, 5, 6, 10, 15, 20, 30, 50];
    for (const artist of ['tech0', 'krs48', 'riji', 'terao', 'heisei'] as const) {
      for (const city of [
        '福岡市',
        '北九州市',
        '佐賀市',
        '長崎市',
        '熊本市',
        '大分市',
        '宮崎市',
        '鹿児島市',
      ] as const) {
        const { people, perDot } = demandOf(artist, city);
        const total = Object.values(people).reduce((sum, n) => sum + n, 0);
        expect(total / perDot).toBeLessThanOrEqual(150);
        const smaller = steps.filter((step) => step < perDot);
        for (const step of smaller) expect(total / step).toBeGreaterThan(150);
      }
    }
  });
});
