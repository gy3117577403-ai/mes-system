import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { prismaOrderToFrontend } from '@/lib/mesDbMappers';
import {
  getShanghaiCurrentWeekRangeEpochMs,
  plannedDateAnchorEpochMs,
} from '@/lib/datetimeShanghai';
import { DAYS } from '@/types';
import { canEnterSchedule, getRequiredPool } from '@/lib/scheduleEligibility';
import { isOrderCompletedStatus } from '@/lib/orderStatus';

const AI_CONTEXT_STATUSES = new Set(['normal', 'PENDING', 'SCHEDULED', 'IN_PROGRESS', 'PAUSED', 'anomaly', 'Rework']);

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 180);
  return String(error).slice(0, 180);
}

function orderWeekAnchorMs(order: { plannedDate?: string | null; createdAt: number }): number | null {
  return plannedDateAnchorEpochMs(order.plannedDate) ?? (Number.isFinite(Number(order.createdAt)) ? Number(order.createdAt) : null);
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const weekStartParam = Number(params.get('weekStartMs'));
    const hasWeekStartParam = Number.isFinite(weekStartParam) && weekStartParam > 0;
    const defaultWeek = getShanghaiCurrentWeekRangeEpochMs();
    const weekStartMs = hasWeekStartParam ? weekStartParam : defaultWeek.weekStartMs;
    const weekEndMs = weekStartMs + 7 * 86_400_000 - 1;

    const rows = await prisma.order.findMany({
      where: { deletedAt: null, isArchived: false },
      orderBy: [{ isUrgent: 'desc' }, { deliveryDate: 'asc' }, { createdAt: 'asc' }],
    });
    const orders = rows.map(prismaOrderToFrontend);
    const currentWeekOrders = orders.filter((order) => {
      const anchor = orderWeekAnchorMs(order);
      return anchor != null && anchor >= weekStartMs && anchor <= weekEndMs;
    });

    const dayCounts = DAYS.reduce<Record<string, number>>((acc, day) => {
      acc[day.key] = orders.filter((order) => order.assignedDay === day.key).length;
      return acc;
    }, {});

    const poolCounts = {
      tech: orders.filter(
        (order) =>
          !isOrderCompletedStatus(order.taskStatus) &&
          order.taskStatus !== 'PendingQC' &&
          order.assignedDay === 'Unscheduled' &&
          getRequiredPool(order) === 'TECH_POOL'
      ).length,
      material: orders.filter(
        (order) =>
          !isOrderCompletedStatus(order.taskStatus) &&
          order.taskStatus !== 'PendingQC' &&
          order.assignedDay === 'Unscheduled' &&
          getRequiredPool(order) === 'MATERIAL_POOL'
      ).length,
      ready: orders.filter(
        (order) =>
          !isOrderCompletedStatus(order.taskStatus) &&
          order.taskStatus !== 'PendingQC' &&
          order.assignedDay === 'Unscheduled' &&
          getRequiredPool(order) === 'READY_OR_SCHEDULE_POOL'
      ).length,
      days: dayCounts,
    };

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      databaseActiveTotal: orders.length,
      currentWeekTotal: currentWeekOrders.length,
      currentWeekRange: { weekStartMs, weekEndMs },
      schedulableTotal: orders.filter(canEnterSchedule).length,
      aiReadableOrderCount: orders.filter((order) => AI_CONTEXT_STATUSES.has(String(order.taskStatus))).length,
      poolCounts,
      diagnostics: {
        queryUsesLimit: false,
        pageLoadedCountMustBeComparedClientSide: true,
        message: '该接口返回数据库当前有效订单全量统计，不使用 70 条显示上限。',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        generatedAt: new Date().toISOString(),
        error: `订单数量诊断失败：${safeErrorMessage(error)}`,
      },
      { status: 200 }
    );
  }
}
