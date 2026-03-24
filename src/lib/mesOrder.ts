import { Order } from '@/types';

export type AlarmKind = 'Material' | 'Maintenance' | 'QC';

/** 將舊資料與部分欄位補齊為完整 MES Order */
export function normalizeOrder(raw: Partial<Order> & { id: string }): Order {
  const qty = Number(raw.qty) || 1;
  const totalQty = raw.totalQty != null ? Number(raw.totalQty) : qty;
  const reportedQty = raw.reportedQty != null ? Number(raw.reportedQty) : 0;

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
    boxNumber: raw.boxNumber ?? null,
    worker: raw.worker,
    createdAt: raw.createdAt ?? Date.now(),
    isImportError: raw.isImportError,
    errorReason: raw.errorReason,
    drawingUrl: raw.drawingUrl ?? '',
    activeAlarm: raw.activeAlarm ?? null,
    totalQty: Math.max(1, totalQty),
    reportedQty: Math.max(0, reportedQty),
    isUrgent: raw.isUrgent === true,
  };
}

export function normalizeOrders(list: unknown[]): Order[] {
  if (!Array.isArray(list)) return [];
  return list.map((o) => normalizeOrder(o as Partial<Order> & { id: string }));
}
