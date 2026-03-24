import type { Order } from '@/types';

/** 比對兩筆訂單，回傳需寫入資料庫的變更欄位（用於 AI 排產後增量同步） */
export function diffOrder(prev: Order, next: Order): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = Object.keys(next) as (keyof Order)[];
  for (const k of keys) {
    if (prev[k] !== next[k]) {
      out[k as string] = next[k] as unknown;
    }
  }
  return out;
}
