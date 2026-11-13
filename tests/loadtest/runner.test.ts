import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runLoad } from '../../loadtest/n22-node.mjs';
import { createJsonLogger } from '../../src/server/logger';
import { startServer } from '../../src/server/start';
import type { RunningServer } from '../../src/server/start';

// 代わりの台本 n22-node.mjs の動作確認（I-99 の小さい版・I-100 の閾値の自己検査）。短い時間（2〜3 秒）で流す。
describe('Node の代わりの台本', () => {
  let dir: string;
  let real: RunningServer | undefined;
  const fakes: Server[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'oshiyobu-load-'));
  });
  afterEach(async () => {
    await real?.close();
    real = undefined;
    await Promise.all(
      fakes.splice(0).map((s) => {
        s.closeAllConnections();
        return new Promise((resolve) => s.close(resolve));
      }),
    );
    await rm(dir, { recursive: true, force: true });
  });

  /** 決まった遅れ・状態コードを返す小さなサーバー（閾値の自己検査用）。 */
  async function fakeServer(options: {
    delayMs?: number;
    status?: number;
    healthStatus?: number;
  }): Promise<string> {
    const server = createServer((req, res) => {
      const respond = () => {
        const isHealth = req.url === '/healthz';
        const status = isHealth ? (options.healthStatus ?? 200) : (options.status ?? 200);
        res.writeHead(status, {
          'content-type': 'application/json',
          'server-timing': 'app;dur=0.1',
        });
        res.end(
          JSON.stringify(
            isHealth
              ? { ok: true }
              : { performanceId: 'terao:KGS-001', joined: 0, counted: true, resetAt: null },
          ),
        );
      };
      req.resume();
      req.on('end', () => {
        if (options.delayMs !== undefined && req.url !== '/healthz') {
          setTimeout(respond, options.delayMs);
        } else {
          respond();
        }
      });
    });
    fakes.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    return `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;
  }

  it('実際の API に流すと合格する。申し込みの件数が、ちょうど申し込み件数だけ増え、すべて counted: true（I-99 の小さい版）', async () => {
    real = await startServer({
      env: { DATA_DIR: dir },
      logger: createJsonLogger(() => undefined),
      port: 0,
    });
    const { plan, result, evaluation } = await runLoad({
      base: `http://127.0.0.1:${real.port}`,
      clients: 20,
      durationSec: 3,
      joinStartSec: 1,
      joinWindowSec: 1,
    });
    expect(plan).toMatchObject({ getRatePerSec: 10, joins: 10 });
    expect(result.total).toBe(30 + 10); // 取得 毎秒 10 回 × 3 秒 + 申し込み 10 件
    expect(result.joinedDelta).toBe(10);
    expect(result.countedTrue).toBe(10);
    expect(result.status429).toBe(0);
    expect(evaluation.failures).toEqual([]);
    expect(evaluation.pass).toBe(true);
    expect(result.serverMs.length).toBeGreaterThan(0); // Server-Timing が読めている
    expect(evaluation.line).toMatch(/^合否=合格 20台 /);
  });

  it('同じ接続元から、端末の番号の違う申し込みを続けても、429 は 0 件（N-24）。100 件を一斉に近い間隔で', async () => {
    real = await startServer({
      env: { DATA_DIR: dir },
      logger: createJsonLogger(() => undefined),
      port: 0,
    });
    const { result } = await runLoad({
      base: `http://127.0.0.1:${real.port}`,
      clients: 20,
      joins: 100,
      durationSec: 2,
      joinStartSec: 0,
      joinWindowSec: 1,
    });
    expect(result.status429).toBe(0);
    expect(result.joinedDelta).toBe(100);
  });

  it('I-100: 遅延 700ms を返す相手には、p95 の閾値で不合格（結果は一行で出る）', async () => {
    const base = await fakeServer({ delayMs: 700 });
    const { evaluation } = await runLoad({
      base,
      clients: 10,
      durationSec: 2,
      joinStartSec: 0,
      joinWindowSec: 1,
    });
    expect(evaluation.pass).toBe(false);
    expect(evaluation.failures.join('\n')).toContain('p95');
    expect(evaluation.line).toMatch(/^合否=不合格 /);
  });

  it('I-100: 遅延が小さい（約 200ms）相手には合格する', async () => {
    const base = await fakeServer({ delayMs: 200 });
    const { evaluation } = await runLoad({
      base,
      clients: 10,
      durationSec: 2,
      joinStartSec: 0,
      joinWindowSec: 1,
    });
    // joined の増え方は、固定の応答では確かめられない（0 のまま）ので、この項目だけ除いて見る
    expect(
      evaluation.failures.filter((f) => !f.includes('joined') && !f.includes('counted')),
    ).toEqual([]);
  });

  it('I-100: 429 を返す相手には、429 の件数を数えて不合格', async () => {
    const base = await fakeServer({ status: 429 });
    const { result, evaluation } = await runLoad({
      base,
      clients: 10,
      durationSec: 1,
      joinStartSec: 0,
      joinWindowSec: 1,
    });
    expect(result.status429).toBe(result.total);
    expect(evaluation.pass).toBe(false);
    expect(evaluation.failures.join('\n')).toContain('429');
  });

  it('応答の無い相手には、待ちの超過をエラーに数える（timeoutMs で短くして確かめる）', async () => {
    const base = await fakeServer({ delayMs: 600 });
    const { result } = await runLoad({
      base,
      clients: 10,
      durationSec: 1,
      joinStartSec: 0,
      joinWindowSec: 1,
      timeoutMs: 100,
    });
    expect(result.failed).toBe(result.total);
  });

  it('実行の前の GET /healthz が 200 でないときは、始めずに例外にする', async () => {
    const base = await fakeServer({ healthStatus: 503 });
    await expect(
      runLoad({ base, clients: 10, durationSec: 1, joinStartSec: 0, joinWindowSec: 1 }),
    ).rejects.toThrow(/healthz/);
  });
});
