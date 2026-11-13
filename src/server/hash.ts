import { createHash } from 'node:crypto';

/**
 * 端末の番号を、保存・上限の数え方に使うときのハッシュにする（SHA-256 の先頭 16 桁の 16 進数。設計 D-12・D-31）。
 * 元の番号は、保存せず、ログにも出さない。
 */
export function hashDeviceId(deviceId: string): string {
  return createHash('sha256').update(deviceId).digest('hex').slice(0, 16);
}
