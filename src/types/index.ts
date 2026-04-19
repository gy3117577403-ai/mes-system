export type AlarmKind = 'Material' | 'Maintenance' | 'QC';

export type TaskStatusMES =
  | 'normal'
  | 'anomaly'
  | 'completed'
  | 'PendingQC'
  | 'Rework'
  /** 柔性排產管線狀態（與 Prisma 字串並存，舊資料仍可能為 normal 等） */
  | 'PENDING'
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'PAUSED'
  | 'COMPLETED';

export interface Order {
  id: string;
  client: string;
  model: string;
  qty: number;
  totalHours: number;
  sales: string;
  deliveryDate: string;
  drawing: string;
  materials: string;
  assignedDay: string;
  /** MES 擴展：含 PendingQC（待質檢）、Rework（返工）；並含 PENDING／SCHEDULED／IN_PROGRESS／PAUSED／COMPLETED 管線語義 */
  taskStatus: string;
  cutStatus: string;
  /** 周轉箱編號（字串，如 "05"） */
  boxNumber: string | null;
  worker?: string;
  /** 可選：關聯 `MesWorker.id`；與 `worker` 顯示名並存 */
  workerId?: string | null;
  createdAt: number;
  isImportError?: boolean;
  errorReason?: string;
  /** 電子 SOP / 圖紙 URL（無紙化預留） */
  drawingUrl: string;
  /** 安燈：null 為無警報 */
  activeAlarm: AlarmKind | null;
  /** 計件總數（可與 qty 一致） */
  totalQty: number;
  /** 已報工完成數 */
  reportedQty: number;
  /** PMC 急單綠色通道：圖紙已發即可進就緒池，且 AI 不自動排產 */
  isUrgent: boolean;
  /** 圖紙／工藝綠燈 */
  isDrawingReady: boolean;
  /** 物料齊套綠燈 */
  isMaterialReady: boolean;
  /** 紅燈阻斷原因（與 taskStatus=PAUSED 搭配） */
  exceptionRemark?: string;
  /** AI 或計劃員給出的具體排產日／星期描述（Asia/Shanghai 語意） */
  plannedDate?: string;
  /** 主看板熱數據：false 顯示於看板；true 已歸檔僅審計穿透 */
  isArchived?: boolean;
}

export type ViewMode = 'manager' | 'workshop';

export type MainAppView = 'kanban' | 'dashboard';

/** 審計 / 操作類型 */
export type AuditActionType =
  | 'login'
  | 'upload_sop'
  | 'material_change'
  | 'schedule_drag'
  | 'ai_schedule'
  | 'alarm'
  | 'alarm_resolve'
  | 'progress'
  | 'qc'
  | 'legacy'
  | string;

/** 車間操作日誌（審計可追溯） */
export interface ActivityLogEntry {
  id: string;
  ts: number;
  /** 已格式化的完整一行（兼容舊資料） */
  text: string;
  /** 操作人 */
  operator?: string;
  /** 角色 */
  role?: string;
  /** 操作類型 */
  actionType?: AuditActionType;
}

/** 安燈通知中心條目 */
export interface AndonNotification {
  id: string;
  ts: number;
  orderId: string;
  model: string;
  kind: AlarmKind;
  message: string;
  resolved: boolean;
}

export const DAYS = [
  { key: 'Monday', label: '周一 排产', color: 'bg-blue-500', border: 'border-slate-700', bg: 'bg-slate-800/30' },
  { key: 'Tuesday', label: '周二 排产', color: 'bg-indigo-500', border: 'border-slate-700', bg: 'bg-slate-800/30' },
  { key: 'Wednesday', label: '周三 排产', color: 'bg-violet-500', border: 'border-slate-700', bg: 'bg-slate-800/30' },
  { key: 'Thursday', label: '周四 排产', color: 'bg-fuchsia-500', border: 'border-slate-700', bg: 'bg-slate-800/30' },
  { key: 'Friday', label: '周五 排产', color: 'bg-rose-500', border: 'border-slate-700', bg: 'bg-slate-800/30' },
  { key: 'Saturday', label: '周六 (溢出补充)', color: 'bg-orange-500', border: 'border-slate-700', bg: 'bg-slate-800/30' }
];
