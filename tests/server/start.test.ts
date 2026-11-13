import { createServer } from 'node:net';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CORE_VERSION, parseJoinResponse, parseMeterResponse } from '../../src/core';
import { createJsonLogger } from '../../src/server/logger';
import { startServer } from '../../src/server/start';
import type { RunningServer } from '../../src/server/start';
import { randomDeviceId, randomPassphrase } from './helpers';

// 起動（設計 D-23・D-24・K-16・I-130）。実際に待ち受けるので、port 0（空いている番号）で起動する。
const PID = 'tech0:cbox';

describe('サーバーの起動と終了', () => {
  let root: string;
  let logs: string[];
  const running: RunningServer[] = [];
  const logger = () => createJsonLogger((line) => logs.push(line));

  const start = async (env: Record<string, string | undefined>) => {
    const server = await startServer({ env, logger: logger(), port: 0 });
    running.push(server);
    return server;
  };
  const url = (server: RunningServer, path: string) => `http://127.0.0.1:${server.port}${path}`;
  const post = (server: RunningServer, deviceId: string) =>
    fetch(url(server, `/api/v1/performances/${PID}/joins`), {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ deviceId }),
    });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'oshiyobu-start-'));
    logs = [];
  });
  afterEach(async () => {
    await Promise.all(running.splice(0).map((server) => server.close()));
    await rm(root, { recursive: true, force: true });
  });

  it('起動して、GET /healthz が 200 と coreVersion を返す。保存先のフォルダが（途中も）作られる（I-130 (a)）', async () => {
    const dataDir = join(root, 'nested', 'data');
    const server = await start({ DATA_DIR: dataDir, NODE_ENV: 'production' });
    const res = await fetch(url(server, '/healthz'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, coreVersion: CORE_VERSION });
    expect((await stat(dataDir)).isDirectory()).toBe(true);
    expect(logs.join('\n')).toContain('"event":"server_started"');
  });

  it('keep-alive は 65 秒（2 秒ごとに来る端末の接続を切らない。設計 D-13）', async () => {
    const server = await start({ DATA_DIR: root });
    expect(server.server.keepAliveTimeout).toBe(65_000);
    expect(server.server.headersTimeout).toBeGreaterThan(65_000);
  });

  it('申し込んだ件数が、終了で保存され、再起動しても消えない（同じ端末は counted: false のまま）', async () => {
    const id = randomDeviceId();
    const first = await start({ DATA_DIR: root });
    expect(parseJoinResponse(await (await post(first, id)).json())).toMatchObject({
      counted: true,
      joined: 1,
    });
    await first.close(); // 終了の合図で、待たずに書く
    const saved = await readFile(join(root, 'meter.json'), 'utf8');
    expect(saved).not.toContain(id); // 端末の番号そのものは保存しない

    const second = await start({ DATA_DIR: root });
    const meter = parseMeterResponse(
      await (await fetch(url(second, `/api/v1/performances/${PID}/meter`))).json(),
    );
    expect(meter?.joined).toBe(1);
    expect(parseJoinResponse(await (await post(second, id)).json())).toMatchObject({
      counted: false,
      joined: 1,
    });
  });

  it('保存先を作れないときは、警告を出して、保存なしで動く（落ちない。I-130 (c)）', async () => {
    const blocker = join(root, 'blocker');
    await writeFile(blocker, 'x');
    const server = await start({ DATA_DIR: join(blocker, 'data') });
    const res = await post(server, randomDeviceId());
    expect(res.status).toBe(200);
    expect(logs.join('\n')).toContain('"event":"persistence_disabled"');
  });

  it('保存ファイルが壊れているときは、空の状態で起動する（I-130 (d)）', async () => {
    await writeFile(join(root, 'meter.json'), '{ broken');
    const server = await start({ DATA_DIR: root });
    const meter = parseMeterResponse(
      await (await fetch(url(server, `/api/v1/performances/${PID}/meter`))).json(),
    );
    expect(meter).toEqual({ performanceId: PID, joined: 0, resetAt: null });
  });

  it('合言葉が未設定なら reset は 503。起動のログに警告が出る。ログに合言葉の値は出ない', async () => {
    const server = await start({ DATA_DIR: root });
    const res = await fetch(url(server, '/api/v1/reset'), {
      method: 'POST',
      headers: { 'x-presenter-key': 'x' },
    });
    expect(res.status).toBe(503);
    expect(logs.join('\n')).toContain('passphrase_not_configured');
  });

  it('合言葉が設定されていれば reset できる。値はログに出ない（I-130 の「合言葉をログに出さない」）', async () => {
    const passphrase = randomPassphrase();
    const server = await start({ DATA_DIR: root, PRESENTER_PASSPHRASE: passphrase });
    const res = await fetch(url(server, '/api/v1/reset'), {
      method: 'POST',
      headers: { 'x-presenter-key': passphrase },
    });
    expect(res.status).toBe(200);
    expect(logs.join('\n')).not.toContain(passphrase);
    expect(logs.join('\n')).not.toContain('passphrase_not_configured');
  });

  it('CORS_ORIGINS の環境変数で、許す接続元を決める', async () => {
    const server = await start({
      DATA_DIR: root,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://app.example.test',
    });
    const allowed = await fetch(url(server, '/healthz'), {
      headers: { origin: 'https://app.example.test' },
    });
    const other = await fetch(url(server, '/healthz'), {
      headers: { origin: 'https://evil.example.test' },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.example.test');
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('待ち受けの番号がすでに使われているときは、起動に失敗する（ほかのプロセスを止めない）', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const address = blocker.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    try {
      await expect(
        startServer({ env: { DATA_DIR: root }, logger: logger(), port, host: '127.0.0.1' }),
      ).rejects.toMatchObject({ code: 'EADDRINUSE' });
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });
});
