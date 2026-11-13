import { describe, expect, it } from 'vitest';
import {
  achievementPct,
  barFill,
  conditionOf,
  crossedMilestone,
  displayedCount,
  minPeopleGapYen,
  peopleLeft,
  supportStatus,
} from '../../src/core';
import type { MeterState } from '../../src/core';

// 期待値の出どころ: 仕様.md「検算（基準の組み合わせ）」・SP-26・SP-28・SP-77、テスト設計.md の I-16〜I-20・I-135。
// 基準: tech0・久留米市・Cボックス。到達ライン 650,000円・価格 7,000円・必要人数 93人・初めの支援者 74人。
const base = conditionOf('cbox');

/** 申し込んでいない端末で、サーバーの件数だけが違う状態。 */
const server = (serverJoined: number): MeterState => ({
  serverJoined,
  counted: false,
  joined: false,
  pseudoFriends: 0,
});

describe('達成率・あと N 人・棒の長さ（仕様 SP-26・決定 11）', () => {
  it.each([
    // 支援者, あと N 人, 達成率
    [74, 19, 79],
    [75, 18, 80],
    [76, 17, 81],
  ])('最低人数 93: 支援者 %i人 → あと %i人・達成率 %i%%（切り捨て。I-16）', (n, left, pct) => {
    expect(peopleLeft(n, 93)).toBe(left);
    expect(achievementPct(n, 93)).toBe(pct);
  });

  it('棒の長さは 支援者 ÷ 最低人数（74 ÷ 93 ≒ 79.6%。I-16）', () => {
    expect(barFill(74, 93)).toBeCloseTo(79.57, 1);
  });

  it('100% を超えたら、達成率は数字のまま（最低人数 70・75人 → 107%）、あと 0人、棒は 100% で止まる（決定 11。I-17）', () => {
    expect(achievementPct(75, 70)).toBe(107);
    expect(peopleLeft(75, 70)).toBe(0);
    expect(barFill(75, 70)).toBe(100);
  });

  it('境界: 切り捨て（99.99…% は 99%）と、ちょうど 100%', () => {
    expect(achievementPct(92, 93)).toBe(98); // 98.92…
    expect(achievementPct(93, 93)).toBe(100);
    expect(achievementPct(0, 93)).toBe(0);
  });

  it('最低人数が 1 未満のときは、0 で割らずに 0% ・棒 0・あと 0人にする（呼ぶ側の誤りでも、画面を壊さない）', () => {
    expect(achievementPct(74, 0)).toBe(0);
    expect(barFill(74, 0)).toBe(0);
    expect(peopleLeft(74, 0)).toBe(0);
  });
});

describe('80% の演出の判定（決定 10。仕様 SP-28・I-20）', () => {
  it.each([
    [79, 80, true], // 74人 → 75人（最低人数 93）で 79% → 80%
    [80, 81, false], // すでに 80% 以上
    [92, 93, false], // 最低人数 80 で、初めから 92%
    [79, 79, false],
    [0, 100, true], // 一度に 80% を越えても、80% 未満から 80% 以上になったので真
    [80, 80, false],
  ])('達成率 %i%% → %i%% は、演出を出す: %s', (before, after, expected) => {
    expect(crossedMilestone(before, after)).toBe(expected);
  });

  it('基準で、申し込み 1 件（74人 → 75人）は 80% の演出が出る。最低人数 80 では出ない（初めから 92%）', () => {
    expect(crossedMilestone(achievementPct(74, 93), achievementPct(75, 93))).toBe(true);
    expect(achievementPct(74, 80)).toBe(92);
    expect(achievementPct(75, 80)).toBe(93);
    expect(crossedMilestone(achievementPct(74, 80), achievementPct(75, 80))).toBe(false);
  });

  it('成立済みの公演（サーバーの件数 19 → 画面は 93人）に入った端末は、申し込む前から 80% 以上で、演出が出ない（設計 D-18 の規則 9）', () => {
    const before = achievementPct(displayedCount(base.start, server(19)), base.min);
    const after = achievementPct(
      displayedCount(base.start, { ...server(19), joined: true }),
      base.min,
    );
    expect([before, after]).toEqual([100, 101]);
    expect(crossedMilestone(before, after)).toBe(false);
  });
});

// 表示する人数の式（設計 D-18 の規則 4・テスト設計 I-135）。開始 74。
describe('表示する人数 displayedCount（I-135）', () => {
  it.each([
    // サーバーの件数 s, 申し込み済み a, 数えられた印 c, 擬似の仲間 f, 表示の人数
    [0, false, false, 0, 74],
    [0, true, false, 0, 75], // 自分が申し込んだ直後は、数えられる前でも 75
    [1, false, false, 0, 75], // ほかの端末の 1 件
    [1, true, true, 0, 75], // 自分の分がサーバーに数えられた。引いてから足すので 76 にならない
    [5, true, true, 0, 79],
    [3, false, false, 0, 77],
    [0, false, false, 2, 76], // 擬似の仲間は人数に足す
    [19, false, false, 0, 93],
    [1, false, true, 0, 74], // 申し込みをやめた（サーバーは減らさない）。自分の分だけ −1
    [0, false, true, 0, 74], // s − c が負にならない（max(0, …)）
  ])('s=%i・申し込み済み=%s・数えられた印=%s・擬似の仲間=%i → %i人', (s, a, c, f, expected) => {
    expect(displayedCount(74, { serverJoined: s, joined: a, counted: c, pseudoFriends: f })).toBe(
      expected,
    );
  });

  it('reset を検知したあと（申し込み・印・擬似の仲間が消え、サーバーが 0）は、初めの人数 74 に戻る', () => {
    expect(
      displayedCount(74, { serverJoined: 0, joined: false, counted: false, pseudoFriends: 0 }),
    ).toBe(74);
  });
});

describe('成立の判定（仕様 SP-26・決定 1。判定は各端末で行う）', () => {
  it('件数 0 → 74人（79%・518,000円）。まだ成立しない', () => {
    const s = supportStatus(base, { ...server(0), myCoursePrice: 0 });
    expect(s).toMatchObject({
      supporters: 74,
      total: 518_000,
      pct: 79,
      left: 19,
      established: false,
      gathered: false,
    });
  });

  it('自分が通常の席に申し込んだ直後（数えられる前）: 75人・80%・525,000円', () => {
    const s = supportStatus(base, {
      serverJoined: 0,
      counted: false,
      joined: true,
      pseudoFriends: 0,
      myCoursePrice: 7_000,
    });
    expect(s).toMatchObject({ supporters: 75, total: 525_000, pct: 80, left: 18 });
  });

  it('全員が通常の席で 93人になると、651,000円で成立する（(a) 最低人数 93・支援者 93。I-18）', () => {
    const s = supportStatus(base, { ...server(19), myCoursePrice: 0 });
    expect(s).toMatchObject({
      supporters: 93,
      total: 651_000,
      peopleOk: true,
      amountOk: true,
      established: true,
      gathered: false,
      pct: 100,
    });
  });

  it('(b) 最低人数 80・支援者 80: 560,000円で人数は届くが金額が足りない →「人数だけ届いた」で、成立と出ない', () => {
    const cond = conditionOf('cbox', { minPeople: 80 });
    const s = supportStatus(cond, { ...server(6), myCoursePrice: 0 });
    expect(s).toMatchObject({
      supporters: 80,
      total: 560_000,
      peopleOk: true,
      amountOk: false,
      established: false,
      gathered: true,
    });
  });

  it('(c) 最低人数 100・支援者 93: 金額は届くが人数が足りない（あと 7人）。成立と出ない', () => {
    const cond = conditionOf('cbox', { minPeople: 100 });
    const s = supportStatus(cond, { ...server(19), myCoursePrice: 0 });
    expect(s).toMatchObject({
      supporters: 93,
      total: 651_000,
      peopleOk: false,
      amountOk: true,
      established: false,
      gathered: false,
      left: 7,
    });
  });

  it('最上位コースに申し込むと、人数は 1 人ぶん（74 → 75）・金額は 300,000円で数える（74 × 7,000 + 300,000 = 818,000円）。金額は届くが人数が足りず成立しない（I-19）', () => {
    const s = supportStatus(base, {
      serverJoined: 0,
      counted: false,
      joined: true,
      pseudoFriends: 0,
      myCoursePrice: 300_000,
    });
    expect(s).toMatchObject({
      supporters: 75,
      total: 818_000,
      pct: 80,
      peopleOk: false,
      amountOk: true,
      established: false,
    });
  });

  it('ほかの端末の申し込みは、通常の席の価格で数える（決定 6・A2）。自分の分がサーバーに数えられたあとは、引いてから足す', () => {
    // サーバー 3 件のうち 1 件が自分（特別コース 100,000円）。ほかの端末は 2 件 × 7,000円。
    const s = supportStatus(base, {
      serverJoined: 3,
      counted: true,
      joined: true,
      pseudoFriends: 0,
      myCoursePrice: 100_000,
    });
    expect(s.supporters).toBe(74 + 2 + 1);
    expect(s.total).toBe((74 + 2) * 7_000 + 100_000);
  });

  it('擬似の仲間は、人数にも金額（通常の席の価格）にも足す', () => {
    const s = supportStatus(base, { ...server(0), pseudoFriends: 1, myCoursePrice: 0 });
    expect(s.supporters).toBe(75);
    expect(s.total).toBe(75 * 7_000);
  });

  it('人数が最低人数を超えても、あと N 人は 0 のまま・達成率は数字のまま（仕様 SP-77）', () => {
    const cond = conditionOf('cbox', { minPeople: 70 });
    const s = supportStatus(cond, { ...server(1), myCoursePrice: 0 });
    expect(s).toMatchObject({ supporters: 75, pct: 107, left: 0, fill: 100 });
  });

  it('仲間が 1 人（通常の席）申し込んだら成立するか（仕様 SP-26）', () => {
    // サーバー 18 件 → 92人・644,000円。仲間が 1 人 → 93人・651,000円で成立する。
    expect(supportStatus(base, { ...server(18), myCoursePrice: 0 }).friendClinches).toBe(true);
    // サーバー 17 件 → 91人。仲間が 1 人でも 92人で足りない。
    expect(supportStatus(base, { ...server(17), myCoursePrice: 0 }).friendClinches).toBe(false);
    // 人数は届くが金額が足りないとき（最低人数 80・79人）、仲間が 1 人でも 80人・560,000円で金額が足りない。
    const low = conditionOf('cbox', { minPeople: 80 });
    expect(supportStatus(low, { ...server(5), myCoursePrice: 0 }).friendClinches).toBe(false);
  });
});

describe('最低人数が必要人数より少ないときの注意（仕様 SP-15）', () => {
  it('最低人数 80: 650,000 − 80 × 7,000 ＝ あと 90,000円ぶん', () => {
    expect(minPeopleGapYen(conditionOf('cbox', { minPeople: 80 }))).toBe(90_000);
  });

  it('最低人数が必要人数と同じ・多いときは、注意を出さない（null）', () => {
    expect(minPeopleGapYen(conditionOf('cbox'))).toBeNull();
    expect(minPeopleGapYen(conditionOf('cbox', { minPeople: 93 }))).toBeNull();
    expect(minPeopleGapYen(conditionOf('cbox', { minPeople: 144 }))).toBeNull();
  });

  it('境界: 最低人数 92（必要人数の 1 つ下）→ 650,000 − 644,000 ＝ 6,000円ぶん', () => {
    expect(minPeopleGapYen(conditionOf('cbox', { minPeople: 92 }))).toBe(6_000);
  });
});
