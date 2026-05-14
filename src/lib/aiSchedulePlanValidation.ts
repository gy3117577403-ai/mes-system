import { canEnterSchedule, isScheduleAssigned } from '@/lib/scheduleEligibility';
import { BALANCED_SCHEDULE_DAYS, type BalancedScheduleOrderLike, type BalancedSchedulePlan } from '@/lib/aiBalancedSchedulePlanner';

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
  dayLoads: Array<{
    day: string;
    orderCount: number;
    minutes: number;
    averageMinutes: number;
    deltaFromAverage: number;
    withinTolerance: boolean;
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
  const tolerance = Math.max(0, Math.round(Number(input.averageToleranceMinutes) || 500));
  const items = Array.isArray(input.schedulePlan?.items) ? input.schedulePlan.items : [];
  const orderMap = new Map(input.orders.map((order) => [order.id, order]));
  const dayLoads = new Map<string, { orderCount: number; minutes: number; items: typeof items }>(
    BALANCED_SCHEDULE_DAYS.map((day) => [day, { orderCount: 0, minutes: 0, items: [] }])
  );

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
        const deliveryA = String(orderA?.deliveryDate ?? a.deliveryDate ?? '');
        const deliveryB = String(orderB?.deliveryDate ?? b.deliveryDate ?? '');
        const aDay = dayIndex(a.targetDay);
        const bDay = dayIndex(b.targetDay);
        if (deliveryA && deliveryB && deliveryA < deliveryB && aDay > bDay) {
          errors.push({
            code: 'DUE_DATE_ORDER_BROKEN',
            message: '交期顺序错误：早交期订单被排到了晚交期订单之后。',
            orderId: a.orderId,
            day: a.targetDay,
          });
        }
        if (deliveryA && deliveryB && deliveryA === deliveryB && minutesOf(orderA) > minutesOf(orderB) && aDay > bDay) {
          errors.push({
            code: 'SAME_DUE_LARGE_ORDER_DELAYED',
            message: '同交期工时高的订单被排得更晚，不符合大工时优先规则。',
            orderId: a.orderId,
            day: a.targetDay,
          });
        }
      }
    }
  }

  for (let i = 0; i < BALANCED_SCHEDULE_DAYS.length - 1; i += 1) {
    const left = dayLoads.get(BALANCED_SCHEDULE_DAYS[i])?.items ?? [];
    const right = dayLoads.get(BALANCED_SCHEDULE_DAYS[i + 1])?.items ?? [];
    const leftDates = left.map((item) => String(orderMap.get(item.orderId)?.deliveryDate ?? item.deliveryDate ?? '')).filter(Boolean);
    const rightDates = right.map((item) => String(orderMap.get(item.orderId)?.deliveryDate ?? item.deliveryDate ?? '')).filter(Boolean);
    const leftMax = leftDates.sort().at(-1);
    const rightMin = rightDates.sort()[0];
    if (leftMax && rightMin && leftMax > rightMin) {
      errors.push({
        code: 'DAY_DUE_DATE_BOUNDARY_BROKEN',
        message: `${BALANCED_SCHEDULE_DAYS[i]}存在比${BALANCED_SCHEDULE_DAYS[i + 1]}更晚交期的订单，不能执行。`,
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
    const delta = row.minutes - averageMinutes;
    const withinTolerance = Math.abs(delta) <= tolerance;
    if (items.length > 0 && row.minutes > maxTarget) {
      warnings.push({ code: 'DAY_OVER_AVERAGE_TOLERANCE', message: `${day}负荷 ${row.minutes} 分钟，超过日均 ${averageMinutes} 分钟 + ${tolerance} 分钟。`, day });
    }
    if (items.length > 0 && !input.allowOverAverageTolerance && (row.minutes > severeOverload || row.minutes > averageMinutes * 1.5)) {
      errors.push({ code: 'DAY_SEVERE_OVERLOAD', message: `${day}负荷严重偏离平均值，存在异常堆积。`, day });
    }
    return { day, orderCount: row.orderCount, minutes: row.minutes, averageMinutes, deltaFromAverage: delta, withinTolerance };
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
    dayLoads: rows,
    summary: ok
      ? `排产草案通过校验：总工时 ${totalMinutes} 分钟，日均目标 ${averageMinutes} 分钟，允许浮动 ±${tolerance} 分钟。`
      : `排产草案未通过校验：${errors.length} 个错误，${warnings.length} 个警告。`,
  };
}
