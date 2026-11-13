import { randomBytes } from 'node:crypto';
import { createApp } from '../../src/server/app';
import type { AppDeps } from '../../src/server/app';
import { createJsonLogger } from '../../src/server/logger';
import { SlidingWindowLimiter } from '../../src/server/ratelimit';
import { MeterStore } from '../../src/server/store';

/** 実行のたびに変わる、端末の番号（32 桁の 16 進数）。ソースに値を書かない。 */
export const randomDeviceId = (): string => randomBytes(16).toString('hex');

/** 実行のたびに変わる、試験用の合言葉（ソースに値を書かない）。 */
export const randomPassphrase = (length = 18): string =>
  randomBytes(length).toString('hex').slice(0, length);

export interface HarnessOptions {
  readonly corsOrigins?: readonly string[];
  /** 無効な合言葉（未設定・短い）を試すときは undefined。 */
  readonly passphrase?: string | undefined;
  readonly startMs?: number;
  readonly app?: Partial<AppDeps>;
}

/** app.request でサーバーを立てずに試すための道具一式（設計 D-02）。時刻と待ちは差し替えられる。 */
export function makeHarness(options: HarnessOptions = {}) {
  let now = options.startMs ?? Date.UTC(2026, 10, 20, 0, 0, 0, 0);
  const logs: string[] = [];
  const sleeps: number[] = [];
  const store = new MeterStore({ now: () => now });
  const limiter = new SlidingWindowLimiter({ limit: 20, windowMs: 60_000, now: () => now });
  const passphrase = 'passphrase' in options ? options.passphrase : randomPassphrase();
  const app = createApp({
    store,
    limiter,
    config: {
      corsOrigins: options.corsOrigins ?? ['https://app.example.test'],
      presenterPassphrase: passphrase,
    },
    logger: createJsonLogger(
      (line) => logs.push(line),
      () => now,
    ),
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    ...options.app,
  });

  const base = '/api/v1/performances';
  return {
    app,
    store,
    limiter,
    logs,
    sleeps,
    passphrase,
    advance: (ms: number) => {
      now += ms;
    },
    get: (pid: string, init?: RequestInit) => app.request(`${base}/${pid}/meter`, init),
    join: (pid: string, deviceId: string = randomDeviceId(), init?: RequestInit) =>
      app.request(`${base}/${pid}/joins`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ deviceId }),
        ...init,
      }),
    reset: (key?: string, init?: RequestInit) =>
      app.request('/api/v1/reset', {
        method: 'POST',
        headers: key === undefined ? {} : { 'x-presenter-key': key },
        ...init,
      }),
  };
}

export type Harness = ReturnType<typeof makeHarness>;
