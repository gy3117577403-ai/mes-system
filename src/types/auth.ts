/** 模擬 RBAC 角色 */
export type UserRole = 'Boss' | 'Planner' | 'Engineering' | 'Warehouse' | 'Employee';

export interface AuthUser {
  username: string;
  role: UserRole;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  Boss: '老板',
  Planner: '计划',
  Engineering: '技术',
  Warehouse: '仓库',
  Employee: '员工',
};

export const ROLE_SHORT: Record<UserRole, string> = {
  Boss: 'Admin',
  Planner: 'PMC',
  Engineering: 'ENG',
  Warehouse: 'WH',
  Employee: 'OP',
};
