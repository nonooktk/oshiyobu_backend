// 負荷の試験の、Node だけの代わりの台本（k6 が手元に無いとき用。k6 の台本 n22.js と同じ数字・同じ合否の部品 lib.js を使う）。
//   node loadtest/n22-node.mjs --base http://127.0.0.1:8787 --clients 100
// 本番の B1 に当てる試験は、k6（コーディネーター側の Mac。D-42）で行う。この台本は、手元のサーバー（127.0.0.1）で、
// 台本の数字と閾値を確かめるための道具。同じ PC でサーバーと台本が動くので、本番の通信の遅れ・接続数は再現しない。
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { DEFAULT_PID, buildPlan, evaluate, parseServerTiming } from './lib.js';

/** 予定の時刻より、これ以上遅れて出した要求は「出し切れなかった」と数える（k6 の dropped_iterations に当たる）。 */
const LATE_MS = 250;
/** 1 要求の待ち（ミリ秒）。設計 D-17 の 8 秒。 */
const DEFAULT_TIMEOUT_MS = 8000;

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * @param {{
 *   base: string, pid?: string, clients?: number, timeoutMs?: number,
 *   joins?: number, joinStartSec?: number, joinWindowSec?: number, durationSec?: number,
 *   onProgress?: (message: string) => void,
 * }} options
 */
export async function runLoad(options) {
  const base = options.base.replace(/\/$/, '');
  const pid = options.pid ?? DEFAULT_PID;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const plan = buildPlan(options.clients ?? 100, {
    ...(options.joins === undefined ? {} : { joins: options.joins }),
    ...(options.joinStartSec === undefined ? {} : { joinStartSec: options.joinStartSec }),
    ...(options.joinWindowSec === undefined ? {} : { joinWindowSec: options.joinWindowSec }),
    ...(options.durationSec === undefined ? {} : { durationSec: options.durationSec }),
  });
  const meterUrl = `${base}/api/v1/performances/${pid}/meter`;
  const joinUrl = `${base}/api/v1/performances/${pid}/joins`;

  // 実行の前: 生存の確認と、いまの件数
  const health = await fetch(`${base}/healthz`);
  if (health.status !== 200) {
    throw new Error(`実行の前の GET /healthz が ${health.status} です（200 でなければ始めません）`);
  }
  const before = await readJoined(meterUrl);

  // 予定表: 取得は毎秒 台数÷2 回を一定の間隔で、申し込みは窓の中に等間隔で
  const events = [];
  const meterCount = Math.round(plan.getRatePerSec * plan.durationSec);
  for (let i = 0; i < meterCount; i++) {
    events.push({ at: i / plan.getRatePerSec, kind: 'meter' });
  }
  for (let i = 0; i < plan.joins; i++) {
    events.push({ at: plan.joinStartSec + (i * plan.joinWindowSec) / plan.joins, kind: 'join' });
  }
  events.sort((a, b) => a.at - b.at);

  const record = {
    meterMs: [],
    joinMs: [],
    serverMs: [],
    total: 0,
    failed: 0,
    status429: 0,
    dropped: 0,
    countedTrue: 0,
  };

  const send = async (kind) => {
    const started = performance.now();
    record.total += 1;
    try {
      const init =
        kind === 'meter'
          ? { signal: AbortSignal.timeout(timeoutMs) }
          : {
              method: 'POST',
              // 事前の問い合わせ（OPTIONS）が要らない送り方（設計 D-13）。端末の番号は、実行ごとに新しい乱数。
              headers: { 'content-type': 'text/plain;charset=UTF-8' },
              body: JSON.stringify({ deviceId: randomBytes(16).toString('hex') }),
              signal: AbortSignal.timeout(timeoutMs),
            };
      const res = await fetch(kind === 'meter' ? meterUrl : joinUrl, init);
      const text = await res.text();
      const elapsed = performance.now() - started;
      (kind === 'meter' ? record.meterMs : record.joinMs).push(elapsed);
      const serverMs = parseServerTiming(res.headers.get('server-timing'));
      if (serverMs !== null) record.serverMs.push(serverMs);
      if (res.status === 429) record.status429 += 1;
      // 409（上限）は、想定内として、エラーに数えない（D-42）。
      const expected = res.status === 200 || (kind === 'join' && res.status === 409);
      if (!expected) record.failed += 1;
      if (kind === 'join' && res.status === 200) {
        try {
          if (JSON.parse(text).counted === true) record.countedTrue += 1;
        } catch {
          record.failed += 1;
        }
      }
    } catch {
      record.failed += 1; // 通信の失敗・待ちの超過
    }
  };

  options.onProgress?.(
    `開始: ${plan.clients}台・${plan.durationSec}秒・取得 ${meterCount} 回・申し込み ${plan.joins} 件・公演 ${pid}`,
  );
  const t0 = performance.now();
  const inflight = [];
  for (const event of events) {
    const due = t0 + event.at * 1000;
    const wait = due - performance.now();
    if (wait > 2) await sleep(wait - 1);
    if (performance.now() - due > LATE_MS) record.dropped += 1;
    inflight.push(send(event.kind));
  }
  await Promise.all(inflight);

  // 実行の後: 生存の確認と、件数の増え方
  const healthAfter = await fetch(`${base}/healthz`);
  const after = await readJoined(meterUrl);
  const joinedDelta = before === null || after === null ? null : after - before;
  const result = {
    ...record,
    clients: plan.clients,
    expectedJoins: plan.joins,
    joinedDelta,
    countedTrue: record.countedTrue,
  };
  const evaluation = evaluate(result);
  if (healthAfter.status !== 200) {
    evaluation.failures.push(`実行の後の GET /healthz が ${healthAfter.status}（200 が合格）`);
    evaluation.pass = false;
    evaluation.line = evaluation.line.replace('合否=合格', '合否=不合格');
  }
  return { plan, result, evaluation };
}

async function readJoined(meterUrl) {
  try {
    const res = await fetch(meterUrl);
    const body = await res.json();
    return typeof body.joined === 'number' ? body.joined : null;
  } catch {
    return null;
  }
}

// 手元から呼んだときだけ動く（テストから import したときは動かさない）。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      base: { type: 'string' },
      clients: { type: 'string', default: '100' },
      pid: { type: 'string', default: DEFAULT_PID },
      duration: { type: 'string' },
      'join-start': { type: 'string' },
      'join-window': { type: 'string' },
      joins: { type: 'string' },
    },
  });
  if (values.base === undefined) {
    console.error(
      '使い方: node loadtest/n22-node.mjs --base <URL> [--clients 100] [--pid terao:KGS-001] [--duration 100] [--join-start 30] [--join-window 10] [--joins 50]',
    );
    process.exit(2);
  }
  const number = (text) => (text === undefined ? undefined : Number(text));
  try {
    const { evaluation } = await runLoad({
      base: values.base,
      pid: values.pid,
      clients: Number(values.clients),
      durationSec: number(values.duration),
      joinStartSec: number(values['join-start']),
      joinWindowSec: number(values['join-window']),
      joins: number(values.joins),
      onProgress: (message) => console.error(message),
    });
    console.log(evaluation.line);
    for (const failure of evaluation.failures) console.error(`  不合格の理由: ${failure}`);
    process.exit(evaluation.pass ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
