import { describe, expect, it } from 'vitest';
import {
  ARTISTS,
  ARTIST_IDS,
  CITIES,
  CITY_NAMES,
  COST,
  COST_TIERS,
  COURSES,
  NEIGHBOR_PREFS,
  VENUES,
  conditionOf,
  demandOf,
  levelOf,
  needOf,
  lineOf,
  costsOfTier,
  venuesOf,
} from '../../src/core';
import { SIMULATOR_COST, SIMULATOR_VENUES } from '../fixtures/simulator-snapshot';

describe('固定のデータの数（仕様 SP-19）', () => {
  it('アーティスト 5 組（表示順）・地図の 9 市・会場 12 件・コース 4 つ', () => {
    expect(ARTIST_IDS).toEqual(['tech0', 'krs48', 'riji', 'terao', 'heisei']);
    expect(ARTISTS.map((artist) => artist.id)).toEqual(ARTIST_IDS);
    expect(CITY_NAMES).toEqual([
      '福岡市',
      '北九州市',
      '久留米市',
      '佐賀市',
      '長崎市',
      '熊本市',
      '大分市',
      '宮崎市',
      '鹿児島市',
    ]);
    expect(CITIES.map((city) => city.name)).toEqual(CITY_NAMES);
    expect(VENUES).toHaveLength(12);
    expect(COURSES.map((course) => course.id)).toEqual(['normal', 'front', 'special', 'top']);
  });

  it('登録者数・熱量は、組ごとに 9 市ぶんある。熱量は 0〜100、登録者数は正の整数', () => {
    for (const artist of ARTISTS) {
      expect(artist.reg).toHaveLength(9);
      expect(artist.hot).toHaveLength(9);
      for (const n of artist.reg) expect(Number.isInteger(n) && n > 0).toBe(true);
      for (const n of artist.hot) expect(n >= 0 && n <= 100).toBe(true);
    }
  });

  it('基準の市（久留米市）の登録者数 × 熱量が、組ごとに値のとおり（tech0: 1,380 × 86）', () => {
    const tech0 = ARTISTS.find((artist) => artist.id === 'tech0');
    expect(tech0?.reg[2]).toBe(1380);
    expect(tech0?.hot[2]).toBe(86);
  });

  it('隣の県は、7 県すべてに 2 つずつ（近い順）。自分の県を含まない', () => {
    expect(Object.keys(NEIGHBOR_PREFS)).toHaveLength(7);
    for (const [pref, neighbors] of Object.entries(NEIGHBOR_PREFS)) {
      expect(neighbors).toHaveLength(2);
      expect(neighbors).not.toContain(pref);
    }
    expect(NEIGHBOR_PREFS['福岡県']).toEqual(['佐賀県', '熊本県']);
  });
});

describe('会場の候補（仕様 SP-11・I-03）', () => {
  it('市ごとの件数は、福岡市 3・北九州市 1・久留米市 2・佐賀市 1・長崎市 1・熊本市 1・大分市 1・宮崎市 1・鹿児島市 1（計 12）', () => {
    expect(CITY_NAMES.map((city) => venuesOf(city).length)).toEqual([3, 1, 2, 1, 1, 1, 1, 1, 1]);
  });

  it('会場 ID は重複せず、区分は費用の表にある。必要人数はキャパに収まる', () => {
    expect(new Set(VENUES.map((venue) => venue.id)).size).toBe(12);
    for (const venue of VENUES) {
      expect(COST_TIERS).toContain(venue.tier);
      expect(conditionOf(venue.id).need).toBeLessThanOrEqual(venue.cap);
    }
  });

  it('決まりの検査: 久留米市以外の候補は、最大 3 件・同じ区分は 1 件・tech0 の見込みが必要人数に届く（札が高か中）。届く会場が無い大分市・宮崎市は、札「低」の 1 件だけ', () => {
    for (const city of CITY_NAMES.filter((name) => name !== '久留米市')) {
      const venues = venuesOf(city);
      expect(venues.length).toBeLessThanOrEqual(3);
      expect(new Set(venues.map((venue) => venue.tier)).size).toBe(venues.length);
      const levels = venues.map((venue) =>
        levelOf(demandOf('tech0', city).expected, conditionOf(venue.id).need),
      );
      if (city === '大分市' || city === '宮崎市') {
        expect(levels).toEqual(['低']);
      } else {
        for (const level of levels) expect(level).not.toBe('低');
      }
    }
  });

  it('久留米市の 2 件は固定（Cボックス・RISE UP）で、公開料金の目安は 70,860円・70,000円', () => {
    expect(venuesOf('久留米市').map((venue) => [venue.id, venue.publicFee])).toEqual([
      ['cbox', 70_860],
      ['riseup', 70_000],
    ]);
  });
});

// 設計 D-21 と I-31〜I-33。simulator.html 本体との照合は frontend の契約テストで行う。ここは core 側の期待値の確認。
describe('収支シミュレーターとの数字の一致（core 側。I-31〜I-33）', () => {
  it('I-31: 5 区分の費用 5 項目と価格が、simulator の COST と一致する', () => {
    for (const tier of COST_TIERS) {
      expect(COST[tier]).toEqual(SIMULATOR_COST[tier]);
    }
  });

  it('I-32: simulator に会場 ID がある 11 件の（収容人数・区分）が一致する。Cボックスは FUK-019（144 席・区分 100）、RISE UP だけ無い', () => {
    const withSimulator = VENUES.filter((venue) => venue.simulatorVenueId !== undefined);
    expect(withSimulator).toHaveLength(11);
    for (const venue of withSimulator) {
      const simulator = SIMULATOR_VENUES[venue.simulatorVenueId as keyof typeof SIMULATOR_VENUES];
      expect(simulator).toEqual({ capacity: venue.cap, tier: venue.tier });
    }
    expect(VENUES.find((venue) => venue.id === 'cbox')?.simulatorVenueId).toBe('FUK-019');
    expect(VENUES.find((venue) => venue.id === 'riseup')?.simulatorVenueId).toBeUndefined();
  });

  it('I-33: 区分ごとの到達ライン・必要人数が、simulator の費用の合計と ⌈合計 ÷ 価格⌉ に一致する（区分 100: 650,000円・93人。区分 30: 280,000円・40人。区分 300: 1,500,000円・250人）', () => {
    const expected = { 30: [280_000, 40], 100: [650_000, 93], 300: [1_500_000, 250] } as const;
    for (const tier of [30, 100, 300] as const) {
      const sim = SIMULATOR_COST[tier];
      const simLine = sim.venue + sim.prod + sim.fee + sim.travel + sim.profit;
      expect([simLine, Math.ceil(simLine / sim.price)]).toEqual(expected[tier]);
      expect([
        lineOf(costsOfTier(tier)),
        needOf(lineOf(costsOfTier(tier)), COST[tier].price),
      ]).toEqual(expected[tier]);
    }
  });
});
