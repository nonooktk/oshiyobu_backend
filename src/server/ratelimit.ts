/** 端末の番号ごとの上限の判定。通すなら allowed: true、止めるなら待ち時間（秒。1 以上）を返す。 */
export type HitResult =
  { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSec: number };

export interface LimiterOptions {
  /** 窓の中で通す回数。 */
  readonly limit: number;
  /** 窓の長さ（ミリ秒）。 */
  readonly windowMs: number;
  /** 現在の時刻（ミリ秒）。テストで差し替える。 */
  readonly now: () => number;
}

/**
 * 端末の番号ごとの上限（スライディングウィンドウ。設計 D-14・D-17）。
 * 上限は端末の番号ごとだけで、接続元（IP）は受け取らない・数えない（同じ Wi-Fi の聞き手を弾かないため。N-24）。
 * 止めた要求は記録に数えない（連打し続けても、窓から古い記録が出れば、また通る）。
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastSweepAt: number;

  constructor(private readonly options: LimiterOptions) {
    this.lastSweepAt = options.now();
  }

  hit(key: string): HitResult {
    const now = this.options.now();
    this.sweep(now);
    const windowStart = now - this.options.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((at) => at > windowStart);
    if (recent.length >= this.options.limit) {
      this.hits.set(key, recent);
      const oldest = recent[0] ?? now;
      const waitMs = oldest + this.options.windowMs - now;
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(waitMs / 1000)) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true };
  }

  /** いま記録を持っている端末の番号の数（メモリの見張り用）。 */
  size(): number {
    return this.hits.size;
  }

  /** 窓の外の記録だけになった端末の番号を、窓の長さに 1 回の頻度で片づける。 */
  private sweep(now: number): void {
    if (now - this.lastSweepAt < this.options.windowMs) {
      return;
    }
    this.lastSweepAt = now;
    const windowStart = now - this.options.windowMs;
    for (const [key, times] of this.hits) {
      const last = times[times.length - 1];
      if (last === undefined || last <= windowStart) {
        this.hits.delete(key);
      }
    }
  }
}
