import type { Order as PrismaOrder } from '@prisma/client';
import type { Order, AlarmKind } from '@/types';
import { normalizeOrder } from '@/lib/mesOrder';

/** Prisma → 前端 Order（經 normalize） */
export function prismaOrderToFrontend(row: PrismaOrder): Order {
  return normalizeOrder({
    id: row.id,
    client: row.client,
    model: row.model,
    qty: row.qty,
    totalHours: row.totalHours,
    sales: row.sales,
    deliveryDate: row.deliveryDate,
    drawing: row.drawing,
    materials: row.materials,
    assignedDay: row.assignedDay,
    taskStatus: row.taskStatus,
    cutStatus: row.cutStatus,
    boxNumber: row.boxNumber,
    worker: row.worker ?? undefined,
    workerId: row.workerId ?? undefined,
    createdAt: row.createdAt,
    isImportError: row.isImportError,
    errorReason: row.errorReason ?? undefined,
    drawingUrl: row.drawingUrl ?? '',
    activeAlarm: (row.activeAlarm as AlarmKind | null) ?? null,
    totalQty: row.totalQty,
    reportedQty: row.reportedQty,
    isUrgent: row.isUrgent,
    isDrawingReady: row.isDrawingReady,
    isMaterialReady: row.isMaterialReady,
    exceptionRemark: row.exceptionRemark ?? undefined,
    plannedDate: row.plannedDate ?? undefined,
  });
}

/** 前端 Order → Prisma create 資料 */
export function frontendOrderToPrismaCreate(o: Order) {
  return {
    id: o.id,
    client: o.client,
    model: o.model,
    qty: o.qty,
    totalHours: o.totalHours,
    sales: o.sales,
    deliveryDate: o.deliveryDate,
    drawing: o.drawing,
    materials: o.materials,
    assignedDay: o.assignedDay,
    taskStatus: o.taskStatus,
    cutStatus: o.cutStatus,
    boxNumber: o.boxNumber,
    worker: o.worker ?? null,
    workerId: o.workerId ?? null,
    createdAt: o.createdAt,
    isImportError: o.isImportError ?? false,
    errorReason: o.errorReason ?? null,
    drawingUrl: o.drawingUrl || null,
    activeAlarm: o.activeAlarm ?? null,
    totalQty: o.totalQty,
    reportedQty: o.reportedQty,
    isUrgent: o.isUrgent,
    isDrawingReady: o.isDrawingReady,
    isMaterialReady: o.isMaterialReady,
    exceptionRemark: o.exceptionRemark ?? null,
    plannedDate: o.plannedDate ?? null,
    deletedAt: null as number | null,
  };
}
