import type { AiPlannerReport } from '@/actions/aiSchedulerActions';
import type { AiPlannerTodo, AiPlannerTodoStatus } from '@/types';

type BuildTodoInput = {
  plannerReport?: AiPlannerReport | null;
  aiRunId?: string;
  selectedTaskName?: string | null;
};

const MAX_RELATED_ORDERS = 20;

function hashText(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function buildTodoId(parts: Array<string | number | null | undefined>): string {
  const raw = parts.filter((part) => part !== null && part !== undefined && String(part).trim() !== '').join('|');
  return `todo-${hashText(raw)}`;
}

function limitOrderIds(orderIds?: string[]): string[] | undefined {
  if (!Array.isArray(orderIds)) return undefined;
  const limited = orderIds.filter(Boolean).slice(0, MAX_RELATED_ORDERS);
  return limited.length ? limited : undefined;
}

function sourceLabel(source: AiPlannerTodo['source']): string {
  if (source === 'PRIORITY_ACTION') return '优先动作';
  if (source === 'QUESTION_FOR_HUMAN') return '主动问题';
  if (source === 'BLOCKED_GROUP') return '阻塞归类';
  return '系统体检';
}

export function buildAiPlannerTodosFromReport(input: BuildTodoInput): AiPlannerTodo[] {
  const report = input.plannerReport;
  if (!report) return [];

  const createdAt = new Date().toISOString();
  const aiRunId = input.aiRunId;
  const taskName = input.selectedTaskName ?? null;
  const todos: AiPlannerTodo[] = [];

  report.priorityActions.forEach((action, index) => {
    todos.push({
      id: buildTodoId(['PRIORITY_ACTION', aiRunId, index, action.level, action.title]),
      source: 'PRIORITY_ACTION',
      status: 'PENDING',
      level: action.level,
      title: action.title || 'AI 优先动作',
      reason: action.reason,
      detail: action.reason,
      relatedOrderIds: limitOrderIds(action.relatedOrderIds),
      createdAt,
      aiRunId,
      taskName,
    });
  });

  report.questionsForHuman.forEach((question, index) => {
    todos.push({
      id: buildTodoId(['QUESTION_FOR_HUMAN', aiRunId, index, question.question]),
      source: 'QUESTION_FOR_HUMAN',
      status: 'PENDING',
      level: 'MUST',
      title: question.question || '需要主管确认',
      reason: question.whyItMatters,
      detail: question.whyItMatters,
      suggestedOwner: question.suggestedOwner || '主管确认',
      relatedOrderIds: limitOrderIds(question.relatedOrderIds),
      createdAt,
      aiRunId,
      taskName,
    });
  });

  report.blockedGroups
    .filter((group) => Number(group.count) > 0)
    .forEach((group, index) => {
      const title = `${group.reasonType}：${group.count} 单需跟进`;
      todos.push({
        id: buildTodoId(['BLOCKED_GROUP', aiRunId, index, group.reasonType, group.count]),
        source: 'BLOCKED_GROUP',
        status: 'PENDING',
        level: group.reasonType === 'DRAWING_NOT_READY' || group.reasonType === 'MATERIAL_NOT_READY' ? 'MUST' : 'SHOULD',
        title,
        reason: group.suggestion,
        detail: group.suggestion,
        suggestedOwner: group.reasonType === 'DRAWING_NOT_READY' ? '技术确认图纸' : group.reasonType === 'MATERIAL_NOT_READY' ? '仓库跟进配料' : '计划员确认',
        relatedOrderIds: limitOrderIds(group.orderIds),
        createdAt,
        aiRunId,
        taskName,
      });
    });

  return todos;
}

export function buildTodoCopyText(todo: AiPlannerTodo): string {
  const orderText = todo.relatedOrderIds?.length ? todo.relatedOrderIds.join(', ') : '无指定订单';
  return [
    '【AI计划员待办】',
    `来源：${sourceLabel(todo.source)}`,
    `事项：${todo.title}`,
    `原因：${todo.reason || todo.detail || '请按现场情况确认'}`,
    `涉及订单：${orderText}`,
    `建议负责人：${todo.suggestedOwner || '待指定'}`,
    `请确认：${todo.detail || todo.title}`,
  ].join('\n');
}

export function mergeTodoStatuses(existingTodos: AiPlannerTodo[], newTodos: AiPlannerTodo[]): AiPlannerTodo[] {
  const statusById = new Map<string, AiPlannerTodoStatus>();
  existingTodos.forEach((todo) => {
    if (todo.status === 'DONE' || todo.status === 'IGNORED') {
      statusById.set(todo.id, todo.status);
    }
  });

  const merged = newTodos.map((todo) => ({
    ...todo,
    status: statusById.get(todo.id) ?? todo.status ?? 'PENDING',
  }));

  const retained = existingTodos.filter((todo) => (todo.status === 'DONE' || todo.status === 'IGNORED') && !merged.some((next) => next.id === todo.id));
  return [...merged, ...retained].slice(0, 80);
}
