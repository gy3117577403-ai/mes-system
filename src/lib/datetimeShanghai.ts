import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { parse } from 'date-fns';

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
