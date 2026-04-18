import { Order } from '@/types';
import { nowEpochMsForMesStorage } from '@/lib/datetimeShanghai';

export type AlarmKind = 'Material' | 'Maintenance' | 'QC';

/** 將舊資料與部分欄位補齊為完整 MES Order */
export function normalizeOrder(raw: Partial<Order> & { id: string }): Order {
  const qty = Number(raw.qty) || 1;
  const totalQty = raw.totalQty != null ? Number(raw.totalQty) : qty;
  const reportedQty = raw.reportedQty != null ? Number(raw.reportedQty) : 0;

  const boxRaw = raw.boxNumber;
  const boxNumber =
    boxRaw === null || boxRaw === undefined || boxRaw === ''
      ? null
      : typeof boxRaw === 'number'
        ? String(Math.trunc(boxRaw)).padStart(2, '0')
        : String(boxRaw).trim() || null;

  return {
    id: raw.id,
    client: raw.client ?? '',
    model: raw.model ?? '',
    qty,
    totalHours: Number(raw.totalHours) || 0,
    sales: raw.sales ?? '',
    deliveryDate: raw.deliveryDate ?? '',
    drawing: raw.drawing ?? '未发图',
    materials: raw.materials ?? '未配料',
    assignedDay: raw.assignedDay ?? 'Unscheduled',
    taskStatus: raw.taskStatus ?? 'normal',
    cutStatus: raw.cutStatus ?? 'pending',
    boxNumber,
    worker: raw.worker,
    workerId:
      raw.workerId === undefined
        ? undefined
        : raw.workerId === null || raw.workerId === ''
          ? null
          : String(raw.workerId),
    createdAt: raw.createdAt ?? nowEpochMsForMesStorage(),
    isImportError: raw.isImportError,
    errorReason: raw.errorReason,
    drawingUrl: raw.drawingUrl ?? '',
    activeAlarm: raw.activeAlarm ?? null,
    totalQty: Math.max(1, totalQty),
    reportedQty: Math.max(0, reportedQty),
    isUrgent: raw.isUrgent === true,
    isDrawingReady: raw.isDrawingReady === true,
    isMaterialReady: raw.isMaterialReady === true,
    exceptionRemark: raw.exceptionRemark ?? undefined,
    plannedDate: raw.plannedDate ?? undefined,
  };
}

export function normalizeOrders(list: unknown[]): Order[] {
  if (!Array.isArray(list)) return [];
  return list.map((o) => normalizeOrder(o as Partial<Order> & { id: string }));
}
