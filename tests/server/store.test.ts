import { describe, expect, it, vi } from 'vitest';
import {
  MeterStore,
  PER_PERFORMANCE_LIMIT,
  TOTAL_LIMIT,
  parseSnapshot,
} from '../../src/server/store';

// 設計 D-11・D-12・D-14: 預かるのは、公演ごとの申し込みの件数と、数えた端末の番号のハッシュだけ。
const hex16 = (n: number) => n.toString(16).padStart(16, '0');
const makeStore = (start = 1_800_000_000_000) => {
  let now = start;
  const onChange = vi.fn();
  const store = new MeterStore({ now: () => now, onChange });
  return {
    store,
    onChange,
    advance: (ms: number) => {
      now += ms;
    },
  };
};

describe('申し込みの件数（0 から。開始人数 74 は含まない。D-11・K-06）', () => {
  it('何も無いときは 0・resetAt は null（I-129 の (a)）', () => {
    const { store } = makeStore();
    expect(store.get('tech0:cbox')).toEqual({ joined: 0, resetAt: null });
  });

  it('1 回目は数える（counted: true）。同じ端末の 2 回目は数えない（counted: false・件数は増えない。I-37）', () => {
    const { store } = makeStore();
    expect(store.join('tech0:cbox', hex16(1))).toEqual({ status: 'ok', counted: true, joined: 1 });
    expect(store.join('tech0:cbox', hex16(1))).toEqual({ status: 'ok', counted: false, joined: 1 });
    expect(store.join('tech0:cbox', hex16(2))).toEqual({ status: 'ok', counted: true, joined: 2 });
  });

  it('公演ごとに別に数える。同じ端末の番号でも、別の公演なら別に数える', () => {
    const { store } = makeStore();
    store.join('tech0:cbox', hex16(1));
    expect(store.join('krs48:FUK-012', hex16(1))).toEqual({
      status: 'ok',
      counted: true,
      joined: 1,
    });
    expect(store.get('tech0:cbox').joined).toBe(1);
    expect(store.get('terao:KGS-001').joined).toBe(0);
  });
});

describe('上限（公演ごと 500・全体 1,500。D-14・I-42）', () => {
  it('公演の 501 件目は cap_reached（joined 500 を添える）。数えない', () => {
    const { store } = makeStore();
    for (let i = 0; i < PER_PERFORMANCE_LIMIT; i++) {
      expect(store.join('tech0:cbox', hex16(i))).toMatchObject({ status: 'ok', counted: true });
    }
    expect(store.join('tech0:cbox', hex16(PER_PERFORMANCE_LIMIT))).toEqual({
      status: 'cap_reached',
      joined: 500,
    });
    expect(store.get('tech0:cbox').joined).toBe(500);
  });

  it('上限に届いていても、すでに数えた端末の番号の再送は、これまでどおり counted: false で受ける（冪等）', () => {
    const { store } = makeStore();
    for (let i = 0; i < PER_PERFORMANCE_LIMIT; i++) store.join('tech0:cbox', hex16(i));
    expect(store.join('tech0:cbox', hex16(0))).toEqual({
      status: 'ok',
      counted: false,
      joined: 500,
    });
  });

  it('全体の 1,501 件目は、別の公演でも cap_reached（その公演の joined を添える）', () => {
    const { store } = makeStore();
    expect(TOTAL_LIMIT).toBe(1500);
    for (const pid of ['tech0:cbox', 'krs48:FUK-012', 'riji:cbox'] as const) {
      for (let i = 0; i < PER_PERFORMANCE_LIMIT; i++) store.join(pid, hex16(i));
    }
    expect(store.totalJoined()).toBe(1500);
    expect(store.join('terao:KGS-001', hex16(9999))).toEqual({ status: 'cap_reached', joined: 0 });
  });
});

describe('reset（発表者が初めに戻す。D-15）', () => {
  it('全公演の件数と、数えた端末の番号を空にする。resetAt を返し、get が同じ値を返す', () => {
    const { store } = makeStore(Date.UTC(2026, 10, 20, 0, 30, 0, 0));
    store.join('tech0:cbox', hex16(1));
    store.join('krs48:FUK-012', hex16(2));
    const resetAt = store.reset();
    expect(resetAt).toBe('2026-11-20T00:30:00.000Z');
    expect(store.get('tech0:cbox')).toEqual({ joined: 0, resetAt });
    expect(store.totalJoined()).toBe(0);
    expect(store.snapshot().performances).toEqual({});
  });

  it('reset のあと、同じ端末の番号が再び counted: true になる（A1）', () => {
    const { store } = makeStore();
    store.join('tech0:cbox', hex16(1));
    store.reset();
    expect(store.join('tech0:cbox', hex16(1))).toEqual({ status: 'ok', counted: true, joined: 1 });
  });

  it('同じミリ秒に 2 回 reset しても、resetAt は前より後の時刻になる（端末が検知できるように）', () => {
    const { store } = makeStore(Date.UTC(2026, 10, 20, 0, 30, 0, 0));
    const first = store.reset();
    const second = store.reset();
    expect(Date.parse(second)).toBeGreaterThan(Date.parse(first));
    expect(second).toBe('2026-11-20T00:30:00.001Z');
  });
});

describe('保存する中身（D-12）', () => {
  it('v・resetAt・公演ごとの joined と ids。joined は ids の件数に常に等しい', () => {
    const { store } = makeStore();
    store.join('tech0:cbox', hex16(1));
    store.join('tech0:cbox', hex16(2));
    store.join('tech0:cbox', hex16(2));
    expect(store.snapshot()).toEqual({
      v: 1,
      resetAt: null,
      performances: { 'tech0:cbox': { joined: 2, ids: [hex16(1), hex16(2)] } },
    });
  });

  it('変更があったときだけ onChange を呼ぶ（数えたとき・reset）。取得・再送・上限の拒否では呼ばない', () => {
    const { store, onChange } = makeStore();
    store.get('tech0:cbox');
    expect(onChange).not.toHaveBeenCalled();
    store.join('tech0:cbox', hex16(1));
    expect(onChange).toHaveBeenCalledTimes(1);
    store.join('tech0:cbox', hex16(1));
    expect(onChange).toHaveBeenCalledTimes(1);
    store.reset();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('保存した中身から、同じ状態を作り直せる（再起動で数が消えない）', () => {
    const { store } = makeStore();
    store.join('tech0:cbox', hex16(1));
    store.join('krs48:FUK-012', hex16(2));
    const resetAt = store.reset();
    store.join('tech0:cbox', hex16(3));
    const restored = new MeterStore({ initial: store.snapshot() });
    expect(restored.snapshot()).toEqual(store.snapshot());
    expect(restored.get('tech0:cbox')).toEqual({ joined: 1, resetAt });
    expect(restored.join('tech0:cbox', hex16(3))).toMatchObject({ counted: false });
  });
});

describe('保存した中身の検査 parseSnapshot（壊れたファイルで落ちない）', () => {
  const ok = {
    v: 1,
    resetAt: '2026-11-20T00:30:00.000Z',
    performances: { 'tech0:cbox': { joined: 2, ids: [hex16(1), hex16(2)] } },
  };

  it('正しい形は受ける', () => {
    expect(parseSnapshot(ok)).toEqual(ok);
  });

  it.each([
    ['null', null],
    ['文字列', 'x'],
    ['配列', []],
    ['v が違う', { ...ok, v: 2 }],
    ['v が無い', { resetAt: null, performances: {} }],
    ['resetAt が日付でない', { ...ok, resetAt: 'yesterday' }],
    ['performances が配列', { ...ok, performances: [] }],
    ['performances が無い', { v: 1, resetAt: null }],
  ])('形が違うとき（%s）は null（空の状態で始める）', (_label, value) => {
    expect(parseSnapshot(value)).toBeNull();
  });

  it('一覧に無い公演 ID・形の違う端末のハッシュ・重複は捨てる。joined は ids の件数から作り直す', () => {
    const parsed = parseSnapshot({
      v: 1,
      resetAt: null,
      performances: {
        'tech0:cbox': { joined: 999, ids: [hex16(1), hex16(1), 'ZZZ', 42, hex16(2)] },
        'nobody:nowhere': { joined: 1, ids: [hex16(3)] },
        'krs48:FUK-012': { joined: 1 },
        __proto__: { joined: 1, ids: [hex16(4)] },
      },
    });
    expect(parsed).toEqual({
      v: 1,
      resetAt: null,
      performances: { 'tech0:cbox': { joined: 2, ids: [hex16(1), hex16(2)] } },
    });
  });
});
