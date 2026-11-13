import { describe, expect, it } from 'vitest';
import {
  achievementPct,
  conditionOf,
  crossedMilestone,
  demandOf,
  displayedCount,
  levelOf,
  minPeopleGapYen,
  peopleLeft,
  supportStatus,
  upliftOf,
} from '../../src/core';
import type { MeterState, SupportState } from '../../src/core';

// ゴールデンテスト: 基準の組み合わせ（tech0・久留米市・Cボックス）。
// 期待値は、仕様.md「検算（基準の組み合わせ）」の表を、1 行ずつ写した値。式は表の「式」の列のとおり。
// 画面（frontend）が、core の版を上げたときに、数字が動いていないかを、ここで確かめる。

const cond = conditionOf('cbox');

/** 申し込んでいない端末で、サーバーの件数が n のとき。 */
const serverOnly = (n: number): SupportState => ({
  serverJoined: n,
  counted: false,
  joined: false,
  pseudoFriends: 0,
  myCoursePrice: 0,
});

describe('検算の表: 基準の組み合わせ', () => {
  it('到達ライン 650,000円（60,000 + 100,000 + 250,000 + 120,000 + 120,000）', () => {
    expect(cond.costs).toEqual({
      venue: 60_000,
      prod: 100_000,
      fee: 250_000,
      travel: 120_000,
      profit: 120_000,
    });
    expect(cond.line).toBe(650_000);
  });

  it('通常の席の価格 7,000円・必要人数 ⌈650,000 ÷ 7,000⌉ ＝ 93人・最低人数の初めの値 93人', () => {
    expect(cond.price).toBe(7_000);
    expect(cond.need).toBe(93);
    expect(cond.min).toBe(93);
  });

  it('見込み 187人・札「高」（187 ÷ 93 ＝ 2.01）', () => {
    const { expected } = demandOf('tech0', '久留米市');
    expect(expected).toBe(187);
    expect(levelOf(expected, cond.need)).toBe('高');
  });

  it('前方の席は 21,000円・14席', () => {
    const front = cond.courses.find((course) => course.id === 'front');
    expect([front?.price, front?.slots]).toEqual([21_000, 14]);
  });

  it('上位コースの上乗せ 768,000円（196,000 + 279,000 + 293,000）', () => {
    expect(upliftOf(cond).total).toBe(768_000);
  });

  it('初めの支援者 ⌈93 × 0.8⌉ − 1 ＝ 74人', () => {
    expect(cond.start).toBe(74);
  });

  it('達成率 74人 → 79%・75人 → 80%・76人 → 81%。あと N 人は 19・18・17', () => {
    expect([74, 75, 76].map((n) => achievementPct(n, cond.min))).toEqual([79, 80, 81]);
    expect([74, 75, 76].map((n) => peopleLeft(n, cond.min))).toEqual([19, 18, 17]);
  });

  it('サーバーの件数と画面の人数: 0 → 74人、1 → 75人、2 → 76人、19 → 93人。自分が申し込んだ直後は、数えられる前でも 75人', () => {
    const shown = (state: MeterState) => displayedCount(cond.start, state);
    expect([0, 1, 2, 19].map((n) => shown(serverOnly(n)))).toEqual([74, 75, 76, 93]);
    expect(shown({ ...serverOnly(0), joined: true })).toBe(75);
  });

  it('80% の判定: 74人は 79%（80% 未満）、75人は 80%（80% 以上）。申し込み 1 件で 80% に届く', () => {
    expect(achievementPct(74, 93)).toBeLessThan(80);
    expect(achievementPct(75, 93)).toBeGreaterThanOrEqual(80);
    expect(crossedMilestone(79, 80)).toBe(true);
  });

  it('支援の合計（全員が通常の席）: 74人 → 518,000円・75人 → 525,000円・93人 → 651,000円。93人で到達ライン以上になり、成立', () => {
    expect([0, 1, 19].map((n) => supportStatus(cond, serverOnly(n)).total)).toEqual([
      518_000, 525_000, 651_000,
    ]);
    expect(supportStatus(cond, serverOnly(19)).established).toBe(true);
    expect(supportStatus(cond, serverOnly(18)).established).toBe(false);
  });
});

describe('検算の表: 最低人数 80 のとき', () => {
  const low = conditionOf('cbox', { minPeople: 80 });

  it('初めの 74人は ⌊74 × 100 ÷ 80⌋ ＝ 92%・あと 6人。申し込み後の 75人は 93%・あと 5人', () => {
    expect(achievementPct(74, low.min)).toBe(92);
    expect(peopleLeft(74, low.min)).toBe(6);
    expect(achievementPct(75, low.min)).toBe(93);
    expect(peopleLeft(75, low.min)).toBe(5);
  });

  it('80% 未満から 80% 以上になる申し込みではないので、80% の演出は出ない（決定 10）', () => {
    expect(crossedMilestone(achievementPct(74, low.min), achievementPct(75, low.min))).toBe(false);
  });

  it('注意: 650,000 − 80 × 7,000 ＝ あと 90,000円ぶん。必要人数は 93人のまま・札は「高」のまま（決定 12）', () => {
    expect(minPeopleGapYen(low)).toBe(90_000);
    expect(low.need).toBe(93);
    expect(levelOf(demandOf('tech0', '久留米市').expected, low.need)).toBe('高');
  });
});
