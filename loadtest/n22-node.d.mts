import type { LoadResult, Plan } from './lib.js';

export interface RunOptions {
  base: string;
  pid?: string;
  clients?: number;
  timeoutMs?: number;
  joins?: number;
  joinStartSec?: number;
  joinWindowSec?: number;
  durationSec?: number;
  onProgress?: (message: string) => void;
}
export function runLoad(options: RunOptions): Promise<{
  plan: Plan;
  result: LoadResult;
  evaluation: { pass: boolean; failures: string[]; line: string };
}>;
