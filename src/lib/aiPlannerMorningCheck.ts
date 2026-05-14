import type { AiPlannerReport } from '@/actions/aiSchedulerActions';
import type { AiPlannerDailyReport, AiPlannerMorningCheckResult, AiPlannerTodo } from '@/types';

const MORNING_CHECK_STORAGE_KEY = 'gg-ai.aiPlannerMorningCheck.v1';

export function createMorningCheckId(): string {
  return `morning-check-${new Date().toISOString()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildMorningCheckSummary(input: {
  plannerReport?: AiPlannerReport | null;
  todos: AiPlannerTodo[];
  dailyReport?: AiPlannerDailyReport | null;
}): string {
  const mustCount = input.todos.filter((todo) => todo.status === 'PENDING' && todo.level === 'MUST').length;
  const pendingCount = input.todos.filter((todo) => todo.status === 'PENDING').length;
  const conclusion = input.plannerReport?.conclusion?.trim();
  const reportText = input.dailyReport ? '日报草稿已生成' : '日报草稿未生成';
  return conclusion
    ? `今日晨检完成：${conclusion} 已生成 ${pendingCount} 条待办，其中 MUST ${mustCount} 条；${reportText}。`
    : `今日晨检完成：共识别 ${pendingCount} 条待办，其中 MUST ${mustCount} 条；${reportText}。`;
}

export function saveMorningCheckResultToStorage(result: AiPlannerMorningCheckResult): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MORNING_CHECK_STORAGE_KEY, JSON.stringify(result));
    window.dispatchEvent(new Event('gg-ai:planner-presence-updated'));
  } catch {
    // Morning check status is a local convenience snapshot only.
  }
}

export function loadMorningCheckResultFromStorage(): AiPlannerMorningCheckResult | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(MORNING_CHECK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AiPlannerMorningCheckResult;
    return parsed && typeof parsed.id === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export { MORNING_CHECK_STORAGE_KEY };
