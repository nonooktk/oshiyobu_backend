// @ts-check
// 共有メーター API の負荷の試験（k6）。設計 D-42・テスト設計 I-95〜I-100・S-73〜S-76。
//   k6 run -e BASE=<API の URL> -e CLIENTS=100 loadtest/n22.js
//   -e CLIENTS=150 で余裕の確認。-e PID=<公演 ID> で公演を変えられる（既定は、発表に使わない terao:KGS-001）。
// 取得（毎秒 台数÷2 回。constant-arrival-rate）に、開始 30 秒後から 10 秒間で 台数÷2 件の申し込みを重ね、100 秒続ける。
// 1 つの IP（この端末）から出すので、同じ Wi-Fi の聞き手の再現になる。端末の番号は、実行ごとに新しい乱数。
// 合格（thresholds。1 つでも外れたら、終了コードが 0 でない）: 応答の p95 < 500ms（全体・取得・申し込み）／
// server_ms（応答の Server-Timing）の p95 < 50ms／エラー < 1%（409 は想定内）／429 が 0 件／出し切れなかった要求が 0 件／
// 申し込み後の joined の増え方が、申し込み件数と同じ。
import crypto from 'k6/crypto';
import { check, fail } from 'k6';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';
import { DEFAULT_PID, THRESHOLDS, buildPlan, k6SummaryLine, parseServerTiming } from './lib.js';

const BASE = (__ENV.BASE ?? '').replace(/\/$/, '');
const CLIENTS = Number(__ENV.CLIENTS ?? 100);
const PID = __ENV.PID ?? DEFAULT_PID;
if (BASE === '') {
  throw new Error('BASE（API の URL）を -e BASE=... で渡してください');
}
const plan = buildPlan(CLIENTS);

// 応答のうち、409（上限）は想定内として、エラーに数えない。
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 409));

const serverMs = new Trend('server_ms');
const status429 = new Counter('status_429');
const joinCounted = new Counter('join_counted');
const joinedDeltaMismatch = new Counter('joined_delta_mismatch');

const meterUrl = `${BASE}/api/v1/performances/${PID}/meter`;
const joinUrl = `${BASE}/api/v1/performances/${PID}/joins`;

export const options = {
  scenarios: {
    // 取得: 台数 ÷ 2 を毎秒の回数にする（rate = 台数、timeUnit = 2 秒 なら、台数が奇数でも割り切れる）
    meter: {
      executor: 'constant-arrival-rate',
      rate: plan.clients,
      timeUnit: '2s',
      duration: `${plan.durationSec}s`,
      preAllocatedVUs: Math.ceil(plan.getRatePerSec * 0.5) + 20,
      maxVUs: 400,
      exec: 'meter',
      tags: { kind: 'meter' },
    },
    // 申し込み: 開始 30 秒後から 10 秒間に、台数 ÷ 2 件（10 秒の窓に joins 回）
    join: {
      executor: 'constant-arrival-rate',
      rate: plan.joins,
      timeUnit: `${plan.joinWindowSec}s`,
      duration: `${plan.joinWindowSec}s`,
      startTime: `${plan.joinStartSec}s`,
      preAllocatedVUs: 20,
      maxVUs: 200,
      exec: 'join',
      tags: { kind: 'join' },
    },
  },
  thresholds: {
    http_req_failed: [`rate<${THRESHOLDS.errorRate}`],
    http_req_duration: [`p(95)<${THRESHOLDS.p95Ms}`],
    'http_req_duration{kind:meter}': [`p(95)<${THRESHOLDS.p95Ms}`],
    'http_req_duration{kind:join}': [`p(95)<${THRESHOLDS.p95Ms}`],
    server_ms: [`p(95)<${THRESHOLDS.serverP95Ms}`],
    status_429: ['count==0'],
    dropped_iterations: ['count==0'],
    joined_delta_mismatch: ['count==0'],
    join_counted: [`count==${plan.joins}`],
  },
};

/** 実行の前: 生存の確認と、いまの件数。 */
export function setup() {
  const health = http.get(`${BASE}/healthz`);
  if (health.status !== 200) {
    fail(`実行の前の GET /healthz が ${health.status} です（200 でなければ始めません）`);
  }
  const before = http.get(meterUrl).json('joined');
  return { before: typeof before === 'number' ? before : null };
}

export function meter() {
  const res = http.get(meterUrl, { tags: { kind: 'meter' } });
  record(res);
  check(res, { 'GET meter は 200': (r) => r.status === 200 });
}

export function join() {
  // 端末の番号は、実行ごと・要求ごとに新しい乱数（32 桁の 16 進数）。
  const deviceId = Array.from(new Uint8Array(crypto.randomBytes(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const res = http.post(joinUrl, JSON.stringify({ deviceId }), {
    // 事前の問い合わせ（OPTIONS）が要らない送り方（設計 D-13）
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    tags: { kind: 'join' },
  });
  record(res);
  const ok = check(res, { 'POST joins は 200': (r) => r.status === 200 });
  if (ok && res.json('counted') === true) {
    joinCounted.add(1);
  }
}

/** @param {import('k6/http').RefinedResponse<any>} res */
function record(res) {
  const ms = parseServerTiming(res.headers['Server-Timing']);
  if (ms !== null) {
    serverMs.add(ms);
  }
  if (res.status === 429) {
    status429.add(1);
  }
}

/** 実行の後: 生存の確認と、件数が、申し込み件数ちょうど増えたこと。 */
export function teardown(/** @type {{ before: number | null }} */ data) {
  const health = http.get(`${BASE}/healthz`);
  check(health, { '実行の後の /healthz は 200': (r) => r.status === 200 });
  const after = http.get(meterUrl).json('joined');
  if (data.before !== null && typeof after === 'number' && after - data.before !== plan.joins) {
    joinedDeltaMismatch.add(1);
    console.error(`joined が ${after - data.before} 増えました（申し込み ${plan.joins} 件のはず）`);
  }
}

/** 結果は、合否・p95・server_ms・エラー・429 の一行で出す（I-100）。 */
export function handleSummary(/** @type {any} */ data) {
  return { stdout: `${k6SummaryLine(data, CLIENTS)}\n` };
}
