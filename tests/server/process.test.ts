import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CORE_VERSION } from '../../src/core';
import { bundleServer } from '../../scripts/lib/server-bundle.mjs';
import { createZip } from '../../scripts/lib/zip.mjs';
import { readZip } from '../scripts/zip-reader';
import { randomPassphrase } from './helpers';
import { inflateRawSync } from 'node:zlib';

// I-130: 束ねた server.mjs を、プロセスとして起動する（K-16）。配備物の zip から取り出したものを、
// node_modules の無い場所で起動できることも確かめる（設計 D-23）。

/** 空いている番号を 1 つ借りる。 */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

interface Started {
  readonly child: ChildProcess;
  readonly port: number;
  readonly output: () => string;
  readonly stop: () => Promise<number | null>;
}

describe('server.mjs をプロセスとして起動する（I-130）', () => {
  let workDir: string;
  let serverDir: string; // zip から取り出した、node_modules の無い場所
  const children: ChildProcess[] = [];

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'oshiyobu-proc-'));
    // 配備物と同じ作り方: 束ねる → zip にする → 空のフォルダに取り出す（node_modules は無い）
    const built = await bundleServer({ outDir: join(workDir, 'dist') });
    const files = [
      { name: 'server.mjs', data: await readFile(built.file) },
      { name: 'package.json', data: await readFile(join(dirname(built.file), 'package.json')) },
    ];
    serverDir = join(workDir, 'unzipped');
    await mkdir(serverDir);
    for (const entry of readZip(createZip(files))) {
      const body = entry.method === 8 ? inflateRawSync(entry.compressed) : entry.compressed;
      await writeFile(join(serverDir, entry.name), body);
    }
  });

  afterEach(() => {
    for (const child of children.splice(0)) {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  /** 起動して、server_started のログが出るまで待つ。env は、渡したものだけ（手元の環境変数を引き継がない）。 */
  async function start(env: Record<string, string>): Promise<Started> {
    const child = spawn(process.execPath, [join(serverDir, 'server.mjs')], {
      cwd: serverDir,
      env: { PATH: process.env['PATH'] ?? '', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    const port = Number(env['PORT']);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`起動の合図が出ません: ${output}`));
      }, 10_000);
      const poll = setInterval(() => {
        if (output.includes('"event":"server_started"')) {
          clearTimeout(timer);
          clearInterval(poll);
          resolve();
        }
      }, 20);
      child.once('exit', (code) => {
        clearTimeout(timer);
        clearInterval(poll);
        reject(new Error(`起動せずに終了しました（終了コード ${String(code)}）: ${output}`));
      });
    });
    return {
      child,
      port,
      output: () => output,
      stop: () =>
        new Promise((resolve) => {
          child.once('exit', (code) => {
            resolve(code);
          });
          child.kill('SIGTERM');
        }),
    };
  }

  it('(a) PORT を指定し、存在しない DATA_DIR で起動する: その番号で待ち受け、GET /healthz が 200。DATA_DIR が作られる', async () => {
    const port = await freePort();
    const dataDir = join(workDir, 'made', 'by', 'server');
    const server = await start({ PORT: String(port), DATA_DIR: dataDir, NODE_ENV: 'production' });
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, coreVersion: CORE_VERSION });
    expect((await stat(dataDir)).isDirectory()).toBe(true);
    expect(await server.stop()).toBe(0); // 終了の合図で、保存を済ませて 0 で終わる
  });

  it('(c) DATA_DIR が書けない場所（途中がファイル）でも、警告を出して保存なしで動く。落ちない', async () => {
    const blocker = join(workDir, 'blocker-file');
    await writeFile(blocker, 'x');
    const port = await freePort();
    const server = await start({ PORT: String(port), DATA_DIR: join(blocker, 'data') });
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
    expect(server.output()).toContain('"event":"persistence_disabled"');
  });

  it('(d) 保存ファイルが壊れている状態でも、空の状態で起動する', async () => {
    const dataDir = join(workDir, 'broken-data');
    await mkdir(dataDir);
    await writeFile(join(dataDir, 'meter.json'), '{ broken');
    const port = await freePort();
    const server = await start({ PORT: String(port), DATA_DIR: dataDir });
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/performances/tech0:cbox/meter`);
    expect(await res.json()).toEqual({ performanceId: 'tech0:cbox', joined: 0, resetAt: null });
    expect(server.output()).toContain('snapshot_unreadable');
  });

  it('どの場合も、PRESENTER_PASSPHRASE の値をログに出さない。値が未設定なら警告が出る', async () => {
    const passphrase = randomPassphrase();
    const port = await freePort();
    const withValue = await start({
      PORT: String(port),
      DATA_DIR: join(workDir, 'pass-data'),
      PRESENTER_PASSPHRASE: passphrase,
    });
    await fetch(`http://127.0.0.1:${port}/api/v1/reset`, {
      method: 'POST',
      headers: { 'x-presenter-key': randomPassphrase() }, // 間違い
    });
    await fetch(`http://127.0.0.1:${port}/api/v1/reset`, {
      method: 'POST',
      headers: { 'x-presenter-key': passphrase },
    });
    await withValue.stop();
    expect(withValue.output()).not.toContain(passphrase);
    expect(withValue.output()).not.toContain('passphrase_not_configured');

    const port2 = await freePort();
    const without = await start({ PORT: String(port2), DATA_DIR: join(workDir, 'pass-data2') });
    expect(without.output()).toContain('passphrase_not_configured');
  });

  it('終了の合図（SIGTERM）で、保存を済ませてから終わる。再起動しても、申し込みの件数が残る', async () => {
    const dataDir = join(workDir, 'restart-data');
    const port = await freePort();
    const first = await start({ PORT: String(port), DATA_DIR: dataDir });
    const joined = await fetch(`http://127.0.0.1:${port}/api/v1/performances/krs48:FUK-012/joins`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ deviceId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' }),
    });
    expect(joined.status).toBe(200);
    expect(await first.stop()).toBe(0);

    const port2 = await freePort();
    await start({ PORT: String(port2), DATA_DIR: dataDir });
    const res = await fetch(`http://127.0.0.1:${port2}/api/v1/performances/krs48:FUK-012/meter`);
    expect(((await res.json()) as { joined: number }).joined).toBe(1);
  });

  it('待ち受けの番号が使われているときは、理由の記号だけをログに出して、終了コード 1 で終わる', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, resolve));
    const address = blocker.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    try {
      await expect(start({ PORT: String(port), DATA_DIR: join(workDir, 'busy') })).rejects.toThrow(
        /終了コード 1）[\s\S]*"event":"start_failed"[\s\S]*EADDRINUSE/,
      );
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });
});
