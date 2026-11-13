import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PID,
  THRESHOLDS,
  buildPlan,
  evaluate,
  k6SummaryLine,
  parseServerTiming,
  percentile,
} from '../../loadtest/lib.js';
import { PERFORMANCE_IDS, PERSONAS, personaPerformanceId } from '../../src/core';

// 負荷の試験（設計 D-42・テスト設計 I-95〜I-100・S-73〜S-75）の、台本の部品。k6 の台本と、Node の代わりの台本が、同じ部品を使う。

describe('I-132: 負荷の試験の公演', () => {
  it('既定は terao:KGS-001。core の一覧（60 件）にあり、人物 1〜15 の公演のどれとも違う（発表に使わない）', () => {
    expect(DEFAULT_PID).toBe('terao:KGS-001');
    expect(PERFORMANCE_IDS).toContain(DEFAULT_PID);
    expect(PERSONAS.map((p) => personaPerformanceId(p))).not.toContain(DEFAULT_PID);
  });
});

describe('台数から、台本の数字を決める（設計 D-42）', () => {
  it('100 台（合格の線）: 取得は毎秒 50 回・申し込み 50 件（30 秒後から 10 秒間）・100 秒', () => {
    expect(buildPlan(100)).toEqual({
      clients: 100,
      getRatePerSec: 50,
      joins: 50,
      joinStartSec: 30,
      joinWindowSec: 10,
      durationSec: 100,
    });
  });

  it('150 台（余裕の確認）: 取得は毎秒 75 回・申し込み 75 件', () => {
    expect(buildPlan(150)).toMatchObject({ getRatePerSec: 75, joins: 75 });
  });

  it('秒数と申し込み件数は上書きできる（I-97: 100 台が 10 秒のあいだに 1 回ずつ → joins 100）', () => {
    expect(
      buildPlan(100, { joins: 100, joinStartSec: 5, joinWindowSec: 10, durationSec: 30 }),
    ).toEqual({
      clients: 100,
      getRatePerSec: 50,
      joins: 100,
      joinStartSec: 5,
      joinWindowSec: 10,
      durationSec: 30,
    });
  });

  it.each([[0], [-1], [1.5], [Number.NaN]])('台数 %s は使えない（例外）', (clients) => {
    expect(() => buildPlan(clients)).toThrow(RangeError);
  });

  it('申し込みの窓が、全体の長さに収まらないときは例外', () => {
    expect(() => buildPlan(100, { joinStartSec: 95, joinWindowSec: 10, durationSec: 100 })).toThrow(
      RangeError,
    );
  });
});

describe('Server-Timing の読み取り', () => {
  it.each([
    ['app;dur=0.123', 0.123],
    ['app;dur=12', 12],
    ['cache;desc="x", app;dur=1.5', 1.5],
    ['app;dur=0', 0],
  ])('「%s」→ %s ミリ秒', (header, ms) => {
    expect(parseServerTiming(header)).toBe(ms);
  });

  it.each([[null], [undefined], [''], ['app'], ['app;dur=abc'], ['app;dur=-1'], ['other;dur=3']])(
    '「%s」は読めない → null',
    (header) => {
      expect(parseServerTiming(header)).toBeNull();
    },
  );
});

describe('パーセンタイル（最も近い順位）', () => {
  it('1〜100 の p95 は 95、p50 は 50、p100 は 100。並びは問わない', () => {
    const values = Array.from({ length: 100 }, (_, i) => 100 - i);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 100)).toBe(100);
  });

  it('1 件ならその値。空は null', () => {
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 95)).toBeNull();
  });
});

describe('合否の判定 evaluate（I-100: 閾値の自己検査）', () => {
  const ok = {
    meterMs: Array.from({ length: 100 }, () => 20),
    joinMs: Array.from({ length: 50 }, () => 30),
    serverMs: Array.from({ length: 150 }, () => 0.2),
    total: 150,
    failed: 0,
    status429: 0,
    dropped: 0,
    clients: 100,
    expectedJoins: 50,
    joinedDelta: 50,
    countedTrue: 50,
  };

  it('合格の線を満たす結果は合格。一行（合否・p95・server_ms・エラー・429）で出る', () => {
    const result = evaluate(ok);
    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.line).toMatch(/^合否=合格 /);
    expect(result.line).toContain('100台');
    expect(result.line).toContain('p95=');
    expect(result.line).toContain('server_ms_p95=');
    expect(result.line).toContain('エラー=0.00%');
    expect(result.line).toContain('429=0');
  });

  it('遅延 200ms（p95）は合格、遅延 700ms は p95 の閾値で不合格', () => {
    const slow = (ms: number) => ({
      ...ok,
      meterMs: Array.from({ length: 100 }, () => ms),
      joinMs: Array.from({ length: 50 }, () => ms),
    });
    expect(evaluate(slow(200)).pass).toBe(true);
    const failed = evaluate(slow(700));
    expect(failed.pass).toBe(false);
    expect(failed.failures.join('\n')).toContain('p95');
    expect(failed.line).toMatch(/^合否=不合格 /);
  });

  it('429 が 1 件でもあれば不合格（同じ接続元の 100 台が弾かれない。N-24）', () => {
    const result = evaluate({ ...ok, status429: 1 });
    expect(result.pass).toBe(false);
    expect(result.failures.join('\n')).toContain('429');
  });

  it.each([
    [
      '取得の p95 が 500ms ちょうど（k6 の p(95)<500 と同じく、未満だけ合格）',
      { meterMs: Array.from({ length: 100 }, () => THRESHOLDS.p95Ms) },
    ],
    ['申し込みの p95 が 500ms 以上', { joinMs: Array.from({ length: 50 }, () => 501) }],
    [
      'server_ms の p95 が 50ms ちょうど',
      { serverMs: Array.from({ length: 150 }, () => THRESHOLDS.serverP95Ms) },
    ],
    ['エラーが 1%（150 件中 1.5 件以上 → 2 件）', { failed: 2 }],
    ['出し切れなかった要求がある', { dropped: 1 }],
    ['申し込み後の joined の増え方が、申し込み件数と違う', { joinedDelta: 49 }],
    ['counted: true が申し込み件数に足りない', { countedTrue: 49 }],
  ])('不合格になる: %s', (_label, change) => {
    expect(evaluate({ ...ok, ...change }).pass).toBe(false);
  });

  it('エラーが 1% 未満（150 件中 1 件 = 0.67%）なら合格', () => {
    expect(evaluate({ ...ok, failed: 1 }).pass).toBe(true);
  });

  it('申し込みの増え方が分からないとき（joinedDelta が null）は、その項目を判定に入れない', () => {
    expect(evaluate({ ...ok, joinedDelta: null, countedTrue: null }).pass).toBe(true);
  });

  it('応答が 1 件も無いとき（全部失敗）は、不合格', () => {
    const result = evaluate({
      ...ok,
      meterMs: [],
      joinMs: [],
      serverMs: [],
      total: 100,
      failed: 100,
    });
    expect(result.pass).toBe(false);
  });
});

describe('k6 の結果の 1 行（handleSummary）', () => {
  const metric = (
    values: Record<string, number>,
    thresholds: Record<string, { ok: boolean }> = {},
  ) => ({ values, thresholds });
  const summary = (ok: boolean) => ({
    metrics: {
      http_req_duration: metric({ 'p(95)': 12.3 }, { 'p(95)<500': { ok } }),
      'http_req_duration{kind:meter}': metric({ 'p(95)': 10.1 }),
      'http_req_duration{kind:join}': metric({ 'p(95)': 15.2 }),
      server_ms: metric({ 'p(95)': 0.31 }),
      http_req_failed: metric({ rate: 0 }),
      status_429: metric({ count: 0 }),
      dropped_iterations: metric({ count: 0 }),
      http_reqs: metric({ count: 5500 }),
    },
  });

  it('閾値がすべて ok なら合格の 1 行。1 つでも ok でなければ不合格', () => {
    expect(k6SummaryLine(summary(true), 100)).toMatch(
      /^合否=合格 100台 p95=12\.3ms（取得 10\.1ms・申し込み 15\.2ms） server_ms_p95=0\.31ms エラー=0\.00% 429=0 /,
    );
    expect(k6SummaryLine(summary(false), 100)).toMatch(/^合否=不合格 /);
  });

  it('dropped_iterations が無い結果（1 件も出し損ねていない）でも、読める', () => {
    const s = summary(true);
    delete (s.metrics as Record<string, unknown>)['dropped_iterations'];
    expect(k6SummaryLine(s, 100)).toContain('打ち切り=0');
  });
});
