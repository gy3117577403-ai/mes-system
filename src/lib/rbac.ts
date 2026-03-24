import { UserRole } from '@/types/auth';

/** 可拖拽看板卡片：老板、计划、员工 */
export function canUseKanbanDnD(role: UserRole | undefined): boolean {
  if (!role) return false;
  return role === 'Boss' || role === 'Planner' || role === 'Employee';
}

/** 计划：不能改图纸/配料下拉（只读） */
export function isPlannerFieldReadOnly(role: UserRole | undefined): boolean {
  return role === 'Planner';
}

/** 技术：仅图纸区可操作 */
export function isEngineeringRole(role: UserRole | undefined): boolean {
  return role === 'Engineering';
}

/** 仓库：仅配料区可操作 */
export function isWarehouseRole(role: UserRole | undefined): boolean {
  return role === 'Warehouse';
}

export function isBoss(role: UserRole | undefined): boolean {
  return role === 'Boss';
}

/** 员工在管理看板：通常只拖拽不改编字段 — 可按需改为只读 */
export function employeeReadOnlyFields(role: UserRole | undefined): boolean {
  return role === 'Employee';
}
