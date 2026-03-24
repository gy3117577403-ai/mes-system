export type AlarmKind = 'Material' | 'Maintenance' | 'QC';

export type TaskStatusMES =
  | 'normal'
  | 'anomaly'
  | 'completed'
  | 'PendingQC'
  | 'Rework';

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
  /** MES 擴展：含 PendingQC（待質檢）、Rework（返工） */
  taskStatus: string;
  cutStatus: string;
  boxNumber: number | null;
  worker?: string;
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
