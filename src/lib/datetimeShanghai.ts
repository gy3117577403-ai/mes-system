import { endOfWeek, parse, startOfWeek, subWeeks } from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';

/**
 * MES 全站業務時區（IANA），與 UTC+8 北京時間一致。
 * 所有「人讀」與 AI Prompt 的時間字串均經此常量換算，不依賴宿主 `process.env.TZ`。
 */
export const MES_TIMEZONE = 'Asia/Shanghai' as const;

/**
 * **落庫毫秒時間戳的唯一權威入口**（UTC 絕對瞬時的 JS Number）。
 *
 * 業務意圖：
 * - JavaScript `Date` 內部均為 UTC epoch；此值與在 `Asia/Shanghai` 牆鐘下觀測到的「同一物理時刻」嚴格對應。
 * - 不依賴宿主機時區漂移；展示層一律使用 `formatInTimeZone` / `formatMsToShanghaiLocale`。
 * - Prisma Extension 在 `Order` / `MesActivityLog` / `MesAbnormalClaim` 建立時若未顯式傳入時間欄位，將回退到此函數。
 */
export function nowEpochMsForMesStorage(): number {
  return Date.now();
}

/**
 * 將 UTC 毫秒時間戳格式化為上海本地日時字串（日誌、看板、DeepSeek Prompt）。
 */
export function formatMsToShanghaiLocale(ms: number): string {
  return formatInTimeZone(new Date(ms), MES_TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

/**
 * 取得「當前瞬時」在上海日曆下的 ISO 日部分（`yyyy-MM-dd`），供排產錨點與 AI 上下文。
 */
export function shanghaiDateTodayISO(): string {
  return formatInTimeZone(new Date(), MES_TIMEZONE, 'yyyy-MM-dd');
}

/**
 * 將 **解釋為 Asia/Shanghai 牆鐘** 的 `yyyy-MM-dd HH:mm:ss` 字串轉為 UTC 毫秒戳，用於導入／表單落庫。
 *
 * @param datePart `yyyy-MM-dd`
 * @param timePart `HH:mm:ss`（預設 `00:00:00`）
 */
export function parseShanghaiWallClockToEpochMs(datePart: string, timePart = '00:00:00'): number {
  const d = parse(`${datePart.trim()} ${timePart.trim()}`, 'yyyy-MM-dd HH:mm:ss', new Date(0));
  if (Number.isNaN(d.getTime())) {
    throw new TypeError(`無效的上海本地時間: ${datePart} ${timePart}`);
  }
  return fromZonedTime(d, MES_TIMEZONE).getTime();
}

/** 上海日曆下週一至週日的 short weekday（en-US）→ ISO 週內序 1=Mon … 7=Sun */
const SHANGHAI_DOW_MAP: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

function shanghaiIsoDow1To7(ms: number): number {
  const w = new Intl.DateTimeFormat('en-US', { timeZone: MES_TIMEZONE, weekday: 'short' }).format(
    new Date(ms)
  );
  return SHANGHAI_DOW_MAP[w] ?? 1;
}

/**
 * 以 **Asia/Shanghai** 週一 00:00 至週日 23:59:59.999 的 UTC 毫秒區間（與 `Order.createdAt` Float 對齊）。
 * 用於本週訂單審計等聚合查詢。
 */
export function getShanghaiCurrentWeekRangeEpochMs(now = new Date()): {
  weekStartMs: number;
  weekEndMs: number;
} {
  const ymd = formatInTimeZone(now, MES_TIMEZONE, 'yyyy-MM-dd');
  const todayStartMs = parseShanghaiWallClockToEpochMs(ymd, '00:00:00');
  const dow = shanghaiIsoDow1To7(todayStartMs);
  const weekStartMs = todayStartMs - (dow - 1) * 86_400_000;
  const weekEndMs = weekStartMs + 7 * 86_400_000 - 1;
  return { weekStartMs, weekEndMs };
}

/**
 * 審計強制路徑：以 `date-fns` + `date-fns-tz` 計算 **Asia/Shanghai** 本週一 00:00:00.000
 * 至週日 23:59:59.999 對應的 UTC 毫秒區間（與 `Order.createdAt` Float 對齊）。
 */
export function getShanghaiAuditWeekRangeEpochMs(now = new Date()): {
  weekStartMs: number;
  weekEndMs: number;
} {
  const zonedNow = toZonedTime(now, MES_TIMEZONE);
  const startZoned = startOfWeek(zonedNow, { weekStartsOn: 1 });
  const endZoned = endOfWeek(zonedNow, { weekStartsOn: 1 });
  return {
    weekStartMs: fromZonedTime(startZoned, MES_TIMEZONE).getTime(),
    weekEndMs: fromZonedTime(endZoned, MES_TIMEZONE).getTime(),
  };
}

/**
 * `weekOffset`：0＝含「現在」的上海自然週，1＝上一週，依此類推（最多建議 0～8）。
 */
export function getShanghaiAuditWeekRangeEpochMsForOffset(weekOffset = 0, now = new Date()): {
  weekStartMs: number;
  weekEndMs: number;
} {
  const n = Math.min(8, Math.max(0, Math.floor(Number(weekOffset)) || 0));
  const anchor = n === 0 ? now : subWeeks(now, n);
  return getShanghaiAuditWeekRangeEpochMs(anchor);
}

/**
 * 將庫存 `plannedDate` 解析為可比較的 UTC 毫秒錨點：純數字字串視為毫秒戳；
 * 否則取前綴 `yyyy-MM-dd` 並按上海當日 00:00:00 解釋。
 */
export function plannedDateAnchorEpochMs(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{10,15}$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const isoPrefix = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoPrefix) {
    try {
      return parseShanghaiWallClockToEpochMs(isoPrefix[1], '00:00:00');
    } catch {
      return null;
    }
  }
  return null;
}
