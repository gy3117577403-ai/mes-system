import type { Order } from '@/types';

export type ScheduleBlockReason = 'DRAWING_NOT_READY' | 'MATERIAL_NOT_READY';
export type RequiredSchedulePool = 'TECH_POOL' | 'MATERIAL_POOL' | 'READY_OR_SCHEDULE_POOL';

type ScheduleEligibilityOrder = Omit<
  Pick<Order, 'assignedDay' | 'plannedDate' | 'taskStatus' | 'isDrawingReady' | 'isMaterialReady'>,
  'plannedDate'
> & { plannedDate?: string | null } &
  Partial<Pick<Order, 'drawing' | 'materials'>>;

const SCHEDULED_TASK_STATUSES = new Set(['SCHEDULED', 'IN_PROGRESS', 'PAUSED']);

export function getScheduleBlockReasons(order: Partial<ScheduleEligibilityOrder>): ScheduleBlockReason[] {
  const reasons: ScheduleBlockReason[] = [];

  if (order.isDrawingReady !== true) {
    reasons.push('DRAWING_NOT_READY');
  }

  if (order.isMaterialReady !== true) {
    reasons.push('MATERIAL_NOT_READY');
  }

  return reasons;
}

export function canEnterSchedule(order: Partial<ScheduleEligibilityOrder>): boolean {
  return getScheduleBlockReasons(order).length === 0;
}

export function getRequiredPool(order: Partial<ScheduleEligibilityOrder>): RequiredSchedulePool {
  const reasons = getScheduleBlockReasons(order);
  if (reasons.includes('DRAWING_NOT_READY')) return 'TECH_POOL';
  if (reasons.includes('MATERIAL_NOT_READY')) return 'MATERIAL_POOL';
  return 'READY_OR_SCHEDULE_POOL';
}

export function isScheduleAssigned(order: Partial<ScheduleEligibilityOrder>): boolean {
  const assignedDay = String(order.assignedDay ?? '').trim();
  const plannedDate = String(order.plannedDate ?? '').trim();
  const taskStatus = String(order.taskStatus ?? '').trim();

  return (
    (assignedDay !== '' && assignedDay !== 'Unscheduled') ||
    plannedDate !== '' ||
    SCHEDULED_TASK_STATUSES.has(taskStatus)
  );
}

export function formatScheduleBlockReason(reason: ScheduleBlockReason): string {
  if (reason === 'DRAWING_NOT_READY') return '未下发图纸/SOP';
  return '未配料齐';
}

export function formatScheduleBlockMessage(order: { model?: string | null }, reasons: ScheduleBlockReason[]): string {
  const model = String(order.model ?? '').trim() || '未知订单';
  if (reasons.includes('DRAWING_NOT_READY')) {
    return `订单 ${model} 未下发图纸/SOP，禁止进入排产池。`;
  }
  if (reasons.includes('MATERIAL_NOT_READY')) {
    return `订单 ${model} 未配料齐，禁止进入排产池。`;
  }
  return `订单 ${model} 不符合排产资格，禁止进入排产池。`;
}
