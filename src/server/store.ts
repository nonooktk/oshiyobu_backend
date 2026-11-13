import { isPerformanceId } from '../core';
import type { PerformanceId } from '../core';

/** 公演ごとの上限・全体の上限（設計 D-14）。聞き手の最大（100）の 5 倍・15 倍。 */
export const PER_PERFORMANCE_LIMIT = 500;
export const TOTAL_LIMIT = 1500;

/** 保存ファイルの中身（設計 D-12）。端末の番号は、ハッシュ（先頭 16 桁）だけを持つ。 */
export interface StoreSnapshot {
  readonly v: 1;
  readonly resetAt: string | null;
  readonly performances: Readonly<
    Record<string, { readonly joined: number; readonly ids: readonly string[] }>
  >;
}

export type JoinResult =
  | { readonly status: 'ok'; readonly counted: boolean; readonly joined: number }
  | { readonly status: 'cap_reached'; readonly joined: number };

export interface StoreOptions {
  /** 保存ファイルから読んだ中身（検査済みのもの）。無ければ空で始める。 */
  readonly initial?: StoreSnapshot;
  /** 現在の時刻（ミリ秒）。reset の時刻に使う。 */
  readonly now?: () => number;
  /** 状態が変わったときに呼ぶ（保存の予約）。 */
  readonly onChange?: () => void;
}

const HASH = /^[0-9a-f]{16}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 保存ファイルの中身を検査する。形が違えば null（空の状態で始める）。
 * 一覧に無い公演 ID・形の違う端末のハッシュ・重複は捨てる。joined は ids の件数から作り直す。
 */
export function parseSnapshot(value: unknown): StoreSnapshot | null {
  if (!isRecord(value) || value['v'] !== 1) {
    return null;
  }
  const resetAt = value['resetAt'];
  const performances = value['performances'];
  if (
    resetAt !== null &&
    (typeof resetAt !== 'string' || !ISO_UTC.test(resetAt) || Number.isNaN(Date.parse(resetAt)))
  ) {
    return null;
  }
  if (!isRecord(performances)) {
    return null;
  }
  const result: Record<string, { joined: number; ids: string[] }> = {};
  for (const [pid, entry] of Object.entries(performances)) {
    if (!isPerformanceId(pid) || !isRecord(entry) || !Array.isArray(entry['ids'])) {
      continue;
    }
    const ids = [
      ...new Set(
        (entry['ids'] as unknown[]).filter(
          (id): id is string => typeof id === 'string' && HASH.test(id),
        ),
      ),
    ];
    if (ids.length > 0) {
      result[pid] = { joined: ids.length, ids };
    }
  }
  return { v: 1, resetAt, performances: result };
}

/**
 * 共有メーターの状態（メモリが正本。設計 D-03・D-11・D-12）。公演ごとの「数えた端末の番号のハッシュ」の集合だけを持ち、
 * 件数 joined はその大きさ（常に ids の件数に等しい）。インスタンスは 1 つの前提。
 */
export class MeterStore {
  private readonly performances = new Map<PerformanceId, Set<string>>();
  private resetAt: string | null;
  private readonly now: () => number;
  private readonly onChange: () => void;

  constructor(options: StoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.onChange = options.onChange ?? (() => undefined);
    this.resetAt = options.initial?.resetAt ?? null;
    for (const [pid, entry] of Object.entries(options.initial?.performances ?? {})) {
      if (isPerformanceId(pid)) {
        this.performances.set(pid, new Set(entry.ids));
      }
    }
  }

  /** 公演の申し込みの件数と、最後に reset した時刻。 */
  get(pid: PerformanceId): { joined: number; resetAt: string | null } {
    return { joined: this.performances.get(pid)?.size ?? 0, resetAt: this.resetAt };
  }

  /** 全公演の件数の合計。 */
  totalJoined(): number {
    let total = 0;
    for (const ids of this.performances.values()) {
      total += ids.size;
    }
    return total;
  }

  /**
   * この端末を、新しく数えられるか（すでに数えた端末の再送、または、上限に届いていない）。状態は変えない。
   * 上限に届いたあとの連打で、端末ごとの上限の記録（メモリ）を増やさないために、数える前に確かめる。
   */
  canCount(pid: PerformanceId, deviceHash: string): boolean {
    const ids = this.performances.get(pid);
    return (
      ids?.has(deviceHash) === true ||
      ((ids?.size ?? 0) < PER_PERFORMANCE_LIMIT && this.totalJoined() < TOTAL_LIMIT)
    );
  }

  /**
   * 申し込みを 1 件数える。同じ公演で同じ端末（ハッシュ）は 1 回だけ（counted: false で件数は増えない）。
   * すでに数えた端末の再送は、上限に届いていても受ける（冪等）。新しい端末は、上限に届いていたら cap_reached。
   */
  join(pid: PerformanceId, deviceHash: string): JoinResult {
    const ids = this.performances.get(pid);
    if (ids?.has(deviceHash) === true) {
      return { status: 'ok', counted: false, joined: ids.size };
    }
    if (!this.canCount(pid, deviceHash)) {
      return { status: 'cap_reached', joined: ids?.size ?? 0 };
    }
    const target = ids ?? new Set<string>();
    target.add(deviceHash);
    this.performances.set(pid, target);
    this.onChange();
    return { status: 'ok', counted: true, joined: target.size };
  }

  /**
   * 全公演の件数と、数えた端末の番号を空にして、reset の時刻を返す。
   * 同じミリ秒に続けて reset しても、前より後の時刻にする（端末が resetAt の変化で検知するため）。
   */
  reset(): string {
    const previous = this.resetAt === null ? Number.NEGATIVE_INFINITY : Date.parse(this.resetAt);
    const at = Math.max(this.now(), previous + 1);
    this.resetAt = new Date(at).toISOString();
    this.performances.clear();
    this.onChange();
    return this.resetAt;
  }

  /** 保存ファイルに書く中身。 */
  snapshot(): StoreSnapshot {
    const performances: Record<string, { joined: number; ids: string[] }> = {};
    for (const [pid, ids] of this.performances) {
      performances[pid] = { joined: ids.size, ids: [...ids] };
    }
    return { v: 1, resetAt: this.resetAt, performances };
  }
}
