import { describe, expect, it } from 'vitest';
import {
  canApply,
  conditionOf,
  depShort,
  mainShort,
  nextDepositTarget,
  restParts,
} from '../../src/core';

// 期待値の出どころ: 仕様.md SP-27・SP-33（初めの状態 = 人物 4: 預金 90,000円・メイン口座は未）、テスト設計.md I-21・I-22。
const courses = conditionOf('cbox').courses;
const course = (id: 'normal' | 'front' | 'special' | 'top') => {
  const found = courses.find((c) => c.id === id);
  if (found === undefined) throw new Error(`コースが無い: ${id}`);
  return found;
};

describe('コースの条件（預金とメイン口座。仕様 SP-27）', () => {
  it('人物 4（預金 90,000円・メイン口座は未）: 通常の席は申し込める', () => {
    expect(canApply(course('normal'), 90_000, false)).toBe(true);
    expect(depShort(course('normal'), 90_000)).toBe(0);
    expect(mainShort(course('normal'), false)).toBe(false); // 通常の席はメイン口座が要らない
  });

  it('人物 4: 前方の席は「あと 10,000円・メイン口座」、特別コースは「あと 210,000円・メイン口座」、最上位コースは「あと 910,000円・メイン口座」', () => {
    expect(
      (['front', 'special', 'top'] as const).map((id) => ({
        canApply: canApply(course(id), 90_000, false),
        depShort: depShort(course(id), 90_000),
        mainShort: mainShort(course(id), false),
        rest: restParts(course(id), 90_000, false),
      })),
    ).toEqual([
      {
        canApply: false,
        depShort: 10_000,
        mainShort: true,
        rest: [{ kind: 'deposit', yen: 10_000 }, { kind: 'main' }],
      },
      {
        canApply: false,
        depShort: 210_000,
        mainShort: true,
        rest: [{ kind: 'deposit', yen: 210_000 }, { kind: 'main' }],
      },
      {
        canApply: false,
        depShort: 910_000,
        mainShort: true,
        rest: [{ kind: 'deposit', yen: 910_000 }, { kind: 'main' }],
      },
    ]);
  });

  it('境界: 預金がちょうど条件の額なら足りている（20,000円・100,000円）。1 円足りないと足りない', () => {
    expect(depShort(course('normal'), 20_000)).toBe(0);
    expect(canApply(course('normal'), 19_999, false)).toBe(false);
    expect(depShort(course('normal'), 19_999)).toBe(1);
    expect(canApply(course('front'), 100_000, true)).toBe(true);
    expect(canApply(course('front'), 99_999, true)).toBe(false);
  });

  it('預金は足りていて、メイン口座だけが未のとき: 足りないものは「メイン口座」だけ', () => {
    expect(depShort(course('front'), 180_000)).toBe(0);
    expect(mainShort(course('front'), false)).toBe(true);
    expect(canApply(course('front'), 180_000, false)).toBe(false);
    expect(restParts(course('front'), 180_000, false)).toEqual([{ kind: 'main' }]);
  });

  it('すべてそろっていれば、足りないものは無い', () => {
    expect(restParts(course('top'), 1_050_000, true)).toEqual([]);
    expect(canApply(course('top'), 1_050_000, true)).toBe(true);
  });

  it('預金が負の数・0 でも、足りない額は条件の額を超えない・0 未満にならない', () => {
    expect(depShort(course('normal'), 0)).toBe(20_000);
    expect(depShort(course('normal'), 5_000_000)).toBe(0);
  });
});

describe('預金を積み増す（次に開くコースの預金額。仕様 SP-33・I-22）', () => {
  it('90,000 → 100,000 → 300,000 → 1,000,000円。そのあとは積み増せない（undefined）', () => {
    expect(nextDepositTarget(90_000)).toBe(100_000);
    expect(nextDepositTarget(100_000)).toBe(300_000);
    expect(nextDepositTarget(300_000)).toBe(1_000_000);
    expect(nextDepositTarget(1_000_000)).toBeUndefined();
  });

  it('預金が 20,000 未満なら、次は 20,000円（通常の席）。境界: 19,999 → 20,000、20,000 → 100,000', () => {
    expect(nextDepositTarget(0)).toBe(20_000);
    expect(nextDepositTarget(19_999)).toBe(20_000);
    expect(nextDepositTarget(20_000)).toBe(100_000);
  });
});
