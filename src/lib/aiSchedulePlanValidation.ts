import { canEnterSchedule, isScheduleAssigned } from '@/lib/scheduleEligibility';
import {
  BALANCED_SCHEDULE_DAYS,
  normalizeScheduleDeliveryDate,
  type BalancedScheduleOrderLike,
  type BalancedSchedulePlan,
  type NormalizedScheduleDeliveryDate,
} from '@/lib/aiBalancedSchedulePlanner';

export type AiSchedulePlanValidationIssue = {
  code: string;
  message: string;
  orderId?: string;
  day?: string;
};

export type AiSchedulePlanValidation = {
  ok: boolean;
  errors: AiSchedulePlanValidationIssue[];
  warnings: AiSchedulePlanValidationIssue[];
  dueDateOrder: {
    ok: boolean;
    conflicts: Array<{
      previousDay: string;
      nextDay: string;
      previousLatestDueDate: string;
      nextEarliestDueDate: string;
      message: string;
    }>;
  };
  dayLoads: Array<{
    day: string;
    orderCount: number;
    minutes: number;
    averageMinutes: number;
    deltaFromAverage: number;
    withinTolerance: boolean;
    earliestDueDate?: string;
    latestDueDate?: string;
  }>;
  summary: string;
};

export type ValidateAiSchedulePlanInput = {
  schedulePlan?: Partial<BalancedSchedulePlan> | null;
  orders: BalancedScheduleOrderLike[];
  averageToleranceMinutes?: number;
  allowOverAverageTolerance?: boolean;
  allowRescheduleAssigned?: boolean;
  dueDateFirst?: boolean;
};

function minutesOf(order?: BalancedScheduleOrderLike): number {
  return Math.max(0, Math.round(Number(order?.planMinutes ?? order?.totalHours ?? 0) || 0));
}

function dayIndex(day?: string): number {
  return BALANCED_SCHEDULE_DAYS.indexOf(day as never);
}

export function validateAiSchedulePlan(input: ValidateAiSchedulePlanInput): AiSchedulePlanValidation {
  const errors: AiSchedulePlanValidationIssue[] = [];
  const warnings: AiSchedulePlanValidationIssue[] = [];
  const dueDateConflicts: AiSchedulePlanValidation['dueDateOrder']['conflicts'] = [];
  const tolerance = Math.max(0, Math.round(Number(input.averageToleranceMinutes) || 500));
  const items = Array.isArray(input.schedulePlan?.items) ? input.schedulePlan.items : [];
  const orderMap = new Map(input.orders.map((order) => [order.id, order]));
  const dayLoads = new Map<string, { orderCount: number; minutes: number; items: typeof items }>(
    BALANCED_SCHEDULE_DAYS.map((day) => [day, { orderCount: 0, minutes: 0, items: [] }])
  );
  const itemDeliveryMap = new Map<string, NormalizedScheduleDeliveryDate>();

  if (items.length === 0) {
    errors.push({ code: 'EMPTY_SCHEDULE_PLAN', message: '用户要求排单，但当前草案为空，不能执行。' });
  }

  for (const item of items) {
    if (!BALANCED_SCHEDULE_DAYS.includes(item.targetDay as never)) {
      errors.push({ code: 'INVALID_TARGET_DAY', message: '目标排产日无效，只允许周一到周六。', orderId: item.orderId, day: item.targetDay });
      continue;
    }
    const order = orderMap.get(item.orderId);
    if (!order) {
      errors.push({ code: 'ORDER_NOT_FOUND', message: '草案包含不存在的订单，不能执行。', orderId: item.orderId, day: item.targetDay });
      continue;
    }
    if (!canEnterSchedule(order)) {
      errors.push({ code: 'SCHEDULE_NOT_ALLOWED', message: '草案包含图纸未发或物料未齐的订单，不能执行。', orderId: item.orderId, day: item.targetDay });
    }
    const delivery = normalizeScheduleDeliveryDate(order.deliveryDate ?? item.deliveryDate ?? '');
    if (!delivery) {
      errors.push({ code: 'INVALID_DELIVERY_DATE', message: '草案包含交期格式无法识别的订单，需人工确认，不能进入严格交期排产草案。', orderId: item.orderId, day: item.targetDay });
    } else {
      itemDeliveryMap.set(item.orderId, delivery);
    }
    if (!input.allowRescheduleAssigned && isScheduleAssigned(order)) {
      warnings.push({ code: 'ALREADY_SCHEDULED', message: '草案包含已排产订单；当前未启用重排模式，请人工确认是否需要移动。', orderId: item.orderId, day: item.targetDay });
    }
    const bucket = dayLoads.get(item.targetDay);
    if (bucket) {
      bucket.orderCount += 1;
      bucket.minutes += Number(item.estimatedMinutes) || minutesOf(order);
      bucket.items.push(item);
    }
  }

  if (input.dueDateFirst !== false) {
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const a = items[i];
        const b = items[j];
        const orderA = orderMap.get(a.orderId);
        const orderB = orderMap.get(b.orderId);
        const deliveryA = itemDeliveryMap.get(a.orderId) ?? normalizeScheduleDeliveryDate(orderA?.deliveryDate ?? a.deliveryDate ?? '');
        const deliveryB = itemDeliveryMap.get(b.orderId) ?? normalizeScheduleDeliveryDate(orderB?.deliveryDate ?? b.deliveryDate ?? '');
        const aDay = dayIndex(a.targetDay);
        const bDay = dayIndex(b.targetDay);
        if (deliveryA && deliveryB && deliveryA.key < deliveryB.key && aDay > bDay) {
          errors.push({
            code: 'DUE_DATE_ORDER_BROKEN',
            message: '交期顺序错误：早交期订单被排到了晚交期订单之后。',
            orderId: a.orderId,
            day: a.targetDay,
          });
        }
        if (deliveryA && deliveryB && deliveryA.key > deliveryB.key && aDay < bDay) {
          errors.push({
            code: 'DUE_DATE_ORDER_BROKEN',
            message: '交期顺序错误：后交期订单被排到了前交期订单前面。',
            orderId: a.orderId,
            day: a.targetDay,
          });
        }
        if (deliveryA && deliveryB && deliveryA.key === deliveryB.key && minutesOf(orderA) > minutesOf(orderB) && aDay > bDay) {
          errors.push({
            code: 'SAME_DUE_LARGE_ORDER_DELAYED',
            message: '同交期工时高的订单被排得更晚，不符合大工时优先规则。',
            orderId: a.orderId,
            day: a.targetDay,
          });
        }
        if (deliveryA && deliveryB && deliveryA.key === deliveryB.key && aDay === bDay && minutesOf(orderA) < minutesOf(orderB)) {
          errors.push({
            code: 'SAME_DUE_LARGE_ORDER_DELAYED',
            message: '同一天同交期内，工时高的订单应排在工时低的订单前面。',
            orderId: b.orderId,
            day: b.targetDay,
          });
        }
      }
    }
  }

  for (let i = 0; i < BALANCED_SCHEDULE_DAYS.length - 1; i += 1) {
    const left = dayLoads.get(BALANCED_SCHEDULE_DAYS[i])?.items ?? [];
    const right = dayLoads.get(BALANCED_SCHEDULE_DAYS[i + 1])?.items ?? [];
    const leftDates = left
      .map((item) => ({ item, delivery: itemDeliveryMap.get(item.orderId) ?? normalizeScheduleDeliveryDate(orderMap.get(item.orderId)?.deliveryDate ?? item.deliveryDate ?? '') }))
      .filter((row): row is { item: (typeof items)[number]; delivery: NormalizedScheduleDeliveryDate } => Boolean(row.delivery));
    const rightDates = right
      .map((item) => ({ item, delivery: itemDeliveryMap.get(item.orderId) ?? normalizeScheduleDeliveryDate(orderMap.get(item.orderId)?.deliveryDate ?? item.deliveryDate ?? '') }))
      .filter((row): row is { item: (typeof items)[number]; delivery: NormalizedScheduleDeliveryDate } => Boolean(row.delivery));
    const leftMax = leftDates.sort((a, b) => a.delivery.key - b.delivery.key).at(-1);
    const rightMin = rightDates.sort((a, b) => a.delivery.key - b.delivery.key)[0];
    if (leftMax && rightMin && leftMax.delivery.key > rightMin.delivery.key) {
      const message = `${BALANCED_SCHEDULE_DAYS[i]}存在 ${leftMax.delivery.label} 交期订单，${BALANCED_SCHEDULE_DAYS[i + 1]}存在 ${rightMin.delivery.label} 交期订单，因此违反交期顺序。`;
      dueDateConflicts.push({
        previousDay: BALANCED_SCHEDULE_DAYS[i],
        nextDay: BALANCED_SCHEDULE_DAYS[i + 1],
        previousLatestDueDate: leftMax.delivery.label,
        nextEarliestDueDate: rightMin.delivery.label,
        message,
      });
      errors.push({
        code: 'DAY_DUE_DATE_BOUNDARY_BROKEN',
        message,
        day: BALANCED_SCHEDULE_DAYS[i],
      });
    }
  }

  const totalMinutes = [...dayLoads.values()].reduce((sum, row) => sum + row.minutes, 0);
  const averageMinutes = BALANCED_SCHEDULE_DAYS.length ? Math.round(totalMinutes / BALANCED_SCHEDULE_DAYS.length) : 0;
  const maxTarget = averageMinutes + tolerance;
  const severeOverload = averageMinutes + 1500;
  const rows = BALANCED_SCHEDULE_DAYS.map((day) => {
    const row = dayLoads.get(day) ?? { orderCount: 0, minutes: 0, items: [] };
    const dueDates = row.items
      .map((item) => itemDeliveryMap.get(item.orderId) ?? normalizeScheduleDeliveryDate(orderMap.get(item.orderId)?.deliveryDate ?? item.deliveryDate ?? ''))
      .filter((item): item is NormalizedScheduleDeliveryDate => Boolean(item))
      .sort((a, b) => a.key - b.key);
    const earliestDueDate = dueDates[0]?.label;
    const latestDueDate = dueDates.at(-1)?.label;
    const delta = row.minutes - averageMinutes;
    const withinTolerance = Math.abs(delta) <= tolerance;
    if (items.length > 0 && row.minutes > maxTarget) {
      warnings.push({ code: 'DAY_OVER_AVERAGE_TOLERANCE', message: `${day}负荷 ${row.minutes} 分钟，超过日均 ${averageMinutes} 分钟 + ${tolerance} 分钟。为了保证交期优先，负荷均衡只能在同交期或不破坏交期顺序的范围内调整。`, day });
    }
    if (items.length > 0 && !input.allowOverAverageTolerance && (row.minutes > severeOverload || row.minutes > averageMinutes * 1.5)) {
      errors.push({ code: 'DAY_SEVERE_OVERLOAD', message: `${day}负荷严重偏离平均值，存在异常堆积。`, day });
    }
    return { day, orderCount: row.orderCount, minutes: row.minutes, averageMinutes, deltaFromAverage: delta, withinTolerance, earliestDueDate, latestDueDate };
  });

  const saturday = rows.at(-1);
  const firstFiveLow = rows.slice(0, 5).filter((row) => row.minutes > 0 && row.minutes < averageMinutes - tolerance).length;
  if (items.length > 0 && saturday && !input.allowOverAverageTolerance && (saturday.minutes > averageMinutes + 1500 || saturday.minutes >= averageMinutes * 2) && firstFiveLow >= 2) {
    errors.push({ code: 'SATURDAY_BACKLOG_OVERLOAD', message: '前序工作日负荷偏低而周六严重爆仓，草案未通过均衡校验。', day: '周六' });
  }

  const ok = errors.length === 0;
  return {
    ok,
    errors,
    warnings,
    dueDateOrder: {
      ok:
        dueDateConflicts.length === 0 &&
        !errors.some((item) => item.code === 'DUE_DATE_ORDER_BROKEN' || item.code === 'DAY_DUE_DATE_BOUNDARY_BROKEN' || item.code === 'INVALID_DELIVERY_DATE'),
      conflicts: dueDateConflicts,
    },
    dayLoads: rows,
    summary: ok
      ? `排产草案通过校验：总工时 ${totalMinutes} 分钟，日均目标 ${averageMinutes} 分钟，允许浮动 ±${tolerance} 分钟。`
      : `排产草案未通过校验：${errors.length} 个错误，${warnings.length} 个警告。`,
  };
}
