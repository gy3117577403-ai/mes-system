'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import {
  canEnterSchedule,
  formatScheduleBlockMessage,
  getRequiredPool,
  getScheduleBlockReasons,
} from '@/lib/scheduleEligibility';

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

export type AiCopilotResponse = {
  reply: string;
  unreasonableAlerts: string[];
  proposedMutations: AiCopilotMutation[];
  exportDataSummary: AiCopilotExportRow[];
};

export type AiCopilotActionResult = {
  ok: boolean;
  error?: string;
  data?: AiCopilotResponse;
  rawModelPreview?: string;
};

type DeepSeekChatBody = {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
};

type SchedulerContextBuildResult = {
  context: string;
  warnings: string[];
};

function fallbackAiCopilotResponse(
  reply: string,
  unreasonableAlerts: string[] = ['AI 排单执行失败，请检查模型配置、数据库连接或稍后重试']
): AiCopilotResponse {
  return {
    reply,
    unreasonableAlerts,
    proposedMutations: [],
    exportDataSummary: [],
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

  const context = JSON.stringify({
    currentBaseLimit,
    contextWarnings: warnings,
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

  return { context, warnings };
}

export async function interactWithAiCopilotAction(
  userPrompt: string,
  currentBaseLimit: number
): Promise<AiCopilotActionResult> {
  const prompt = String(userPrompt ?? '').trim();
  if (!prompt) {
    return {
      ok: false,
      error: '请输入 AI 排单指令后再执行。',
      data: fallbackAiCopilotResponse('请输入 AI 排单指令后再执行。', ['用户指令为空，未触发 AI 排单']),
    };
  }

  const apiKey = (process.env.DEEPSEEK_API_KEY ?? '').trim();
  if (!apiKey) {
    return {
      ok: false,
      error: 'AI Key 未配置：请在 Sealos 环境变量中配置 DEEPSEEK_API_KEY。',
      data: fallbackAiCopilotResponse('AI 服务未配置，请在 Sealos 环境变量中配置 API Key', [
        '缺少 DEEPSEEK_API_KEY，无法调用 DeepSeek 官方接口',
      ]),
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
        ['数据库连接失败或 Order 表不可用，无法读取当前排产上下文']
      ),
      rawModelPreview: message.slice(0, 500),
    };
  }

  const system =
    '系统级硬规则：图纸未下发禁止排产，必须保留在技术攻坚池；配料未齐禁止排产，必须保留在仓库配料池；只有 scheduleEligible=true 才允许生成 UPDATE_ORDER_DATE。SOP 未上传仅作为文档提醒，不作为排产拦截条件。违反这些规则的建议会被后端拒绝执行。\n\n' +
    '你是一个顶级的工业 MES 运筹调度副驾与数据审计员。当前系统时间为 2026年5月11日。请阅读系统提供的当前车间排单上下文、每日产能基准以及异常工时台账，并理解用户的自然语言指令（如调单、改交期、记异常）。\n' +
    '请执行以下运筹推演：\n' +
    '1. 回应用户的具体诉求，并在虚拟沙盘中推演调整后的结果。\n' +
    '2. 严格审查本周排盘合理性，指出所有不合理状态（如某日工时溢出上限、交期倒挂违约等）。\n' +
    '3. 如果用户指令包含记录异常工时，请提取相应的分钟数和原因。\n\n' +
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
    '  ]\n' +
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
            content: `当前排产上下文 JSON：${contextResult.context}\n\n用户自然语言指令：${prompt}`,
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
            ['API 接口连接受阻，无法进行大盘评估']
          ),
          contextResult.warnings
        ),
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
          fallbackAiCopilotResponse('AI 接口返回格式异常，无法读取响应 JSON。', ['API 响应体不是合法 JSON']),
          contextResult.warnings
        ),
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
            ['API 返回业务错误，无法进行大盘评估']
          ),
          contextResult.warnings
        ),
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
          ]),
          contextResult.warnings
        ),
      };
    }

    try {
      const parsedResult = JSON.parse(extractJsonObjectText(rawContent));
      return {
        ok: true,
        data: withContextWarnings(normalizeAiPayload(parsedResult), contextResult.warnings),
        rawModelPreview: rawContent.slice(0, 500),
      };
    } catch (parseError) {
      console.error('AI 返回的数据无法解析为严格 JSON:', parseError);
      return {
        ok: true,
        data: withContextWarnings(
          fallbackAiCopilotResponse(
            'AI 专家推演成功，但返回的数据结构格式异常，未能自动渲染大盘。请稍后再试或换个说法。',
            ['AI 输出格式非标准 JSON']
          ),
          contextResult.warnings
        ),
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
        ]),
        contextResult.warnings
      ),
      rawModelPreview: message.slice(0, 500),
    };
  }
}

export async function executeAiCopilotMutationsAction(
  proposedMutations: AiCopilotMutation[]
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

  try {
    await prisma.$transaction(async (tx) => {
      const fallbackOrder = await tx.order.findFirst({
        where: { deletedAt: null, isArchived: false },
        orderBy: [{ deliveryDate: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      });

      for (const m of list) {
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
          continue;
        }

        if (m.type === 'UPDATE_DELIVERY_DATE') {
          if (!isIsoDate(m.newDate) || !m.orderId) continue;
          const result = await tx.order.updateMany({
            where: { id: m.orderId, deletedAt: null, isArchived: false },
            data: { deliveryDate: m.newDate },
          });
          updatedOrders += result.count;
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
        }
      }
    });

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
