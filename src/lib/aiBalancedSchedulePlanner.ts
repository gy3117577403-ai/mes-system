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
  normalizedDeliveryDate?: string;
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
    excludedByInvalidDelivery: number;
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

export type NormalizedScheduleDeliveryDate = {
  key: number;
  label: string;
};

const DEFAULT_DELIVERY_YEAR = 2026;

function buildNormalizedDate(year: number, month: number, day: number): NormalizedScheduleDeliveryDate | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const label = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { key: Number(label.replace(/-/g, '')), label };
}

function normalizeExcelDateSerial(value: number): NormalizedScheduleDeliveryDate | null {
  if (!Number.isFinite(value) || value < 20000 || value > 80000) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.round(value) * 24 * 60 * 60 * 1000;
  const date = new Date(ms);
  return buildNormalizedDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function normalizeScheduleDeliveryDate(value?: unknown, defaultYear = DEFAULT_DELIVERY_YEAR): NormalizedScheduleDeliveryDate | null {
  if (value instanceof Date) {
    return buildNormalizedDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === 'number') {
    return normalizeExcelDateSerial(value);
  }

  const text = String(value ?? '').trim();
  if (!text) return null;
  const compact = text.replace(/\s+/g, '');

  const fullDate = /^(\d{4})[年./-]?(\d{1,2})[月./-]?(\d{1,2})日?/.exec(compact);
  if (fullDate) {
    return buildNormalizedDate(Number(fullDate[1]), Number(fullDate[2]), Number(fullDate[3]));
  }

  const chineseMonthDay = /^(\d{1,2})月(\d{1,2})日?$/.exec(compact);
  if (chineseMonthDay) {
    return buildNormalizedDate(defaultYear, Number(chineseMonthDay[1]), Number(chineseMonthDay[2]));
  }

  const shortMonthDay = /^(\d{1,2})[./-](\d{1,2})$/.exec(compact);
  if (shortMonthDay) {
    return buildNormalizedDate(defaultYear, Number(shortMonthDay[1]), Number(shortMonthDay[2]));
  }

  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return null;
  const date = new Date(parsed);
  return buildNormalizedDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
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

function buildReason(order: BalancedScheduleOrderLike, day: BalancedScheduleDay, loadAfter: number, averageMinutes: number, delivery: NormalizedScheduleDeliveryDate): string {
  const minutes = orderMinutes(order);
  const loadHint = loadAfter >= averageMinutes ? '当前日负荷已接近日均目标' : '当前日仍低于日均目标';
  const sourceHint = isScheduleAssigned(order) ? '该订单来自周一到周六已排产池，本次纳入重新平衡' : '该订单来自就绪待排池';
  return `交期 ${delivery.label} 优先，同交期内按工时 ${minutes} 分钟优先，排入${day}；${loadHint}；${sourceHint}。`;
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
  const eligibleWithDelivery = eligibleOrders.map((order) => ({
    order,
    delivery: normalizeScheduleDeliveryDate(order.deliveryDate),
  }));
  const excludedByInvalidDelivery = eligibleWithDelivery.filter((row) => !row.delivery).length;

  const candidates = eligibleWithDelivery
    .filter((row): row is { order: BalancedScheduleOrderLike; delivery: NormalizedScheduleDeliveryDate } => Boolean(row.delivery))
    .filter(({ order }) => allowRescheduleAssigned || !isScheduleAssigned(order))
    .sort((a, b) => {
      const byDelivery = a.delivery.key - b.delivery.key;
      if (byDelivery !== 0) return byDelivery;
      const byDeliveryText = a.delivery.label.localeCompare(b.delivery.label);
      if (byDeliveryText !== 0) return byDeliveryText;
      const byMinutes = orderMinutes(b.order) - orderMinutes(a.order);
      if (byMinutes !== 0) return byMinutes;
      if (Boolean(a.order.isUrgent) !== Boolean(b.order.isUrgent)) return a.order.isUrgent ? -1 : 1;
      const byCreatedAt = stableCreatedAt(a.order).localeCompare(stableCreatedAt(b.order));
      if (byCreatedAt !== 0) return byCreatedAt;
      return String(a.order.id).localeCompare(String(b.order.id));
    });

  const totalMinutes = candidates.reduce((sum, { order }) => sum + orderMinutes(order), 0);
  const averageMinutes = targetDays.length ? Math.round(totalMinutes / targetDays.length) : 0;
  const minTargetMinutes = Math.max(0, averageMinutes - toleranceMinutes);
  const maxTargetMinutes = averageMinutes + toleranceMinutes;
  const dayLoads = new Map<BalancedScheduleDay, number>(targetDays.map((day) => [day, 0]));
  const dayCounts = new Map<BalancedScheduleDay, number>(targetDays.map((day) => [day, 0]));
  const items: BalancedSchedulePlanItem[] = [];
  let dayIndex = 0;

  for (const [index, { order, delivery }] of candidates.entries()) {
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
      deliveryDate: delivery.label,
      normalizedDeliveryDate: delivery.label,
      estimatedMinutes: minutes,
      priorityRank: index + 1,
      reason: buildReason(order, day, nextLoad, averageMinutes, delivery),
    });
  }

  const warnings: string[] = [];
  if (excludedByInvalidDelivery > 0) {
    warnings.push(`${excludedByInvalidDelivery} 单交期格式无法识别，需人工确认，未纳入严格交期排产草案。`);
  }
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
      excludedByInvalidDelivery,
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
