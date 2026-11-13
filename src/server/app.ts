import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { CORE_VERSION, isPerformanceId, isValidDeviceId } from '../core';
import type { ApiErrorCode, PerformanceId } from '../core';
import { isUsablePassphrase } from './config';
import type { ServerConfig } from './config';
import { hashDeviceId } from './hash';
import type { Logger } from './logger';
import type { SlidingWindowLimiter } from './ratelimit';
import type { MeterStore } from './store';

/** 申し込みの本文の上限（バイト）。`{ deviceId }` は約 60 バイト（設計 D-14）。 */
export const MAX_BODY_BYTES = 1024;
/** 合言葉が違うときに、返す前に待つ時間（ミリ秒。総当たりを現実的でなくする。設計 D-15）。 */
export const WRONG_PASSPHRASE_WAIT_MS = 1000;

export interface AppDeps {
  readonly store: MeterStore;
  readonly limiter: SlidingWindowLimiter;
  readonly config: Pick<ServerConfig, 'corsOrigins' | 'presenterPassphrase'>;
  readonly logger: Logger;
  /** 待ち。テストで差し替える。 */
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Content-Type から、メディアタイプだけを小文字で取り出す（`text/plain;charset=UTF-8` → `text/plain`）。 */
function mediaTypeOf(header: string | undefined): string {
  return (header ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

type ReadResult = { readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false };

/** 本文を、上限の大きさまで読む。Content-Length が無い・うそでも、読んだ量で止める。 */
async function readLimited(request: Request, maxBytes: number): Promise<ReadResult> {
  const declared = Number(request.headers.get('content-length'));
  if (declared > maxBytes) {
    return { ok: false };
  }
  if (request.body === null) {
    return { ok: true, bytes: new Uint8Array() };
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = (await reader.read()) as { done: boolean; value?: Uint8Array };
    if (done || value === undefined) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/** 本文から端末の番号を取り出す。`{ "deviceId": "<形の合う文字列>" }` だけを受け、それ以外は null。 */
function parseJoinBody(bytes: Uint8Array): string | null {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const keys = Object.keys(value);
  const deviceId = (value as Record<string, unknown>)['deviceId'];
  return keys.length === 1 && keys[0] === 'deviceId' && isValidDeviceId(deviceId) ? deviceId : null;
}

/** 合言葉の比較（同じ長さにしてから、定数時間で比べる）。 */
function samePassphrase(given: string, expected: string): boolean {
  const digest = (text: string) => createHash('sha256').update(text).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

const errorBody = (error: ApiErrorCode, extra: Record<string, number> = {}) => ({
  error,
  ...extra,
});

/**
 * 共有メーターの API（設計 D-11〜D-18）。サーバーを立てずに app.request() で試せる（設計 D-02）。
 * 応答はすべて JSON・no-store・nosniff・Server-Timing つき。cookie は使わない。
 * 預かるのは、公演ごとの人数だけ。個人の情報は、受け取らず・保存せず・ログにも出さない。
 */
export function createApp(deps: AppDeps): Hono {
  const { store, limiter, config, logger } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const app = new Hono();

  // 全応答の共通のヘッダー。Server-Timing は、入口から応答を組み立て終えるまでの処理時間（ミリ秒。N-22）。
  app.use('*', async (c, next) => {
    const started = process.hrtime.bigint();
    await next();
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    c.res.headers.set('Server-Timing', `app;dur=${ms.toFixed(3)}`);
    c.res.headers.set('Cache-Control', 'no-store');
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
  });

  // CORS: 設定した接続元（完全一致）にだけ許す。事前の問い合わせ（OPTIONS）が出るのは reset だけ（設計 D-13・D-16）。
  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowed = origin !== undefined && config.corsOrigins.includes(origin);
    if (c.req.method === 'OPTIONS') {
      if (allowed) {
        c.header('Access-Control-Allow-Origin', origin);
        c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        c.header('Access-Control-Allow-Headers', 'Content-Type, X-Presenter-Key');
        c.header('Access-Control-Max-Age', '600');
        c.header('Vary', 'Origin');
      }
      return c.body(null, 204);
    }
    await next();
    if (allowed) {
      c.res.headers.set('Access-Control-Allow-Origin', origin);
      c.res.headers.append('Vary', 'Origin');
    }
  });

  app.get('/healthz', (c) => c.json({ ok: true, coreVersion: CORE_VERSION }));

  /** パスの公演 ID。一覧（60 件）に無いものは null（キーが無限に増えない。設計 D-12）。 */
  const performanceOf = (c: Context): PerformanceId | null => {
    const pid: unknown = c.req.param('pid');
    return isPerformanceId(pid) ? pid : null;
  };

  app.get('/api/v1/performances/:pid/meter', (c) => {
    const pid = performanceOf(c);
    if (pid === null) {
      return c.json(errorBody('unknown_performance'), 404);
    }
    const { joined, resetAt } = store.get(pid);
    return c.json({ performanceId: pid, joined, resetAt });
  });

  app.post('/api/v1/performances/:pid/joins', async (c) => {
    const pid = performanceOf(c);
    if (pid === null) {
      return c.json(errorBody('unknown_performance'), 404);
    }
    const media = mediaTypeOf(c.req.header('content-type'));
    if (media !== 'text/plain' && media !== 'application/json') {
      return c.json(errorBody('unsupported_media_type'), 415);
    }
    const body = await readLimited(c.req.raw, MAX_BODY_BYTES);
    if (!body.ok) {
      return c.json(errorBody('payload_too_large'), 413);
    }
    const deviceId = parseJoinBody(body.bytes);
    if (deviceId === null) {
      return c.json(errorBody('invalid_body'), 400);
    }
    const deviceHash = hashDeviceId(deviceId);
    // 公演・全体の上限に届いていて、新しい端末なら、連打の記録を取る前に断る（番号を作り替えて送り続けても、メモリが増えない）。
    if (!store.canCount(pid, deviceHash)) {
      logger.warn('join_cap_reached', { performanceId: pid, joined: store.get(pid).joined });
      return c.json(errorBody('cap_reached', { joined: store.get(pid).joined }), 409);
    }
    // 連打の上限は端末の番号ごとだけ。接続元（IP）は見ない・数えない（同じ Wi-Fi の聞き手を弾かないため。N-24）。
    const hit = limiter.hit(deviceHash);
    if (!hit.allowed) {
      c.header('Retry-After', String(hit.retryAfterSec));
      return c.json(errorBody('rate_limited'), 429);
    }
    const result = store.join(pid, deviceHash);
    if (result.status === 'cap_reached') {
      logger.warn('join_cap_reached', { performanceId: pid, joined: result.joined });
      return c.json(errorBody('cap_reached', { joined: result.joined }), 409);
    }
    logger.info('join', { performanceId: pid, joined: result.joined, counted: result.counted });
    return c.json({
      performanceId: pid,
      joined: result.joined,
      counted: result.counted,
      resetAt: store.get(pid).resetAt,
    });
  });

  app.post('/api/v1/reset', async (c) => {
    const expected = config.presenterPassphrase;
    // 未設定・12 文字未満のときは、reset を無効にする（設定の読み込みでも弾くが、ここでも守る）。
    if (expected === undefined || !isUsablePassphrase(expected)) {
      return c.json(errorBody('not_configured'), 503);
    }
    if (!samePassphrase(c.req.header('x-presenter-key') ?? '', expected)) {
      await sleep(WRONG_PASSPHRASE_WAIT_MS);
      logger.warn('reset_unauthorized');
      return c.json(errorBody('unauthorized'), 401);
    }
    const resetAt = store.reset();
    logger.info('reset', { resetAt });
    return c.json({ resetAt });
  });

  app.notFound((c) => c.json(errorBody('not_found'), 404));

  app.onError((error, c) => {
    // 理由・例外の文言（パスなどを含みうる）は返さない・ログにも出さない。種類の名前だけ残す。
    logger.warn('internal_error', { name: error.name });
    return c.json(errorBody('internal_error'), 500);
  });

  return app;
}
