'use server';

import { prisma } from '@/lib/prisma';
import { formatMsToShanghaiLocale, shanghaiDateTodayISO } from '@/lib/datetimeShanghai';

/** SiliconFlow OpenAI 相容端點（國內可達，DeepSeek 系列） */
const SILICONFLOW_CHAT_URL = 'https://api.siliconflow.cn/v1/chat/completions';

/** 預設模型 slug；可透過環境變數覆寫 */
const DEFAULT_SF_MODEL = 'deepseek-ai/DeepSeek-V3';

type AiScheduleAssignment = {
  orderId: string;
  assignedDay: string;
  taskStatus: string;
  plannedDate?: string;
};

type AiSchedulePayload = {
  assignments: AiScheduleAssignment[];
};

/**
 * 從模型回覆文字中盡力抽取 JSON（支援裸 JSON 或 ```json 程式碼塊包裹）。
 * 業務意圖：DeepSeek 偶發包一層 markdown，避免排產鏈因此中斷。
 */
function extractJsonObjectText(raw: string): string {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(trimmed);
  if (fence) return fence[1].trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

/**
 * 呼叫 DeepSeek（經 SiliconFlow）對未完成工單做柔性排產，並回寫 `assignedDay`、`taskStatus`、`plannedDate`。
 *
 * 業務意圖：
 * - 僅處理 `taskStatus` 為 `PENDING` 或 `PAUSED` 且未軟刪之工單（排產池）。
 * - System Prompt 強制：交期優先；缺料（isMaterialReady=false）必須排在最後；相同 `model` 盡量同日。
 * - 所有日期語境以 **Asia/Shanghai（UTC+8）** 表述；資料庫時間戳仍為毫秒 Float，不在此函式改動。
 *
 * @returns ok=false 時帶 `error`；成功時 `updated` 為實際寫入筆數
 */
export async function runDeepSeekScheduleAction(): Promise<{
  ok: boolean;
  error?: string;
  updated?: number;
  rawModelPreview?: string;
}> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: '缺少環境變數 DEEPSEEK_API_KEY' };
  }

  const model = (process.env.SILICONFLOW_MODEL ?? DEFAULT_SF_MODEL).trim() || DEFAULT_SF_MODEL;

  try {
    const orders = await prisma.order.findMany({
      where: {
        deletedAt: null,
        isArchived: false,
        taskStatus: { in: ['PENDING', 'PAUSED'] },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (orders.length === 0) {
      return { ok: true, updated: 0, rawModelPreview: '(無待排工單)' };
    }

    const todaySh = shanghaiDateTodayISO();
    const orderPayload = orders.map((o) => ({
      orderId: o.id,
      client: o.client,
      model: o.model,
      qty: o.qty,
      deliveryDate: o.deliveryDate,
      isMaterialReady: o.isMaterialReady,
      isDrawingReady: o.isDrawingReady,
      isUrgent: o.isUrgent,
      createdAtShanghai: formatMsToShanghaiLocale(o.createdAt),
      assignedDayCurrent: o.assignedDay,
      taskStatusCurrent: o.taskStatus,
    }));

    const allowedDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Unscheduled'];

    const system = [
      '你是线束 MES 柔性排产调度器。必须只输出一个 JSON 对象，不要输出任何解释文字。',
      'JSON 顶层字段为 "assignments"：数组，每项含 orderId(string)、assignedDay(string)、taskStatus(string)、plannedDate(string，可选)。',
      `assignedDay 必须从以下英文键中择一：${allowedDays.join(', ')}。`,
      'taskStatus 排产后请使用 SCHEDULED（已排入产线日历）；若仍缺料无法排入任何工作日，可用 PAUSED 并令 assignedDay 为 Unscheduled。',
      'plannedDate 请用 Asia/Shanghai（UTC+8）自然语言描述具体日期或星期，例如 "2026-04-21（周一）"。',
      '硬约束（违反视为严重错误）：',
      '1）交期优先：deliveryDate 较早的订单应更早占用工作日；',
      '2）isMaterialReady=false 的订单必须排在所有可排物料已齐订单之后（仍放在 assignments 数组最后段）；',
      '3）尽量将相同 model 的订单排在同一天（assignedDay 相同）。',
      `当前上海日期（锚点）：${todaySh}。`,
    ].join('\n');

    const user = `请根据以下订单 JSON 生成排产结果：\n${JSON.stringify(orderPayload)}`;

    const res = await fetch(SILICONFLOW_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, error: `SiliconFlow HTTP ${res.status}: ${t.slice(0, 500)}` };
    }

    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };

    if (body.error?.message) {
      return { ok: false, error: body.error.message };
    }

    const content = body.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') {
      return { ok: false, error: '模型返回为空' };
    }

    let parsed: AiSchedulePayload;
    try {
      parsed = JSON.parse(extractJsonObjectText(content)) as AiSchedulePayload;
    } catch (e) {
      return {
        ok: false,
        error: `JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`,
        rawModelPreview: content.slice(0, 800),
      };
    }

    if (!parsed.assignments || !Array.isArray(parsed.assignments)) {
      return { ok: false, error: 'JSON 缺少 assignments 数组', rawModelPreview: content.slice(0, 800) };
    }

    const allowed = new Set(allowedDays);
    let updated = 0;

    await prisma.$transaction(async (tx) => {
      for (const a of parsed.assignments) {
        const oid = a.orderId?.trim();
        if (!oid) continue;
        if (!allowed.has(a.assignedDay)) continue;
        const ts = typeof a.taskStatus === 'string' && a.taskStatus.trim() ? a.taskStatus.trim() : 'SCHEDULED';
        const planned =
          typeof a.plannedDate === 'string' && a.plannedDate.trim() ? a.plannedDate.trim() : null;

        const r = await tx.order.updateMany({
          where: {
            id: oid,
            deletedAt: null,
            isArchived: false,
            taskStatus: { in: ['PENDING', 'PAUSED'] },
          },
          data: {
            assignedDay: a.assignedDay,
            taskStatus: ts,
            ...(planned != null ? { plannedDate: planned } : {}),
          },
        });
        updated += r.count;
      }
    });

    return { ok: true, updated, rawModelPreview: content.slice(0, 400) };
  } catch (e) {
    console.error('[runDeepSeekScheduleAction]', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
