'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { normalizeOrder } from '@/lib/mesOrder';
import { prismaOrderToFrontend, frontendOrderToPrismaCreate } from '@/lib/mesDbMappers';
import {
  formatMsToShanghaiLocale,
  getShanghaiAuditWeekRangeEpochMsForOffset,
  nowEpochMsForMesStorage,
  parseShanghaiWallClockToEpochMs,
  plannedDateAnchorEpochMs,
} from '@/lib/datetimeShanghai';
import {
  activityLogEntryZ,
  addWorkerNameZ,
  approveAbnormalClaimInputZ,
  batchAssignedDaysZ,
  batchUpdateOrdersZ,
  createAbnormalClaimInputZ,
  createOrderActionInputZ,
  orderIdZ,
  patchMesSettingsZ,
  softDeleteModeZ,
  importOrdersOverwriteWeekZ,
  carryOverOrdersInputZ,
  toggleOrderReadyInputZ,
  updateOrderDataZ,
} from '@/lib/mesActionZod';
import type { Order } from '@/types';
import type { ActivityLogEntry } from '@/types';
import type { AppTheme, LayoutMode } from '@/lib/uiTheme';
import { isOrderCompletedStatus } from '@/lib/orderStatus';

const SETTINGS_ID = 'singleton';

/**
 * 標記完工時強制 `reportedQty = totalQty`（庫存欄位名），確保審計實做件數與工時核算有基数。
 */
async function mergeCompletionReportedQty(
  orderId: string,
  patch: Record<string, unknown>,
  rawUpdate: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const ts = rawUpdate.taskStatus;
  if (ts === undefined) return patch;
  if (!isOrderCompletedStatus(String(ts))) return patch;
  const row = await prisma.order.findUnique({
    where: { id: orderId },
    select: { totalQty: true, qty: true },
  });
  const fromPatch =
    patch.totalQty != null ? Math.max(1, Math.trunc(Number(patch.totalQty))) : null;
  const fromDb = Math.max(1, Number(row?.totalQty) || Number(row?.qty) || 1);
  const tq = fromPatch != null ? fromPatch : fromDb;
  return { ...patch, reportedQty: tq };
}

/** 與審計一致：`plannedDate` 錨點優先，否則 `createdAt` */
function importOrderWeekAnchorMs(r: { plannedDate: string | null; createdAt: number }): number | null {
  const p = plannedDateAnchorEpochMs(r.plannedDate);
  if (p != null) return p;
  const c = Number(r.createdAt);
  return Number.isFinite(c) ? c : null;
}

function importPairKey(client: string, model: string): string {
  return `${client.trim()}\0${model.trim()}`;
}

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
    workerId: null,
    createdAt: nowEpochMsForMesStorage(),
    isImportError: false,
    errorReason: null,
    drawingUrl: null,
    activeAlarm: null,
    totalQty: 1,
    reportedQty: 0,
    isUrgent: false,
    isDrawingReady: false,
    isMaterialReady: false,
    exceptionRemark: null,
    plannedDate: null,
    isArchived: false,
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
        where: { deletedAt: null, isArchived: false },
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

export async function createOrderAction(
  data: Partial<Order> & { id: string },
  targetDate: string
): Promise<{ ok: boolean; error?: string }> {
  const parsed = createOrderActionInputZ.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  const d = String(targetDate ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return { ok: false, error: '缺少或无效的排产日期 targetDate（需 yyyy-MM-dd）' };
  }
  let plannedMsStr: string;
  try {
    plannedMsStr = String(parseShanghaiWallClockToEpochMs(d, '00:00:00'));
  } catch {
    return { ok: false, error: '排产日期无法解析为上海时区时间戳' };
  }
  try {
    const o = normalizeOrder({
      ...(parsed.data as Partial<Order> & { id: string }),
      plannedDate: plannedMsStr,
    });
    await prisma.order.create({
      data: frontendOrderToPrismaCreate(o),
    });
    return { ok: true };
  } catch (e) {
    console.error('[createOrderAction]', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 按週覆蓋式批次導入：`targetWeekStart` 為該週上海週一 00:00:00 的 UTC 毫秒戳。
 *
 * **不變量**：同週已完工（型號+客戶）永不被覆寫；該週未完成舊計劃一律 `deletedAt` 軟刪（不用 `isArchived` 冒充刪除，避免 KPI 膨脹）。
 */
export async function importOrdersOverwriteWeekAction(
  orders: unknown[],
  targetWeekStart: number
): Promise<{ ok: boolean; error?: string; archivedCount?: number; upsertedCount?: number }> {
  const parsed = importOrdersOverwriteWeekZ.safeParse({ orders, targetWeekStart });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  const { orders: list, targetWeekStart: weekStartMs } = parsed.data;
  const weekEndMs = weekStartMs + 7 * 86_400_000 - 1;

  try {
    let softDeletedObsoleteCount = 0;
    const upsertedCount = await prisma.$transaction(async (tx) => {
      const mondayYmd = formatMsToShanghaiLocale(weekStartMs).slice(0, 10);
      let plannedMsStr: string;
      try {
        plannedMsStr = String(parseShanghaiWallClockToEpochMs(mondayYmd, '00:00:00'));
      } catch {
        throw new Error('targetWeekStart 無法對應為有效週一錨點');
      }

      /** 步驟 A：該計劃週內已完工保護白名單（客戶+型號），絕不允許新導入行覆寫 */
      const completedRows = await tx.order.findMany({
        where: {
          deletedAt: null,
          OR: [{ taskStatus: 'COMPLETED' }, { taskStatus: 'completed' }],
        },
        select: { client: true, model: true, plannedDate: true, createdAt: true },
      });
      const completedPairWhitelist = new Set<string>();
      for (const r of completedRows) {
        const ms = importOrderWeekAnchorMs(r);
        if (ms == null || ms < weekStartMs || ms > weekEndMs) continue;
        completedPairWhitelist.add(importPairKey(r.client ?? '', r.model ?? ''));
      }

      /** 步驟 B：該週錨點下所有未完工且未刪單 → 真實軟刪（廢棄計劃不再進 KPI） */
      const incompleteRows = await tx.order.findMany({
        where: {
          deletedAt: null,
          AND: [{ taskStatus: { not: 'COMPLETED' } }, { taskStatus: { not: 'completed' } }],
        },
        select: { id: true, plannedDate: true, createdAt: true },
      });
      const toSoftDeleteIds = incompleteRows
        .filter((r) => {
          const ms = importOrderWeekAnchorMs(r);
          return ms != null && ms >= weekStartMs && ms <= weekEndMs;
        })
        .map((r) => r.id);

      const nowMs = nowEpochMsForMesStorage();
      if (toSoftDeleteIds.length > 0) {
        const CHUNK = 300;
        for (let i = 0; i < toSoftDeleteIds.length; i += CHUNK) {
          const slice = toSoftDeleteIds.slice(i, i + CHUNK);
          const r = await tx.order.updateMany({
            where: { id: { in: slice } },
            data: { deletedAt: nowMs },
          });
          softDeletedObsoleteCount += r.count;
        }
      }

      /** 步驟 C：跳過白名單鍵後再 upsert，完工行永不插入 */
      const pairMap = new Map<string, { client: string; model: string }>();
      const lastRawByPair = new Map<string, (typeof list)[number]>();
      for (const raw of list) {
        const o = normalizeOrder({
          ...(raw as Partial<Order> & { id: string }),
          plannedDate: plannedMsStr,
        });
        const ck = importPairKey(o.client, o.model);
        if (completedPairWhitelist.has(ck)) continue;
        pairMap.set(ck, { client: o.client.trim(), model: o.model.trim() });
        lastRawByPair.set(ck, raw);
      }

      const dedupedRaws = [...lastRawByPair.values()];
      let n = 0;
      for (const raw of dedupedRaws) {
        const o = normalizeOrder({
          ...(raw as Partial<Order> & { id: string }),
          plannedDate: plannedMsStr,
        });
        const data = frontendOrderToPrismaCreate(o);
        const { id, ...rest } = data;
        await tx.order.upsert({
          where: { id },
          create: data,
          update: {
            ...rest,
            isDrawingReady: data.isDrawingReady,
            isMaterialReady: data.isMaterialReady,
            isArchived: false,
            deletedAt: null,
          },
        });
        n += 1;
      }
      return n;
    });

    return { ok: true, archivedCount: softDeletedObsoleteCount, upsertedCount };
  } catch (e) {
    console.error('[importOrdersOverwriteWeekAction]', e);
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
    else {
      const s = String(v).trim();
      p.boxNumber = s === '' ? null : s;
    }
  }
  if ('worker' in updateData) {
    const v = updateData.worker;
    if (v === undefined) {
      /* skip */
    } else if (v === null || v === '') p.worker = null;
    else p.worker = String(v);
  }
  if ('workerId' in updateData) {
    const v = updateData.workerId;
    if (v === undefined) {
      /* skip */
    } else if (v === null || v === '') p.workerId = null;
    else p.workerId = String(v);
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
  if ('isDrawingReady' in updateData) setBool('isDrawingReady', updateData.isDrawingReady);
  if ('isMaterialReady' in updateData) setBool('isMaterialReady', updateData.isMaterialReady);
  if ('exceptionRemark' in updateData) {
    const v = updateData.exceptionRemark;
    if (v === undefined) {
      /* skip */
    } else if (v === null) p.exceptionRemark = null;
    else p.exceptionRemark = String(v);
  }
  if ('plannedDate' in updateData) {
    const v = updateData.plannedDate;
    if (v === undefined) {
      /* skip */
    } else if (v === null) p.plannedDate = null;
    else p.plannedDate = String(v);
  }
  if ('isArchived' in updateData) setBool('isArchived', updateData.isArchived);
  if ('deletedAt' in updateData) {
    const v = updateData.deletedAt;
    if (v === undefined) {
      /* skip */
    } else if (v === null) p.deletedAt = null;
    else p.deletedAt = Number(v);
  }

  return p;
}

/**
 * 通用單筆更新（欄位名與前端 Order 一致）。
 * 入參經 Zod 校驗；可選 `expectedUpdatedAt` 與庫中 `updatedAt` 對齊作樂觀併發防護。
 */
export async function updateOrderAction(
  orderId: string,
  updateData: Record<string, unknown>,
  options?: { expectedUpdatedAt?: string | number | Date }
): Promise<{ ok: boolean; error?: string }> {
  const idRes = orderIdZ.safeParse(orderId);
  if (!idRes.success) {
    return { ok: false, error: idRes.error.issues.map((i) => i.message).join('; ') };
  }
  const dataRes = updateOrderDataZ.safeParse(updateData);
  if (!dataRes.success) {
    return { ok: false, error: dataRes.error.issues.map((i) => i.message).join('; ') };
  }

  const id = idRes.data;
  const safeUpdate = dataRes.data;

  console.warn('[MES][updateOrderAction] write-trace', {
    orderId: id,
    keys: Object.keys(safeUpdate),
    shanghaiAt: formatMsToShanghaiLocale(nowEpochMsForMesStorage()),
    optimisticLock: options?.expectedUpdatedAt != null,
  });

  try {
    if (options?.expectedUpdatedAt != null) {
      const row = await prisma.order.findUnique({
        where: { id },
        select: { updatedAt: true },
      });
      if (row) {
        const expected = new Date(options.expectedUpdatedAt).getTime();
        const actual = row.updatedAt.getTime();
        if (Number.isFinite(expected) && Math.abs(actual - expected) > 2) {
          console.warn('[MES][updateOrderAction] optimistic-lock-mismatch', {
            orderId: id,
            expectedRowVersionMs: expected,
            actualRowVersionMs: actual,
          });
          return {
            ok: false,
            error: '并发冲突：订单已在其它终端更新，请刷新后重试',
          };
        }
      }
    }

    const patch = buildOrderPatch(safeUpdate);
    if (Object.keys(patch).length === 0) return { ok: true };

    const merged = await mergeCompletionReportedQty(id, patch, safeUpdate as Record<string, unknown>);
    await orderUpdateOrCreateFromPatch(id, merged);
    return { ok: true };
  } catch (e) {
    console.error('[updateOrderAction]', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function batchUpdateOrdersAction(
  updates: { id: string; data: Record<string, unknown> }[]
): Promise<{ ok: boolean; error?: string }> {
  const listRes = batchUpdateOrdersZ.safeParse(updates);
  if (!listRes.success) {
    return { ok: false, error: listRes.error.issues.map((i) => i.message).join('; ') };
  }
  try {
    await Promise.all(
      listRes.data.map(async ({ id, data }) => {
        const patch = buildOrderPatch(data);
        if (Object.keys(patch).length === 0) return;
        const merged = await mergeCompletionReportedQty(id, patch, data as Record<string, unknown>);
        await orderUpdateOrCreateFromPatch(id, merged);
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
  const parsed = batchAssignedDaysZ.safeParse(items);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  try {
    await Promise.all(
      parsed.data.map(async ({ id, assignedDay }) => {
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
  const nameRes = addWorkerNameZ.safeParse(name);
  if (!nameRes.success) {
    return { ok: false, error: nameRes.error.issues.map((i) => i.message).join('; ') };
  }
  const n = nameRes.data;
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
  const parsed = activityLogEntryZ.safeParse(entry);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  const e = parsed.data;
  try {
    await prisma.mesActivityLog.create({
      data: {
        id: e.id,
        ts: e.ts,
        text: e.text,
        operator: e.operator ?? null,
        role: e.role ?? null,
        actionType: e.actionType ?? null,
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
  const parsed = patchMesSettingsZ.safeParse(partial);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  const p = parsed.data;
  try {
    await ensureAppSettings();
    await prisma.mesAppSettings.update({
      where: { id: SETTINGS_ID },
      data: {
        ...(p.dailyCapacity != null && p.dailyCapacity > 0 ? { dailyCapacity: p.dailyCapacity } : {}),
        ...(p.theme != null ? { theme: p.theme } : {}),
        ...(p.layoutMode != null ? { layoutMode: p.layoutMode } : {}),
      },
    });
    return { ok: true };
  } catch (e) {
    console.error('[patchMesSettingsAction]', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 清屏歸檔：completed = 僅已完成；all = 全部未刪且未歸檔（不寫 deletedAt，主看板以 isArchived 隱藏） */
export async function softDeleteOrdersAction(mode: 'completed' | 'all'): Promise<{ ok: boolean; error?: string }> {
  const modeRes = softDeleteModeZ.safeParse(mode);
  if (!modeRes.success) {
    return { ok: false, error: modeRes.error.issues.map((i) => i.message).join('; ') };
  }
  const m = modeRes.data;
  try {
    if (m === 'completed') {
      await prisma.order.updateMany({
        where: {
          deletedAt: null,
          isArchived: false,
          taskStatus: { in: ['completed', 'COMPLETED'] },
        },
        data: { isArchived: true },
      });
    } else {
      await prisma.order.updateMany({
        where: { deletedAt: null, isArchived: false },
        data: { isArchived: true },
      });
    }
    return { ok: true };
  } catch (e) {
    console.error('[softDeleteOrdersAction]', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 上線前刪檔測試：無條件清空 `Order` 表（臨時核按鈕） */
export async function nukeDatabaseAction(): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.order.deleteMany({});
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    console.error('[nukeDatabaseAction]', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 切換訂單「圖紙／工藝」或「物料」紅綠燈就緒狀態。
 *
 * 業務意圖：
 * - 變紅（未就緒）：寫入對應布林、將管線狀態置為 `PAUSED`，並寫入 `exceptionRemark`（阻斷原因）。
 * - 變綠（已就緒）：寫入對應布林；僅當圖紙與物料**皆**為綠燈時才解除 `PAUSED` 並清空 `exceptionRemark`，否則維持暫停並自動切換為另一側的預設阻斷說明。
 * - 可選 `boxNo`：同步鎖定周轉箱字串編號（如 "05"）。
 */
export async function toggleOrderReadyStatus(
  orderId: string,
  type: 'DRAWING' | 'MATERIAL',
  isReady: boolean,
  exception?: string,
  boxNo?: string
): Promise<{ ok: boolean; error?: string }> {
  const parsed = toggleOrderReadyInputZ.safeParse({ orderId, type, isReady, exception, boxNo });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  const { orderId: id, type: toggleType, isReady: ready, exception: ex, boxNo: bx } = parsed.data;

  try {
    const trimmedBox = bx?.trim();
    const defaultException =
      toggleType === 'DRAWING' ? '图纸／工艺未就绪' : '物料未齐套';
    const remarkOnRed = ex?.trim() || defaultException;

    const existing = await prisma.order.findUnique({ where: { id } });
    const nextDrawing =
      toggleType === 'DRAWING' ? ready : (existing?.isDrawingReady ?? false);
    const nextMaterial =
      toggleType === 'MATERIAL' ? ready : (existing?.isMaterialReady ?? false);

    const patch: Record<string, unknown> =
      toggleType === 'DRAWING' ? { isDrawingReady: ready } : { isMaterialReady: ready };

    if (trimmedBox) {
      patch.boxNumber = trimmedBox;
    }

    if (!ready) {
      patch.taskStatus = 'PAUSED';
      patch.exceptionRemark = remarkOnRed;
    } else if (nextDrawing && nextMaterial) {
      patch.taskStatus = 'PENDING';
      patch.exceptionRemark = null;
    } else {
      patch.taskStatus = 'PAUSED';
      patch.exceptionRemark = !nextMaterial ? '物料未齐套' : '图纸／工艺未就绪';
    }

    await orderUpdateOrCreateFromPatch(id, patch);
    return { ok: true };
  } catch (e) {
    console.error('[toggleOrderReadyStatus]', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 車間工人（或後續小程序）申報異常工時；預設為待審 `PENDING`。
 *
 * @param input.orderId 關聯工單主鍵
 * @param input.workerName 申報人姓名
 * @param input.claimedHours 申報異常工時（小時，浮點）
 * @param input.reason 異常原因說明
 */
export async function createAbnormalClaimAction(input: {
  orderId: string;
  workerName: string;
  claimedHours: number;
  reason: string;
}): Promise<{ ok: boolean; error?: string; claimId?: string }> {
  const parsed = createAbnormalClaimInputZ.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  const { orderId, workerName, claimedHours, reason } = parsed.data;

  try {
    const row = await prisma.mesAbnormalClaim.create({
      data: {
        orderId,
        workerName,
        claimedHours,
        reason,
        status: 'PENDING',
        createdAt: nowEpochMsForMesStorage(),
      },
    });
    return { ok: true, claimId: row.id };
  } catch (e) {
    console.error('[createAbnormalClaimAction]', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 管理員核銷通過：將申報單標記為 `APPROVED`，並把申報工時累加到關聯訂單的 `totalHours`（產能／成本口徑）。
 *
 * @param claimId 申報列主鍵（cuid）
 */
export async function approveAbnormalClaimAction(
  claimId: string
): Promise<{ ok: boolean; error?: string }> {
  const parsed = approveAbnormalClaimInputZ.safeParse({ claimId });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  const { claimId: id } = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      const claim = await tx.mesAbnormalClaim.findUnique({ where: { id } });
      if (!claim) {
        throw new Error('申報記錄不存在');
      }
      if (claim.status !== 'PENDING') {
        throw new Error('僅能核銷待審狀態的申報');
      }

      await tx.mesAbnormalClaim.update({
        where: { id },
        data: { status: 'APPROVED' },
      });

      try {
        await tx.order.update({
          where: { id: claim.orderId },
          data: {
            totalHours: {
              increment: claim.claimedHours,
            },
          },
        });
      } catch (err) {
        if (!isRecordNotFoundP2025(err)) throw err;
        throw new Error('關聯訂單不存在，無法累加工時');
      }
    });
    return { ok: true };
  } catch (e) {
    console.error('[approveAbnormalClaimAction]', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

type ModelWeekAcc = {
  plannedQty: number;
  plannedHours: number;
  pendingOrderCount: number;
  shortfallQty: number;
  pendingHours: number;
  completedOrderCount: number;
  actualQty: number;
  burnedHours: number;
};

function partKey(model: string | null): string {
  return (model ?? '').trim() || '(无型号)';
}

/** 審計疊層用訂單輕量實體（對齊 Prisma `Order`） */
export type ProductionAuditOrderLine = {
  id: string;
  /** 對應庫欄位 `client` */
  customerName: string;
  /** 計劃交期／排產錨點（可為自然語言；前端再解析展示） */
  plannedDate: string | null;
  /** 銷售填寫交期字串 */
  deliveryDate: string;
  isDrawingReady: boolean;
  isMaterialReady: boolean;
  /** 紅燈阻斷說明；空字串表示無 */
  exceptionRemark: string;
  assignedDay: string;
  taskStatus: string;
  qty: number;
  totalQty: number;
  reportedQty: number;
  /** 與 `totalQty` 同源，審計顯式別名 */
  totalQuantity: number;
  /** 與 `reportedQty` 同源（實做件數），審計顯式別名 */
  actualQuantity: number;
  totalHours: number;
  /** 庫 `updatedAt` 轉 UTC 毫秒（已完工明細展示完工時間） */
  updatedAtMs: number;
};

/** 審計明細去重鍵：同型號下客戶與計劃工時完全一致視為重複列 */
function auditOrderLineFingerprint(line: ProductionAuditOrderLine): string {
  const cust = (line.customerName ?? '').trim();
  const th = Math.round((Number(line.totalHours) || 0) * 1000) / 1000;
  return `${cust}\t${th}`;
}

/** 未完工型號行（`partNumber` 對應 `Order.model`） */
export type ProductionAuditPendingModelRow = {
  partNumber: string;
  pendingOrderCount: number;
  /** 未完工訂單計劃件數合計（`totalQty ?? qty`） */
  shortfallQty: number;
  /** 未完工訂單 `totalHours` 合計 */
  estimatedHours: number;
  /** 該型號本週全部訂單計劃工時（含已完工），供進度條分母 */
  modelWeekPlannedHours: number;
  /** 該型號本週已完工訂單工時合計，供進度條分子 */
  modelWeekBurnedHours: number;
  /** 本型號下未完工訂單明細 */
  orders: ProductionAuditOrderLine[];
};

/** 已完工型號行 */
export type ProductionAuditCompletedModelRow = {
  partNumber: string;
  completedOrderCount: number;
  /** 完工訂單 `reportedQty` 合計 */
  actualQty: number;
  /** 完工訂單 `totalHours` 合計 */
  burnedHours: number;
  /** 該型號本週計劃件數合計，供進度條分母 */
  modelWeekPlannedQty: number;
  /** 本型號下已完工訂單明細 */
  orders: ProductionAuditOrderLine[];
};

/** 滾動近 30 天：計劃工時（近 30 天新建且仍未完工、未軟刪、未歸檔）與完工實做工時（已完工且 `updatedAt` 落在窗內、未軟刪） */
export type ProductionAuditMonthly30d = {
  plannedHours: number;
  burnedHours: number;
  /** 0～100，burned/planned */
  attainmentPct: number;
};

export type ProductionAuditSummaryResult = {
  ok: boolean;
  error?: string;
  weekOffset: number;
  weekStartMs: number;
  weekEndMs: number;
  /** 當週完工單數（`updatedAt` 落在選中週） */
  completedInWeekCount: number;
  /** 全庫未完工待辦單數 */
  pendingBacklogCount: number;
  /** 當週完工 + 待辦（監控口徑） */
  totalOrderCount: number;
  /** 待辦 ∪ 當週完工 涉及型號數 */
  modelCount: number;
  /** 選中週內完工單 `totalHours` 合計 */
  burnedHours: number;
  /** 全庫待辦 `totalHours` 合計（計劃負荷） */
  plannedHours: number;
  monthly30d: ProductionAuditMonthly30d;
  pendingModels: ProductionAuditPendingModelRow[];
  completedModels: ProductionAuditCompletedModelRow[];
};

const ORDER_AUDIT_SELECT = {
  id: true,
  model: true,
  client: true,
  qty: true,
  totalQty: true,
  reportedQty: true,
  totalHours: true,
  taskStatus: true,
  plannedDate: true,
  deliveryDate: true,
  isDrawingReady: true,
  isMaterialReady: true,
  exceptionRemark: true,
  assignedDay: true,
  createdAt: true,
  updatedAt: true,
} as const;

function toAuditOrderLine(r: {
  id: string;
  model: string;
  client: string;
  qty: number;
  totalQty: number;
  reportedQty: number;
  totalHours: number;
  taskStatus: string;
  plannedDate: string | null;
  deliveryDate: string;
  isDrawingReady: boolean | null;
  isMaterialReady: boolean | null;
  exceptionRemark: string | null;
  assignedDay: string;
  updatedAt: Date;
}): ProductionAuditOrderLine {
  const dr = r.isDrawingReady;
  const mr = r.isMaterialReady;
  const uat = r.updatedAt instanceof Date ? r.updatedAt.getTime() : new Date(r.updatedAt).getTime();
  const rawTq = r.totalQty;
  const rawRq = r.reportedQty;
  const q = Number(r.qty);
  const totalQtyNum = Number.isFinite(Number(rawTq)) ? Math.trunc(Number(rawTq)) : Math.trunc(Number.isFinite(q) ? q : 0);
  const reportedQtyNum = Number.isFinite(Number(rawRq)) ? Math.trunc(Number(rawRq)) : 0;
  const totalHoursNum = Number.isFinite(Number(r.totalHours)) ? Number(r.totalHours) : 0;
  return {
    id: r.id,
    customerName: (r.client ?? '').trim(),
    plannedDate: r.plannedDate?.trim() ? r.plannedDate.trim() : null,
    deliveryDate: (r.deliveryDate ?? '').trim(),
    isDrawingReady: dr === true,
    isMaterialReady: mr === true,
    exceptionRemark: String(r.exceptionRemark ?? '').trim(),
    assignedDay: (r.assignedDay ?? '').trim(),
    taskStatus: String(r.taskStatus ?? '').trim(),
    qty: Math.trunc(Number.isFinite(q) ? q : 0),
    totalQty: totalQtyNum,
    reportedQty: reportedQtyNum,
    totalQuantity: totalQtyNum,
    actualQuantity: reportedQtyNum,
    totalHours: totalHoursNum,
    updatedAtMs: Number.isFinite(uat) ? uat : Date.now(),
  };
}

/**
 * 週計劃結轉：將選中訂單 `plannedDate` 設為新錨點（毫秒字串）、`isArchived: false`；`updatedAt` 由 Prisma 自動刷新。
 */
export async function carryOverOrdersAction(
  orderIds: string[],
  newPlannedDateEpochMs: number
): Promise<{ ok: boolean; error?: string; updated?: number }> {
  const parsed = carryOverOrdersInputZ.safeParse({ orderIds, newPlannedDateEpochMs });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  const { orderIds: ids, newPlannedDateEpochMs: ms } = parsed.data;
  const plannedDateStr = String(Math.trunc(ms));
  try {
    const r = await prisma.order.updateMany({
      where: {
        id: { in: ids },
        deletedAt: null,
      },
      data: {
        plannedDate: plannedDateStr,
        isArchived: false,
      },
    });
    return { ok: true, updated: r.count };
  } catch (e) {
    console.error('[carryOverOrdersAction]', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 生產審計：`weekOffset` 選週。
 * - 待辦：仍以 `plannedDate`（或 `createdAt`）錨點落在該週。
 * - 已完工：僅要求 `updatedAt` 落在該週，不再用 `plannedDate` 二次過濾（跨週完工可計入業績）。
 */
export async function fetchProductionAuditSummaryAction(weekOffset = 0): Promise<ProductionAuditSummaryResult> {
  const empty: ProductionAuditSummaryResult = {
    ok: false,
    weekOffset: 0,
    weekStartMs: 0,
    weekEndMs: 0,
    completedInWeekCount: 0,
    pendingBacklogCount: 0,
    totalOrderCount: 0,
    modelCount: 0,
    burnedHours: 0,
    plannedHours: 0,
    monthly30d: { plannedHours: 0, burnedHours: 0, attainmentPct: 0 },
    pendingModels: [],
    completedModels: [],
  };

  try {
    const off = Math.min(8, Math.max(0, Math.floor(Number(weekOffset)) || 0));
    const { weekStartMs, weekEndMs } = getShanghaiAuditWeekRangeEpochMsForOffset(off);
    const weekStart = new Date(weekStartMs);
    const weekEnd = new Date(weekEndMs);
    const monthStartMs = Date.now() - 30 * 86_400_000;
    const monthStart = new Date(monthStartMs);
    const now = new Date();

    const [pendingCandidates, completedCandidates, monthPlannedAgg, monthBurnedAgg] = await Promise.all([
      prisma.order.findMany({
        where: {
          deletedAt: null,
          isArchived: false,
          AND: [{ taskStatus: { not: 'COMPLETED' } }, { taskStatus: { not: 'completed' } }],
        },
        select: ORDER_AUDIT_SELECT,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.order.findMany({
        where: {
          deletedAt: null,
          OR: [{ taskStatus: 'COMPLETED' }, { taskStatus: 'completed' }],
          updatedAt: { gte: weekStart, lte: weekEnd },
        },
        select: ORDER_AUDIT_SELECT,
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.order.aggregate({
        where: {
          deletedAt: null,
          isArchived: false,
          createdAt: { gte: monthStartMs },
          AND: [{ taskStatus: { not: 'COMPLETED' } }, { taskStatus: { not: 'completed' } }],
        },
        _sum: { totalHours: true },
      }),
      prisma.order.aggregate({
        where: {
          deletedAt: null,
          OR: [{ taskStatus: 'COMPLETED' }, { taskStatus: 'completed' }],
          updatedAt: { gte: monthStart, lte: now },
        },
        _sum: { totalHours: true },
      }),
    ]);

    const planned30 = Number(monthPlannedAgg._sum.totalHours) || 0;
    const burned30 = Number(monthBurnedAgg._sum.totalHours) || 0;
    const attainmentPct =
      planned30 > 0 ? Math.min(100, Math.round((burned30 / planned30) * 1000) / 10) : 0;

    /** `plannedDate` 可解析则用錨點；否則用 `createdAt`，避免無計劃日訂單在審計週視圖中消失 */
    const rowWeekAnchorMs = (r: { plannedDate: string | null; createdAt: number }) => {
      const p = plannedDateAnchorEpochMs(r.plannedDate);
      if (p != null) return p;
      const c = Number(r.createdAt);
      return Number.isFinite(c) ? c : null;
    };

    const inSelectedWeekByAnchor = (r: { plannedDate: string | null; createdAt: number }) => {
      const ms = rowWeekAnchorMs(r);
      if (ms == null) return false;
      return ms >= weekStartMs && ms <= weekEndMs;
    };

    const pendingRows = pendingCandidates.filter((r) => inSelectedWeekByAnchor(r));
    /** 已完工：僅以庫存 `updatedAt`（完工時間）落在選定週為準，不依賴 plannedDate，避免跨週完工漏計 */
    const completedRows = completedCandidates;

    const weekBurnByModel = new Map<string, number>();
    const burnFpByModel = new Map<string, Set<string>>();
    for (const r of completedRows) {
      const k = partKey(r.model);
      const line = toAuditOrderLine(r);
      const fp = auditOrderLineFingerprint(line);
      const seenB = burnFpByModel.get(k) ?? new Set<string>();
      if (seenB.has(fp)) continue;
      seenB.add(fp);
      burnFpByModel.set(k, seenB);
      const th = Number(r.totalHours) || 0;
      weekBurnByModel.set(k, (weekBurnByModel.get(k) ?? 0) + th);
    }

    const pendingAgg = new Map<string, ModelWeekAcc>();
    const pendingLinesByModel = new Map<string, ProductionAuditOrderLine[]>();
    const pendingFpByModel = new Map<string, Set<string>>();

    for (const r of pendingRows) {
      const key = partKey(r.model);
      const line = toAuditOrderLine(r);
      const fp = auditOrderLineFingerprint(line);
      const seen = pendingFpByModel.get(key) ?? new Set<string>();
      if (seen.has(fp)) continue;
      seen.add(fp);
      pendingFpByModel.set(key, seen);

      const plannedPiece = r.totalQty ?? r.qty;
      const th = Number(r.totalHours) || 0;
      const acc =
        pendingAgg.get(key) ??
        ({
          plannedQty: 0,
          plannedHours: 0,
          pendingOrderCount: 0,
          shortfallQty: 0,
          pendingHours: 0,
          completedOrderCount: 0,
          actualQty: 0,
          burnedHours: 0,
        } satisfies ModelWeekAcc);
      acc.pendingOrderCount += 1;
      acc.shortfallQty += plannedPiece;
      acc.pendingHours += th;
      acc.plannedQty += plannedPiece;
      acc.plannedHours += th;
      const arr = pendingLinesByModel.get(key) ?? [];
      arr.push(line);
      pendingLinesByModel.set(key, arr);
      pendingAgg.set(key, acc);
    }

    const completedAgg = new Map<string, ModelWeekAcc>();
    const completedLinesByModel = new Map<string, ProductionAuditOrderLine[]>();
    const completedFpByModel = new Map<string, Set<string>>();

    for (const r of completedRows) {
      const key = partKey(r.model);
      const line = toAuditOrderLine(r);
      const fp = auditOrderLineFingerprint(line);
      const seen = completedFpByModel.get(key) ?? new Set<string>();
      if (seen.has(fp)) continue;
      seen.add(fp);
      completedFpByModel.set(key, seen);

      const plannedPiece = r.totalQty ?? r.qty;
      const th = Number(r.totalHours) || 0;
      const acc =
        completedAgg.get(key) ??
        ({
          plannedQty: 0,
          plannedHours: 0,
          pendingOrderCount: 0,
          shortfallQty: 0,
          pendingHours: 0,
          completedOrderCount: 0,
          actualQty: 0,
          burnedHours: 0,
        } satisfies ModelWeekAcc);
      acc.completedOrderCount += 1;
      acc.actualQty += r.reportedQty ?? 0;
      acc.burnedHours += th;
      acc.plannedQty += plannedPiece;
      acc.plannedHours += th;
      const arr = completedLinesByModel.get(key) ?? [];
      arr.push(line);
      completedLinesByModel.set(key, arr);
      completedAgg.set(key, acc);
    }

    const pendingModels: ProductionAuditPendingModelRow[] = [];
    for (const [partNumber, v] of pendingAgg) {
      const weekBurn = Math.round((weekBurnByModel.get(partNumber) ?? 0) * 1000) / 1000;
      pendingModels.push({
        partNumber,
        pendingOrderCount: v.pendingOrderCount,
        shortfallQty: v.shortfallQty,
        estimatedHours: Math.round(v.pendingHours * 1000) / 1000,
        modelWeekPlannedHours: Math.round(v.pendingHours * 1000) / 1000,
        modelWeekBurnedHours: weekBurn,
        orders: pendingLinesByModel.get(partNumber) ?? [],
      });
    }

    const completedModels: ProductionAuditCompletedModelRow[] = [];
    for (const [partNumber, v] of completedAgg) {
      completedModels.push({
        partNumber,
        completedOrderCount: v.completedOrderCount,
        actualQty: v.actualQty,
        burnedHours: Math.round(v.burnedHours * 1000) / 1000,
        modelWeekPlannedQty: v.plannedQty,
        orders: completedLinesByModel.get(partNumber) ?? [],
      });
    }

    pendingModels.sort((a, b) => b.estimatedHours - a.estimatedHours);
    completedModels.sort((a, b) => b.actualQty - a.actualQty);

    const modelKeys = new Set<string>([...pendingAgg.keys(), ...completedAgg.keys()]);
    const completedInWeekCount = [...completedAgg.values()].reduce((s, v) => s + v.completedOrderCount, 0);
    const pendingBacklogCount = [...pendingAgg.values()].reduce((s, v) => s + v.pendingOrderCount, 0);
    const burnedHours =
      Math.round([...completedAgg.values()].reduce((s, v) => s + v.burnedHours, 0) * 1000) / 1000;
    const plannedHours =
      Math.round([...pendingAgg.values()].reduce((s, v) => s + v.pendingHours, 0) * 1000) / 1000;

    return {
      ok: true,
      weekOffset: off,
      weekStartMs,
      weekEndMs,
      completedInWeekCount,
      pendingBacklogCount,
      totalOrderCount: completedInWeekCount + pendingBacklogCount,
      modelCount: modelKeys.size,
      burnedHours,
      plannedHours,
      monthly30d: {
        plannedHours: Math.round(planned30 * 1000) / 1000,
        burnedHours: Math.round(burned30 * 1000) / 1000,
        attainmentPct: attainmentPct,
      },
      pendingModels,
      completedModels,
    };
  } catch (e) {
    console.error('[fetchProductionAuditSummaryAction]', e);
    return {
      ...empty,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
