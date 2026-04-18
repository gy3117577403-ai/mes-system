/**
 * 周轉箱編號在 Prisma 中為可選字串（如 "05"），選盤為 1–30 的整數。
 * 業務意圖：佔用判斷時忽略純數字字串的前導零，避免 "05" 與 5 重複鎖定失敗。
 */
export function canonicalBoxKey(v: string | number | null | undefined): string | null {
  if (v == null || v === '') return null;
  const t = String(v).trim();
  if (/^\d+$/.test(t)) return String(Number.parseInt(t, 10));
  return t;
}

/**
 * 將選盤整數轉為兩位字串寫入資料庫，與現場箱貼編號習慣一致。
 */
export function boxGridValueToStorage(gridNum: number): string {
  return String(Math.trunc(gridNum)).padStart(2, '0');
}

/** 判斷選盤上的箱號是否已被其他未完成工單占用 */
export function isGridBoxOccupied(occupied: (string | null | undefined)[], gridNum: number): boolean {
  const want = canonicalBoxKey(gridNum);
  if (want == null) return false;
  return occupied.some((b) => canonicalBoxKey(b) === want);
}
