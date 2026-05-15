import { canEnterSchedule, getScheduleBlockReasons, isScheduleAssigned } from '@/lib/scheduleEligibility';

export const BALANCED_SCHEDULE_DAYS = ['周一', '周二', '周三', '周四', '周五', '周六'] as const;

export type BalancedScheduleDay = (typeof BALANCED_SCHEDULE_DAYS)[number];

export type BalancedScheduleOrderLike = {
  id: string;
  deliveryDate?: string | null;
  totalHours?: number | null;
  planMinutes?: number | null;
  taskStatus?: string;
  isUrgent?: boolean | null;
  isArchived?: boolean | null;
  deletedAt?: unknown;
  assignedDay?: string;
  plannedDate?: string;
  createdAt?: string | number | Date | null;
  model?: string | null;
  client?: string | null;
  isDrawingReady?: boolean;
  isMaterialReady?: boolean;
};

export type BalancedSchedulePlanItem = {
  orderId: string;
  targetDay: BalancedScheduleDay;
  reason: string;
  estimatedMinutes: number;
  priorityRank: number;
  deliveryDate?: string;
};

export type BalancedSchedulePlan = {
  title: string;
  summary: string;
  items: BalancedSchedulePlanItem[];
  warnings: string[];
  candidateSummary: {
    scannedOrderCount: number;
    readyPoolCount: number;
    scheduledAdjustableCount: number;
    includedCount: number;
    excludedByDrawing: number;
    excludedByMaterial: number;
    excludedByDoneArchivedDeleted: number;
    allowRescheduleAssigned: boolean;
  };
  balance: {
    totalMinutes: number;
    dayCount: number;
    averageMinutes: number;
    toleranceMinutes: number;
    minTargetMinutes: number;
    maxTargetMinutes: number;
    dayLoads: Array<{
      day: BalancedScheduleDay;
      orderCount: number;
      minutes: number;
      deltaFromAverage: number;
    }>;
  };
};

export type BalancedScheduleMutation = {
  type: 'ASSIGN_ORDER_DAY';
  orderId: string;
  assignedDay: BalancedScheduleDay;
  reason: string;
};

export type BuildBalancedSchedulePlanInput = {
  orders: BalancedScheduleOrderLike[];
  targetDays?: string[];
  averageToleranceMinutes?: number;
  allowRescheduleAssigned?: boolean;
  userPrompt?: string;
};

function normalizeTargetDays(days?: string[]): BalancedScheduleDay[] {
  const allowed = new Set<string>(BALANCED_SCHEDULE_DAYS);
  const normalized = (days ?? BALANCED_SCHEDULE_DAYS).filter((day): day is BalancedScheduleDay => allowed.has(day));
  return normalized.length ? normalized.slice(0, 6) : [...BALANCED_SCHEDULE_DAYS];
}

function orderMinutes(order: BalancedScheduleOrderLike): number {
  return Math.max(0, Math.round(Number(order.planMinutes ?? order.totalHours ?? 0) || 0));
}

function deliveryKey(order: BalancedScheduleOrderLike): number {
  const text = String(order.deliveryDate ?? '').trim();
  if (!text) return Number.MAX_SAFE_INTEGER;
  const normalized = text.replace(/[/.]/g, '-');
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(normalized);
  if (match) {
    const [, year, month, day] = match;
    return Number(`${year}${month.padStart(2, '0')}${day.padStart(2, '0')}`);
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : Number(new Date(parsed).toISOString().slice(0, 10).replace(/-/g, ''));
}

function deliveryLabel(order: BalancedScheduleOrderLike): string {
  const text = String(order.deliveryDate ?? '').trim();
  return text || '未填交期';
}

function stableCreatedAt(order: BalancedScheduleOrderLike): string {
  const raw = order.createdAt;
  if (raw instanceof Date) return raw.toISOString();
  return String(raw ?? '');
}

function isOrderDone(order: BalancedScheduleOrderLike): boolean {
  return ['COMPLETED', 'completed', 'DONE', 'done'].includes(String(order.taskStatus ?? ''));
}

function isDoneArchivedOrDeleted(order: BalancedScheduleOrderLike): boolean {
  return Boolean(order.isArchived || order.deletedAt || isOrderDone(order));
}

function buildReason(order: BalancedScheduleOrderLike, day: BalancedScheduleDay, loadAfter: number, averageMinutes: number): string {
  const delivery = deliveryLabel(order);
  const minutes = orderMinutes(order);
  const loadHint = loadAfter >= averageMinutes ? '当前日负荷已接近日均目标' : '当前日仍低于日均目标';
  const sourceHint = isScheduleAssigned(order) ? '该订单来自周一到周六已排产池，本次纳入重新平衡' : '该订单来自就绪待排池';
  return `交期 ${delivery} 优先，同交期内按工时 ${minutes} 分钟优先，排入${day}；${loadHint}；${sourceHint}。`;
}

export function buildBalancedSchedulePlan(input: BuildBalancedSchedulePlanInput): {
  schedulePlan: BalancedSchedulePlan;
  proposedMutations: BalancedScheduleMutation[];
} {
  const targetDays = normalizeTargetDays(input.targetDays);
  const toleranceMinutes = Math.max(0, Math.round(Number(input.averageToleranceMinutes) || 500));
  const allowRescheduleAssigned = input.allowRescheduleAssigned !== false;
  const scannedOrders = input.orders.filter((order) => order && order.id);
  const activeOrders = scannedOrders.filter((order) => !isDoneArchivedOrDeleted(order));
  const eligibleOrders = activeOrders.filter((order) => canEnterSchedule(order));
  const readyPoolCount = eligibleOrders.filter((order) => !isScheduleAssigned(order)).length;
  const scheduledAdjustableCount = eligibleOrders.filter((order) => isScheduleAssigned(order)).length;
  const excludedByDoneArchivedDeleted = scannedOrders.filter(isDoneArchivedOrDeleted).length;
  const excludedByDrawing = activeOrders.filter((order) => getScheduleBlockReasons(order).includes('DRAWING_NOT_READY')).length;
  const excludedByMaterial = activeOrders.filter((order) => {
    const reasons = getScheduleBlockReasons(order);
    return !reasons.includes('DRAWING_NOT_READY') && reasons.includes('MATERIAL_NOT_READY');
  }).length;

  const candidates = scannedOrders
    .filter((order) => order && order.id)
    .filter((order) => canEnterSchedule(order))
    .filter((order) => !isDoneArchivedOrDeleted(order))
    .filter((order) => allowRescheduleAssigned || !isScheduleAssigned(order))
    .sort((a, b) => {
      const byDelivery = deliveryKey(a) - deliveryKey(b);
      if (byDelivery !== 0) return byDelivery;
      const byDeliveryText = deliveryLabel(a).localeCompare(deliveryLabel(b));
      if (byDeliveryText !== 0) return byDeliveryText;
      const byMinutes = orderMinutes(b) - orderMinutes(a);
      if (byMinutes !== 0) return byMinutes;
      if (Boolean(a.isUrgent) !== Boolean(b.isUrgent)) return a.isUrgent ? -1 : 1;
      const byCreatedAt = stableCreatedAt(a).localeCompare(stableCreatedAt(b));
      if (byCreatedAt !== 0) return byCreatedAt;
      return String(a.id).localeCompare(String(b.id));
    });

  const totalMinutes = candidates.reduce((sum, order) => sum + orderMinutes(order), 0);
  const averageMinutes = targetDays.length ? Math.round(totalMinutes / targetDays.length) : 0;
  const minTargetMinutes = Math.max(0, averageMinutes - toleranceMinutes);
  const maxTargetMinutes = averageMinutes + toleranceMinutes;
  const dayLoads = new Map<BalancedScheduleDay, number>(targetDays.map((day) => [day, 0]));
  const dayCounts = new Map<BalancedScheduleDay, number>(targetDays.map((day) => [day, 0]));
  const items: BalancedSchedulePlanItem[] = [];
  let dayIndex = 0;

  for (const [index, order] of candidates.entries()) {
    const minutes = orderMinutes(order);
    let day = targetDays[Math.min(dayIndex, targetDays.length - 1)];
    const load = dayLoads.get(day) ?? 0;
    const remainingDaysAfterCurrent = targetDays.length - dayIndex - 1;
    const shouldMove =
      dayIndex < targetDays.length - 1 &&
      load > 0 &&
      (load >= averageMinutes ||
        (load >= minTargetMinutes && load + minutes > maxTargetMinutes) ||
        (remainingDaysAfterCurrent > 0 && load >= minTargetMinutes && minutes >= averageMinutes));

    if (shouldMove) {
      dayIndex += 1;
      day = targetDays[dayIndex];
    }

    const nextLoad = (dayLoads.get(day) ?? 0) + minutes;
    dayLoads.set(day, nextLoad);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    items.push({
      orderId: order.id,
      targetDay: day,
      deliveryDate: order.deliveryDate || undefined,
      estimatedMinutes: minutes,
      priorityRank: index + 1,
      reason: buildReason(order, day, nextLoad, averageMinutes),
    });
  }

  const warnings: string[] = [];
  const loadRows = targetDays.map((day) => {
    const minutes = dayLoads.get(day) ?? 0;
    if (items.length > 0 && minutes > maxTargetMinutes) {
      warnings.push(`${day} 负荷 ${minutes} 分钟，高于日均目标 ${averageMinutes} 分钟 + ${toleranceMinutes} 分钟；由于交期优先，负荷均衡只能在不破坏交期顺序的前提下调整。`);
    }
    return {
      day,
      orderCount: dayCounts.get(day) ?? 0,
      minutes,
      deltaFromAverage: minutes - averageMinutes,
    };
  });

  const schedulePlan: BalancedSchedulePlan = {
    title: '交期优先均衡排产草案',
    summary: items.length
      ? `已按交期升序、同交期工时降序生成 ${items.length} 条草案；候选包含就绪待排 ${readyPoolCount} 单、已排可调整 ${allowRescheduleAssigned ? scheduledAdjustableCount : 0} 单；本周候选总工时 ${totalMinutes} 分钟，日均目标 ${averageMinutes} 分钟，目标浮动 ±${toleranceMinutes} 分钟。`
      : '当前没有满足图纸已发、物料齐套且可排产的候选订单。',
    items,
    warnings,
    candidateSummary: {
      scannedOrderCount: scannedOrders.length,
      readyPoolCount,
      scheduledAdjustableCount: allowRescheduleAssigned ? scheduledAdjustableCount : 0,
      includedCount: items.length,
      excludedByDrawing,
      excludedByMaterial,
      excludedByDoneArchivedDeleted,
      allowRescheduleAssigned,
    },
    balance: {
      totalMinutes,
      dayCount: targetDays.length,
      averageMinutes,
      toleranceMinutes,
      minTargetMinutes,
      maxTargetMinutes,
      dayLoads: loadRows,
    },
  };

  return {
    schedulePlan,
    proposedMutations: items.map((item) => ({
      type: 'ASSIGN_ORDER_DAY',
      orderId: item.orderId,
      assignedDay: item.targetDay,
      reason: item.reason,
    })),
  };
}
