import type { AiPlannerDailyReport, AiPlannerTodo } from '@/types';

export type AiPlannerPresenceStatus = 'IDLE' | 'HAS_TODOS' | 'HAS_MUST' | 'REPORT_READY';

export type AiPlannerPresence = {
  todoTotal: number;
  pendingCount: number;
  doneCount: number;
  ignoredCount: number;
  mustCount: number;
  hasDailyReport: boolean;
  latestReportTitle?: string;
  latestReportCreatedAt?: string;
  status: AiPlannerPresenceStatus;
  statusText: string;
};

const TODO_STORAGE_KEY = 'gg-ai.aiPlannerTodos.v1';
const DAILY_REPORT_STORAGE_KEY = 'gg-ai.aiPlannerDailyReport.v1';

const idlePresence: AiPlannerPresence = {
  todoTotal: 0,
  pendingCount: 0,
  doneCount: 0,
  ignoredCount: 0,
  mustCount: 0,
  hasDailyReport: false,
  status: 'IDLE',
  statusText: 'AI计划员待命',
};

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function getAiPlannerPresenceLabel(status: AiPlannerPresenceStatus): string {
  if (status === 'HAS_MUST') return '有必须处理事项';
  if (status === 'HAS_TODOS') return '有待处理事项';
  if (status === 'REPORT_READY') return '日报已生成';
  return 'AI计划员待命';
}

export function readAiPlannerPresenceFromStorage(): AiPlannerPresence {
  if (typeof window === 'undefined') return idlePresence;

  try {
    const todos = safeParse<AiPlannerTodo[]>(window.localStorage.getItem(TODO_STORAGE_KEY));
    const report = safeParse<AiPlannerDailyReport>(window.localStorage.getItem(DAILY_REPORT_STORAGE_KEY));
    const safeTodos = Array.isArray(todos) ? todos : [];
    const pendingCount = safeTodos.filter((todo) => todo.status === 'PENDING').length;
    const mustCount = safeTodos.filter((todo) => todo.status === 'PENDING' && todo.level === 'MUST').length;
    const hasDailyReport = Boolean(report?.id && report.markdown);
    const status: AiPlannerPresenceStatus = mustCount > 0 ? 'HAS_MUST' : pendingCount > 0 ? 'HAS_TODOS' : hasDailyReport ? 'REPORT_READY' : 'IDLE';

    return {
      todoTotal: safeTodos.length,
      pendingCount,
      doneCount: safeTodos.filter((todo) => todo.status === 'DONE').length,
      ignoredCount: safeTodos.filter((todo) => todo.status === 'IGNORED').length,
      mustCount,
      hasDailyReport,
      latestReportTitle: report?.title,
      latestReportCreatedAt: report?.createdAt,
      status,
      statusText: getAiPlannerPresenceLabel(status),
    };
  } catch {
    return idlePresence;
  }
}

export function getAiPlannerPresenceHint(presence: AiPlannerPresence): string {
  if (presence.mustCount > 0) {
    return `当前有 ${presence.pendingCount} 条待办，其中 ${presence.mustCount} 条 MUST。`;
  }
  if (presence.pendingCount > 0) {
    return `当前有 ${presence.pendingCount} 条待办等待计划员跟进。`;
  }
  if (presence.hasDailyReport) {
    return '今日日报已生成，可打开 AI 工作台查看。';
  }
  return '暂无待办，建议执行每日排产体检。';
}
