'use server';

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
