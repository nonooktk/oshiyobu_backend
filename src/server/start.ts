import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { CORE_VERSION } from '../core';
import { createApp } from './app';
import { loadConfig } from './config';
import type { Logger } from './logger';
import { createSnapshotWriter, prepareDataDir } from './persistence';
import type { SnapshotWriter } from './persistence';
import { SlidingWindowLimiter } from './ratelimit';
import { MeterStore } from './store';

/** 端末の番号ごとの上限（設計 D-14）。1 申し込みの再送は最大 6 回なので、普通の使い方では当たらない。 */
const DEVICE_LIMIT_PER_MINUTE = 20;
const WINDOW_MS = 60_000;
/** 2 秒ごとに来る端末の接続を切らない（設計 D-13）。headersTimeout は、それより長くする。 */
const KEEP_ALIVE_TIMEOUT_MS = 65_000;
const HEADERS_TIMEOUT_MS = 66_000;
/** 終了の合図のあと、つながったままの接続を待つ時間。 */
const SHUTDOWN_GRACE_MS = 3_000;

export interface StartOptions {
  /** 環境変数（PORT・DATA_DIR・CORS_ORIGINS・PRESENTER_PASSPHRASE・NODE_ENV）。 */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly logger: Logger;
  /** 待ち受けの番号の上書き（テストで 0 ＝ 空いている番号にする）。無ければ環境変数の PORT。 */
  readonly port?: number;
  /** 待ち受けるアドレスの上書き。無ければすべて。 */
  readonly host?: string;
}

export interface RunningServer {
  /** 実際に待ち受けている番号。 */
  readonly port: number;
  readonly app: Hono;
  readonly store: MeterStore;
  readonly server: Server;
  /** 終了の合図: 保存を待たずに書き、接続を閉じる。 */
  close(): Promise<void>;
}

/**
 * サーバーを起動する（設計 D-23）。
 * 保存先のフォルダを作り、保存ファイルを読み、API を待ち受ける。保存できなくても、メモリだけで動く。
 */
export async function startServer(options: StartOptions): Promise<RunningServer> {
  const { logger } = options;
  const { config, warnings } = loadConfig(options.env);
  for (const warning of warnings) {
    logger.warn('config_warning', {
      code: warning.code,
      ...(warning.detail === undefined ? {} : { detail: warning.detail }),
    });
  }

  const loaded = await prepareDataDir(config.dataDir, logger);
  let writer: SnapshotWriter | undefined;
  const store = new MeterStore({
    ...(loaded.snapshot === undefined ? {} : { initial: loaded.snapshot }),
    onChange: () => writer?.schedule(),
  });
  if (loaded.writable) {
    writer = createSnapshotWriter({
      dir: config.dataDir,
      logger,
      getSnapshot: () => store.snapshot(),
    });
  }

  const limiter = new SlidingWindowLimiter({
    limit: DEVICE_LIMIT_PER_MINUTE,
    windowMs: WINDOW_MS,
    now: () => Date.now(),
  });
  const app = createApp({ store, limiter, config, logger });

  const listenPort = options.port ?? config.port;
  const { server, port } = await new Promise<{ server: Server; port: number }>(
    (resolve, reject) => {
      const created = serve(
        {
          fetch: app.fetch,
          port: listenPort,
          ...(options.host === undefined ? {} : { hostname: options.host }),
          serverOptions: {
            keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
            headersTimeout: HEADERS_TIMEOUT_MS,
          },
        },
        (info) => {
          resolve({ server: created as Server, port: info.port });
        },
      );
      created.once('error', reject);
    },
  );

  logger.info('server_started', {
    port,
    persistence: loaded.writable,
    coreVersion: CORE_VERSION,
  });

  return {
    port,
    app,
    store,
    server,
    async close() {
      await writer?.flush();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          server.closeAllConnections();
        }, SHUTDOWN_GRACE_MS);
        timer.unref();
        server.close(() => {
          clearTimeout(timer);
          resolve();
        });
        server.closeIdleConnections();
      });
    },
  };
}
