'use server';

import { prisma } from '@/lib/prisma';
import {
  getAiPlannerRunDetailSafe,
  listAiPlannerRunsSafe,
  updateAiSuggestionStatusSafe,
} from '@/lib/aiPlannerAudit';

export async function listAiPlannerRunsAction(limit = 10) {
  const result = await listAiPlannerRunsSafe(limit);
  if (!result.ok) return { ok: false, error: result.reason, data: [] };
  return { ok: true, data: result.data };
}

export async function getAiPlannerRunDetailAction(id: string) {
  const result = await getAiPlannerRunDetailSafe(id);
  if (!result.ok) return { ok: false, error: result.reason, data: null };
  return { ok: true, data: result.data };
}

export async function rejectAiSuggestionAction(suggestionId: string, reason?: string) {
  const id = String(suggestionId ?? '').trim();
  if (!id) return { ok: false, error: 'suggestionId is required' };
  const result = await updateAiSuggestionStatusSafe({
    suggestionId: id,
    status: 'REJECTED',
    blockedReason: reason || '人工忽略/拒绝',
    resultJson: { reason: reason || '人工忽略/拒绝' },
    executedAt: new Date(),
  });
  if (!result.ok) return { ok: false, error: result.reason };
  return { ok: true };
}

export async function checkAiPlannerAuditWritableAction() {
  let testRunId = '';
  try {
    const row = await prisma.aiPlannerRun.create({
      data: {
        status: 'COMPLETED',
        source: 'SYSTEM_CHECK',
        userPrompt: '[SYSTEM_CHECK] AI planner audit writable check',
        replyText: 'AI planner audit writable check passed',
        responseJson: { ok: true, source: 'SYSTEM_CHECK' },
      },
      select: { id: true },
    });
    testRunId = row.id;

    try {
      await prisma.aiPlannerRun.delete({ where: { id: testRunId } });
      return { ok: true };
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message.slice(0, 180) : String(deleteError).slice(0, 180);
      return {
        ok: false,
        reason: `AI 审计写入自检记录已创建但删除失败，可能残留测试记录 ${testRunId}。${message}`,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 220) : String(error).slice(0, 220);
    const reason = /does not exist|P2021|AiPlannerRun/i.test(message)
      ? 'AI 审计表尚未部署，请先执行 prisma/manual_ai_planner_audit.sql'
      : message;
    return { ok: false, reason, testRunId: testRunId || undefined };
  }
}
