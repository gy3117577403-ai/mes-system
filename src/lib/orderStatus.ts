/**
 * 判斷工單是否處於「已完工」狀態。
 * 業務意圖：兼容舊版小寫 `completed` 與管線大寫 `COMPLETED`，避免看板與統計漏網。
 */
export function isOrderCompletedStatus(taskStatus: string): boolean {
  return taskStatus === 'completed' || taskStatus === 'COMPLETED';
}
