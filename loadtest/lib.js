// @ts-check
// 負荷の試験（設計 D-42・テスト設計 I-95〜I-100・S-73〜S-75）の、台本の部品。
// k6 の台本（n22.js）と、k6 が無い環境の代わりの台本（n22-node.mjs）が、同じ部品を使う。
// k6 の中でも動くよう、Node 専用の API を使わない（import も、この中では行わない）。

/** 負荷の試験の公演。発表に使わない公演（人物 1〜15 の公演のどれとも違う。判定 K-13・I-132）。 */
export const DEFAULT_PID = 'terao:KGS-001';

/** 合格の線（要件 N-22・N-24。決定メモ §7）。いずれも「未満」で合格（k6 の p(95)<500 と同じ）。 */
export const THRESHOLDS = {
  /** 応答の p95（ミリ秒）。全体・取得だけ・申し込みだけ。 */
  p95Ms: 500,
  /** サーバーの中の処理時間 server_ms の p95（ミリ秒）。 */
  serverP95Ms: 50,
  /** エラーの割合（通信の失敗・5xx・想定外の 4xx）。 */
  errorRate: 0.01,
};

/**
 * 台数から、台本の数字を決める。
 * 取得は台数 ÷ 2 を毎秒の回数にする（各端末が 2 秒おきに取りに来る）。申し込みは、開始 30 秒後から 10 秒間に、台数の半分。長さは 100 秒。
 * @param {number} clients 台数（100 が合格の線、150 が余裕の確認）
 * @param {Partial<{ joins: number, joinStartSec: number, joinWindowSec: number, durationSec: number }>} [overrides]
 */
export function buildPlan(clients, overrides = {}) {
  if (!Number.isInteger(clients) || clients < 1) {
    throw new RangeError(`台数は 1 以上の整数です（受け取った値: ${clients}）`);
  }
  const plan = {
    clients,
    getRatePerSec: clients / 2,
    joins: overrides.joins ?? Math.round(clients / 2),
    joinStartSec: overrides.joinStartSec ?? 30,
    joinWindowSec: overrides.joinWindowSec ?? 10,
    durationSec: overrides.durationSec ?? 100,
  };
  for (const key of /** @type {const} */ ([
    'joins',
    'joinStartSec',
    'joinWindowSec',
    'durationSec',
  ])) {
    if (!Number.isInteger(plan[key]) || plan[key] < (key === 'joinStartSec' ? 0 : 1)) {
      throw new RangeError(
        `${key} は整数で、範囲の中に入れてください（受け取った値: ${plan[key]}）`,
      );
    }
  }
  if (plan.joinStartSec + plan.joinWindowSec > plan.durationSec) {
    throw new RangeError('申し込みの窓（開始 + 長さ）が、全体の長さに収まりません');
  }
  return plan;
}

/**
 * 応答の Server-Timing（`app;dur=<ミリ秒>`）から、サーバーの中の処理時間を取り出す。読めなければ null。
 * @param {string | null | undefined} header
 * @returns {number | null}
 */
export function parseServerTiming(header) {
  if (typeof header !== 'string') {
    return null;
  }
  for (const metric of header.split(',')) {
    const [name, ...params] = metric.split(';').map((part) => part.trim());
    if (name !== 'app') {
      continue;
    }
    for (const param of params) {
      if (param.startsWith('dur=')) {
        const ms = Number(param.slice(4));
        return Number.isFinite(ms) && ms >= 0 ? ms : null;
      }
    }
  }
  return null;
}

/**
 * パーセンタイル（最も近い順位）。値が無ければ null。
 * @param {readonly number[]} values
 * @param {number} p 0〜100
 * @returns {number | null}
 */
export function percentile(values, p) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1] ?? null;
}

/**
 * 数を、小数 2 桁までで、余分な 0 を付けずに書く。
 * @param {number | null} value
 */
function fmt(value) {
  return value === null ? 'なし' : String(Number(value.toFixed(2)));
}

/**
 * 結果から、合否を判定し、一行にまとめる（D-42 の合否。I-100）。
 * 合格: 応答の p95（全体・取得・申し込み）< 500ms／server_ms の p95 < 50ms／エラー < 1%／429 が 0 件／出し切れなかった要求が 0 件／
 * 申し込み後の joined の増え方と counted: true の件数が、申し込み件数と同じ（分かるとき）。
 * @param {{
 *   meterMs: readonly number[], joinMs: readonly number[], serverMs: readonly number[],
 *   total: number, failed: number, status429: number, dropped: number,
 *   clients: number, expectedJoins: number, joinedDelta: number | null, countedTrue: number | null,
 * }} result
 */
export function evaluate(result) {
  const failures = [];
  const p95Meter = percentile(result.meterMs, 95);
  const p95Join = percentile(result.joinMs, 95);
  const p95All = percentile([...result.meterMs, ...result.joinMs], 95);
  const p95Server = percentile(result.serverMs, 95);
  const errorRate = result.total > 0 ? result.failed / result.total : 1;

  /**
   * @param {string} label
   * @param {number | null} value
   * @param {boolean} required
   */
  const checkP95 = (label, value, required) => {
    if (value === null) {
      if (required) failures.push(`${label}の p95: 応答が 1 件も無い`);
    } else if (!(value < THRESHOLDS.p95Ms)) {
      failures.push(`${label}の p95 が ${fmt(value)}ms（${THRESHOLDS.p95Ms}ms 未満が合格）`);
    }
  };
  checkP95('全体', p95All, true);
  checkP95('取得', p95Meter, true);
  checkP95('申し込み', p95Join, result.expectedJoins > 0);

  if (p95Server === null) {
    failures.push('server_ms: Server-Timing を読めた応答が 1 件も無い');
  } else if (!(p95Server < THRESHOLDS.serverP95Ms)) {
    failures.push(
      `server_ms の p95 が ${fmt(p95Server)}ms（${THRESHOLDS.serverP95Ms}ms 未満が合格）`,
    );
  }
  if (!(errorRate < THRESHOLDS.errorRate)) {
    failures.push(
      `エラーが ${(errorRate * 100).toFixed(2)}%（${THRESHOLDS.errorRate * 100}% 未満が合格）`,
    );
  }
  if (result.status429 > 0) {
    failures.push(
      `429 が ${result.status429} 件（0 件が合格。同じ接続元の台数ぶんが弾かれている）`,
    );
  }
  if (result.dropped > 0) {
    failures.push(`出し切れなかった要求が ${result.dropped} 件（0 件が合格）`);
  }
  if (result.joinedDelta !== null && result.joinedDelta !== result.expectedJoins) {
    failures.push(
      `申し込み後の joined が ${result.joinedDelta} 増えた（${result.expectedJoins} が合格）`,
    );
  }
  if (result.countedTrue !== null && result.countedTrue !== result.expectedJoins) {
    failures.push(`counted: true が ${result.countedTrue} 件（${result.expectedJoins} が合格）`);
  }

  const pass = failures.length === 0;
  const line =
    `合否=${pass ? '合格' : '不合格'} ${result.clients}台 p95=${fmt(p95All)}ms（取得 ${fmt(p95Meter)}ms・申し込み ${fmt(p95Join)}ms） ` +
    `server_ms_p95=${fmt(p95Server)}ms エラー=${(errorRate * 100).toFixed(2)}% 429=${result.status429} 打ち切り=${result.dropped}` +
    (result.joinedDelta === null ? '' : ` joined増=${result.joinedDelta}/${result.expectedJoins}`);
  return { pass, failures, line };
}

/**
 * k6 の handleSummary に渡される結果から、同じ形の一行を作る。合否は、k6 の thresholds がすべて ok かで決める。
 * @param {any} data
 * @param {number} clients
 */
export function k6SummaryLine(data, clients) {
  const metrics = data?.metrics ?? {};
  /**
   * @param {string} name
   * @param {string} key
   * @returns {number | null}
   */
  const value = (name, key) => {
    const found = metrics[name]?.values?.[key];
    return typeof found === 'number' ? found : null;
  };
  const pass = Object.values(metrics).every((metric) =>
    Object.values(/** @type {any} */ (metric)?.thresholds ?? {}).every(
      (threshold) => /** @type {any} */ (threshold)?.ok === true,
    ),
  );
  const rate = value('http_req_failed', 'rate') ?? 0;
  return (
    `合否=${pass ? '合格' : '不合格'} ${clients}台 p95=${fmt(value('http_req_duration', 'p(95)'))}ms` +
    `（取得 ${fmt(value('http_req_duration{kind:meter}', 'p(95)'))}ms・申し込み ${fmt(value('http_req_duration{kind:join}', 'p(95)'))}ms） ` +
    `server_ms_p95=${fmt(value('server_ms', 'p(95)'))}ms エラー=${(rate * 100).toFixed(2)}% ` +
    `429=${value('status_429', 'count') ?? 0} 打ち切り=${value('dropped_iterations', 'count') ?? 0}`
  );
}
