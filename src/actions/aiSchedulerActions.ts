'use server';

import { revalidatePath } from 'next/cache';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { AiPlannerUiContext } from '@/types';
import { buildBalancedSchedulePlan, type BalancedScheduleOrderLike, type BalancedSchedulePlan } from '@/lib/aiBalancedSchedulePlanner';
import { validateAiSchedulePlan, type AiSchedulePlanValidation } from '@/lib/aiSchedulePlanValidation';
import {
  canEnterSchedule,
  formatScheduleBlockMessage,
  getRequiredPool,
  getScheduleBlockReasons,
  isScheduleAssigned,
} from '@/lib/scheduleEligibility';
import {
  completeAiPlannerRunSafe,
  createAiPlannerRunSafe,
  createAiSuggestionsSafe,
  hashJson,
  saveAiContextSnapshotSafe,
  updateAiSuggestionStatusSafe,
  type AiPlannerAuditRef,
} from '@/lib/aiPlannerAudit';

const DEEPSEEK_CHAT_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-chat';
const ABNORMAL_CLAIM_CONTEXT_WARNING =
  '异常工时台账表 MesAbnormalClaim 不可用，本次 AI 仅基于订单、交期、产能、缺料和图纸状态进行分析。';

export type AiCopilotMutation =
  | { type: 'ASSIGN_ORDER_DAY'; orderId: string; assignedDay: string; plannedDate?: string; reason?: string }
  | { type: 'UPDATE_ORDER_DATE'; orderId: string; newDate: string }
  | { type: 'UPDATE_DELIVERY_DATE'; orderId: string; newDate: string }
  | { type: 'LOG_EXCEPTION_HOUR'; orderId?: string; minutes: number; reason: string };

export type AiCopilotExportRow = {
  型号: string;
  状态: string;
  计划工时: number;
  交期风险: string;
};

export type AiPlannerReport = {
  conclusion: string;
  priorityActions: Array<{
    level: 'MUST' | 'SHOULD' | 'WATCH';
    title: string;
    reason: string;
    relatedOrderIds?: string[];
  }>;
  blockedGroups: Array<{
    reasonType: 'DRAWING_NOT_READY' | 'MATERIAL_NOT_READY' | 'DATA_INCOMPLETE' | 'OTHER';
    count: number;
    orderIds: string[];
    suggestion: string;
  }>;
  questionsForHuman: Array<{
    question: string;
    whyItMatters: string;
    relatedOrderIds?: string[];
    suggestedOwner?: string;
  }>;
};

export type AiSchedulePlanItem = {
  orderId: string;
  targetDay: string;
  targetDate?: string;
  reason: string;
  estimatedMinutes?: number;
  priorityRank?: number;
};

export type AiSchedulePlan = {
  title: string;
  summary: string;
  items: AiSchedulePlanItem[];
  warnings: string[];
  candidateSummary?: BalancedSchedulePlan['candidateSummary'];
  balance?: BalancedSchedulePlan['balance'];
};

export type AiCopilotResponse = {
  reply: string;
  unreasonableAlerts: string[];
  proposedMutations: AiCopilotMutation[];
  exportDataSummary: AiCopilotExportRow[];
  plannerReport?: AiPlannerReport;
  schedulePlan?: AiSchedulePlan;
  schedulePlanValidation?: AiSchedulePlanValidation;
};

export type AiCopilotContextSummary = {
  totalOrders: number;
  schedulableOrders: number;
  blockedByDrawing: number;
  blockedByMaterial: number;
  scheduledOrders: number;
  urgentOrders: number;
  riskOrders: number;
  dailyCapacity: number;
  contextWarnings: string[];
};

export type AiCopilotActionResult = {
  ok: boolean;
  error?: string;
  data?: AiCopilotResponse;
  contextSummary?: AiCopilotContextSummary;
  rawModelPreview?: string;
  audit?: AiPlannerAuditRef;
};

type DeepSeekChatBody = {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
};

type SchedulerContextBuildResult = {
  context: string;
  warnings: string[];
  summary: AiCopilotContextSummary;
};

function limitString(value: unknown, max = 120): string | undefined {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  return text.slice(0, max);
}

function sanitizeUiContext(input?: AiPlannerUiContext | null): AiPlannerUiContext | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const visibleOrderIds = Array.isArray(input.visibleOrderIds)
    ? input.visibleOrderIds.map((id) => limitString(id, 80)).filter((id): id is string => Boolean(id)).slice(0, 200)
    : undefined;
  const localSummary = input.localSummary
    ? {
        totalOrders: Math.max(0, Math.round(Number(input.localSummary.totalOrders) || 0)),
        schedulableOrders: Math.max(0, Math.round(Number(input.localSummary.schedulableOrders) || 0)),
        blockedByDrawing: Math.max(0, Math.round(Number(input.localSummary.blockedByDrawing) || 0)),
        blockedByMaterial: Math.max(0, Math.round(Number(input.localSummary.blockedByMaterial) || 0)),
        scheduledOrders: Math.max(0, Math.round(Number(input.localSummary.scheduledOrders) || 0)),
        urgentOrders: Math.max(0, Math.round(Number(input.localSummary.urgentOrders) || 0)),
        riskOrders: Math.max(0, Math.round(Number(input.localSummary.riskOrders) || 0)),
      }
    : undefined;

  return {
    currentView: limitString(input.currentView, 80),
    layoutMode: limitString(input.layoutMode, 80),
    planWeekSelected: input.planWeekSelected === true,
    planWeekLabel: input.planWeekLabel === null ? null : limitString(input.planWeekLabel, 80),
    selectedTaskId: input.selectedTaskId === null ? null : limitString(input.selectedTaskId, 80),
    selectedTaskName: input.selectedTaskName === null ? null : limitString(input.selectedTaskName, 120),
    visibleOrderIds,
    loadedOrderCount: input.loadedOrderCount == null ? undefined : Math.max(0, Math.round(Number(input.loadedOrderCount) || 0)),
    localSummary,
    readyFlagGuard: input.readyFlagGuard
      ? {
          baselineModeRecommended: input.readyFlagGuard.baselineModeRecommended === true,
          historicalMismatchCount:
            input.readyFlagGuard.historicalMismatchCount == null
              ? undefined
              : Math.max(0, Math.round(Number(input.readyFlagGuard.historicalMismatchCount) || 0)),
          recentProblemCount:
            input.readyFlagGuard.recentProblemCount == null
              ? undefined
              : Math.max(0, Math.round(Number(input.readyFlagGuard.recentProblemCount) || 0)),
          sourceRiskLevel: limitString(input.readyFlagGuard.sourceRiskLevel, 40),
        }
      : undefined,
    aiAuditStatus: input.aiAuditStatus
      ? {
          enabled: input.aiAuditStatus.enabled === true,
          missingTables: Array.isArray(input.aiAuditStatus.missingTables)
            ? input.aiAuditStatus.missingTables.map((name) => limitString(name, 80)).filter((name): name is string => Boolean(name)).slice(0, 20)
            : undefined,
        }
      : undefined,
  };
}

function buildFallbackPlannerReport(
  summary?: AiCopilotContextSummary,
  reason = '当前按已保存订单数据生成计划体检',
  uiContext?: AiPlannerUiContext
): AiPlannerReport {
  const selectedTaskId = uiContext?.selectedTaskId ?? '';
  const taskHint =
    selectedTaskId === 'RISK_ORDER_SCAN'
      ? `当前任务是风险订单扫描，应优先关注交期风险 ${summary?.riskOrders ?? 0} 条和急单 ${summary?.urgentOrders ?? 0} 条。`
      : selectedTaskId === 'BLOCKED_ORDER_ANALYSIS'
        ? `当前任务是不可排产原因归类，应优先拆分图纸未发 ${summary?.blockedByDrawing ?? 0} 条、物料未齐 ${summary?.blockedByMaterial ?? 0} 条。`
        : selectedTaskId === 'SCHEDULABLE_ORDER_RECOMMENDATION'
          ? `当前任务是可排产订单推荐，应优先从 ${summary?.schedulableOrders ?? 0} 条可排产订单中按交期和工时排序。`
          : selectedTaskId === 'PLANNER_QUESTION_LIST'
            ? '当前任务是 AI 主动问题清单，应优先列出需要主管、技术、仓库确认的问题。'
            : selectedTaskId === 'DAILY_PLANNING_CHECKUP'
              ? '当前任务是每日排产体检，应同时覆盖可排产、不可排产、交期风险和处理优先级。'
              : '当前为通用规则体检。';
  return {
    conclusion: summary
      ? `计划体检：当前读取订单 ${summary.totalOrders} 条，可排产 ${summary.schedulableOrders} 条，图纸未发 ${summary.blockedByDrawing} 条，物料未齐 ${summary.blockedByMaterial} 条，交期风险 ${summary.riskOrders} 条。${taskHint}${reason}`
      : `计划体检：${reason}`,
    priorityActions: [
      ...(summary?.riskOrders
        ? [
            {
              level: 'MUST' as const,
              title: '优先确认交期风险订单',
              reason: `当前发现 ${summary.riskOrders} 条交期风险订单，需要计划员先确认是否加急、拆单或协调交期。`,
            },
          ]
        : []),
      ...(summary?.schedulableOrders
        ? [
            {
              level: 'SHOULD' as const,
              title: '从可排产池选择订单',
              reason: `当前有 ${summary.schedulableOrders} 条订单满足图纸已发和物料齐套，可结合交期和工时进行排产。`,
            },
          ]
        : []),
      {
        level: 'WATCH',
        title: '继续监控阻塞订单',
        reason: '图纸未发和物料未齐订单不能进入排产日，需由对应责任人处理后再排。',
      },
    ],
    blockedGroups: [
      {
        reasonType: 'DRAWING_NOT_READY',
        count: summary?.blockedByDrawing ?? 0,
        orderIds: [],
        suggestion: '由技术/工程负责人推动图纸下发；未下发前保留在技术攻坚池。',
      },
      {
        reasonType: 'MATERIAL_NOT_READY',
        count: summary?.blockedByMaterial ?? 0,
        orderIds: [],
        suggestion: '由仓库/采购确认配料齐套；未齐套前保留在仓库配料池。',
      },
    ],
    questionsForHuman: [
      {
        question: '是否需要优先处理交期风险订单？',
        whyItMatters: '交期风险会影响本周排产顺序和客户承诺。',
        suggestedOwner: '生产计划主管',
      },
    ],
  };
}

function fallbackAiCopilotResponse(
  reply: string,
  unreasonableAlerts: string[] = ['AI 排单执行失败，请检查模型配置、数据库连接或稍后重试'],
  summary?: AiCopilotContextSummary,
  uiContext?: AiPlannerUiContext
): AiCopilotResponse {
  return {
    reply,
    unreasonableAlerts,
    proposedMutations: [],
    exportDataSummary: [],
    plannerReport: buildFallbackPlannerReport(summary, reply, uiContext),
  };
}

type CompactSchedulerOrder = {
  id: string;
  partNumber?: string;
  client?: string;
  plannedDate?: string | null;
  assignedDay?: string;
  deliveryDate?: string;
  planMinutes?: number;
  totalHours?: number;
  taskStatus?: string;
  isUrgent?: boolean;
  scheduleEligible?: boolean;
  isDrawingReady?: boolean;
  isMaterialReady?: boolean;
};

function parseCompactOrders(context: string): CompactSchedulerOrder[] {
  try {
    const parsed = JSON.parse(context) as { orders?: unknown };
    if (!Array.isArray(parsed.orders)) return [];
    return parsed.orders.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      const id = String(row.id ?? '').trim();
      if (!id) return [];
      return [
        {
          id,
          partNumber: String(row.partNumber ?? '').trim(),
          client: String(row.client ?? '').trim(),
          plannedDate: typeof row.plannedDate === 'string' ? row.plannedDate : undefined,
          assignedDay: String(row.assignedDay ?? '').trim(),
          deliveryDate: String(row.deliveryDate ?? '').trim(),
          planMinutes: Number(row.planMinutes ?? row.totalHours ?? 0) || 0,
          totalHours: Number(row.totalHours ?? row.planMinutes ?? 0) || 0,
          taskStatus: String(row.taskStatus ?? '').trim(),
          isUrgent: row.isUrgent === true,
          scheduleEligible: row.scheduleEligible === true,
          isDrawingReady: row.isDrawingReady === true,
          isMaterialReady: row.isMaterialReady === true,
        },
      ];
    });
  } catch {
    return [];
  }
}

function buildWeekDates(): Record<ChineseScheduleDay, string> {
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const day = local.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(local);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(local.getDate() + mondayOffset);
  return CHINESE_SCHEDULE_DAYS.reduce(
    (acc, label, index) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + index);
      acc[label] = d.toISOString().slice(0, 10);
      return acc;
    },
    {} as Record<ChineseScheduleDay, string>
  );
}

function buildRuleSchedulePlan(
  orders: CompactSchedulerOrder[],
  currentBaseLimit: number,
  planNotice?: string,
  intent: ScheduleIntent = extractScheduleIntent('')
): { schedulePlan: AiSchedulePlan; proposedMutations: AiCopilotMutation[]; plannerReport: AiPlannerReport } {
  const balanced = buildBalancedSchedulePlan({
    orders: orders as BalancedScheduleOrderLike[],
    targetDays: intent.targetDays,
    averageToleranceMinutes: intent.toleranceMinutes,
    allowRescheduleAssigned: intent.allowRescheduleAssigned,
  });
  const weekDates = buildWeekDates();
  const schedulePlan: AiSchedulePlan = {
    ...balanced.schedulePlan,
    items: balanced.schedulePlan.items.map((item) => ({
      ...item,
      targetDate: weekDates[item.targetDay as ChineseScheduleDay],
      reason: item.reason,
    })),
  };
  const proposedMutations: AiCopilotMutation[] = schedulePlan.items.map((item) => ({
    type: 'ASSIGN_ORDER_DAY',
    orderId: item.orderId,
    assignedDay: item.targetDay,
    reason: item.reason,
  }));

  const plannerReport: AiPlannerReport = {
    conclusion: `${planNotice ? `${planNotice} ` : ''}${schedulePlan.summary}`,
    priorityActions: [
      {
        level: schedulePlan.items.length ? 'MUST' : 'WATCH',
        title: schedulePlan.items.length ? '人工确认排产草案后执行' : '先补齐可排产订单条件',
        reason: schedulePlan.items.length
          ? '排产草案只会在人工确认后写入；后端仍会校验图纸/物料状态。'
          : '没有可排产订单时，AI 只能给出分析，不能生成有效写入动作。',
        relatedOrderIds: schedulePlan.items.slice(0, 20).map((item) => item.orderId),
      },
    ],
    blockedGroups: [
      {
        reasonType: 'OTHER',
        count:
          (schedulePlan.candidateSummary?.excludedByDrawing ?? 0) +
          (schedulePlan.candidateSummary?.excludedByMaterial ?? 0) +
          (schedulePlan.candidateSummary?.excludedByDoneArchivedDeleted ?? 0),
        orderIds: [],
        suggestion: '图纸未发、物料未齐、已完成、已归档或已删除的订单不会进入本次排产草案。',
      },
    ],
    questionsForHuman: [
      {
        question: '是否确认按该草案把可排产订单写入周一到周六？',
        whyItMatters: '写入排产会改变看板排产日，必须由计划员人工确认。',
        relatedOrderIds: schedulePlan.items.slice(0, 20).map((item) => item.orderId),
        suggestedOwner: '生产计划员',
      },
    ],
  };

  return { schedulePlan, proposedMutations, plannerReport };
}

function friendlyRuleScheduleNotice(reason?: string): string | null {
  const text = String(reason ?? '').trim();
  if (!text) return null;
  if (/Key|密钥|未配置/.test(text)) {
    return '当前未启用 AI 模型，系统已根据当前订单、交期、工时和产能生成排产建议。';
  }
  if (/格式|JSON|输出|返回|解析/.test(text)) {
    return 'AI 返回内容未形成标准排产草案，系统已根据当前订单、交期、工时和产能重新生成规则排产建议。';
  }
  if (/接口|连接|响应|业务错误|HTTP/.test(text)) {
    return 'AI 服务暂时不可用，系统已根据当前订单、交期、工时和产能生成排产建议。';
  }
  return '系统已根据当前订单、交期、工时和产能生成排产建议。';
}

function withRuleSchedulePlan(
  result: AiCopilotResponse,
  context: string,
  currentBaseLimit: number,
  shouldBuild: boolean,
  reasonPrefix?: string,
  intent: ScheduleIntent = extractScheduleIntent('')
): AiCopilotResponse {
  if (!shouldBuild) {
    return result;
  }
  const notice = friendlyRuleScheduleNotice(reasonPrefix);
  const rule = buildRuleSchedulePlan(parseCompactOrders(context), currentBaseLimit, notice ?? undefined, intent);
  return {
    ...result,
    reply: `${result.reply}\n\n${notice ? `${notice}\n\n` : ''}${rule.schedulePlan.summary}`,
    proposedMutations: [
      ...result.proposedMutations.filter((mutation) => mutation.type !== 'ASSIGN_ORDER_DAY' && mutation.type !== 'UPDATE_ORDER_DATE'),
      ...rule.proposedMutations,
    ],
    plannerReport: result.plannerReport ?? rule.plannerReport,
    schedulePlan: rule.schedulePlan,
    unreasonableAlerts: uniqueNonEmpty([...result.unreasonableAlerts, ...rule.schedulePlan.warnings]),
  };
}

function withScheduleValidation(result: AiCopilotResponse, context: string, intent: ScheduleIntent): AiCopilotResponse {
  if (!intent.wantsScheduling || !result.schedulePlan) return result;
  const orders = parseCompactOrders(context) as BalancedScheduleOrderLike[];
  const validation = validateAiSchedulePlan({
    schedulePlan: result.schedulePlan as BalancedSchedulePlan,
    orders,
    averageToleranceMinutes: intent.toleranceMinutes,
    allowOverAverageTolerance: intent.allowOverAverageTolerance,
    allowRescheduleAssigned: intent.allowRescheduleAssigned,
    dueDateFirst: intent.dueDateFirst,
  });
  if (validation.ok) {
    return {
      ...result,
      schedulePlanValidation: validation,
      unreasonableAlerts: uniqueNonEmpty([...result.unreasonableAlerts, ...validation.warnings.map((item) => item.message)]),
    };
  }
  return {
    ...result,
    schedulePlanValidation: validation,
    proposedMutations: result.proposedMutations.filter((mutation) => mutation.type !== 'ASSIGN_ORDER_DAY' && mutation.type !== 'UPDATE_ORDER_DATE'),
    unreasonableAlerts: uniqueNonEmpty([...validation.errors.map((item) => item.message), ...result.unreasonableAlerts]),
  };
}

function withUiContextScheduleNotes(result: AiCopilotResponse, uiContext?: AiPlannerUiContext): AiCopilotResponse {
  if (!result.schedulePlan || uiContext?.planWeekSelected !== false) return result;
  const message = '当前未选择计划归属周，本次仅基于当前看板进行排产建议。';
  return {
    ...result,
    unreasonableAlerts: uniqueNonEmpty([message, ...result.unreasonableAlerts]),
    schedulePlan: {
      ...result.schedulePlan,
      warnings: uniqueNonEmpty([message, ...result.schedulePlan.warnings]),
    },
  };
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function uniqueNonEmpty(items: string[]): string[] {
  return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))];
}

function withContextWarnings(result: AiCopilotResponse, warnings: string[]): AiCopilotResponse {
  return {
    ...result,
    unreasonableAlerts: uniqueNonEmpty([...warnings, ...result.unreasonableAlerts]),
  };
}

function extractJsonObjectText(raw: string): string {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(trimmed);
  if (fence) return fence[1].trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

const CHINESE_SCHEDULE_DAYS = ['周一', '周二', '周三', '周四', '周五', '周六'] as const;
const ENGLISH_SCHEDULE_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

type ChineseScheduleDay = (typeof CHINESE_SCHEDULE_DAYS)[number];

function normalizeScheduleDay(value: unknown): { chinese: ChineseScheduleDay; assignedDay: string } | null {
  const text = String(value ?? '').trim();
  const aliases: Record<string, ChineseScheduleDay> = {
    周一: '周一',
    星期一: '周一',
    Monday: '周一',
    monday: '周一',
    Mon: '周一',
    mon: '周一',
    周二: '周二',
    星期二: '周二',
    Tuesday: '周二',
    tuesday: '周二',
    Tue: '周二',
    tue: '周二',
    周三: '周三',
    星期三: '周三',
    Wednesday: '周三',
    wednesday: '周三',
    Wed: '周三',
    wed: '周三',
    周四: '周四',
    星期四: '周四',
    Thursday: '周四',
    thursday: '周四',
    Thu: '周四',
    thu: '周四',
    周五: '周五',
    星期五: '周五',
    Friday: '周五',
    friday: '周五',
    Fri: '周五',
    fri: '周五',
    周六: '周六',
    星期六: '周六',
    Saturday: '周六',
    saturday: '周六',
    Sat: '周六',
    sat: '周六',
  };
  const chinese = aliases[text];
  if (!chinese) return null;
  const index = CHINESE_SCHEDULE_DAYS.indexOf(chinese);
  return { chinese, assignedDay: ENGLISH_SCHEDULE_DAYS[index] };
}

function assignedDayFromYmd(ymd: string): string {
  const weekday = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: 'Asia/Shanghai',
  }).format(new Date(`${ymd}T00:00:00+08:00`));
  const allowed = new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
  return allowed.has(weekday) ? weekday : 'Unscheduled';
}

function isSchedulePlanningPrompt(prompt: string): boolean {
  return /排单|排产|安排|重排|重新排|调整|平衡|优化|周一|周二|周三|周四|周五|周六|按交期排|按工时排|一键排|帮我排产|生成本周排产建议|排到周/.test(prompt);
}

type ScheduleIntent = {
  wantsScheduling: boolean;
  dueDateFirst: boolean;
  allowOverAverageTolerance: boolean;
  allowRescheduleAssigned: boolean;
  toleranceMinutes: number;
  targetDays: string[];
};

function extractScheduleIntent(userPrompt: string): ScheduleIntent {
  const prompt = String(userPrompt ?? '');
  const toleranceMatch = /(?:上下浮动|浮动|±)\s*(\d{2,5})/.exec(prompt);
  const wantsScheduling = isSchedulePlanningPrompt(prompt);
  const keepScheduledFixed = /不要动已排|不动已排|不要调整已排|保留已排|只排待排|只排未排|只看就绪待排|只排就绪待排|只处理待排池|只处理未排/.test(prompt);
  return {
    wantsScheduling,
    dueDateFirst: /交期优先|按交期|交期一定优先|交期从早到晚|交期升序/.test(prompt) || wantsScheduling,
    allowOverAverageTolerance: /允许超负荷|允许加班|可超产能|超出工时也可以|允许超出/.test(prompt),
    allowRescheduleAssigned: wantsScheduling && !keepScheduledFixed,
    toleranceMinutes: toleranceMatch ? Math.max(0, Math.round(Number(toleranceMatch[1]) || 500)) : 500,
    targetDays: ['周一', '周二', '周三', '周四', '周五', '周六'],
  };
}

function normalizeAiPayload(raw: unknown): AiCopilotResponse {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const mutations = Array.isArray(obj.proposedMutations) ? obj.proposedMutations : [];
  const safeMutations: AiCopilotMutation[] = mutations.flatMap((m) => {
    if (!m || typeof m !== 'object') return [];
    const item = m as Record<string, unknown>;
    const type = String(item.type ?? '').trim();

    if ((type === 'UPDATE_ORDER_DATE' || type === 'UPDATE_DELIVERY_DATE') && isIsoDate(item.newDate)) {
      const orderId = String(item.orderId ?? '').trim();
      if (!orderId) return [];
      return [{ type, orderId, newDate: item.newDate.trim() } as AiCopilotMutation];
    }

    if (type === 'ASSIGN_ORDER_DAY') {
      const orderId = String(item.orderId ?? '').trim();
      const day = normalizeScheduleDay(item.assignedDay ?? item.targetDay);
      const plannedDate = isIsoDate(item.plannedDate ?? item.targetDate) ? String(item.plannedDate ?? item.targetDate).trim() : undefined;
      const reason = String(item.reason ?? '').trim();
      if (!orderId || !day) return [];
      return [
        {
          type: 'ASSIGN_ORDER_DAY',
          orderId,
          assignedDay: day.chinese,
          ...(plannedDate ? { plannedDate } : {}),
          ...(reason ? { reason } : {}),
        },
      ];
    }

    if (type === 'LOG_EXCEPTION_HOUR') {
      const minutes = Math.max(1, Math.round(Number(item.minutes) || 0));
      const reason = String(item.reason ?? '').trim();
      const orderId = String(item.orderId ?? '').trim();
      if (!minutes || !reason) return [];
      return [{ type, minutes, reason, ...(orderId ? { orderId } : {}) }];
    }

    return [];
  });

  const exportRows = Array.isArray(obj.exportDataSummary) ? obj.exportDataSummary : [];
  const rawReport = obj.plannerReport && typeof obj.plannerReport === 'object' ? (obj.plannerReport as Record<string, unknown>) : null;
  const rawSchedulePlan = obj.schedulePlan && typeof obj.schedulePlan === 'object' ? (obj.schedulePlan as Record<string, unknown>) : null;
  const rawScheduleItems = Array.isArray(rawSchedulePlan?.items) ? rawSchedulePlan.items : [];
  const scheduleItems: AiSchedulePlanItem[] = rawScheduleItems.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const orderId = String(row.orderId ?? '').trim();
    const day = normalizeScheduleDay(row.targetDay ?? row.assignedDay);
    if (!orderId || !day) return [];
    const targetDate = isIsoDate(row.targetDate ?? row.plannedDate) ? String(row.targetDate ?? row.plannedDate).trim() : undefined;
    return [
      {
        orderId,
        targetDay: day.chinese,
        ...(targetDate ? { targetDate } : {}),
        reason: String(row.reason ?? '按交期和产能建议排产').trim(),
        estimatedMinutes: row.estimatedMinutes == null ? undefined : Math.max(0, Math.round(Number(row.estimatedMinutes) || 0)),
        priorityRank: row.priorityRank == null ? undefined : Math.max(1, Math.round(Number(row.priorityRank) || 1)),
      },
    ];
  });
  if (scheduleItems.length && !safeMutations.some((m) => m.type === 'ASSIGN_ORDER_DAY' || m.type === 'UPDATE_ORDER_DATE')) {
    safeMutations.push(
      ...scheduleItems.map((item) => ({
        type: 'ASSIGN_ORDER_DAY' as const,
        orderId: item.orderId,
        assignedDay: item.targetDay,
        ...(item.targetDate ? { plannedDate: item.targetDate } : {}),
        reason: item.reason,
      }))
    );
  }
  const priorityActions = Array.isArray(rawReport?.priorityActions) ? rawReport.priorityActions : [];
  const blockedGroups = Array.isArray(rawReport?.blockedGroups) ? rawReport.blockedGroups : [];
  const questionsForHuman = Array.isArray(rawReport?.questionsForHuman) ? rawReport.questionsForHuman : [];

  return {
    reply: String(obj.reply ?? 'AI 已完成推演，但返回内容缺少可展示摘要。'),
    unreasonableAlerts: Array.isArray(obj.unreasonableAlerts)
      ? obj.unreasonableAlerts.map((x) => String(x)).filter(Boolean)
      : ['AI 返回内容缺少合理性审查字段'],
    proposedMutations: safeMutations,
    exportDataSummary: exportRows.map((row) => {
      const r = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
      return {
        型号: String(r['型号'] ?? r['model'] ?? r['partNumber'] ?? ''),
        状态: String(r['状态'] ?? r['status'] ?? ''),
        计划工时: Number(r['计划工时'] ?? r['planMinutes'] ?? r['plannedMinutes'] ?? 0),
        交期风险: String(r['交期风险'] ?? r['deliveryRisk'] ?? ''),
      };
    }),
    plannerReport: rawReport
      ? {
          conclusion: String(rawReport.conclusion ?? obj.reply ?? 'AI 计划员工已完成分析。'),
          priorityActions: priorityActions.flatMap((action) => {
            const a = action && typeof action === 'object' ? (action as Record<string, unknown>) : {};
            const level = String(a.level ?? 'WATCH').trim();
            if (!['MUST', 'SHOULD', 'WATCH'].includes(level)) return [];
            return [
              {
                level: level as 'MUST' | 'SHOULD' | 'WATCH',
                title: String(a.title ?? '计划动作'),
                reason: String(a.reason ?? ''),
                relatedOrderIds: Array.isArray(a.relatedOrderIds) ? a.relatedOrderIds.map((id) => String(id)).filter(Boolean) : undefined,
              },
            ];
          }),
          blockedGroups: blockedGroups.flatMap((group) => {
            const g = group && typeof group === 'object' ? (group as Record<string, unknown>) : {};
            const reasonType = String(g.reasonType ?? 'OTHER').trim();
            if (!['DRAWING_NOT_READY', 'MATERIAL_NOT_READY', 'DATA_INCOMPLETE', 'OTHER'].includes(reasonType)) return [];
            return [
              {
                reasonType: reasonType as 'DRAWING_NOT_READY' | 'MATERIAL_NOT_READY' | 'DATA_INCOMPLETE' | 'OTHER',
                count: Math.max(0, Math.round(Number(g.count) || 0)),
                orderIds: Array.isArray(g.orderIds) ? g.orderIds.map((id) => String(id)).filter(Boolean) : [],
                suggestion: String(g.suggestion ?? ''),
              },
            ];
          }),
          questionsForHuman: questionsForHuman.flatMap((question) => {
            const q = question && typeof question === 'object' ? (question as Record<string, unknown>) : {};
            const text = String(q.question ?? '').trim();
            if (!text) return [];
            return [
              {
                question: text,
                whyItMatters: String(q.whyItMatters ?? ''),
                relatedOrderIds: Array.isArray(q.relatedOrderIds) ? q.relatedOrderIds.map((id) => String(id)).filter(Boolean) : undefined,
                suggestedOwner: q.suggestedOwner ? String(q.suggestedOwner) : undefined,
              },
            ];
          }),
        }
      : undefined,
    schedulePlan: rawSchedulePlan
      ? {
          title: String(rawSchedulePlan.title ?? '本周排产草案'),
          summary: String(rawSchedulePlan.summary ?? `已生成 ${scheduleItems.length} 条排产建议。`),
          items: scheduleItems,
          warnings: Array.isArray(rawSchedulePlan.warnings) ? rawSchedulePlan.warnings.map((item) => String(item)).filter(Boolean) : [],
        }
      : undefined,
  };
}

async function buildSchedulerContext(currentBaseLimit: number): Promise<SchedulerContextBuildResult> {
  const warnings: string[] = [];

  let orders: Array<{
    id: string;
    model: string;
    client: string;
    plannedDate: string | null;
    assignedDay: string;
    deliveryDate: string;
    totalQty: number;
    reportedQty: number;
    qty: number;
    totalHours: number;
    taskStatus: string;
    isUrgent: boolean;
    isMaterialReady: boolean;
    isDrawingReady: boolean;
  }>;

  try {
    orders = await prisma.order.findMany({
      where: {
        deletedAt: null,
        isArchived: false,
        taskStatus: { in: ['normal', 'PENDING', 'SCHEDULED', 'IN_PROGRESS', 'PAUSED', 'anomaly', 'Rework'] },
      },
      orderBy: [{ deliveryDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        model: true,
        client: true,
        plannedDate: true,
        assignedDay: true,
        deliveryDate: true,
        totalQty: true,
        reportedQty: true,
        qty: true,
        totalHours: true,
        taskStatus: true,
        isUrgent: true,
        isMaterialReady: true,
        isDrawingReady: true,
      },
    });
  } catch (error) {
    throw new Error(`订单排产上下文读取失败：${safeErrorMessage(error)}`);
  }

  let exceptions: Array<{
    id: string;
    orderId: string;
    workerName: string;
    claimedHours: number;
    reason: string;
    status: string;
    createdAt: Date;
    order: { model: string };
  }> = [];

  try {
    exceptions = await prisma.mesAbnormalClaim.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        orderId: true,
        workerName: true,
        claimedHours: true,
        reason: true,
        status: true,
        createdAt: true,
        order: { select: { model: true } },
      },
    });
  } catch (error) {
    console.error('[buildSchedulerContext] MesAbnormalClaim context unavailable:', error);
    warnings.push(ABNORMAL_CLAIM_CONTEXT_WARNING);
  }

  const todayYmd = new Date().toISOString().slice(0, 10);
  const blockedByDrawing = orders.filter((o) => getScheduleBlockReasons(o).includes('DRAWING_NOT_READY')).length;
  const blockedByMaterial = orders.filter(
    (o) =>
      !getScheduleBlockReasons(o).includes('DRAWING_NOT_READY') &&
      getScheduleBlockReasons(o).includes('MATERIAL_NOT_READY')
  ).length;
  const summary: AiCopilotContextSummary = {
    totalOrders: orders.length,
    schedulableOrders: orders.filter((o) => canEnterSchedule(o)).length,
    blockedByDrawing,
    blockedByMaterial,
    scheduledOrders: orders.filter((o) => isScheduleAssigned(o)).length,
    urgentOrders: orders.filter((o) => o.isUrgent).length,
    riskOrders: orders.filter((o) => {
      const deliveryDate = String(o.deliveryDate ?? '').trim();
      if (!deliveryDate) return false;
      return deliveryDate < todayYmd && !isScheduleAssigned(o);
    }).length,
    dailyCapacity: currentBaseLimit,
    contextWarnings: warnings,
  };

  const context = JSON.stringify({
    currentBaseLimit,
    contextWarnings: warnings,
    contextSummary: summary,
    orders: orders.map((o) => {
      const totalQuantity = Number(o.totalQty || o.qty || 1);
      const planMinutes = Number(o.totalHours) || 0;
      return {
        id: o.id,
        partNumber: o.model,
        client: o.client,
        plannedDate: o.plannedDate,
        assignedDay: o.assignedDay,
        deliveryDate: o.deliveryDate,
        totalQuantity,
        actualQuantity: Number(o.reportedQty) || 0,
        unitTime: totalQuantity > 0 ? Number((planMinutes / totalQuantity).toFixed(2)) : planMinutes,
        planMinutes,
        taskStatus: o.taskStatus,
        isUrgent: o.isUrgent,
        isMaterialReady: o.isMaterialReady,
        isDrawingReady: o.isDrawingReady,
        scheduleEligible: canEnterSchedule(o),
        blockReasons: getScheduleBlockReasons(o),
        requiredPool: getRequiredPool(o),
      };
    }),
    exceptionHourLedger: exceptions.map((e) => ({
      id: e.id,
      orderId: e.orderId,
      partNumber: e.order.model,
      workerName: e.workerName,
      minutes: Math.round(Number(e.claimedHours) * 60),
      reason: e.reason,
      status: e.status,
      createdAt: e.createdAt.toISOString(),
    })),
  });

  return { context, warnings, summary };
}

export async function interactWithAiCopilotAction(
  userPrompt: string,
  currentBaseLimit = 1500,
  uiContext?: AiPlannerUiContext
): Promise<AiCopilotActionResult> {
  const startTime = Date.now();
  const prompt = String(userPrompt ?? '').trim();
  const sanitizedUiContext = sanitizeUiContext(uiContext);
  if (!prompt) {
    return {
      ok: false,
      error: '请输入 AI 排单指令后再执行。',
      data: fallbackAiCopilotResponse('请输入 AI 排单指令后再执行。', ['用户指令为空，未触发 AI 排单'], undefined, sanitizedUiContext),
    };
  }

  let contextResult: SchedulerContextBuildResult;
  try {
    contextResult = await buildSchedulerContext(currentBaseLimit);
  } catch (dbError) {
    const message = safeErrorMessage(dbError);
    console.error('[interactWithAiCopilotAction] Prisma order context query failed:', dbError);
    return {
      ok: false,
      error: '数据库连接失败或订单排产表不可用，AI 排单无法读取核心上下文。',
      data: fallbackAiCopilotResponse(
        `AI 排单执行失败：数据库连接或订单排产上下文读取异常。请检查 DATABASE_URL、Prisma 连接和 Order 表结构。详情：${message.slice(0, 180)}`,
        ['数据库连接失败或 Order 表不可用，无法读取当前排产上下文'],
        undefined,
        sanitizedUiContext
      ),
      rawModelPreview: message.slice(0, 500),
    };
  }

  const scheduleIntent = extractScheduleIntent(prompt);
  const shouldBuildSchedulePlan = scheduleIntent.wantsScheduling;
  const apiKey = (process.env.DEEPSEEK_API_KEY ?? '').trim();
  if (!apiKey) {
    const reply = '当前未启用 AI 模型，系统将依据已保存订单、交期、工时和产能生成计划建议。';
    const data = withRuleSchedulePlan(
      fallbackAiCopilotResponse(reply, ['当前未启用 AI 模型，已改用系统排产规则生成建议'], contextResult.summary, sanitizedUiContext),
      contextResult.context,
      currentBaseLimit,
      shouldBuildSchedulePlan,
      'AI 模型未启用',
      scheduleIntent
    );
    return {
      ok: true,
      data: withContextWarnings(withUiContextScheduleNotes(withScheduleValidation(data, contextResult.context, scheduleIntent), sanitizedUiContext), contextResult.warnings),
      contextSummary: contextResult.summary,
      audit: { enabled: false, persistenceWarning: '当前未启用 AI 模型，本次不会创建 AI 审计记录' },
    };
  }

  const contextHash = hashJson(contextResult.context);
  const compactContextJson = (() => {
    try {
      return {
        ...(JSON.parse(contextResult.context) as Record<string, unknown>),
        currentUserPageContext: sanitizedUiContext,
      };
    } catch {
      return { rawContextHash: contextHash, currentUserPageContext: sanitizedUiContext };
    }
  })();
  const auditRun = await createAiPlannerRunSafe({
    status: 'ANALYZING',
    userPrompt: prompt,
    provider: 'DeepSeek',
    model: DEEPSEEK_MODEL,
    contextSummaryJson: contextResult.summary,
    contextHash,
  });
  const audit: AiPlannerAuditRef = auditRun.ok
    ? { enabled: true, aiRunId: auditRun.data.id }
    : { enabled: false, persistenceWarning: auditRun.reason };
  if (audit.aiRunId) {
    await saveAiContextSnapshotSafe({
      aiRunId: audit.aiRunId,
      snapshotType: 'SCHEDULER_CONTEXT',
      orderCount: contextResult.summary.totalOrders,
      contentHash: contextHash,
      contentJson: compactContextJson as Prisma.InputJsonValue,
    });
  }

  const finishAudit = async (
    status: 'COMPLETED' | 'FAILED',
    payload: {
      responseJson?: unknown;
      replyText?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    }
  ) => {
    if (!audit.aiRunId) return;
    const result = await completeAiPlannerRunSafe({
      aiRunId: audit.aiRunId,
      status,
      responseJson: payload.responseJson as Prisma.InputJsonValue,
      replyText: payload.replyText ?? null,
      durationMs: Date.now() - startTime,
      errorCode: payload.errorCode ?? null,
      errorMessage: payload.errorMessage ?? null,
    });
    if (!result.ok && audit.enabled) {
      audit.enabled = false;
      audit.persistenceWarning = result.reason;
    }
  };

  const pageContextText = JSON.stringify(sanitizedUiContext ?? { unavailable: true });
  const scheduleInstruction =
    '排产任务硬要求：当用户要求排单、排产、重排、调整、平衡、优化、按交期排、安排到周一到周六或生成本周排产建议时，必须返回 schedulePlan 和 proposedMutations。AI 计划员的候选范围默认是全周可排订单：就绪待排池 + 周一到周六已排产订单；除非用户明确说不要动已排订单或只排待排池，否则可以重新移动已排订单。schedulePlan.items 的 targetDay 只能是周一、周二、周三、周四、周五、周六。对应 proposedMutations 请使用 { "type": "ASSIGN_ORDER_DAY", "orderId": "...", "assignedDay": "周一", "plannedDate": "YYYY-MM-DD", "reason": "..." }。只允许选择 scheduleEligible=true 的订单；图纸未下发不得排产；物料未齐不得排产；已完成、已归档、已删除订单不得排产；SOP 缺失只提醒，不拦截；不能编造不存在的订单 ID；每条建议必须说明原因；所有写入都必须等待人工确认，后端仍会重新校验 canEnterSchedule。schedulePlan JSON 结构为 { "title": "本周排产草案", "summary": "...", "items": [{ "orderId": "...", "targetDay": "周一", "targetDate": "YYYY-MM-DD", "reason": "...", "estimatedMinutes": 120, "priorityRank": 1 }], "warnings": [] }。';
  const balancedScheduleInstruction =
    '专业均衡排产规则：生成排产草案时必须严格按交期从早到晚；不允许后交期订单排到前交期订单前面；同一天交期内，工时高的订单优先；先计算本周候选订单总工时，再用总工时除以 6 得到日均目标；每天负荷尽量围绕日均目标上下浮动 500 分钟；大单可以造成单日适度超出，但不能把大量订单堆到某一天；不允许前几天低负荷、最后一天严重爆仓；不允许周六负荷远高于其他天。如果无法同时满足交期和均衡，必须说明冲突，不要硬生成可执行草案。';
  const system =
    '系统级硬规则：图纸未下发禁止排产，必须保留在技术攻坚池；配料未齐禁止排产，必须保留在仓库配料池；只有 scheduleEligible=true 才允许生成 UPDATE_ORDER_DATE。SOP 未上传仅作为文档提醒，不作为排产拦截条件。违反这些规则的建议会被后端拒绝执行。\n\n' +
    '你是一个严谨的生产计划员工，不是闲聊助手。当前系统时间为 2026年5月11日。请阅读系统提供的当前车间排单上下文、每日产能基准以及异常工时台账，并理解用户的自然语言任务。\n' +
    '工作原则：风险必须分级；建议动作必须说明原因；数据不足时提出问题，不得编造；你不能直接修改数据库，只能提出建议；涉及写入必须等待人工确认并接受后端 canEnterSchedule 二次校验。\n' +
    '请执行以下运筹推演：\n' +
    '1. 回应用户的具体诉求，并在虚拟沙盘中推演调整后的结果。\n' +
    '2. 严格审查本周排盘合理性，指出所有不合理状态（如某日工时溢出上限、交期倒挂违约等）。\n' +
    '3. 如果用户指令包含记录异常工时，请提取相应的分钟数和原因。\n\n' +
    '当前用户页面上下文会在 user message 中提供。页面上下文用于理解用户当前视角；真实排产资格以服务端数据库重新计算为准；不得因为前端上下文绕过图纸/物料硬规则。\n\n' +
    '务必返回严格且纯净的 JSON 对象，绝不包含任何 Markdown 标记、解释文字或思维链。JSON 结构必须严格如下：\n' +
    '{\n' +
    '  "reply": "对老板自然语言指令的专业回复与当前大盘评估摘要（直接可用作 UI 文本）",\n' +
    '  "unreasonableAlerts": ["具体的不合理点预警1", "具体预警2"],\n' +
    '  "proposedMutations": [\n' +
    '    { "type": "UPDATE_ORDER_DATE", "orderId": "...", "newDate": "YYYY-MM-DD" },\n' +
    '    { "type": "UPDATE_DELIVERY_DATE", "orderId": "...", "newDate": "YYYY-MM-DD" },\n' +
    '    { "type": "LOG_EXCEPTION_HOUR", "minutes": 120, "reason": "故障原因" }\n' +
    '  ],\n' +
    '  "exportDataSummary": [\n' +
    '    { "型号": "...", "状态": "超负荷/正常", "计划工时": 1500, "交期风险": "高/低" }\n' +
    '  ],\n' +
    '  "plannerReport": {\n' +
    '    "conclusion": "生产计划员口吻的本轮结论",\n' +
    '    "priorityActions": [\n' +
    '      { "level": "MUST", "title": "必须处理的动作", "reason": "原因", "relatedOrderIds": ["订单ID"] },\n' +
    '      { "level": "SHOULD", "title": "建议处理的动作", "reason": "原因", "relatedOrderIds": [] },\n' +
    '      { "level": "WATCH", "title": "持续观察的动作", "reason": "原因", "relatedOrderIds": [] }\n' +
    '    ],\n' +
    '    "blockedGroups": [\n' +
    '      { "reasonType": "DRAWING_NOT_READY", "count": 0, "orderIds": [], "suggestion": "技术/工程处理建议" },\n' +
    '      { "reasonType": "MATERIAL_NOT_READY", "count": 0, "orderIds": [], "suggestion": "仓库/采购处理建议" },\n' +
    '      { "reasonType": "DATA_INCOMPLETE", "count": 0, "orderIds": [], "suggestion": "数据补齐建议" },\n' +
    '      { "reasonType": "OTHER", "count": 0, "orderIds": [], "suggestion": "其他处理建议" }\n' +
    '    ],\n' +
    '    "questionsForHuman": [\n' +
    '      { "question": "需要主管确认的问题", "whyItMatters": "为什么重要", "relatedOrderIds": [], "suggestedOwner": "建议负责人" }\n' +
    '    ]\n' +
    '  }\n' +
    '}';

  try {
    const res = await fetch(DEEPSEEK_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `${system}\n\n${scheduleInstruction}\n\n${balancedScheduleInstruction}` },
          {
            role: 'user',
            content: `当前排产上下文 JSON：${contextResult.context}\n\n当前用户页面上下文 JSON：${pageContextText}\n\n用户自然语言指令：${prompt}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      console.error('DeepSeek API 响应失败:', res.status, errorText);
      const data = withRuleSchedulePlan(
        fallbackAiCopilotResponse(
          `AI 调度大脑响应异常 (HTTP ${res.status})。请检查 API 密钥、模型权限或账户余额。`,
          ['AI 服务暂时不可用，已根据当前订单、交期、工时和产能生成排产建议'],
          contextResult.summary,
          sanitizedUiContext
        ),
        contextResult.context,
        currentBaseLimit,
        shouldBuildSchedulePlan,
        'AI 服务暂时不可用',
        scheduleIntent
      );
      return {
        ok: true,
        data: withContextWarnings(withUiContextScheduleNotes(withScheduleValidation(data, contextResult.context, scheduleIntent), sanitizedUiContext), contextResult.warnings),
        contextSummary: contextResult.summary,
        rawModelPreview: errorText.slice(0, 500),
      };
    }

    let body: DeepSeekChatBody;
    try {
      body = (await res.json()) as DeepSeekChatBody;
    } catch (jsonError) {
      const message = safeErrorMessage(jsonError);
      console.error('DeepSeek API 响应不是合法 JSON:', jsonError);
      const data = withRuleSchedulePlan(
        fallbackAiCopilotResponse('AI 返回内容未形成标准排产草案，系统已根据当前订单、交期、工时和产能重新生成规则排产建议。', ['AI 返回内容未形成标准排产草案，已重新生成排产建议'], contextResult.summary, sanitizedUiContext),
        contextResult.context,
        currentBaseLimit,
        shouldBuildSchedulePlan,
        'AI 返回内容未形成标准排产草案',
        scheduleIntent
      );
      return {
        ok: true,
        data: withContextWarnings(withUiContextScheduleNotes(withScheduleValidation(data, contextResult.context, scheduleIntent), sanitizedUiContext), contextResult.warnings),
        contextSummary: contextResult.summary,
        rawModelPreview: message.slice(0, 500),
      };
    }

    if (body.error?.message) {
      console.error('DeepSeek API 返回业务错误:', body.error.message);
      const data = withRuleSchedulePlan(
        fallbackAiCopilotResponse(
          `AI 调度大脑返回错误：${body.error.message.slice(0, 180)}。请检查 API 密钥、模型权限或账户余额。`,
          ['AI 服务暂时不可用，已根据当前订单、交期、工时和产能生成排产建议'],
          contextResult.summary,
          sanitizedUiContext
        ),
        contextResult.context,
        currentBaseLimit,
        shouldBuildSchedulePlan,
        'AI 服务暂时不可用',
        scheduleIntent
      );
      return {
        ok: true,
        data: withContextWarnings(withUiContextScheduleNotes(withScheduleValidation(data, contextResult.context, scheduleIntent), sanitizedUiContext), contextResult.warnings),
        contextSummary: contextResult.summary,
        rawModelPreview: body.error.message.slice(0, 500),
      };
    }

    const rawContent = body.choices?.[0]?.message?.content;
    if (!rawContent) {
      console.error('DeepSeek API 返回空内容:', body);
      const data = withRuleSchedulePlan(
        fallbackAiCopilotResponse('AI 调度大脑返回为空，未能自动渲染大盘。请稍后再试或换个说法。', [
          'AI 返回内容为空，已根据当前订单、交期、工时和产能生成排产建议',
        ], contextResult.summary, sanitizedUiContext),
        contextResult.context,
        currentBaseLimit,
        shouldBuildSchedulePlan,
        'AI 返回内容为空',
        scheduleIntent
      );
      return {
        ok: true,
        data: withContextWarnings(withUiContextScheduleNotes(withScheduleValidation(data, contextResult.context, scheduleIntent), sanitizedUiContext), contextResult.warnings),
        contextSummary: contextResult.summary,
      };
    }

    try {
      const parsedResult = JSON.parse(extractJsonObjectText(rawContent));
      const normalized = withRuleSchedulePlan(
        normalizeAiPayload(parsedResult),
        contextResult.context,
        currentBaseLimit,
        shouldBuildSchedulePlan,
        undefined,
        scheduleIntent
      );
      const data = withContextWarnings(
        withUiContextScheduleNotes(withScheduleValidation(
          normalized.plannerReport ? normalized : { ...normalized, plannerReport: buildFallbackPlannerReport(contextResult.summary, undefined, sanitizedUiContext) },
          contextResult.context,
          scheduleIntent
        ), sanitizedUiContext),
        contextResult.warnings
      );
      await finishAudit('COMPLETED', {
        responseJson: data as unknown as Record<string, unknown>,
        replyText: data.reply,
      });
      if (audit.aiRunId && data.proposedMutations.length > 0) {
        const suggestionsResult = await createAiSuggestionsSafe({
          aiRunId: audit.aiRunId,
          suggestions: data.proposedMutations.map((mutation, mutationIndex) => ({
            type: mutation.type,
            title: mutation.type === 'UPDATE_ORDER_DATE' ? '调整排产日期' : mutation.type === 'UPDATE_DELIVERY_DATE' ? '调整交期' : '记录异常工时',
            reason: mutation.type === 'LOG_EXCEPTION_HOUR' ? mutation.reason : undefined,
            targetOrderId: 'orderId' in mutation ? mutation.orderId : undefined,
            payloadJson: { ...mutation, mutationIndex },
          })),
        });
        if (!suggestionsResult.ok && audit.enabled) {
          audit.enabled = false;
          audit.persistenceWarning = suggestionsResult.reason;
        }
      }
      return {
        ok: true,
        data,
        contextSummary: contextResult.summary,
        rawModelPreview: rawContent.slice(0, 500),
        audit,
      };
    } catch (parseError) {
      console.error('AI 返回的数据无法解析为严格 JSON:', parseError);
      const data = withRuleSchedulePlan(
        fallbackAiCopilotResponse(
          'AI 返回内容未形成标准排产草案，系统已根据当前订单、交期、工时和产能重新生成规则排产建议。',
          ['AI 返回内容未形成标准排产草案，已重新生成排产建议'],
          contextResult.summary,
          sanitizedUiContext
        ),
        contextResult.context,
        currentBaseLimit,
        shouldBuildSchedulePlan,
        'AI 返回内容未形成标准排产草案',
        scheduleIntent
      );
      return {
        ok: true,
        data: withContextWarnings(withUiContextScheduleNotes(withScheduleValidation(data, contextResult.context, scheduleIntent), sanitizedUiContext), contextResult.warnings),
        contextSummary: contextResult.summary,
        rawModelPreview: rawContent.slice(0, 500),
      };
    }
  } catch (error) {
    const message = safeErrorMessage(error);
    console.error('[interactWithAiCopilotAction] DeepSeek request failed:', error);
    const data = withRuleSchedulePlan(
      fallbackAiCopilotResponse('AI 调度大脑连接异常。请检查网络、API 密钥或账户状态。', [
        'AI 服务暂时不可用，已根据当前订单、交期、工时和产能生成排产建议',
      ], contextResult.summary, sanitizedUiContext),
      contextResult.context,
      currentBaseLimit,
      shouldBuildSchedulePlan,
      'AI 服务暂时不可用',
      scheduleIntent
    );
    return {
      ok: true,
      data: withContextWarnings(withUiContextScheduleNotes(withScheduleValidation(data, contextResult.context, scheduleIntent), sanitizedUiContext), contextResult.warnings),
      contextSummary: contextResult.summary,
      rawModelPreview: message.slice(0, 500),
    };
  }
}

export async function generateRuleSchedulePlanAction(
  currentBaseLimit = 1500,
  uiContext?: AiPlannerUiContext
): Promise<AiCopilotActionResult> {
  const sanitizedUiContext = sanitizeUiContext(uiContext);
  try {
    const contextResult = await buildSchedulerContext(currentBaseLimit);
    const intent = extractScheduleIntent('把所有能排的订单统一按交期重新排，本周负荷尽量均衡，每天上下浮动500分钟');
    const rule = buildRuleSchedulePlan(parseCompactOrders(contextResult.context), currentBaseLimit, '已根据当前订单、交期、工时和产能生成排产建议。', intent);
    const data: AiCopilotResponse = withContextWarnings(
      withScheduleValidation(
        {
          reply: `已生成排产草案。${rule.schedulePlan.summary}` ,
          unreasonableAlerts: rule.schedulePlan.warnings,
          proposedMutations: rule.proposedMutations,
          exportDataSummary: [],
          plannerReport: rule.plannerReport,
          schedulePlan: rule.schedulePlan,
        },
        contextResult.context,
        intent
      ),
      contextResult.warnings
    );
    return {
      ok: true,
      data,
      contextSummary: contextResult.summary,
      audit: { enabled: false, persistenceWarning: '本次仅生成排产草案，不会创建 AI 审计记录' },
    };
  } catch (error) {
    const message = safeErrorMessage(error);
    return {
      ok: false,
      error: `生成规则排产草案失败：${message}`,
      data: fallbackAiCopilotResponse(
        `生成规则排产草案失败：${message.slice(0, 180)}`,
        ['规则排产草案生成失败，请检查数据库连接和订单表状态'],
        undefined,
        sanitizedUiContext
      ),
    };
  }
}

export async function executeAiCopilotMutationsAction(
  proposedMutations: AiCopilotMutation[],
  aiRunId?: string
): Promise<{
  ok: boolean;
  error?: string;
  updatedOrders: number;
  exceptionLogs: number;
  rejectedMutations?: Array<{ mutation: AiCopilotMutation; reason: string }>;
  unreasonableAlerts?: string[];
}> {
  const list = Array.isArray(proposedMutations) ? proposedMutations : [];
  let updatedOrders = 0;
  let exceptionLogs = 0;
  const rejectedMutations: Array<{ mutation: AiCopilotMutation; reason: string }> = [];
  const executionResults: Array<{ mutationIndex: number; status: 'EXECUTED' | 'BLOCKED' | 'FAILED'; reason?: string }> = [];

  try {
    await prisma.$transaction(async (tx) => {
      const fallbackOrder = await tx.order.findFirst({
        where: { deletedAt: null, isArchived: false },
        orderBy: [{ deliveryDate: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      });

      for (const [mutationIndex, m] of list.entries()) {
        if (m.type === 'ASSIGN_ORDER_DAY') {
          const day = normalizeScheduleDay(m.assignedDay);
          if (!day || !m.orderId) {
            rejectedMutations.push({ mutation: m, reason: '目标排产日无效，系统只允许周一到周六。' });
            executionResults.push({ mutationIndex, status: 'FAILED', reason: 'INVALID_TARGET_DAY' });
            continue;
          }
          const order = await tx.order.findFirst({
            where: { id: m.orderId, deletedAt: null, isArchived: false },
            select: {
              id: true,
              model: true,
              assignedDay: true,
              plannedDate: true,
              taskStatus: true,
              isDrawingReady: true,
              isMaterialReady: true,
            },
          });
          if (!order) {
            rejectedMutations.push({ mutation: m, reason: `订单 ${m.orderId} 不存在或已归档，无法排产。` });
            executionResults.push({ mutationIndex, status: 'FAILED', reason: 'ORDER_NOT_FOUND' });
            continue;
          }
          if (!canEnterSchedule(order)) {
            const reasons = getScheduleBlockReasons(order);
            const reason = `AI 建议已被系统拦截：${formatScheduleBlockMessage(order, reasons)}`;
            rejectedMutations.push({ mutation: m, reason });
            executionResults.push({
              mutationIndex,
              status: 'BLOCKED',
              reason: reasons[0] || 'SCHEDULE_NOT_ALLOWED',
            });
            continue;
          }
          const updateData: Prisma.OrderUpdateManyMutationInput = {
            assignedDay: day.assignedDay,
            taskStatus: 'SCHEDULED',
          };
          if (m.plannedDate && isIsoDate(m.plannedDate)) updateData.plannedDate = m.plannedDate;
          const result = await tx.order.updateMany({
            where: { id: m.orderId, deletedAt: null, isArchived: false },
            data: updateData,
          });
          if (result.count > 0) {
            await tx.mesActivityLog.create({
              data: {
                ts: Date.now(),
                text: `AI计划员建议经人工确认后执行排产：订单 ${order.model} 安排到 ${day.chinese}${m.reason ? `；原因：${m.reason}` : ''}`,
                operator: 'AI Planner',
                role: 'planner',
                actionType: 'ai_schedule_apply',
              },
            });
          }
          updatedOrders += result.count;
          executionResults.push({ mutationIndex, status: 'EXECUTED' });
          continue;
        }

        if (m.type === 'UPDATE_ORDER_DATE') {
          if (!isIsoDate(m.newDate) || !m.orderId) continue;
          const order = await tx.order.findFirst({
            where: { id: m.orderId, deletedAt: null, isArchived: false },
            select: {
              id: true,
              model: true,
              assignedDay: true,
              plannedDate: true,
              taskStatus: true,
              isDrawingReady: true,
              isMaterialReady: true,
            },
          });
          if (!order || !canEnterSchedule(order)) {
            const reasons = order ? getScheduleBlockReasons(order) : [];
            const reason = order
              ? `AI 建议已被系统拦截：${formatScheduleBlockMessage(order, reasons)}`
              : `AI 建议已被系统拦截：订单 ${m.orderId} 不存在或已归档，禁止排产。`;
            rejectedMutations.push({ mutation: m, reason });
            executionResults.push({
              mutationIndex,
              status: 'BLOCKED',
              reason: reasons[0] || 'ORDER_NOT_AVAILABLE',
            });
            continue;
          }
          const result = await tx.order.updateMany({
            where: { id: m.orderId, deletedAt: null, isArchived: false },
            data: {
              plannedDate: m.newDate,
              assignedDay: assignedDayFromYmd(m.newDate),
              taskStatus: 'SCHEDULED',
            },
          });
          updatedOrders += result.count;
          executionResults.push({ mutationIndex, status: 'EXECUTED' });
          continue;
        }

        if (m.type === 'UPDATE_DELIVERY_DATE') {
          if (!isIsoDate(m.newDate) || !m.orderId) continue;
          const result = await tx.order.updateMany({
            where: { id: m.orderId, deletedAt: null, isArchived: false },
            data: { deliveryDate: m.newDate },
          });
          updatedOrders += result.count;
          executionResults.push({ mutationIndex, status: 'EXECUTED' });
          continue;
        }

        if (m.type === 'LOG_EXCEPTION_HOUR') {
          const orderId = m.orderId || fallbackOrder?.id;
          const minutes = Math.max(1, Math.round(Number(m.minutes) || 0));
          const reason = String(m.reason ?? '').trim();
          if (!orderId || !minutes || !reason) continue;
          await tx.mesAbnormalClaim.create({
            data: {
              orderId,
              workerName: 'AI Scheduler Copilot',
              claimedHours: minutes / 60,
              reason: `${reason}${m.orderId ? '' : '（AI 未指定订单，已自动关联当前最早有效订单）'}`,
              status: 'APPROVED',
              createdAt: new Date(),
            },
          });
          exceptionLogs += 1;
          executionResults.push({ mutationIndex, status: 'EXECUTED' });
        }
      }
    });

    if (aiRunId) {
      for (const result of executionResults) {
        await updateAiSuggestionStatusSafe({
          aiRunId,
          mutationIndex: result.mutationIndex,
          status: result.status,
          blockedReason: result.reason,
          resultJson: {
            mutationIndex: result.mutationIndex,
            status: result.status,
            reason: result.reason,
          },
          executedAt: new Date(),
        });
      }
      await completeAiPlannerRunSafe({
        aiRunId,
        status:
          rejectedMutations.length > 0 && executionResults.some((item) => item.status === 'EXECUTED')
            ? 'PARTIALLY_EXECUTED'
            : rejectedMutations.length > 0
              ? 'FAILED'
              : 'EXECUTED',
        executedAt: new Date(),
        responseJson: {
          updatedOrders,
          exceptionLogs,
          rejectedMutations,
        },
      });
    }

    revalidatePath('/');
    return {
      ok: rejectedMutations.length === 0,
      error: rejectedMutations.length > 0 ? `已拦截 ${rejectedMutations.length} 条不符合排产资格的 AI 建议。` : undefined,
      updatedOrders,
      exceptionLogs,
      rejectedMutations,
      unreasonableAlerts: rejectedMutations.map((item) => item.reason),
    };
  } catch (error) {
    const message = safeErrorMessage(error);
    console.error('[executeAiCopilotMutationsAction]', error);
    return {
      ok: false,
      error: `AI 建议执行失败：${message}`,
      updatedOrders,
      exceptionLogs,
      rejectedMutations,
    };
  }
}
