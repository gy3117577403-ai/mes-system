import type { AiCopilotContextSummary, AiPlannerReport } from '@/actions/aiSchedulerActions';
import type { AiPlannerDailyReport, AiPlannerTodo, AiPlannerUiContext } from '@/types';

type BuildDailyReportInput = {
  plannerReport?: AiPlannerReport | null;
  plannerTodos: AiPlannerTodo[];
  contextSummary?: AiCopilotContextSummary | null;
  uiContext?: AiPlannerUiContext | null;
  selectedTaskName?: string | null;
};

function compactList(items: Array<string | undefined | null>, fallback: string): string[] {
  const clean = items.map((item) => String(item ?? '').trim()).filter(Boolean);
  return clean.length ? clean.slice(0, 12) : [fallback];
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function overviewFrom(input: BuildDailyReportInput): AiPlannerDailyReport['contextOverview'] {
  const local = input.uiContext?.localSummary;
  const summary = input.contextSummary;
  return {
    totalOrders: summary?.totalOrders ?? local?.totalOrders,
    schedulableOrders: summary?.schedulableOrders ?? local?.schedulableOrders,
    blockedByDrawing: summary?.blockedByDrawing ?? local?.blockedByDrawing,
    blockedByMaterial: summary?.blockedByMaterial ?? local?.blockedByMaterial,
    scheduledOrders: summary?.scheduledOrders ?? local?.scheduledOrders,
    urgentOrders: summary?.urgentOrders ?? local?.urgentOrders,
    riskOrders: summary?.riskOrders ?? local?.riskOrders,
  };
}

function valueOrEmpty(value?: number): string {
  return typeof value === 'number' ? String(value) : '暂无数据';
}

export function buildDailyReportMarkdown(report: AiPlannerDailyReport, selectedTaskName?: string | null): string {
  const overview = report.contextOverview;
  const mustItems = report.nextActions.length ? report.nextActions : ['暂无明确必须处理事项'];
  const pendingQuestions = report.pendingQuestions.length ? report.pendingQuestions : ['暂无待主管确认事项'];
  const risks = report.riskSummary.length ? report.riskSummary : ['暂无风险摘要'];

  return [
    `# ${report.title}`,
    '',
    `生成时间：${formatDateTime(report.createdAt)}`,
    `当前任务：${selectedTaskName || '综合计划交接'}`,
    '',
    '## 一、今日排产概览',
    `- 总订单：${valueOrEmpty(overview.totalOrders)}`,
    `- 可排产：${valueOrEmpty(overview.schedulableOrders)}`,
    `- 图纸未发：${valueOrEmpty(overview.blockedByDrawing)}`,
    `- 物料未齐：${valueOrEmpty(overview.blockedByMaterial)}`,
    `- 已排产：${valueOrEmpty(overview.scheduledOrders)}`,
    `- 急单：${valueOrEmpty(overview.urgentOrders)}`,
    `- 风险订单：${valueOrEmpty(overview.riskOrders)}`,
    '',
    '## 二、AI待办统计',
    `- 待办总数：${report.todoStats.total}`,
    `- 待处理：${report.todoStats.pending}`,
    `- 已处理：${report.todoStats.done}`,
    `- 已忽略：${report.todoStats.ignored}`,
    `- MUST级：${report.todoStats.must}`,
    '',
    '## 三、必须处理事项',
    ...mustItems.map((item, index) => `${index + 1}. ${item}`),
    '',
    '## 四、待主管确认',
    ...pendingQuestions.map((item, index) => `${index + 1}. ${item}`),
    '',
    '## 五、风险摘要',
    ...risks.map((item, index) => `${index + 1}. ${item}`),
    '',
    '## 六、明日/下一步建议',
    ...report.nextActions.map((item, index) => `${index + 1}. ${item}`),
    '',
    '说明：当前报告基于系统已保存数据和页面上下文生成，仅用于计划沟通与交接，不会修改订单。实际排产仍以系统排产结果和后端硬规则为准。',
  ].join('\n');
}

export function buildAiPlannerDailyReport(input: BuildDailyReportInput): AiPlannerDailyReport {
  const createdAt = new Date().toISOString();
  const overview = overviewFrom(input);
  const pendingTodos = input.plannerTodos.filter((todo) => todo.status === 'PENDING');
  const mustTodos = input.plannerTodos.filter((todo) => todo.level === 'MUST' && todo.status === 'PENDING');
  const questions = input.plannerTodos.filter((todo) => todo.source === 'QUESTION_FOR_HUMAN' && todo.status === 'PENDING');
  const report = input.plannerReport;

  const riskSummary = compactList(
    [
      ...(report?.priorityActions.filter((action) => action.level === 'MUST').map((action) => `${action.title}：${action.reason}`) ?? []),
      ...(report?.blockedGroups.filter((group) => group.count > 0).map((group) => `${group.reasonType} ${group.count} 单：${group.suggestion}`) ?? []),
      overview.riskOrders ? `系统规则识别交期风险订单 ${overview.riskOrders} 单` : undefined,
      overview.blockedByDrawing ? `图纸未发订单 ${overview.blockedByDrawing} 单，建议技术跟进` : undefined,
      overview.blockedByMaterial ? `物料未齐订单 ${overview.blockedByMaterial} 单，建议仓库跟进` : undefined,
    ],
    '暂无明确风险摘要'
  );

  const pendingQuestions = compactList(
    [
      ...(report?.questionsForHuman.map((question) => `${question.question}${question.suggestedOwner ? `（建议负责人：${question.suggestedOwner}）` : ''}`) ?? []),
      ...questions.map((todo) => `${todo.title}${todo.suggestedOwner ? `（建议负责人：${todo.suggestedOwner}）` : ''}`),
    ],
    '暂无待主管确认事项'
  );

  const nextActions = compactList(
    [
      ...mustTodos.map((todo) => `${todo.title}${todo.suggestedOwner ? `（${todo.suggestedOwner}）` : ''}`),
      ...pendingTodos.filter((todo) => todo.level !== 'MUST').slice(0, 6).map((todo) => todo.title),
      ...(report?.priorityActions.filter((action) => action.level !== 'WATCH').map((action) => action.title) ?? []),
    ],
    '暂无下一步建议'
  );

  const summary = report?.conclusion || `当前系统共有 ${valueOrEmpty(overview.totalOrders)} 单，可排产 ${valueOrEmpty(overview.schedulableOrders)} 单，待处理 AI 待办 ${pendingTodos.length} 项。`;
  const title = `AI计划员日报 - ${todayKey()}`;
  const draft: AiPlannerDailyReport = {
    id: `daily-report-${createdAt}`,
    createdAt,
    title,
    summary,
    contextOverview: overview,
    todoStats: {
      total: input.plannerTodos.length,
      pending: pendingTodos.length,
      done: input.plannerTodos.filter((todo) => todo.status === 'DONE').length,
      ignored: input.plannerTodos.filter((todo) => todo.status === 'IGNORED').length,
      must: mustTodos.length,
    },
    riskSummary,
    pendingQuestions,
    nextActions,
    markdown: '',
  };

  return {
    ...draft,
    markdown: buildDailyReportMarkdown(draft, input.selectedTaskName ?? input.uiContext?.selectedTaskName ?? null),
  };
}
