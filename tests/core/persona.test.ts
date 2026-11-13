import { describe, expect, it } from 'vitest';
import {
  ARTIST_IDS,
  CITY_NAMES,
  PERSONAS,
  PERSONA_COUNT,
  PERSONA_DEFAULT_NO,
  canApply,
  conditionOf,
  demandOf,
  depShort,
  fnv1a32,
  levelOf,
  mainShort,
  personaByNo,
  personaNoFromParam,
  personaNoOf,
  personaPerformanceId,
  personaVenueId,
  resolvePersonaNo,
} from '../../src/core';
import type { CourseId, VenueId } from '../../src/core';

// 期待値の出どころ: 決定メモ §4・仕様.md SP-64（人物 15 通りの表）、テスト設計.md I-67〜I-78。

// 仕様 SP-64 の表を、そのまま写した期待値（番号, 推し, 地元の市, 公演の会場, 預金額, メイン口座）。
const TABLE = [
  [1, 'tech0', '久留米市', 'cbox', 15_000, false],
  [2, 'tech0', '久留米市', 'cbox', 28_000, false],
  [3, 'tech0', '久留米市', 'cbox', 62_000, false],
  [4, 'tech0', '久留米市', 'cbox', 90_000, false],
  [5, 'tech0', '久留米市', 'cbox', 95_000, true],
  [6, 'tech0', '久留米市', 'cbox', 120_000, true],
  [7, 'tech0', '久留米市', 'cbox', 180_000, false],
  [8, 'tech0', '久留米市', 'cbox', 320_000, true],
  [9, 'tech0', '久留米市', 'cbox', 1_050_000, true],
  [10, 'krs48', '福岡市', 'FUK-012', 48_000, false],
  [11, 'krs48', '熊本市', 'KMM-002', 240_000, true],
  [12, 'riji', '久留米市', 'cbox', 90_000, true],
  [13, 'riji', '佐賀市', 'SAG-003', 320_000, false],
  [14, 'terao', '長崎市', 'NGS-001', 9_000, false],
  [15, 'heisei', '宮崎市', 'MYZ-004', 400_000, true],
] as const;

describe('人物 15 通りのデータ（I-67・I-78）', () => {
  it('表のとおり（推し・地元の市・預金額・メイン口座）。公演は、推しと地元の市の既定の会場で決まる', () => {
    expect(PERSONA_COUNT).toBe(15);
    expect(PERSONAS).toHaveLength(15);
    for (const [no, artistId, city, venueId, depositYen, mainAccount] of TABLE) {
      const persona = personaByNo(no);
      expect(persona).toEqual({ no, artistId, city, depositYen, mainAccount });
      expect(personaVenueId(persona)).toBe(venueId);
    }
  });

  it('I-78: 番号は 1〜15 の連番で重複なし。推し・市は値域内。預金額は 0 以上の整数', () => {
    expect(PERSONAS.map((p) => p.no)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    for (const p of PERSONAS) {
      expect(ARTIST_IDS).toContain(p.artistId);
      expect(CITY_NAMES).toContain(p.city);
      expect(Number.isInteger(p.depositYen) && p.depositYen >= 0).toBe(true);
    }
  });

  it('I-78: 15 通りの（預金額・メイン口座・推し・市）の組が、互いに異なる（R-20・決定メモ B3）', () => {
    const keys = PERSONAS.map(
      (p) => `${p.depositYen}/${String(p.mainAccount)}/${p.artistId}/${p.city}`,
    );
    expect(new Set(keys).size).toBe(15);
  });

  it('I-78: 1〜9 は tech0・久留米市（基準の公演）で、10〜15 は違う。「達成状況」の項目は持たない', () => {
    for (const p of PERSONAS.filter((x) => x.no <= 9)) {
      expect([p.artistId, p.city]).toEqual(['tech0', '久留米市']);
    }
    for (const p of PERSONAS.filter((x) => x.no >= 10)) {
      expect([p.artistId, p.city]).not.toEqual(['tech0', '久留米市']);
    }
    for (const p of PERSONAS) {
      expect(Object.keys(p).sort()).toEqual([
        'artistId',
        'city',
        'depositYen',
        'mainAccount',
        'no',
      ]);
    }
  });

  it('既定の人物（モックの既定の人）は 4（預金 90,000円・メイン口座は未・tech0・久留米市）', () => {
    expect(PERSONA_DEFAULT_NO).toBe(4);
    expect(personaByNo(PERSONA_DEFAULT_NO)).toMatchObject({
      artistId: 'tech0',
      city: '久留米市',
      depositYen: 90_000,
      mainAccount: false,
    });
  });
});

describe('人物の公演 ID（I-72）', () => {
  it('1〜9 はすべて tech0:cbox。10 は krs48:FUK-012、11 は krs48:KMM-002、12 は riji:cbox、13 は riji:SAG-003、14 は terao:NGS-001、15 は heisei:MYZ-004', () => {
    const ids = PERSONAS.map((p) => personaPerformanceId(p));
    expect(ids.slice(0, 9)).toEqual(Array<string>(9).fill('tech0:cbox'));
    expect(ids.slice(9)).toEqual([
      'krs48:FUK-012',
      'krs48:KMM-002',
      'riji:cbox',
      'riji:SAG-003',
      'terao:NGS-001',
      'heisei:MYZ-004',
    ]);
    // 10〜15 は互いに違う公演
    expect(new Set(ids.slice(9)).size).toBe(6);
  });
});

// I-77: 「この人が体験すること」を、15 人について 1 件ずつ、計算で確かめる。
// 期待値は、仕様 SP-64 の「この人が体験すること」の文から、手で導いた（実装の出力を写していない）。
// 各人物について、(コース, 申し込める?, 足りない預金, メイン口座が足りない?) を書く。
type Expectation = readonly [CourseId, boolean, number, boolean];
const EXPERIENCE: ReadonlyArray<{ no: number; says: string; expects: readonly Expectation[] }> = [
  { no: 1, says: '通常の席まで、あと 5,000円', expects: [['normal', false, 5_000, false]] },
  { no: 2, says: '通常の席にすぐ申し込める', expects: [['normal', true, 0, false]] },
  {
    no: 3,
    says: '通常の席は申し込める。前方の席は、メイン口座とあと 38,000円',
    expects: [
      ['normal', true, 0, false],
      ['front', false, 38_000, true],
    ],
  },
  {
    no: 4,
    says: '前方の席は、メイン口座とあと 10,000円',
    expects: [
      ['normal', true, 0, false],
      ['front', false, 10_000, true],
    ],
  },
  { no: 5, says: '前方の席まで、あと 5,000円', expects: [['front', false, 5_000, false]] },
  { no: 6, says: '前方の席にすぐ申し込める', expects: [['front', true, 0, false]] },
  {
    no: 7,
    says: 'メイン口座にすれば、前方の席に申し込める（預金は足りている）',
    expects: [['front', false, 0, true]],
  },
  { no: 8, says: '特別コースにすぐ申し込める', expects: [['special', true, 0, false]] },
  { no: 9, says: '最上位コースにすぐ申し込める', expects: [['top', true, 0, false]] },
  { no: 10, says: '別の公演。通常の席に申し込める', expects: [['normal', true, 0, false]] },
  { no: 11, says: '別の公演。前方の席にすぐ申し込める', expects: [['front', true, 0, false]] },
  { no: 12, says: '前方の席まで、あと 10,000円', expects: [['front', false, 10_000, false]] },
  {
    no: 13,
    says: 'メイン口座にすれば、特別コースに申し込める（預金は足りている）',
    expects: [['special', false, 0, true]],
  },
  {
    no: 14,
    says: '預金が足りない。通常の席まで、あと 11,000円',
    expects: [['normal', false, 11_000, false]],
  },
  {
    no: 15,
    says: '特別コースまでは申し込める（最上位は預金が足りない）',
    expects: [
      ['special', true, 0, false],
      ['top', false, 600_000, false],
    ],
  },
];

describe('I-77: 15 人それぞれの「この人が体験すること」を計算で確かめる', () => {
  it.each(EXPERIENCE)('人物 $no: $says', ({ no, expects }) => {
    const persona = personaByNo(no);
    const { courses } = conditionOf(personaVenueId(persona));
    for (const [id, applicable, depositShort, mainIsShort] of expects) {
      const course = courses.find((c) => c.id === id);
      if (course === undefined) throw new Error(`コースが無い: ${id}`);
      expect({
        canApply: canApply(course, persona.depositYen, persona.mainAccount),
        depShort: depShort(course, persona.depositYen),
        mainShort: mainShort(course, persona.mainAccount),
      }).toEqual({ canApply: applicable, depShort: depositShort, mainShort: mainIsShort });
    }
  });

  it('人物 15（heisei・宮崎市）は、事務所向けで札「低」（見込み 11 ÷ 必要人数 250）。提案を出せない組み合わせ（I-75）', () => {
    const persona = personaByNo(15);
    const demand = demandOf(persona.artistId, persona.city);
    expect(demand.expected).toBe(11);
    expect(conditionOf(personaVenueId(persona)).need).toBe(250);
    expect(levelOf(demand.expected, 250)).toBe('低');
  });

  it('会場の価格が違う市（福岡市 FUK-012・6,000円）の人物 10 は、前方の席が 18,000円。預金の条件は変わらない（I-73）', () => {
    const front = conditionOf(personaVenueId(personaByNo(10))).courses.find(
      (c) => c.id === 'front',
    );
    expect(front?.price).toBe(18_000);
    expect(front?.deposit).toBe(100_000);
  });
});

describe('FNV-1a（32 ビット）', () => {
  // 公開されている標準のテストベクトル（http://www.isthe.com/chongo/src/fnv/test_fnv.c）。
  it.each([
    ['', 0x811c9dc5],
    ['a', 0xe40c292c],
    ['foobar', 0xbf9cf968],
  ])('「%s」のハッシュは %i', (text, expected) => {
    expect(fnv1a32(text)).toBe(expected);
  });

  it('全角など ASCII 以外の文字は、UTF-8 の 3 バイトとして混ぜる（「あ」= E3 81 82）', () => {
    // FNV-1a(UTF-8 bytes E3 81 82) = 0xe02c1bb1（別の言語 Python で独立に計算した値）
    expect(fnv1a32('あ')).toBe(0xe02c1bb1);
  });
});

describe('人物の番号の決め方 personaNoOf（決定 2・6。仕様 SP-60・設計 D-19）', () => {
  it('端末の番号の FNV-1a（32 ビット）を 15 で割った余り + 1。同じ端末の番号なら、何度でも同じ人物（再読み込みで変わらない）', () => {
    // 'a' → 0xe40c292c = 3,826,002,220 → 15 で割った余り 10 → 人物 11
    expect(personaNoOf('a')).toBe(11);
    expect(personaNoOf('a')).toBe(personaNoOf('a'));
    // 空の文字列 → 0x811c9dc5 = 2,166,136,261 → 余り 1 → 人物 2
    expect(personaNoOf('')).toBe(2);
  });

  it('端末の番号の例（UUID）から、1〜15 の整数が決まる', () => {
    const no = personaNoOf('3f2b8c1e-9d4a-4e7b-8a61-2c5d7e9f0a13');
    expect(Number.isInteger(no) && no >= 1 && no <= 15).toBe(true);
  });

  // I-76: 乱数の UUID 1 万件で、各番号が平均（約 667）の ±20% に入る。1〜9 の割合が 55〜65%。
  // 乱数は、結果が毎回同じになる固定の種の生成器（mulberry32）で作る。
  it('I-76: UUID 風の 1 万件で、各番号が 534〜800 件に収まり、1〜9 が 55〜65%（過半）', () => {
    let seed = 20261113;
    const next = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const hex = (digits: number) =>
      Array.from({ length: digits }, () => Math.floor(next() * 16).toString(16)).join('');
    const counts = new Array<number>(16).fill(0);
    for (let i = 0; i < 10_000; i++) {
      const uuid = `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
      const no = personaNoOf(uuid);
      counts[no] = (counts[no] ?? 0) + 1;
    }
    expect(counts[0]).toBe(0); // 0 番は出ない
    for (let no = 1; no <= 15; no++) {
      expect(counts[no]).toBeGreaterThanOrEqual(534);
      expect(counts[no]).toBeLessThanOrEqual(800);
    }
    const base = counts.slice(1, 10).reduce((sum, n) => sum + n, 0) / 10_000;
    expect(base).toBeGreaterThanOrEqual(0.55);
    expect(base).toBeLessThanOrEqual(0.65);
  });
});

describe('/fan/?p=番号 の指定（設計 D-19。I-69）', () => {
  it.each([
    ['1', 1],
    ['15', 15],
    ['7', 7],
    ['07', 7],
  ])('「%s」は人物 %i に固定する', (param, no) => {
    expect(personaNoFromParam(param)).toBe(no);
  });

  it.each([['0'], ['16'], ['abc'], ['1.5'], [''], ['-1'], ['auto'], [' 7'], ['７']])(
    '「%s」は無視する（端末の番号で決める）',
    (param) => {
      expect(personaNoFromParam(param)).toBeUndefined();
    },
  );

  it('指定が無い（null・undefined）ときも無視する', () => {
    expect(personaNoFromParam(null)).toBeUndefined();
    expect(personaNoFromParam(undefined)).toBeUndefined();
  });

  it('resolvePersonaNo: 有効な指定があれば指定を使い、無ければ端末の番号から決める', () => {
    expect(resolvePersonaNo('a', '4')).toBe(4);
    expect(resolvePersonaNo('a', '99')).toBe(personaNoOf('a'));
    expect(resolvePersonaNo('a', null)).toBe(personaNoOf('a'));
  });
});

describe('人物の取り出し', () => {
  it('範囲外の番号は例外にする（0・16・小数）', () => {
    expect(() => personaByNo(0)).toThrow(RangeError);
    expect(() => personaByNo(16)).toThrow(RangeError);
    expect(() => personaByNo(1.5)).toThrow(RangeError);
  });

  it('型: 人物の会場は VenueId、公演 ID は「推し:会場」', () => {
    const venueId: VenueId = personaVenueId(personaByNo(1));
    expect(personaPerformanceId(personaByNo(1))).toBe(`tech0:${venueId}`);
  });
});
