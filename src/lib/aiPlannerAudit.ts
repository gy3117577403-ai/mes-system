import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';

type SafeResult<T = unknown> = { ok: true; data: T } | { ok: false; reason: string };

type AuditPrisma = typeof prisma & {
  aiPlannerRun?: {
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
    findMany: (args: unknown) => Promise<unknown>;
    findUnique: (args: unknown) => Promise<unknown>;
  };
  aiContextSnapshot?: {
    create: (args: unknown) => Promise<unknown>;
  };
  aiSuggestion?: {
    createMany: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
    updateMany: (args: unknown) => Promise<unknown>;
  };
};

export type AiPlannerAuditRef = {
  enabled: boolean;
  aiRunId?: string;
  persistenceWarning?: string;
};

export type AiSuggestionPayload = {
  type: string;
  title?: string;
  reason?: string;
  targetOrderId?: string;
  payloadJson?: Prisma.InputJsonValue;
};

const AUDIT_TABLE_WARNING = 'AI 审计表尚未部署，本次分析不会持久化记录';

export function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeReason(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.slice(0, 220);
    if (/does not exist|table .* not found|P2021|AiPlannerRun|AiContextSnapshot|AiSuggestion/i.test(message)) {
      return AUDIT_TABLE_WARNING;
    }
    return message;
  }
  return String(error).slice(0, 220);
}

function auditPrisma(): AuditPrisma {
  return prisma as AuditPrisma;
}

function tableUnavailable(delegate: unknown): SafeResult<never> | null {
  if (!delegate) return { ok: false, reason: AUDIT_TABLE_WARNING };
  if (!process.env.DATABASE_URL?.trim()) return { ok: false, reason: 'DATABASE_URL 未配置，AI 审计记录不可用' };
  return null;
}

export async function createAiPlannerRunSafe(input: {
  status?: string;
  source?: string;
  userPrompt: string;
  operator?: string | null;
  role?: string | null;
  provider?: string | null;
  model?: string | null;
  contextSummaryJson?: Prisma.InputJsonValue;
  contextHash?: string | null;
}): Promise<SafeResult<{ id: string }>> {
  try {
    const db = auditPrisma();
    const unavailable = tableUnavailable(db.aiPlannerRun);
    if (unavailable) return unavailable;
    const row = (await db.aiPlannerRun!.create({
      data: {
        status: input.status ?? 'ANALYZING',
        source: input.source ?? 'AI_PLANNER_WORKSPACE',
        userPrompt: input.userPrompt,
        operator: input.operator ?? null,
        role: input.role ?? null,
        provider: input.provider ?? null,
        model: input.model ?? null,
        contextSummaryJson: input.contextSummaryJson ?? Prisma.JsonNull,
        contextHash: input.contextHash ?? null,
      },
      select: { id: true },
    })) as { id: string };
    return { ok: true, data: { id: row.id } };
  } catch (error) {
    console.error('[createAiPlannerRunSafe]', error);
    return { ok: false, reason: safeReason(error) };
  }
}

export async function saveAiContextSnapshotSafe(input: {
  aiRunId?: string;
  snapshotType?: string;
  orderCount: number;
  contentHash?: string | null;
  contentJson?: Prisma.InputJsonValue;
}): Promise<SafeResult<{ id: string } | null>> {
  if (!input.aiRunId) return { ok: false, reason: AUDIT_TABLE_WARNING };
  try {
    const db = auditPrisma();
    const unavailable = tableUnavailable(db.aiContextSnapshot);
    if (unavailable) return unavailable;
    const row = (await db.aiContextSnapshot!.create({
      data: {
        aiRunId: input.aiRunId,
        snapshotType: input.snapshotType ?? 'SCHEDULER_CONTEXT',
        orderCount: input.orderCount,
        contentHash: input.contentHash ?? null,
        contentJson: input.contentJson ?? Prisma.JsonNull,
      },
      select: { id: true },
    })) as { id: string };
    return { ok: true, data: { id: row.id } };
  } catch (error) {
    console.error('[saveAiContextSnapshotSafe]', error);
    return { ok: false, reason: safeReason(error) };
  }
}

export async function completeAiPlannerRunSafe(input: {
  aiRunId?: string;
  status: 'COMPLETED' | 'FAILED' | 'EXECUTING' | 'EXECUTED' | 'PARTIALLY_EXECUTED';
  responseJson?: Prisma.InputJsonValue;
  replyText?: string | null;
  durationMs?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  executedAt?: Date | null;
}): Promise<SafeResult<null>> {
  if (!input.aiRunId) return { ok: false, reason: AUDIT_TABLE_WARNING };
  try {
    const db = auditPrisma();
    const unavailable = tableUnavailable(db.aiPlannerRun);
    if (unavailable) return unavailable;
    await db.aiPlannerRun!.update({
      where: { id: input.aiRunId },
      data: {
        status: input.status,
        responseJson: input.responseJson ?? undefined,
        replyText: input.replyText ?? undefined,
        durationMs: input.durationMs ?? undefined,
        errorCode: input.errorCode ?? undefined,
        errorMessage: input.errorMessage ?? undefined,
        executedAt: input.executedAt ?? undefined,
      },
    });
    return { ok: true, data: null };
  } catch (error) {
    console.error('[completeAiPlannerRunSafe]', error);
    return { ok: false, reason: safeReason(error) };
  }
}

export async function createAiSuggestionsSafe(input: {
  aiRunId?: string;
  suggestions: AiSuggestionPayload[];
}): Promise<SafeResult<{ count: number }>> {
  if (!input.aiRunId) return { ok: false, reason: AUDIT_TABLE_WARNING };
  if (input.suggestions.length === 0) return { ok: true, data: { count: 0 } };
  try {
    const db = auditPrisma();
    const unavailable = tableUnavailable(db.aiSuggestion);
    if (unavailable) return unavailable;
    const result = (await db.aiSuggestion!.createMany({
      data: input.suggestions.map((suggestion) => ({
        aiRunId: input.aiRunId!,
        type: suggestion.type,
        title: suggestion.title ?? null,
        reason: suggestion.reason ?? null,
        targetOrderId: suggestion.targetOrderId ?? null,
        status: 'PENDING',
        payloadJson: suggestion.payloadJson ?? Prisma.JsonNull,
      })),
    })) as { count: number };
    return { ok: true, data: { count: result.count ?? input.suggestions.length } };
  } catch (error) {
    console.error('[createAiSuggestionsSafe]', error);
    return { ok: false, reason: safeReason(error) };
  }
}

export async function updateAiSuggestionStatusSafe(input: {
  aiRunId?: string;
  suggestionId?: string;
  mutationIndex?: number;
  status: string;
  resultJson?: Prisma.InputJsonValue;
  blockedReason?: string | null;
  executedAt?: Date | null;
}): Promise<SafeResult<{ count?: number } | null>> {
  if (!input.aiRunId && !input.suggestionId) return { ok: false, reason: AUDIT_TABLE_WARNING };
  try {
    const db = auditPrisma();
    const unavailable = tableUnavailable(db.aiSuggestion);
    if (unavailable) return unavailable;
    const data = {
      status: input.status,
      resultJson: input.resultJson ?? Prisma.JsonNull,
      blockedReason: input.blockedReason ?? null,
      executedAt: input.executedAt ?? (['EXECUTED', 'BLOCKED', 'FAILED', 'REJECTED'].includes(input.status) ? new Date() : null),
    };
    if (input.suggestionId) {
      await db.aiSuggestion!.update({ where: { id: input.suggestionId }, data });
      return { ok: true, data: null };
    }
    const result = (await db.aiSuggestion!.updateMany({
      where: { aiRunId: input.aiRunId, payloadJson: { path: ['mutationIndex'], equals: input.mutationIndex } },
      data,
    })) as { count: number };
    return { ok: true, data: { count: result.count } };
  } catch (error) {
    console.error('[updateAiSuggestionStatusSafe]', error);
    return { ok: false, reason: safeReason(error) };
  }
}

export async function listAiPlannerRunsSafe(limit = 10): Promise<SafeResult<unknown[]>> {
  try {
    const db = auditPrisma();
    const unavailable = tableUnavailable(db.aiPlannerRun);
    if (unavailable) return unavailable;
    const rows = (await db.aiPlannerRun!.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(50, Math.trunc(limit))),
      select: {
        id: true,
        createdAt: true,
        status: true,
        userPrompt: true,
        provider: true,
        model: true,
        durationMs: true,
        executedAt: true,
        _count: { select: { suggestions: true } },
      },
    })) as unknown[];
    return { ok: true, data: rows };
  } catch (error) {
    console.error('[listAiPlannerRunsSafe]', error);
    return { ok: false, reason: safeReason(error) };
  }
}

export async function getAiPlannerRunDetailSafe(id: string): Promise<SafeResult<unknown | null>> {
  if (!id.trim()) return { ok: false, reason: 'AI run id is required' };
  try {
    const db = auditPrisma();
    const unavailable = tableUnavailable(db.aiPlannerRun);
    if (unavailable) return unavailable;
    const row = await db.aiPlannerRun!.findUnique({
      where: { id },
      include: {
        suggestions: { orderBy: { createdAt: 'asc' } },
        contextSnapshots: { orderBy: { createdAt: 'asc' } },
      },
    });
    return { ok: true, data: row };
  } catch (error) {
    console.error('[getAiPlannerRunDetailSafe]', error);
    return { ok: false, reason: safeReason(error) };
  }
}
