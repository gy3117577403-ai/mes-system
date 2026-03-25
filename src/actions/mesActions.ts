'use server';

import { prisma } from '@/lib/prisma';
import { normalizeOrder } from '@/lib/mesOrder';
import { prismaOrderToFrontend, frontendOrderToPrismaCreate } from '@/lib/mesDbMappers';
import type { Order } from '@/types';
import type { ActivityLogEntry } from '@/types';
import type { AppTheme, LayoutMode } from '@/lib/uiTheme';

const SETTINGS_ID = 'singleton';

async function ensureAppSettings() {
  await prisma.mesAppSettings.upsert({
    where: { id: SETTINGS_ID },
    create: {
      id: SETTINGS_ID,
      dailyCapacity: 980,
      theme: 'dark',
      layoutMode: 'card',
    },
    update: {},
  });
}

async function ensureDefaultWorkers() {
  const count = await prisma.mesWorker.count();
  if (count > 0) return;
  const defaults = ['1号员工', '2号员工'];
  await prisma.$transaction(
    defaults.map((name, i) =>
      prisma.mesWorker.create({
        data: { name, sortOrder: i },
      })
    )
  );
}

export type FetchInitialDataResult = {
  ok: boolean;
  error?: string;
  orders: Order[];
  workers: string[];
  activityLogs: ActivityLogEntry[];
  dailyCapacity: number;
  theme: AppTheme;
  layoutMode: LayoutMode;
};

function isRecordNotFoundP2025(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code?: string }).code === 'P2025'
  );
}

/** 空庫或本地 id 在雲端不存在時，update 會拋 P2025；此預設與 schema 預設一致，供改為新增合併 */
function defaultOrderUncheckedCreate(id: string) {
  return {
    id,
    client: '',
    model: '',
    qty: 1,
    totalHours: 0,
    sales: '',
    deliveryDate: '',
    drawing: '未发图',
    materials: '未配料',
    assignedDay: 'Unscheduled',
    taskStatus: 'normal',
    cutStatus: 'pending',
    boxNumber: null,
    worker: null,
    createdAt: Date.now(),
    isImportError: false,
    errorReason: null,
    drawingUrl: null,
    activeAlarm: null,
    totalQty: 1,
    reportedQty: 0,
    isUrgent: false,
    deletedAt: null,
  };
}

async function orderUpdateOrCreateFromPatch(
  orderId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const data = patch as Parameters<typeof prisma.order.update>[0]['data'];
  try {
    await prisma.order.update({
      where: { id: orderId },
      data,
    });
  } catch (e) {
    if (!isRecordNotFoundP2025(e)) throw e;
    await prisma.order.create({
      data: {
        ...defaultOrderUncheckedCreate(orderId),
        ...patch,
      } as Parameters<typeof prisma.order.create>[0]['data'],
    });
  }
}

/** 一次性載入訂單（未軟刪）、員工名單、日誌、應用設定 */
export async function fetchInitialData(): Promise<FetchInitialDataResult> {
  console.log('>>> [DB DEBUG] fetchInitialData — 開始');

  try {
    console.log('>>> [DB DEBUG] 步驟：ensureAppSettings（讀庫前）');
    await ensureAppSettings();
    console.log('>>> [DB DEBUG] 步驟：ensureAppSettings（讀庫後）');

    console.log('>>> [DB DEBUG] 步驟：ensureDefaultWorkers（讀庫前）');
    await ensureDefaultWorkers();
    console.log('>>> [DB DEBUG] 步驟：ensureDefaultWorkers（讀庫後）');

    console.log('>>> [DB DEBUG] 步驟：Promise.all 查詢（讀庫前）');
    const [rows, workerRows, logRows, settings] = await Promise.all([
      prisma.order.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.mesWorker.findMany({ orderBy: { sortOrder: 'asc' } }),
      prisma.mesActivityLog.findMany({
        orderBy: { ts: 'desc' },
        take: 500,
      }),
      prisma.mesAppSettings.findUnique({ where: { id: SETTINGS_ID } }),
    ]);
    console.log('>>> [DB DEBUG] 步驟：Promise.all 查詢（讀庫後）');

    const rowList = rows ?? [];
    const workerList = workerRows ?? [];
    const logList = logRows ?? [];

    const orders = rowList.map(prismaOrderToFrontend);
    const workers = workerList.map((w: { name: string }) => w.name);
    const activityLogs: ActivityLogEntry[] = logList.map(
      (r: {
        id: string;
        ts: number;
        text: string;
        operator: string | null;
        role: string | null;
        actionType: string | null;
      }) => ({
      id: r.id,
      ts: r.ts,
      text: r.text,
      operator: r.operator ?? undefined,
      role: r.role ?? undefined,
      actionType: (r.actionType as ActivityLogEntry['actionType']) ?? 'legacy',
    }),
  );

    const s = settings;
    if (!s) {
      console.log('>>> [DB DEBUG] settings 為 null，使用預設設定與空／既有列資料');
      return {
        ok: true,
        orders,
        workers: workers.length > 0 ? workers : ['1号员工', '2号员工'],
        activityLogs,
        dailyCapacity: 980,
        theme: 'dark',
        layoutMode: 'card',
      };
    }

    const theme = (s.theme === 'light' ? 'light' : 'dark') as AppTheme;
    const layoutMode = (s.layoutMode === 'compact' ? 'compact' : 'card') as LayoutMode;

    console.log('>>> [DB DEBUG] 步驟：返回結果（成功，前）');
    return {
      ok: true,
      orders,
      workers,
      activityLogs,
      dailyCapacity: s.dailyCapacity > 0 ? s.dailyCapacity : 980,
      theme,
      layoutMode,
    };
  } catch (e) {
    console.error('[fetchInitialData]', e);
    console.log('>>> [DB DEBUG] 步驟：catch 異常 — 返回錯誤結果');
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      orders: [],
      workers: ['1号员工', '2号员工'],
      activityLogs: [],
      dailyCapacity: 980,
      theme: 'dark',
      layoutMode: 'card',
    };
  }
}

export async function createOrderAction(data: Partial<Order> & { id: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const o = normalizeOrder(data);
    await prisma.order.create({
      data: frontendOrderToPrismaCreate(o),
    });
    return { ok: true };
  } catch (e) {
    console.error('[createOrderAction]', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 將前端傳入的欄位轉為 Prisma 可寫入的 patch（僅處理已知欄位） */
function buildOrderPatch(updateData: Record<string, unknown>): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  const setStr = (k: string, v: unknown) => {
    if (v === undefined) return;
    p[k] = v === null ? null : String(v);
  };
  const setInt = (k: string, v: unknown) => {
    if (v === undefined) return;
    p[k] = v === null ? null : Math.trunc(Number(v));
  };
  const setFloat = (k: string, v: unknown) => {
    if (v === undefined) return;
    p[k] = v === null ? null : Number(v);
  };
  const setBool = (k: string, v: unknown) => {
    if (v === undefined) return;
    p[k] = Boolean(v);
  };

  if ('client' in updateData) setStr('client', updateData.client);
  if ('model' in updateData) setStr('model', updateData.model);
  if ('qty' in updateData) setInt('qty', updateData.qty);
  if ('totalHours' in updateData) setFloat('totalHours', updateData.totalHours);
  if ('sales' in updateData) setStr('sales', updateData.sales);
  if ('deliveryDate' in updateData) setStr('deliveryDate', updateData.deliveryDate);
  if ('drawing' in updateData) setStr('drawing', updateData.drawing);
  if ('materials' in updateData) setStr('materials', updateData.materials);
  if ('assignedDay' in updateData) setStr('assignedDay', updateData.assignedDay);
  if ('taskStatus' in updateData) setStr('taskStatus', updateData.taskStatus);
  if ('cutStatus' in updateData) setStr('cutStatus', updateData.cutStatus);
  if ('boxNumber' in updateData) {
    const v = updateData.boxNumber;
    if (v === undefined) {
      /* skip */
    } else if (v === null) p.boxNumber = null;
    else p.boxNumber = Math.trunc(Number(v));
  }
  if ('worker' in updateData) {
    const v = updateData.worker;
    if (v === undefined) {
      /* skip */
    } else if (v === null || v === '') p.worker = null;
    else p.worker = String(v);
  }
  if ('createdAt' in updateData) setFloat('createdAt', updateData.createdAt);
  if ('isImportError' in updateData) setBool('isImportError', updateData.isImportError);
  if ('errorReason' in updateData) {
    const v = updateData.errorReason;
    if (v === undefined) {
      /* skip */
    } else if (v === null) p.errorReason = null;
    else p.errorReason = String(v);
  }
  if ('drawingUrl' in updateData) {
    const v = updateData.drawingUrl;
    if (v === undefined) {
      /* skip */
    } else if (v === null || v === '') p.drawingUrl = null;
    else p.drawingUrl = String(v);
  }
  if ('activeAlarm' in updateData) {
    const v = updateData.activeAlarm;
    if (v === undefined) {
      /* skip */
    } else if (v === null || v === '') p.activeAlarm = null;
    else p.activeAlarm = String(v);
  }
  if ('totalQty' in updateData) setInt('totalQty', updateData.totalQty);
  if ('reportedQty' in updateData) setInt('reportedQty', updateData.reportedQty);
  if ('isUrgent' in updateData) setBool('isUrgent', updateData.isUrgent);
  if ('deletedAt' in updateData) {
    const v = updateData.deletedAt;
    if (v === undefined) {
      /* skip */
    } else if (v === null) p.deletedAt = null;
    else p.deletedAt = Number(v);
  }

  return p;
}

/** 通用單筆更新（欄位名與前端 Order 一致） */
export async function updateOrderAction(
  orderId: string,
  updateData: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  try {
    const patch = buildOrderPatch(updateData);
    if (Object.keys(patch).length === 0) return { ok: true };

    await orderUpdateOrCreateFromPatch(orderId, patch);
    return { ok: true };
  } catch (e) {
    console.error('[updateOrderAction]', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function batchUpdateOrdersAction(
  updates: { id: string; data: Record<string, unknown> }[]
): Promise<{ ok: boolean; error?: string }> {
  try {
    await Promise.all(
      updates.map(async ({ id, data }) => {
        const patch = buildOrderPatch(data);
        if (Object.keys(patch).length === 0) return;
        await orderUpdateOrCreateFromPatch(id, patch);
      })
    );
    return { ok: true };
  } catch (e) {
    console.error('[batchUpdateOrdersAction]', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 用於 AI 排產：僅批量更新 assignedDay */
export async function batchUpdateAssignedDaysAction(
  items: { id: string; assignedDay: string }[]
): Promise<{ ok: boolean; error?: string }> {
  try {
    await Promise.all(
      items.map(async ({ id, assignedDay }) => {
        try {
          await prisma.order.update({
            where: { id },
            data: { assignedDay },
          });
        } catch (e) {
          if (!isRecordNotFoundP2025(e)) throw e;
          await prisma.order.create({
            data: {
              ...defaultOrderUncheckedCreate(id),
              assignedDay,
            },
          });
        }
      })
    );
    return { ok: true };
  } catch (e) {
    console.error('[batchUpdateAssignedDaysAction]', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function addWorkerAction(name: string): Promise<{ ok: boolean; error?: string }> {
  const n = name.trim();
  if (!n) return { ok: false, error: 'empty name' };
  try {
    const max = await prisma.mesWorker.aggregate({ _max: { sortOrder: true } });
    const sortOrder = (max._max.sortOrder ?? -1) + 1;
    await prisma.mesWorker.create({
      data: { name: n, sortOrder },
    });
    return { ok: true };
  } catch (e) {
    console.error('[addWorkerAction]', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function createActivityLogAction(entry: {
  id: string;
  ts: number;
  text: string;
  operator?: string;
  role?: string;
  actionType?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.mesActivityLog.create({
      data: {
        id: entry.id,
        ts: entry.ts,
        text: entry.text,
        operator: entry.operator ?? null,
        role: entry.role ?? null,
        actionType: entry.actionType ?? null,
      },
    });
    const cnt = await prisma.mesActivityLog.count();
    if (cnt > 520) {
      const excess = cnt - 500;
      const old = await prisma.mesActivityLog.findMany({
        orderBy: { ts: 'asc' },
        take: excess,
        select: { id: true },
      });
      if (old.length > 0) {
        await prisma.mesActivityLog.deleteMany({
          where: { id: { in: old.map((x: { id: string }) => x.id) } },
        });
      }
    }
    return { ok: true };
  } catch (e) {
    console.error('[createActivityLogAction]', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function patchMesSettingsAction(partial: {
  dailyCapacity?: number;
  theme?: AppTheme;
  layoutMode?: LayoutMode;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    await ensureAppSettings();
    await prisma.mesAppSettings.update({
      where: { id: SETTINGS_ID },
      data: {
        ...(partial.dailyCapacity != null && partial.dailyCapacity > 0
          ? { dailyCapacity: partial.dailyCapacity }
          : {}),
        ...(partial.theme != null ? { theme: partial.theme } : {}),
        ...(partial.layoutMode != null ? { layoutMode: partial.layoutMode } : {}),
      },
    });
    return { ok: true };
  } catch (e) {
    console.error('[patchMesSettingsAction]', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 軟刪除：completed = 僅已完成訂單；all = 全部未刪訂單 */
export async function softDeleteOrdersAction(mode: 'completed' | 'all'): Promise<{ ok: boolean; error?: string }> {
  const now = Date.now();
  try {
    if (mode === 'completed') {
      await prisma.order.updateMany({
        where: { deletedAt: null, taskStatus: 'completed' },
        data: { deletedAt: now },
      });
    } else {
      await prisma.order.updateMany({
        where: { deletedAt: null },
        data: { deletedAt: now },
      });
    }
    return { ok: true };
  } catch (e) {
    console.error('[softDeleteOrdersAction]', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
