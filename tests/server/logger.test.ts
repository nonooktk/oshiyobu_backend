import { describe, expect, it } from 'vitest';
import { createJsonLogger } from '../../src/server/logger';

// 設計 D-14・D-31: ログには、固定のイベント名・公演 ID・人数だけを出す。IP・端末の番号・本文・合言葉は出さない。
describe('ログ（1 行 1 件の JSON）', () => {
  const lines: string[] = [];
  const logger = createJsonLogger(
    (line) => lines.push(line),
    () => Date.UTC(2026, 10, 20, 0, 30, 0, 0),
  );

  it('時刻・水準・イベント名・項目を、JSON の 1 行で出す', () => {
    logger.info('join', { performanceId: 'tech0:cbox', joined: 3, counted: true });
    logger.warn('persist_failed', { code: 'EACCES' });
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      {
        t: '2026-11-20T00:30:00.000Z',
        level: 'info',
        event: 'join',
        performanceId: 'tech0:cbox',
        joined: 3,
        counted: true,
      },
      { t: '2026-11-20T00:30:00.000Z', level: 'warn', event: 'persist_failed', code: 'EACCES' },
    ]);
  });

  it('IP・端末の番号・本文・合言葉の名前の項目は、渡されても出さない（出さない決まりの二重の備え）', () => {
    lines.length = 0;
    logger.info('x', {
      ip: '203.0.113.9',
      deviceId: 'a'.repeat(16),
      body: '{"deviceId":"x"}',
      passphrase: 'secret-value',
      key: 'k',
      joined: 1,
    });
    expect(lines).toHaveLength(1);
    const text = lines[0] ?? '';
    for (const bad of ['203.0.113.9', 'aaaaaaaaaaaaaaaa', 'deviceId', 'secret-value']) {
      expect(text).not.toContain(bad);
    }
    expect(JSON.parse(text)).toMatchObject({ event: 'x', joined: 1 });
  });
});
