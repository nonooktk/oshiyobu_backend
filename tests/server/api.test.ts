import { describe, expect, it } from 'vitest';
import {
  CORE_VERSION,
  parseApiErrorResponse,
  parseJoinResponse,
  parseMeterResponse,
  parseResetResponse,
} from '../../src/core';
import { createApp } from '../../src/server/app';
import { PER_PERFORMANCE_LIMIT } from '../../src/server/store';
import { createJsonLogger } from '../../src/server/logger';
import { SlidingWindowLimiter } from '../../src/server/ratelimit';
import { MeterStore } from '../../src/server/store';
import { makeHarness, randomDeviceId, randomPassphrase } from './helpers';

// 結合 I のうち API にかかわるもの（I-36〜I-45・I-129 の API 側）。設計 D-11〜D-17・仕様 SP-61〜SP-65・SP-99。
const PID = 'tech0:cbox';
const json = async (res: Response): Promise<unknown> => res.json();

describe('GET /healthz（生存の確認。設計 D-13）', () => {
  it('200 と { ok: true, coreVersion }。coreVersion は core の版（配備後の確認に使う。I-107）', async () => {
    const h = makeHarness();
    const res = await h.app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, coreVersion: CORE_VERSION });
  });
});

describe('I-36 / I-129: 3 本の応答が core の型どおり。joined は申し込みの件数で、0 から数える', () => {
  it('(a) 初回の GET は joined 0（開始人数 74 は含まない）・resetAt null', async () => {
    const h = makeHarness();
    const res = await h.get(PID);
    expect(res.status).toBe(200);
    expect(parseMeterResponse(await json(res))).toEqual({
      performanceId: PID,
      joined: 0,
      resetAt: null,
    });
  });

  it('(b)(c)(d)(e) ほかの端末の申し込み → 自分の申し込み → reset の順に、件数と型が正しい', async () => {
    const h = makeHarness();
    // (b) ほかの端末の 1 件
    await h.join(PID);
    expect(parseMeterResponse(await json(await h.get(PID)))?.joined).toBe(1);
    // (c) 自分の申し込み。応答の型は parseJoinResponse で検査する
    const mine = parseJoinResponse(await json(await h.join(PID)));
    expect(mine).toEqual({ performanceId: PID, joined: 2, counted: true, resetAt: null });
    // (d) reset のあと、件数は 0、resetAt が時刻になる
    const reset = parseResetResponse(await json(await h.reset(h.passphrase)));
    expect(reset?.resetAt).toBe('2026-11-20T00:00:00.000Z');
    expect(parseMeterResponse(await json(await h.get(PID)))).toEqual({
      performanceId: PID,
      joined: 0,
      resetAt: '2026-11-20T00:00:00.000Z',
    });
  });

  it('GET meter が返す resetAt を、申し込みの応答も返す（端末が最初の応答の resetAt を基準にするため。D-18 の規則 10）', async () => {
    const h = makeHarness();
    await h.reset(h.passphrase);
    const joined = parseJoinResponse(await json(await h.join(PID)));
    expect(joined?.resetAt).toBe('2026-11-20T00:00:00.000Z');
  });

  it('公演は別々に数える。別の公演の件数は動かない（I-62）', async () => {
    const h = makeHarness();
    await h.join(PID);
    expect(parseMeterResponse(await json(await h.get('krs48:FUK-012')))?.joined).toBe(0);
  });
});

describe('I-37: 同じ端末の番号は 1 回だけ数える', () => {
  it('1 回目は counted: true・joined 1。2 回目は counted: false・joined 1（数は増えない）', async () => {
    const h = makeHarness();
    const id = randomDeviceId();
    expect(parseJoinResponse(await json(await h.join(PID, id)))).toMatchObject({
      counted: true,
      joined: 1,
    });
    expect(parseJoinResponse(await json(await h.join(PID, id)))).toMatchObject({
      counted: false,
      joined: 1,
    });
  });

  it('保存する中身に、端末の番号そのものは無い（ハッシュの先頭 16 桁だけ）', async () => {
    const h = makeHarness();
    const id = randomDeviceId();
    await h.join(PID, id);
    const saved = JSON.stringify(h.store.snapshot());
    expect(saved).not.toContain(id);
    expect(h.store.snapshot().performances[PID]?.ids[0]).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('事前の問い合わせ（OPTIONS）が要らない送り方（K-17。I-38・I-43）', () => {
  it.each([
    ['text/plain;charset=UTF-8'],
    ['text/plain'],
    ['Text/Plain; Charset=utf-8'],
    ['application/json'],
    ['application/json; charset=utf-8'],
  ])('Content-Type が「%s」の申し込みは 200', async (contentType) => {
    const h = makeHarness();
    const res = await h.join(PID, randomDeviceId(), { headers: { 'content-type': contentType } });
    expect(res.status).toBe(200);
  });
});

describe('I-38: 不正な入力（5xx は 0 件。メモリのキーは増えない）', () => {
  const okId = 'a'.repeat(16);

  it.each([
    ['一覧に無い公演 ID', 'tech0:nope'],
    ['大文字の公演 ID', 'TECH0:CBOX'],
    ['記号入り', 'tech0%3Acbox%00'],
    ['空白つき', 'tech0:cbox%20'],
    ['長すぎる', 'a'.repeat(1000)],
    ['__proto__', '__proto__'],
  ])('公演 ID が不正（%s）は 404 unknown_performance（GET・POST とも）', async (_label, pid) => {
    const h = makeHarness();
    const get = await h.get(pid);
    expect(get.status).toBe(404);
    expect(parseApiErrorResponse(await json(get))).toEqual({ error: 'unknown_performance' });
    const post = await h.join(pid, okId);
    expect(post.status).toBe(404);
    expect(parseApiErrorResponse(await json(post))).toEqual({ error: 'unknown_performance' });
    expect(h.store.totalJoined()).toBe(0);
  });

  it('公演 ID が不正なら、本文が不正でも 404（公演の確認が先）', async () => {
    const h = makeHarness();
    const res = await h.join('tech0:nope', okId, { body: 'not json' });
    expect(res.status).toBe(404);
  });

  it.each([
    ['JSON でない文字', 'not json'],
    ['空の本文', ''],
    ['null', 'null'],
    ['配列', '[]'],
    ['配列の中に deviceId', JSON.stringify([{ deviceId: 'a'.repeat(16) }])],
    ['文字列', '"a"'],
    ['数', '12345678901234567890'],
    ['空のオブジェクト', '{}'],
    ['__proto__', '{"__proto__":{}}'],
    ['__proto__ と deviceId', '{"__proto__":{},"deviceId":"' + 'a'.repeat(16) + '"}'],
    ['余分な項目つき', JSON.stringify({ deviceId: 'a'.repeat(16), extra: 1 })],
    ['deviceId が 15 文字', JSON.stringify({ deviceId: 'a'.repeat(15) })],
    ['deviceId が 65 文字', JSON.stringify({ deviceId: 'a'.repeat(65) })],
    ['deviceId に !', JSON.stringify({ deviceId: 'a'.repeat(15) + '!' })],
    ['deviceId が数', JSON.stringify({ deviceId: 1234567890123456 })],
    ['deviceId が null', JSON.stringify({ deviceId: null })],
    ['項目名が違う', JSON.stringify({ device_id: 'a'.repeat(16) })],
    ['BOM つき', '﻿' + JSON.stringify({ deviceId: 'a'.repeat(16) })],
  ])('本文が不正（%s）は 400 invalid_body', async (_label, body) => {
    const h = makeHarness();
    const res = await h.join(PID, okId, { body });
    expect(res.status).toBe(400);
    expect(parseApiErrorResponse(await json(res))).toEqual({ error: 'invalid_body' });
    expect(h.store.totalJoined()).toBe(0);
    expect(h.limiter.size()).toBe(0); // 不正な本文では、上限の記録（メモリ）を増やさない
  });

  it('UTF-8 として読めない本文は 400', async () => {
    const h = makeHarness();
    const res = await h.join(PID, okId, { body: new Uint8Array([0xff, 0xfe, 0x7b, 0x7d]) });
    expect(res.status).toBe(400);
  });

  it('本文が 1 KB を超えたら 413 payload_too_large（1,024 バイトちょうどは受ける）', async () => {
    const h = makeHarness();
    const big = JSON.stringify({ deviceId: okId, pad: 'x'.repeat(2000) });
    const res = await h.join(PID, okId, { body: big });
    expect(res.status).toBe(413);
    expect(parseApiErrorResponse(await json(res))).toEqual({ error: 'payload_too_large' });
    // 境界: 1,024 バイトちょうどの本文は、大きさでは止めない（中身が不正なので 400）
    const exact = ' '.repeat(1024 - 2) + '{}';
    expect(new TextEncoder().encode(exact).length).toBe(1024);
    expect((await h.join(PID, okId, { body: exact })).status).toBe(400);
    expect((await h.join(PID, okId, { body: exact + ' ' })).status).toBe(413);
  });

  it('Content-Length が無い・うそでも、読んだ量で止める（ストリームの 5,000 バイト → 413）', async () => {
    const h = makeHarness();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 5; i++) controller.enqueue(new TextEncoder().encode('x'.repeat(1000)));
        controller.close();
      },
    });
    const res = await h.join(PID, okId, { body: stream, duplex: 'half' });
    expect(res.status).toBe(413);
  });

  it.each([
    ['text/html'],
    ['multipart/form-data; boundary=x'],
    ['application/x-www-form-urlencoded'],
    ['application/xml'],
    [''],
  ])('Content-Type が「%s」は 415 unsupported_media_type', async (contentType) => {
    const h = makeHarness();
    // 本文を文字列にすると fetch が text/plain を自動で付けるので、バイト列で送る（Content-Type 無しも作れる）。
    const res = await h.app.request(`/api/v1/performances/${PID}/joins`, {
      method: 'POST',
      headers: contentType === '' ? {} : { 'content-type': contentType },
      body: new TextEncoder().encode(JSON.stringify({ deviceId: okId })),
    });
    expect(res.status).toBe(415);
    expect(parseApiErrorResponse(await json(res))).toEqual({ error: 'unsupported_media_type' });
    expect(h.store.totalJoined()).toBe(0);
  });

  it('GET に本文があっても、無視して 200（本文を読まない）', async () => {
    const h = makeHarness();
    const res = await h.get(PID, { method: 'GET' });
    expect(res.status).toBe(200);
  });

  it('知らない道・合わない方法は 404 not_found', async () => {
    const h = makeHarness();
    for (const [method, path] of [
      ['GET', '/'],
      ['GET', '/api/v1'],
      ['POST', '/healthz'],
      ['GET', '/api/v1/reset'],
      ['DELETE', `/api/v1/performances/${PID}/meter`],
      ['PUT', `/api/v1/performances/${PID}/joins`],
      ['GET', `/api/v1/performances/${PID}/joins`],
      ['GET', `/api/v1/performances/${PID}/meter/extra`],
    ] as const) {
      const res = await h.app.request(path, { method });
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(parseApiErrorResponse(await json(res))).toEqual({ error: 'not_found' });
    }
  });

  it('不正な入力を、全部まとめて送っても、5xx が 0 件', async () => {
    const h = makeHarness();
    const statuses: number[] = [];
    for (const body of ['', 'null', '[]', '{}', '\u0000', '{"deviceId":', '😀'.repeat(300)]) {
      statuses.push((await h.join(PID, okId, { body })).status);
    }
    expect(statuses.filter((status) => status >= 500)).toEqual([]);
  });
});

describe('I-39: 発表者の reset（合言葉）', () => {
  it('(a)(b) 合言葉なし・違う値は 401（毎回同じ本文）。1 秒待ってから返す。数は動かない', async () => {
    const h = makeHarness();
    await h.join(PID);
    const none = await h.reset();
    const wrong = await h.reset(randomPassphrase());
    expect([none.status, wrong.status]).toEqual([401, 401]);
    const [a, b] = [await none.text(), await wrong.text()];
    expect(a).toBe(b);
    expect(parseApiErrorResponse(JSON.parse(a) as unknown)).toEqual({ error: 'unauthorized' });
    expect(h.sleeps).toEqual([1000, 1000]);
    expect(h.store.get(PID).joined).toBe(1);
  });

  it('実時間でも、間違いには 1 秒以上待ってから返す（待ちを差し替えない既定の動き）', async () => {
    const passphrase = randomPassphrase();
    const app = createApp({
      store: new MeterStore(),
      limiter: new SlidingWindowLimiter({ limit: 20, windowMs: 60_000, now: () => Date.now() }),
      config: { corsOrigins: [], presenterPassphrase: passphrase },
      logger: createJsonLogger(() => undefined),
    });
    const started = performance.now();
    const res = await app.request('/api/v1/reset', {
      method: 'POST',
      headers: { 'x-presenter-key': randomPassphrase() },
    });
    expect(res.status).toBe(401);
    expect(performance.now() - started).toBeGreaterThanOrEqual(990);
  });

  it('(c) 正しい合言葉は 200 と resetAt。全公演が 0・端末の番号の集合が空になり、同じ端末が再び counted: true', async () => {
    const h = makeHarness();
    const id = randomDeviceId();
    await h.join(PID, id);
    await h.join('krs48:FUK-012');
    const res = await h.reset(h.passphrase);
    expect(res.status).toBe(200);
    expect(parseResetResponse(await json(res))?.resetAt).toBe('2026-11-20T00:00:00.000Z');
    expect(h.store.totalJoined()).toBe(0);
    expect(h.store.snapshot().performances).toEqual({});
    expect(parseJoinResponse(await json(await h.join(PID, id)))).toMatchObject({
      counted: true,
      joined: 1,
    });
    expect(h.sleeps).toEqual([]); // 正しいときは待たない
  });

  it('続けて 2 回 reset すると、resetAt が変わる（端末が検知できる）', async () => {
    const h = makeHarness();
    const first = parseResetResponse(await json(await h.reset(h.passphrase)));
    const second = parseResetResponse(await json(await h.reset(h.passphrase)));
    expect(second?.resetAt).not.toBe(first?.resetAt);
  });

  it('(d) 合言葉が未設定・12 文字未満のときは 503 not_configured（reset を無効にする。待たない）', async () => {
    for (const passphrase of [undefined, randomPassphrase(11)]) {
      const h = makeHarness({ passphrase });
      await h.join(PID);
      const res = await h.reset(randomPassphrase());
      expect(res.status).toBe(503);
      expect(parseApiErrorResponse(await json(res))).toEqual({ error: 'not_configured' });
      expect(h.store.get(PID).joined).toBe(1);
      expect(h.sleeps).toEqual([]);
    }
  });

  it('合言葉は、ヘッダーだけで受ける。URL の問い合わせ・本文では受けない', async () => {
    const h = makeHarness();
    const viaQuery = await h.app.request(`/api/v1/reset?key=${h.passphrase ?? ''}`, {
      method: 'POST',
    });
    const viaBody = await h.app.request('/api/v1/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: h.passphrase }),
    });
    expect([viaQuery.status, viaBody.status]).toEqual([401, 401]);
  });
});

describe('I-40 / I-41: 連打の上限は端末の番号ごと。同じ接続元（同じ Wi-Fi）の 100 台は弾かない', () => {
  const sameWifi = { 'x-forwarded-for': '203.0.113.7' };

  it('I-40 (a): 同じ接続元から、別々の端末の番号 100 台が、1 分に 6 回ずつ（最初の 1 回 + 再送 5 回）送っても、429 が 0 件', async () => {
    const h = makeHarness();
    const ids = Array.from({ length: 100 }, () => randomDeviceId());
    const statuses: number[] = [];
    for (let round = 0; round < 6; round++) {
      for (const id of ids) {
        statuses.push(
          (await h.join(PID, id, { headers: { 'content-type': 'text/plain', ...sameWifi } }))
            .status,
        );
      }
    }
    expect(statuses).toHaveLength(600);
    expect(statuses.filter((status) => status === 429)).toEqual([]);
    expect(h.store.get(PID).joined).toBe(100); // 端末の番号の数だけ増える
  });

  it('I-40 (b): 同じ接続元の GET が 1 分に 10,000 回あっても、429 が 0 件', async () => {
    const h = makeHarness();
    let blocked = 0;
    for (let i = 0; i < 10_000; i++) {
      if ((await h.get(PID, { headers: sameWifi })).status === 429) blocked++;
    }
    expect(blocked).toBe(0);
  });

  it('I-41: 同じ端末の番号が 1 分に 21 回目を送ると 429（Retry-After つき）。別の端末の番号は 200 のまま', async () => {
    const h = makeHarness();
    const id = randomDeviceId();
    for (let i = 0; i < 20; i++) {
      expect((await h.join(PID, id)).status).toBe(200);
    }
    const blocked = await h.join(PID, id);
    expect(blocked.status).toBe(429);
    expect(parseApiErrorResponse(await json(blocked))).toEqual({ error: 'rate_limited' });
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect((await h.join(PID, randomDeviceId())).status).toBe(200);
    // 1 分たてば、また受ける
    h.advance(60_000);
    expect((await h.join(PID, id)).status).toBe(200);
  });
});

describe('I-42: 上限（公演 500・全体 1,500）。409 cap_reached', () => {
  it('公演の 501 件目は 409（joined 500 を添える）。数は増えない。すでに数えた端末の再送は 200', async () => {
    const h = makeHarness();
    const first = randomDeviceId();
    await h.join(PID, first);
    for (let i = 1; i < PER_PERFORMANCE_LIMIT; i++) await h.join(PID, randomDeviceId());
    expect(h.store.get(PID).joined).toBe(500);
    const over = await h.join(PID, randomDeviceId());
    expect(over.status).toBe(409);
    expect(parseApiErrorResponse(await json(over))).toEqual({ error: 'cap_reached', joined: 500 });
    expect(h.store.get(PID).joined).toBe(500);
    expect(parseJoinResponse(await json(await h.join(PID, first)))).toMatchObject({
      counted: false,
      joined: 500,
    });
  });

  it('全体の 1,501 件目は、別の公演でも 409', async () => {
    const h = makeHarness();
    for (const pid of ['tech0:cbox', 'krs48:FUK-012', 'riji:cbox']) {
      for (let i = 0; i < PER_PERFORMANCE_LIMIT; i++) await h.join(pid, randomDeviceId());
    }
    const over = await h.join('terao:KGS-001');
    expect(over.status).toBe(409);
    expect(parseApiErrorResponse(await json(over))).toEqual({ error: 'cap_reached', joined: 0 });
  });
});

describe('I-43: CORS（完全一致。画面の origin だけ。D-16）', () => {
  const allowed = 'https://app.example.test';

  it('許した origin からの GET・POST には Access-Control-Allow-Origin を付ける（Vary: Origin も）。資格情報は許さない', async () => {
    const h = makeHarness({ corsOrigins: [allowed] });
    for (const res of [
      await h.get(PID, { headers: { origin: allowed } }),
      await h.join(PID, randomDeviceId(), {
        headers: { origin: allowed, 'content-type': 'text/plain' },
      }),
    ]) {
      expect(res.headers.get('access-control-allow-origin')).toBe(allowed);
      expect(res.headers.get('vary')).toContain('Origin');
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    }
  });

  it.each([
    ['別の origin', 'https://evil.example.test'],
    ['末尾が違う', 'https://app.example.test.evil.test'],
    ['http', 'http://app.example.test'],
    ['ポート違い', 'https://app.example.test:8443'],
    ['null', 'null'],
  ])('許していない origin（%s）には、CORS のヘッダーを付けない', async (_label, origin) => {
    const h = makeHarness({ corsOrigins: [allowed] });
    const res = await h.get(PID, { headers: { origin } });
    expect(res.status).toBe(200); // 応答そのものは返す（ブラウザの外の呼び出しは CORS の対象外）
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('Origin が無い要求（curl・k6 など）には、CORS のヘッダーを付けない', async () => {
    const h = makeHarness({ corsOrigins: [allowed] });
    expect((await h.get(PID)).headers.get('access-control-allow-origin')).toBeNull();
  });

  it('プリフライト（OPTIONS。reset の X-Presenter-Key を付ける要求）: 許した origin には 204 と、許す方法・ヘッダー・Max-Age 600', async () => {
    const h = makeHarness({ corsOrigins: [allowed] });
    const res = await h.app.request('/api/v1/reset', {
      method: 'OPTIONS',
      headers: {
        origin: allowed,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'x-presenter-key',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(allowed);
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
    expect(res.headers.get('access-control-allow-headers')).toBe('Content-Type, X-Presenter-Key');
    expect(res.headers.get('access-control-max-age')).toBe('600');
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('プリフライト: 許していない origin には、CORS のヘッダーを付けない（ブラウザが止める）', async () => {
    const h = makeHarness({ corsOrigins: [allowed] });
    const res = await h.app.request('/api/v1/reset', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example.test', 'access-control-request-method': 'POST' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-methods')).toBeNull();
  });

  it('接続元を 1 つも設定していなければ、どの origin にも CORS を許さない', async () => {
    const h = makeHarness({ corsOrigins: [] });
    const res = await h.get(PID, { headers: { origin: allowed } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('I-44: 応答は許可リストの項目だけ。全応答に Server-Timing。個人の情報・秘密をログに出さない', () => {
  it('応答の項目が、決まった項目だけ（個別の端末のデータを返す口が無い。設計 D-31）', async () => {
    const h = makeHarness();
    const keys = async (res: Response | Promise<Response>) =>
      Object.keys((await json(await res)) as object).sort();
    expect(await keys(h.app.request('/healthz'))).toEqual(['coreVersion', 'ok']);
    expect(await keys(h.get(PID))).toEqual(['joined', 'performanceId', 'resetAt']);
    expect(await keys(h.join(PID))).toEqual(['counted', 'joined', 'performanceId', 'resetAt']);
    expect(await keys(h.reset(h.passphrase))).toEqual(['resetAt']);
    expect(await keys(h.reset())).toEqual(['error']);
  });

  it('全応答（成功・エラー・OPTIONS）に Server-Timing: app;dur=<ミリ秒>・Cache-Control: no-store・nosniff が付き、cookie は使わない', async () => {
    const h = makeHarness();
    const id = randomDeviceId();
    for (let i = 0; i < 20; i++) await h.join(PID, id);
    const responses = [
      await h.app.request('/healthz'),
      await h.get(PID),
      await h.get('tech0:nope'),
      await h.join(PID, randomDeviceId()),
      await h.join(PID, id), // 429
      await h.join(PID, randomDeviceId(), { headers: { 'content-type': 'text/html' } }), // 415
      await h.join(PID, randomDeviceId(), { body: 'x'.repeat(2000) }), // 413
      await h.join(PID, randomDeviceId(), { body: 'not json' }), // 400
      await h.reset(), // 401
      await h.reset(h.passphrase),
      await h.app.request('/nowhere'), // 404
      await h.app.request('/api/v1/reset', {
        method: 'OPTIONS',
        headers: { origin: 'https://app.example.test' },
      }),
    ];
    for (const res of responses) {
      expect(res.headers.get('server-timing')).toMatch(/^app;dur=\d+(\.\d+)?$/);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('set-cookie')).toBeNull();
    }
    expect(responses.map((res) => res.status)).toEqual([
      200, 200, 404, 200, 429, 415, 413, 400, 401, 200, 404, 204,
    ]);
    // JSON で返す（本文のある応答）
    for (const res of responses.filter((r) => r.status !== 204)) {
      expect(res.headers.get('content-type')).toContain('application/json');
    }
  });

  it('想定外の失敗（内部の例外）は 500 internal_error。理由・例外の文言は返さない', async () => {
    const h = makeHarness({
      app: {
        store: {
          get: () => {
            throw new Error('秘密の理由 /home/data/meter.json');
          },
        } as unknown as MeterStore,
      },
    });
    const res = await h.get(PID);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'internal_error' });
    expect(text).not.toContain('秘密の理由');
    expect(res.headers.get('server-timing')).toMatch(/^app;dur=/);
    expect(h.logs.join('\n')).not.toContain('秘密の理由');
  });

  it('ログに、IP・端末の番号（元もハッシュも）・本文・合言葉が出ない', async () => {
    const h = makeHarness();
    const id = randomDeviceId();
    const wrongKey = randomPassphrase();
    const ip = '198.51.100.23';
    await h.join(PID, id, { headers: { 'content-type': 'text/plain', 'x-forwarded-for': ip } });
    await h.join(PID, id, { body: JSON.stringify({ deviceId: id, secret: 'hidden-body-marker' }) });
    await h.reset(wrongKey, { headers: { 'x-presenter-key': wrongKey, 'x-forwarded-for': ip } });
    await h.reset(h.passphrase);
    const text = h.logs.join('\n');
    expect(h.logs.length).toBeGreaterThan(0); // 申し込みと reset は記録する
    for (const bad of [
      id,
      ip,
      wrongKey,
      'hidden-body-marker',
      h.store.snapshot().performances[PID]?.ids[0] ?? '#',
    ]) {
      expect(text).not.toContain(bad);
    }
    if (h.passphrase !== undefined) expect(text).not.toContain(h.passphrase);
    expect(text).toContain('"event":"join"');
    expect(text).toContain('"event":"reset"');
  });
});
