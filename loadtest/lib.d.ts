export const DEFAULT_PID: 'terao:KGS-001';
export const THRESHOLDS: {
  readonly p95Ms: number;
  readonly serverP95Ms: number;
  readonly errorRate: number;
};
export interface Plan {
  clients: number;
  getRatePerSec: number;
  joins: number;
  joinStartSec: number;
  joinWindowSec: number;
  durationSec: number;
}
export function buildPlan(
  clients: number,
  overrides?: Partial<Pick<Plan, 'joins' | 'joinStartSec' | 'joinWindowSec' | 'durationSec'>>,
): Plan;
export function parseServerTiming(header: string | null | undefined): number | null;
export function percentile(values: readonly number[], p: number): number | null;
export interface LoadResult {
  meterMs: readonly number[];
  joinMs: readonly number[];
  serverMs: readonly number[];
  total: number;
  failed: number;
  status429: number;
  dropped: number;
  clients: number;
  expectedJoins: number;
  joinedDelta: number | null;
  countedTrue: number | null;
}
export function evaluate(result: LoadResult): { pass: boolean; failures: string[]; line: string };
export function k6SummaryLine(data: unknown, clients: number): string;
