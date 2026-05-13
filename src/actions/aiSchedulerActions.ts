'use server';

import { revalidatePath } from 'next/cache';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { AiPlannerUiContext } from '@/types';
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

export type AiCopilotResponse = {
  reply: string;
  unreasonableAlerts: string[];
  proposedMutations: AiCopilotMutation[];
  exportDataSummary: AiCopilotExportRow[];
  plannerReport?: AiPlannerReport;
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
  reason = 'AI 模型未返回结构化计划员报告',
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
      ? `系统规则体检：当前读取订单 ${summary.totalOrders} 条，可排产 ${summary.schedulableOrders} 条，图纸未发 ${summary.blockedByDrawing} 条，物料未齐 ${summary.blockedByMaterial} 条，交期风险 ${summary.riskOrders} 条。${taskHint}${reason}`
      : `系统规则体检：${reason}`,
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

function assignedDayFromYmd(ymd: string): string {
  const weekday = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: 'Asia/Shanghai',
  }).format(new Date(`${ymd}T00:00:00+08:00`));
  const allowed = new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
  return allowed.has(weekday) ? weekday : 'Unscheduled';
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

  const apiKey = (process.env.DEEPSEEK_API_KEY ?? '').trim();
  if (!apiKey) {
    const reply = 'AI 模型未配置，本次先提供系统规则体检结果：模型不会被调用，但订单上下文、排产资格和风险数量仍可用于计划员判断。';
    return {
      ok: true,
      data: withContextWarnings(
        fallbackAiCopilotResponse(reply, ['缺少 DEEPSEEK_API_KEY，当前为系统规则体检结果'], contextResult.summary, sanitizedUiContext),
        contextResult.warnings
      ),
      contextSummary: contextResult.summary,
      audit: { enabled: false, persistenceWarning: 'AI Key 未配置，本次未创建模型分析审计记录' },
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
          { role: 'system', content: system },
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
      return {
        ok: true,
      data: withContextWarnings(
          fallbackAiCopilotResponse(
            `AI 调度大脑响应异常 (HTTP ${res.status})。请检查 API 密钥、模型权限或账户余额。`,
            ['API 接口连接受阻，当前展示系统规则体检结果'],
            contextResult.summary,
            sanitizedUiContext
          ),
          contextResult.warnings
        ),
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
      return {
        ok: true,
        data: withContextWarnings(
          fallbackAiCopilotResponse('AI 接口返回格式异常，无法读取响应 JSON。', ['API 响应体不是合法 JSON'], contextResult.summary, sanitizedUiContext),
          contextResult.warnings
        ),
        contextSummary: contextResult.summary,
        rawModelPreview: message.slice(0, 500),
      };
    }

    if (body.error?.message) {
      console.error('DeepSeek API 返回业务错误:', body.error.message);
      return {
        ok: true,
        data: withContextWarnings(
          fallbackAiCopilotResponse(
            `AI 调度大脑返回错误：${body.error.message.slice(0, 180)}。请检查 API 密钥、模型权限或账户余额。`,
            ['API 返回业务错误，当前展示系统规则体检结果'],
            contextResult.summary,
            sanitizedUiContext
          ),
          contextResult.warnings
        ),
        contextSummary: contextResult.summary,
        rawModelPreview: body.error.message.slice(0, 500),
      };
    }

    const rawContent = body.choices?.[0]?.message?.content;
    if (!rawContent) {
      console.error('DeepSeek API 返回空内容:', body);
      return {
        ok: true,
        data: withContextWarnings(
          fallbackAiCopilotResponse('AI 调度大脑返回为空，未能自动渲染大盘。请稍后再试或换个说法。', [
            'AI 输出为空',
          ], contextResult.summary, sanitizedUiContext),
          contextResult.warnings
        ),
        contextSummary: contextResult.summary,
      };
    }

    try {
      const parsedResult = JSON.parse(extractJsonObjectText(rawContent));
      const normalized = normalizeAiPayload(parsedResult);
      const data = withContextWarnings(
        normalized.plannerReport ? normalized : { ...normalized, plannerReport: buildFallbackPlannerReport(contextResult.summary, undefined, sanitizedUiContext) },
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
      return {
        ok: true,
        data: withContextWarnings(
          fallbackAiCopilotResponse(
            'AI 专家推演成功，但返回的数据结构格式异常，未能自动渲染大盘。请稍后再试或换个说法。',
            ['AI 输出格式非标准 JSON'],
            contextResult.summary,
            sanitizedUiContext
          ),
          contextResult.warnings
        ),
        contextSummary: contextResult.summary,
        rawModelPreview: rawContent.slice(0, 500),
      };
    }
  } catch (error) {
    const message = safeErrorMessage(error);
    console.error('[interactWithAiCopilotAction] DeepSeek request failed:', error);
    return {
      ok: true,
      data: withContextWarnings(
        fallbackAiCopilotResponse('AI 调度大脑连接异常。请检查网络、API 密钥或账户状态。', [
          'AI 接口调用异常，无法进行大盘评估',
        ], contextResult.summary, sanitizedUiContext),
        contextResult.warnings
      ),
      contextSummary: contextResult.summary,
      rawModelPreview: message.slice(0, 500),
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
