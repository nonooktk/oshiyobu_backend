// 収支シミュレーター（mock/simulator.html。DATA.generated = 2026-11-12）から写した値。
// 契約テスト（設計 D-21・テスト設計 I-31〜I-33）の、core 側の期待値。
// 本物の simulator.html との照合は、frontend の public/simulator.html に対して行う（B・V）。
// この写しは、simulator.html の DATA.venues（104 件）のうち、12 会場に使う 11 件と、COST の 5 区分だけ。

export const SIMULATOR_COST = {
  30: { venue: 30000, prod: 30000, fee: 100000, travel: 80000, profit: 40000, price: 7000 },
  100: { venue: 60000, prod: 100000, fee: 250000, travel: 120000, profit: 120000, price: 7000 },
  300: { venue: 200000, prod: 300000, fee: 500000, travel: 200000, profit: 300000, price: 6000 },
  500: { venue: 300000, prod: 600000, fee: 800000, travel: 250000, profit: 500000, price: 7000 },
  1000: {
    venue: 600000,
    prod: 1200000,
    fee: 1500000,
    travel: 350000,
    profit: 1000000,
    price: 7500,
  },
} as const;

/** simulator の会場 ID → （収容人数・区分）。 */
export const SIMULATOR_VENUES = {
  'FUK-012': { capacity: 300, tier: 300 },
  'FUK-016': { capacity: 180, tier: 100 },
  'FUK-018': { capacity: 120, tier: 100 },
  'FUK-019': { capacity: 144, tier: 100 },
  'FUK-020': { capacity: 50, tier: 30 },
  'KGS-001': { capacity: 60, tier: 30 },
  'KMM-002': { capacity: 100, tier: 100 },
  'MYZ-004': { capacity: 300, tier: 300 },
  'NGS-001': { capacity: 40, tier: 30 },
  'OIT-004': { capacity: 100, tier: 100 },
  'SAG-003': { capacity: 60, tier: 30 },
} as const;
