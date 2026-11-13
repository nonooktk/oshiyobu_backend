import { describe, expect, it } from 'vitest';
import { SlidingWindowLimiter } from '../../src/server/ratelimit';

// 設計 D-14・D-17: 端末の番号ごとに 20 回/分。接続元（IP）ごとの上限は置かない（このクラスは IP を受け取らない）。
function makeLimiter() {
  let now = 1_000_000;
  const limiter = new SlidingWindowLimiter({ limit: 20, windowMs: 60_000, now: () => now });
  return {
    limiter,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('端末の番号ごとの上限（20 回/分）', () => {
  it('20 回までは通し、21 回目から止める（I-41）。止めるときは待ち時間（秒）を返す', () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 20; i++) {
      expect(limiter.hit('device-a')).toEqual({ allowed: true });
    }
    expect(limiter.hit('device-a')).toEqual({ allowed: false, retryAfterSec: 60 });
  });

  it('別の端末の番号は、止められない（上限は端末の番号ごと）', () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 21; i++) limiter.hit('device-a');
    expect(limiter.hit('device-b')).toEqual({ allowed: true });
  });

  it('1 分たつと、また通る。待ち時間は、いちばん古い記録が窓から出るまでの秒数（切り上げ）', () => {
    const { limiter, advance } = makeLimiter();
    for (let i = 0; i < 20; i++) limiter.hit('device-a');
    advance(30_500);
    expect(limiter.hit('device-a')).toEqual({ allowed: false, retryAfterSec: 30 }); // 残り 29.5 秒 → 30
    advance(29_499); // 窓の端の 1 ms 手前
    expect(limiter.hit('device-a')).toMatchObject({ allowed: false });
    advance(1); // ちょうど 60 秒
    expect(limiter.hit('device-a')).toEqual({ allowed: true });
  });

  it('止められた要求は、記録に数えない（連打し続けても、窓が出るたびに通る）', () => {
    const { limiter, advance } = makeLimiter();
    for (let i = 0; i < 20; i++) limiter.hit('device-a');
    for (let i = 0; i < 1000; i++) limiter.hit('device-a'); // 止められ続ける
    advance(60_000);
    expect(limiter.hit('device-a')).toEqual({ allowed: true });
  });

  it('同じ接続元の 100 台（別々の端末の番号）が、1 分に 6 回ずつ送っても、1 件も止められない（I-40・N-24）', () => {
    const { limiter } = makeLimiter();
    let blocked = 0;
    for (let round = 0; round < 6; round++) {
      for (let device = 0; device < 100; device++) {
        if (!limiter.hit(`device-${device}`).allowed) blocked++;
      }
    }
    expect(blocked).toBe(0);
  });

  it('使われなくなった端末の記録は、あとの呼び出しで片づく（メモリが増え続けない）', () => {
    const { limiter, advance } = makeLimiter();
    for (let i = 0; i < 500; i++) limiter.hit(`device-${i}`);
    expect(limiter.size()).toBe(500);
    advance(120_000);
    limiter.hit('device-new');
    expect(limiter.size()).toBe(1);
  });
});
